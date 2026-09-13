import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth-principal.js';

// Single-process launch limits. Distributed deployment needs a shared limiter.
@Injectable()
export class WealthRankingRateLimitGuard implements CanActivate {
  private readonly clients = new Map<
    string,
    { count: number; resetsAt: number }
  >();

  canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const now = Date.now();
    for (const [key, entry] of this.clients) {
      if (entry.resetsAt <= now) this.clients.delete(key);
    }
    // Guard runs after token validation. IP spoofing cannot reset user quotas.
    const key = request.authPrincipal.subject;
    const entry = this.clients.get(key) ?? { count: 0, resetsAt: now + 60_000 };
    if (
      entry.count >= 3 ||
      (!this.clients.has(key) && this.clients.size >= 10_000)
    ) {
      response.setHeader(
        'Retry-After',
        Math.max(1, Math.ceil((entry.resetsAt - now) / 1000)),
      );
      throw new HttpException(
        {
          message: '요청이 많습니다. 잠시 후 다시 시도해주세요.',
          reason: 'RATE_LIMITED',
        },
        429,
      );
    }
    entry.count += 1;
    this.clients.set(key, entry);
    return true;
  }
}
