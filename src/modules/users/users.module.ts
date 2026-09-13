import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { AccountWithdrawalService } from './account-withdrawal.service.js';
import { AccountWithdrawalWorker } from './account-withdrawal.worker.js';
import { AccountWithdrawalRateLimitGuard } from './account-withdrawal-rate-limit.guard.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    AccountWithdrawalService,
    AccountWithdrawalWorker,
    AccountWithdrawalRateLimitGuard,
  ],
})
export class UsersModule {}
