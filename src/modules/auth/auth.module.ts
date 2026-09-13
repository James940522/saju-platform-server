import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { SupabaseAuthService } from './supabase-auth.service.js';
import { AuthAccountAdminService } from './auth-account-admin.service.js';

@Module({
  providers: [SupabaseAuthService, SupabaseAuthGuard, AuthAccountAdminService],
  exports: [SupabaseAuthService, SupabaseAuthGuard, AuthAccountAdminService],
})
export class AuthModule {}
