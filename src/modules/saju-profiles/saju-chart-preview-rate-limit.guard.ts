import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const WINDOW_MS = 60_000;
const REQUEST_LIMIT = 60;
const MAX_CLIENTS = 10_000;

@Injectable()
export class SajuChartPreviewRateLimitGuard implements CanActivate {
  private readonly clients = new Map<
    string,
    { count: number; resetsAt: number }
  >();
  private nextCleanupAt = 0;

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const now = Date.now();
    // Applies to validation errors and throttled responses as well as success.
    response.setHeader('Cache-Control', 'no-store');

    if (now >= this.nextCleanupAt) {
      for (const [key, client] of this.clients) {
        if (client.resetsAt <= now) this.clients.delete(key);
      }
      this.nextCleanupAt = now + WINDOW_MS;
    }

    // Use Express's configured peer IP; never trust a raw forwarded header.
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const previous = this.clients.get(key);
    const client =
      previous && previous.resetsAt > now
        ? previous
        : { count: 0, resetsAt: now + WINDOW_MS };

    if (
      client.count >= REQUEST_LIMIT ||
      (!previous && this.clients.size >= MAX_CLIENTS)
    ) {
      response.setHeader(
        'Retry-After',
        Math.ceil((client.resetsAt - now) / 1000),
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
