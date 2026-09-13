import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/environment.schema.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AccountWithdrawalService } from './account-withdrawal.service.js';

@Injectable()
export class AccountWithdrawalWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | undefined;
  private readonly logger = new Logger(AccountWithdrawalWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly withdrawals: AccountWithdrawalService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit() {
    if (
      !this.config.get('ACCOUNT_WITHDRAWAL_ENABLED', { infer: true }) ||
      this.config.get('NODE_ENV', { infer: true }) === 'test'
    )
      return;
    this.timer = setInterval(() => this.tick(), 10_000);
    this.timer.unref();
    this.tick();
  }

  private tick() {
    if (this.running) return;
    this.running = this.runDue()
      .catch(() => {
        this.logger.error('account_withdrawal_worker_unavailable');
      })
      .finally(() => {
        this.running = undefined;
      });
  }

  async runDue() {
    const now = new Date();
    const jobs = await this.prisma.accountWithdrawal.findMany({
      where: {
        nextAttemptAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: 10,
      select: { authSubject: true },
    });
    for (const job of jobs) await this.withdrawals.process(job.authSubject);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
