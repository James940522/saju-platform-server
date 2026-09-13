import {
  Injectable,
  HttpException,
  HttpStatus,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth-principal.js';

@Injectable()
export class AccountWithdrawalRateLimitGuard implements CanActivate {
  private readonly clients = new Map<
    string,
    { count: number; until: number }
  >();
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    for (const [id, value] of this.clients)
      if (value.until <= now) this.clients.delete(id);
    const key = request.authPrincipal.subject;
    const client = this.clients.get(key) ?? { count: 0, until: now + 60_000 };
    if (
      client.count >= 5 ||
      (!this.clients.has(key) && this.clients.size >= 10_000)
    ) {
      response.setHeader(
        'Retry-After',
        Math.ceil((client.until - now) / 1_000),
      );
      throw new HttpException(
        {
          message: '요청이 많습니다. 잠시 후 다시 시도해주세요.',
          reason: 'RATE_LIMITED',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    client.count += 1;
    this.clients.set(key, client);
    return true;
  }
}
