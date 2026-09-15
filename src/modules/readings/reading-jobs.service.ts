import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma, UserStatus } from '../../generated/prisma/client.js';
import { KieWealthRankingProvider } from './infrastructure/kie-wealth-ranking.provider.js';
import {
  ReadingJobDataSchema,
  ReadingJobSummarySchema,
  type CreateReadingJob,
  type ReadingJobsQuery,
} from './reading-job.contract.js';
import { WealthRankingDataSchema } from './wealth-ranking.contract.js';
import { ReadingResultDataSchema } from './reading-result.contract.js';
import { renderWealthComparison } from './wealth-ranking-comparison.js';

const SUMMARY_SELECT = {
  id: true,
  productCode: true,
  status: true,
  stage: true,
  errorReason: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  participants: {
    orderBy: { position: 'asc' },
    select: {
      chartId: true,
      chart: { select: { profile: { select: { displayName: true } } } },
    },
  },
} satisfies Prisma.ReadingJobSelect;
type SummaryRecord = Prisma.ReadingJobGetPayload<{
  select: typeof SUMMARY_SELECT;
}>;
const ERROR_MESSAGES: Record<string, string> = {
  READING_INTERRUPTED:
    '풀이 도중 연결이 중단되어 완료를 확인하지 못했어요. 새 풀이를 요청할 수 있어요.',
  READING_TIMEOUT:
    '풀이 제한 시간을 초과했어요. 잠시 후 새 풀이를 요청해주세요.',
  SAJU_REFERENCE_CONFLICT:
    '만세력과 공식 역법 자료를 대조하지 못했어요. 참여자의 사주 정보를 확인해주세요.',
  READING_FAILED: '풀이를 완성하지 못했어요. 잠시 후 새 풀이를 요청해주세요.',
};
function summary(job: SummaryRecord) {
  return ReadingJobSummarySchema.parse({
    id: job.id,
    productCode: job.productCode,
    status: job.status,
    stage: job.stage,
    chartIds: job.participants.map((p) => p.chartId),
    participantNames: job.participants.map((p) => p.chart.profile.displayName),
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    error: job.errorReason
      ? {
          reason: job.errorReason,
          message:
            ERROR_MESSAGES[job.errorReason] ?? ERROR_MESSAGES.READING_FAILED,
        }
      : null,
  });
}
function detail(job: SummaryRecord & { result: Prisma.JsonValue }) {
  const data = summary(job);
  const result =
    job.result === null ? null : WealthRankingDataSchema.parse(job.result);
  // Names are presentation data: reflect renames without recalculating the reading.
  const names = new Map(
    data.chartIds.map((id, index) => [id, data.participantNames[index]]),
  );
  return ReadingJobDataSchema.parse({
    ...data,
    result: result
      ? {
          ...result,
          ranking: result.ranking.map((entry) => ({
            ...entry,
            displayName: names.get(entry.chartId),
          })),
        }
      : null,
  });
}

@Injectable()
export class ReadingJobsService {
  private readonly logger = new Logger(ReadingJobsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: KieWealthRankingProvider,
  ) {}

  async create(
    subject: string,
    request: CreateReadingJob,
    requestKey: string,
    requestId: string,
  ) {
    const requestHash = createHash('sha256')
      .update(JSON.stringify(request))
      .digest('hex');
    const job = await this.prisma.$transaction(async (tx) => {
      // Same row lock as profile writes/withdrawal: ownership and job creation are atomic.
      await tx.$queryRaw`SELECT id FROM users WHERE auth_subject = ${subject}::uuid FOR UPDATE`;
      const owner = await this.activeOwner(subject, tx);
      const previous = await tx.readingRequest.findUnique({
        where: {
          ownerUserId_requestKey: { ownerUserId: owner.id, requestKey },
        },
      });
      if (previous) {
        if (previous.requestHash !== requestHash)
          throw new ConflictException({
            reason: 'IDEMPOTENCY_KEY_REUSED',
            message: '같은 요청 키로 다른 풀이를 요청할 수 없습니다.',
          });
        if (!previous.jobId)
          throw new HttpException(
            {
              reason: 'READING_DELETED',
              message: '참여자 삭제로 이 풀이가 삭제되었습니다.',
            },
            410,
          );
        return tx.readingJob.findUniqueOrThrow({
          where: { id: previous.jobId },
          select: { ...SUMMARY_SELECT, result: true },
        });
      }
      this.provider.assertAvailable();
      const charts = await tx.sajuChart.findMany({
        where: {
          id: { in: request.chartIds },
          profile: { ownerUserId: owner.id, deletedAt: null },
        },
        select: { id: true, profileId: true },
      });
      if (charts.length !== request.chartIds.length)
        throw new NotFoundException({
          reason: 'SAJU_CHART_NOT_FOUND',
          message: '참여자의 사주 정보를 찾을 수 없습니다.',
        });
      if (
        new Set(charts.map((chart) => chart.profileId)).size !== charts.length
      )
        throw new ConflictException({
          reason: 'DUPLICATE_READING_PARTICIPANT',
          message: '서로 다른 참여자를 선택해주세요.',
        });
      if (
        await tx.readingJob.findFirst({
          where: {
            ownerUserId: owner.id,
            status: { in: ['queued', 'running'] },
          },
          select: { id: true },
        })
      )
        throw new ConflictException({
          reason: 'READING_IN_PROGRESS',
          message: '진행 중인 풀이가 있어요. 내 풀이에서 확인해주세요.',
        });
      // Durable quota; idempotent replays do not consume it, even across API replicas.
      if (
        (await tx.readingRequest.count({
          where: {
            ownerUserId: owner.id,
            createdAt: { gte: new Date(Date.now() - 60_000) },
          },
        })) >= 3
      )
        throw new HttpException(
          {
            reason: 'RATE_LIMITED',
            message: '요청이 많아요. 1분 뒤 다시 시도해주세요.',
          },
          429,
        );
      return tx.readingJob.create({
        data: {
          ownerUserId: owner.id,
          productCode: request.productCode,
          requestId,
          participants: {
            create: request.chartIds.map((chartId, position) => ({
              chartId,
              position,
            })),
          },
          requests: {
            create: { ownerUserId: owner.id, requestKey, requestHash },
          },
        },
        select: { ...SUMMARY_SELECT, result: true },
      });
    });
    this.logger.log({
      event: 'reading_job_accepted',
      jobId: job.id,
      requestId,
      status: job.status,
    });
    return detail(job);
  }

