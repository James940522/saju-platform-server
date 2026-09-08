import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { SupabaseAuthService } from './supabase-auth.service.js';

@Module({
  providers: [SupabaseAuthService, SupabaseAuthGuard],
  exports: [SupabaseAuthService, SupabaseAuthGuard],
})
export class AuthModule {}
