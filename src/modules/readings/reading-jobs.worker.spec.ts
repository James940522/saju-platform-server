import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { WealthRankingService } from './wealth-ranking.service.js';
import { ReadingJobsWorker } from './reading-jobs.worker.js';
import {
  wealthCharts,
  wealthModelOutput,
} from '../../../test/fixtures/wealth-ranking.fixture.js';
import { buildWealthRankingContext } from './wealth-ranking-context.js';
import { mapWealthRankingResult } from './wealth-ranking-result.js';

describe('Reading job deadline execution', () => {
  const prisma = {
    readingJob: { findFirst: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const wealth = { create: vi.fn() };
  let worker: ReadingJobsWorker;
  const job = () => ({
    ownerUserId: 'owner',
    productCode: 'wealth-ranking',
    requestId: 'request',
    createdAt: new Date(),
    owner: { authSubject: 'subject' },
    participants: wealthCharts().map(({ chartId }) => ({ chartId })),
  });
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    prisma.readingJob.updateMany.mockResolvedValue({ count: 1 });
    const module = await Test.createTestingModule({
      providers: [
        ReadingJobsWorker,
        { provide: PrismaService, useValue: prisma },
        { provide: WealthRankingService, useValue: wealth },
        {
          provide: ConfigService,
          useValue: new ConfigService({ NODE_ENV: 'test' }),
        },
      ],
    }).compile();
    worker = module.get(ReadingJobsWorker);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('expires queue time before starting any interpretation', async () => {
    prisma.readingJob.findFirst.mockResolvedValue({
      ...job(),
      createdAt: new Date(Date.now() - 301_000),
    });
    await worker.process('job', 'lease');
    expect(wealth.create).not.toHaveBeenCalled();
    expect(prisma.readingJob.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'job',
        status: 'running',
        leaseId: 'lease',
      }),
      data: expect.objectContaining({
        status: 'failed',
        errorReason: 'READING_TIMEOUT',
        leaseId: null,
      }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('stops at the original job deadline and never saves a late result', async () => {
    prisma.readingJob.findFirst.mockResolvedValue({
      ...job(),
      createdAt: new Date(Date.now() - 299_000),
    });
    let resolveOutput!: (
      value: ReturnType<typeof mapWealthRankingResult>,
    ) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    wealth.create.mockImplementation(() => {
      entered();
      return new Promise<ReturnType<typeof mapWealthRankingResult>>(
        (resolve) => {
          resolveOutput = resolve;
        },
      );
    });
    const processing = worker.process('job', 'lease');
    await started;
    await vi.advanceTimersByTimeAsync(1000);
    await processing;
    expect(prisma.readingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorReason: 'READING_TIMEOUT' }),
      }),
    );
    resolveOutput(
      mapWealthRankingResult(
        wealthModelOutput(),
        buildWealthRankingContext(wealthCharts()),
        wealthCharts(),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(wealth.create).toHaveBeenCalledTimes(1);
  });

  it('revokes expired queue and running leases only for wealth ranking', async () => {
    await worker.recoverExpired();
    expect(prisma.readingJob.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        productCode: 'wealth-ranking',
        status: { in: ['queued', 'running'] },
        createdAt: { lte: new Date(Date.now() - 300_000) },
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
  });

  it('reports a stalled DB poll without overlapping it and resumes after rejection', async () => {
    let rejectQuery!: (error: Error) => void;
    prisma.readingJob.updateMany.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectQuery = reject;
        }),
    );
    prisma.readingJob.findFirst.mockResolvedValue(null);
    const pending = worker.tick();
    await vi.advanceTimersByTimeAsync(10_000);
    await worker.tick();
    expect(prisma.readingJob.updateMany).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.warn).toHaveBeenCalledWith({
      event: 'reading_jobs_poll_waiting',
      stage: 'expire_job_deadlines',
      elapsedMs: 10_000,
    });
    rejectQuery(new Error('private DB error must not enter logs'));
    await pending;
    expect(Logger.prototype.error).toHaveBeenCalledWith({
      event: 'reading_job_worker_unavailable',
      stage: 'expire_job_deadlines',
      elapsedMs: 10_000,
    });
    await worker.tick();
    expect(prisma.readingJob.findFirst).toHaveBeenCalledOnce();
    expect(prisma.readingJob.updateMany).toHaveBeenCalledTimes(4);
    expect(wealth.create).not.toHaveBeenCalled();
  });
});