  async findOne(subject: string, id: string) {
    const owner = await this.activeOwner(subject);
    const job = await this.prisma.readingJob.findFirst({
      where: {
        id,
        ownerUserId: owner.id,
        owner: { status: UserStatus.ACTIVE },
      },
      select: { ...SUMMARY_SELECT, result: true },
    });
    if (!job)
      throw new NotFoundException({
        reason: 'READING_JOB_NOT_FOUND',
        message: '풀이를 찾을 수 없습니다.',
      });
    return detail(job);
  }

  async findPublicResult(id: string) {
    const job = await this.prisma.readingJob.findFirst({
      where: {
        id,
        productCode: 'wealth-ranking',
        owner: { status: UserStatus.ACTIVE },
        participants: { every: { chart: { profile: { deletedAt: null } } } },
      },
      select: {
        id: true,
        productCode: true,
        status: true,
        stage: true,
        result: true,
        participants: {
          select: {
            chartId: true,
            chart: { select: { profile: { select: { displayName: true } } } },
          },
        },
      },
    });
    if (!job)
      throw new NotFoundException({
        reason: 'READING_JOB_NOT_FOUND',
        message: '풀이를 찾을 수 없습니다.',
      });
    const stored =
      job.status === 'succeeded'
        ? WealthRankingDataSchema.parse(job.result)
        : null;
    const names = new Map(
      job.participants.map((p) => [p.chartId, p.chart.profile.displayName]),
    );
    // Missing/deleted participants must not fall back to a stale stored name.
    if (
      stored &&
      (stored.ranking.length !== names.size ||
        stored.ranking.some((entry) => !names.has(entry.chartId)))
    ) {
      throw new NotFoundException({
        reason: 'READING_JOB_NOT_FOUND',
        message: '풀이를 찾을 수 없습니다.',
      });
    }
    return ReadingResultDataSchema.parse({
      id: job.id,
      productCode: job.productCode,
      status: job.status,
      stage: job.stage,
      result: stored
        ? {
            ranking: stored.ranking.map((entry) => ({
              rank: entry.rank,
              displayName: names.get(entry.chartId),
              fortune: entry.fortune,
            })),
            ...renderWealthComparison(stored, names),
            // Old private notices can contain birth-time/correction details.
            notice:
              '사주에 기반한 참고용 풀이이며 실제 재산이나 미래 수익을 보장하지 않습니다. 입력 정보의 범위에 따라 해석과 상대 순위가 달라질 수 있습니다.',
          }
        : null,
      error:
        job.status === 'failed'
          ? { message: '풀이를 완료하지 못했어요.' }
          : null,
    });
  }

  async findAll(subject: string, query: ReadingJobsQuery) {
    const owner = await this.activeOwner(subject);
    const cursor = query.cursor
      ? await this.prisma.readingJob.findFirst({
          where: { id: query.cursor, ownerUserId: owner.id },
          select: { id: true, createdAt: true },
        })
      : null;
    if (query.cursor && !cursor)
      throw new NotFoundException({
        reason: 'READING_JOB_NOT_FOUND',
        message: '풀이 목록을 다시 불러와주세요.',
      });
    const records = await this.prisma.readingJob.findMany({
      where: {
        ownerUserId: owner.id,
        owner: { status: UserStatus.ACTIVE },
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: SUMMARY_SELECT,
    });
    const jobs = records.slice(0, query.limit).map(summary);
    return {
      jobs,
      nextCursor:
        records.length > query.limit ? (jobs.at(-1)?.id ?? null) : null,
    };
  }

  private async activeOwner(
    subject: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const user = await tx.user.findUnique({
      where: { authSubject: subject },
      select: { id: true, status: true },
    });
    if (!user || user.status === UserStatus.PENDING_REGISTRATION)
      throw new ForbiddenException({
        reason: 'USER_REGISTRATION_REQUIRED',
        message: '가입 확인을 완료해주세요.',
      });
    if (user.status !== UserStatus.ACTIVE)
      throw new ForbiddenException({
        reason: 'USER_ACCESS_DENIED',
        message: '현재 계정으로 풀이를 이용할 수 없습니다.',
      });
    return user;
  }
}
