import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth-principal.js';
import { SupabaseAuthService } from './supabase-auth.service.js';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly supabaseAuthService: SupabaseAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);

    if (!match) {
      throw this.createUnauthorizedException();
    }

    const accessToken = match[1];

    if (!accessToken) {
      throw this.createUnauthorizedException();
    }

    const principal =
      await this.supabaseAuthService.verifyAccessToken(accessToken);

    if (!principal) {
      throw this.createUnauthorizedException();
    }

    request.authPrincipal = principal;
    return true;
  }

  private createUnauthorizedException() {
    return new UnauthorizedException({
      message: '로그인이 필요합니다.',
      reason: 'AUTHENTICATION_REQUIRED',
    });
  }
}
