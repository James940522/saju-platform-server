import { randomUUID } from 'node:crypto';
import {
  HttpException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/environment.schema.js';
import { PrismaService } from '../../database/prisma.service.js';
import { UserStatus } from '../../generated/prisma/client.js';
import { WealthRankingService } from './wealth-ranking.service.js';
import type { ReadingJobStage } from './reading-job.contract.js';
import { getWealthRankingFailureDiagnostic } from './wealth-ranking-failure.js';
import { WealthRankingDeadline } from './wealth-ranking-deadline.js';
import { WEALTH_RANKING_JOB_TIMEOUT_MS } from '../../config/wealth-ranking-runtime.config.js';

const LEASE_MS = 60_000;
const CONCURRENCY = 2;
const POLL_INTERVAL_MS = 2000;
const POLL_WAIT_LOG_INTERVAL_MS = 10_000;

@Injectable()
export class ReadingJobsWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly running = new Set<Promise<void>>();
  private polling = false;
  private pollStartedAt = 0;
  private lastPollWaitLogAt = 0;
  private pollStage = 'idle';
  private stopping = false;
  private readonly logger = new Logger(ReadingJobsWorker.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly wealthRanking: WealthRankingService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit() {
    const enabled =
      this.config.get('NODE_ENV', { infer: true }) !== 'test' &&
      this.config.get('READING_JOBS_WORKER_ENABLED', { infer: true });
    this.logger.log({
      event: 'reading_jobs_worker_configured',
      enabled,
      pollIntervalMs: POLL_INTERVAL_MS,
      concurrency: CONCURRENCY,
    });
    if (!enabled) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
    void this.tick();
  }

  async tick() {
    if (this.stopping) return;
    if (this.polling) {
      const now = Date.now();
      if (now - this.lastPollWaitLogAt >= POLL_WAIT_LOG_INTERVAL_MS) {
        this.lastPollWaitLogAt = now;
        this.logger.warn({
          event: 'reading_jobs_poll_waiting',
          stage: this.pollStage,
          elapsedMs: now - this.pollStartedAt,
        });
      }
      return;
    }
    this.polling = true;
    this.pollStartedAt = Date.now();
    this.lastPollWaitLogAt = this.pollStartedAt;
    try {
      await this.recoverExpired();
      while (!this.stopping && this.running.size < CONCURRENCY) {
        const id = await this.claimNext();
        if (!id) break;
        const task = this.process(id.jobId, id.leaseId)
          .catch(() =>
            this.logger.error({
              event: 'reading_job_worker_storage_failed',
              jobId: id.jobId,
            }),
          )
          .finally(() => this.running.delete(task));
        this.running.add(task);
      }
    } catch {
      // No raw DB error/connection string or participant data in operational logs.
      this.logger.error({
        event: 'reading_job_worker_unavailable',
        stage: this.pollStage,
        elapsedMs: Date.now() - this.pollStartedAt,
      });
    } finally {
      this.polling = false;
      this.pollStage = 'idle';
    }
  }

  async recoverExpired() {
    // Queue time counts too. Expiration revokes the lease so late completions
    // cannot overwrite a timed-out job, including across worker processes.
    this.pollStage = 'expire_job_deadlines';
    const timedOut = await this.prisma.readingJob.updateMany({
      where: {
        productCode: 'wealth-ranking',
        status: { in: ['queued', 'running'] },
        createdAt: {
          lte: new Date(Date.now() - WEALTH_RANKING_JOB_TIMEOUT_MS),
        },
      },
      data: {
        status: 'failed',
        stage: 'finished',
        errorReason: 'READING_TIMEOUT',
        completedAt: new Date(),
        leaseId: null,
        leaseUntil: null,
      },
    });
    if (timedOut.count)
      this.logger.warn({
        event: 'reading_jobs_deadline_exceeded',
        count: timedOut.count,
        timeoutMs: WEALTH_RANKING_JOB_TIMEOUT_MS,
      });
    const expired = { status: 'running', leaseUntil: { lte: new Date() } };
    // Stage is persisted BEFORE making the non-idempotent external AI call.
    this.pollStage = 'recover_preparing_leases';
    const requeued = await this.prisma.readingJob.updateMany({
      where: { ...expired, stage: 'preparing' },
      data: {
        status: 'queued',
        stage: 'queued',
        leaseId: null,
        leaseUntil: null,
        startedAt: null,
      },
    });
    this.pollStage = 'recover_interpreting_leases';
    const failed = await this.prisma.readingJob.updateMany({
      where: { ...expired, stage: { in: ['interpreting', 'saving'] } },
      data: {
        status: 'failed',
        stage: 'finished',
        errorReason: 'READING_INTERRUPTED',
        completedAt: new Date(),
        leaseId: null,
        leaseUntil: null,
      },
    });
    if (requeued.count || failed.count)
      this.logger.warn({
        event: 'reading_jobs_recovered',
        requeued: requeued.count,
        interrupted: failed.count,
      });
  }

  async claimNext() {
    this.pollStage = 'find_queued_job';
    const job = await this.prisma.readingJob.findFirst({
      where: { status: 'queued', owner: { status: UserStatus.ACTIVE } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!job) return null;
    const leaseId = randomUUID();
    this.pollStage = 'claim_queued_job';
    const claimed = await this.prisma.readingJob.updateMany({
      where: { id: job.id, status: 'queued' },
      data: {
        status: 'running',
        stage: 'preparing',
        startedAt: new Date(),
        leaseId,
        leaseUntil: new Date(Date.now() + LEASE_MS),
      },
    });
    return claimed.count ? { jobId: job.id, leaseId } : null;
  }

  async process(jobId: string, leaseId: string) {
    let deadline: WealthRankingDeadline | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let heartbeatRunning: Promise<void> | undefined;
    let lostLease = false;
    const owned = () => ({
      id: jobId,
      status: 'running',
      leaseId,
      leaseUntil: { gt: new Date() },
    });
    const renew = async () => {
      try {
        const result = await this.prisma.readingJob.updateMany({
          where: owned(),
          data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
        });
        if (!result.count) lostLease = true;
      } catch {
        lostLease = true;
      }
    };
    try {
      const job = await this.prisma.readingJob.findFirst({
        where: owned(),
        select: {
          ownerUserId: true,
          productCode: true,
          requestId: true,
          createdAt: true,
          owner: { select: { authSubject: true } },
          participants: {
            orderBy: { position: 'asc' },
            select: { chartId: true },
          },
        },
      });
      if (!job) return;
      heartbeat = setInterval(() => {
        if (!heartbeatRunning)
          heartbeatRunning = renew().finally(() => {
            heartbeatRunning = undefined;
          });
      }, 10_000);
      heartbeat.unref();
      this.logger.log({
        event: 'reading_job_started',
        jobId,
        requestId: job.requestId,
      });
      const progress = async (stage: ReadingJobStage) => {
        if (lostLease) throw new Error('Reading lease lost');
        const updated = await this.prisma.readingJob.updateMany({
          where: owned(),
          data: { stage },
        });
        if (!updated.count) throw new Error('Reading lease lost');
        this.logger.log({
          event: 'reading_job_progress',
          jobId,
          requestId: job.requestId,
          stage,
        });
      };
      // Add a product-specific executor here only when that product is implemented.
      if (job.productCode !== 'wealth-ranking')
        throw new Error('Unsupported reading product');
      const execution = new WealthRankingDeadline(
        job.createdAt.getTime() + WEALTH_RANKING_JOB_TIMEOUT_MS,
      );
      deadline = execution;
      await execution.run(async () => {
        const result = await this.wealthRanking.create(
          job.owner.authSubject,
          { chartIds: job.participants.map((p) => p.chartId) },
          job.requestId,
          progress,
          execution,
        );
        if (lostLease) return;
        execution.remainingMs();
        const saved = await this.prisma.$transaction(
          async (tx) => {
            // Serialize completion with profile deletion and withdrawal; never resurrect data.
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${job.ownerUserId}::uuid FOR UPDATE`;
            execution.remainingMs();
            const updated = await tx.readingJob.updateMany({
              where: { ...owned(), owner: { status: UserStatus.ACTIVE } },
              data: {
                result,
                status: 'succeeded',
                stage: 'finished',
                completedAt: new Date(),
                leaseId: null,
                leaseUntil: null,
              },
            });
            // Throwing inside the transaction rolls back a late write.
            execution.remainingMs();
            return updated;
          },
          {
            maxWait: Math.min(2000, execution.remainingMs()),
            timeout: Math.min(5000, execution.remainingMs()),
          },
        );
        if (saved.count)
          this.logger.log({
            event: 'reading_job_succeeded',
            jobId,
            requestId: job.requestId,
            durationMs: Date.now() - job.createdAt.getTime(),
          });
      });
    } catch (error: unknown) {
      const diagnostic = getWealthRankingFailureDiagnostic(error);
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const response =
        error instanceof HttpException ? error.getResponse() : null;
      const isReferenceConflict =
        typeof response === 'object' &&
        response !== null &&
        'reason' in response &&
        typeof response.reason === 'string' &&
        [
          'SAJU_CALENDAR_MISMATCH',
          'SAJU_SOLAR_TERM_MISMATCH',
          'SAJU_SOLAR_TERM_BOUNDARY_UNCERTAIN',
        ].includes(response.reason);
      const reason =
        status === 504
          ? 'READING_TIMEOUT'
          : isReferenceConflict
            ? 'SAJU_REFERENCE_CONFLICT'
            : 'READING_FAILED';
      const saved = await this.prisma.readingJob.updateMany({
        where: owned(),
        data: {
          status: 'failed',
          stage: 'finished',
          errorReason: reason,
          completedAt: new Date(),
          leaseId: null,
          leaseUntil: null,
        },
      });
      if (saved.count)
        this.logger.error({
          event: 'reading_job_failed',
          jobId,
          reason,
          diagnostic,
        });
    } finally {
      deadline?.dispose();
      if (heartbeat) clearInterval(heartbeat);
      await heartbeatRunning;
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    // In-flight jobs keep their lease for another process to reconcile. Shutdown
    // must not wait for the AI; provider shutdown aborts its transport.
  }
}
