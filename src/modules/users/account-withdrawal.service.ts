import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { UserStatus } from '../../generated/prisma/client.js';
import {
  AccountProviderError,
  AuthAccountAdminService,
} from '../auth/auth-account-admin.service.js';
import { SupabaseAuthService } from '../auth/supabase-auth.service.js';
import type { AccountWithdrawalData } from './account-withdrawal.contract.js';
import { lockAuthSubject } from './user-lock.js';

const LEASE_MS = 60_000;

@Injectable()
export class AccountWithdrawalService {
  private readonly logger = new Logger(AccountWithdrawalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AuthAccountAdminService,
    private readonly auth: SupabaseAuthService,
  ) {}

  async withdraw(
    subject: string,
    accessToken: string,
  ): Promise<AccountWithdrawalData> {
    this.admin.requireEnabled();
    const existing = await this.prisma.accountWithdrawal.findUnique({
      where: { authSubject: subject },
    });
    if (!existing) {
      let kakaoUserId: string | null;
      try {
        kakaoUserId = await this.admin.getKakaoIdentity(subject);
      } catch {
        throw new ServiceUnavailableException({
          message: '탈퇴 요청을 접수하지 못했어요. 잠시 후 다시 시도해주세요.',
          reason: 'ACCOUNT_WITHDRAWAL_UNAVAILABLE',
        });
      }
      if (!kakaoUserId)
        throw new UnauthorizedException({
          message: '로그인이 필요합니다.',
          reason: 'AUTHENTICATION_REQUIRED',
        });
      await this.prisma.$transaction(
        async (tx) => {
          await lockAuthSubject(tx, subject);
          if (
            await tx.accountWithdrawal.findUnique({
              where: { authSubject: subject },
            })
          )
            return;
          // Recheck after the lock: an earlier guard may have preceded deletion.
          const principal = await this.auth.verifyAccessToken(accessToken);
          if (principal?.subject !== subject)
            throw new UnauthorizedException({
              message: '로그인이 필요합니다.',
              reason: 'AUTHENTICATION_REQUIRED',
            });
          const user = await tx.user.upsert({
            where: { authSubject: subject },
            create: {
              authSubject: subject,
              status: UserStatus.WITHDRAWN,
              withdrawnAt: new Date(),
            },
            update: {
              status: UserStatus.WITHDRAWN,
              withdrawnAt: new Date(),
              displayName: null,
              primarySajuProfileId: null,
            },
            select: { id: true },
          });
          await tx.readingJob.deleteMany({ where: { ownerUserId: user.id } });
          await tx.readingRequest.deleteMany({ where: { ownerUserId: user.id } });
          await tx.sajuProfile.updateMany({
            where: { ownerUserId: user.id },
            data: { currentChartId: null },
          });
          await tx.sajuProfile.deleteMany({ where: { ownerUserId: user.id } });
          await tx.sajuProfileCreation.deleteMany({
            where: { ownerUserId: user.id },
          });
          await tx.userConsent.deleteMany({ where: { userId: user.id } });
          await tx.accountWithdrawal.create({
            data: { authSubject: subject, kakaoUserId },
          });
        },
        { timeout: 15_000 },
      );
    }
    // Once accepted, any processing failure is pending work, not a failed request.
    try {
      return await this.process(subject);
    } catch {
      this.logger.error('account_withdrawal_processing_unavailable');
      return { status: 'processing' };
    }
  }

  async process(subject: string): Promise<AccountWithdrawalData> {
    const leaseId = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.accountWithdrawal.updateMany({
      where: {
        authSubject: subject,
        nextAttemptAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
      data: {
        leaseId,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      const pending = await this.prisma.accountWithdrawal.findUnique({
        where: { authSubject: subject },
        select: { authSubject: true },
      });
      return { status: pending ? 'processing' : 'completed' };
    }
    const owned = {
      authSubject: subject,
      leaseId,
      leaseUntil: { gt: new Date() },
    };
    try {
      const job = await this.prisma.accountWithdrawal.findUniqueOrThrow({
        where: { authSubject: subject },
      });
      let phase = job.phase;
      if (phase === 'unlink_kakao') {
        // Never unlink by a retained provider ID after the original Auth user is gone.
        const identity = await this.admin.getKakaoIdentity(subject);
        if (identity !== job.kakaoUserId)
          throw new AccountProviderError('AUTH_IDENTITY_CHANGED');
        await this.admin.unlinkKakao(job.kakaoUserId);
        const advanced = await this.prisma.accountWithdrawal.updateMany({
          where: { ...owned, leaseUntil: { gt: new Date() }, phase },
          data: { phase: 'delete_auth', lastError: null },
        });
        if (!advanced.count) return { status: 'processing' };
        phase = 'delete_auth';
      }
      if (phase === 'delete_auth') {
        // Always delete the original opaque Auth ID, never search by Kakao/email.
        await this.admin.deleteAuthUser(subject);
        const advanced = await this.prisma.accountWithdrawal.updateMany({
          where: { ...owned, leaseUntil: { gt: new Date() }, phase },
          data: { phase: 'delete_user', lastError: null },
        });
        if (!advanced.count) return { status: 'processing' };
        phase = 'delete_user';
      }
      if (phase !== 'delete_user')
        throw new AccountProviderError('WITHDRAWAL_PHASE_INVALID');
      const completed = await this.prisma.$transaction(async (tx) => {
        await lockAuthSubject(tx, subject);
        const current = await tx.accountWithdrawal.findFirst({
          where: {
            ...owned,
            leaseUntil: { gt: new Date() },
            phase: 'delete_user',
          },
        });
        if (!current) return false;
        await tx.user.deleteMany({
          where: { authSubject: subject, status: UserStatus.WITHDRAWN },
        });
        await tx.accountWithdrawal.delete({ where: { authSubject: subject } });
        return true;
      });
      return { status: completed ? 'completed' : 'processing' };
    } catch (error: unknown) {
      const job = await this.prisma.accountWithdrawal.findUnique({
        where: { authSubject: subject },
        select: { attempts: true },
      });
      const reason =
        error instanceof AccountProviderError
          ? error.reason
          : 'WITHDRAWAL_STORAGE_UNAVAILABLE';
      const attempts = job?.attempts ?? 1;
      await this.prisma.accountWithdrawal.updateMany({
        where: { authSubject: subject, leaseId },
        data: {
          leaseId: null,
          leaseUntil: null,
          lastError: reason,
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(3_600_000, 5_000 * 2 ** Math.min(attempts - 1, 10)),
          ),
        },
      });
      // Safe operational fields only; no subject, provider ID, token or raw error.
      this.logger.warn({
        event: 'account_withdrawal_retry',
        reason,
        attempts,
        needsAttention: attempts >= 5,
      });
      return { status: 'processing' };
    }
  }
}
