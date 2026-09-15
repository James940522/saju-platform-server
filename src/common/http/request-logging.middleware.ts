import { Logger } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { getRequestId, type RequestWithId } from './request-id.middleware.js';

// Express assigns this server-owned route template after routing. Never fall
// back to a URL/path: unknown paths, parameters and query strings may hold PII.
export function getRequestRoute(request: RequestWithId): string {
  const route: unknown = request.route;
  if (
    typeof route === 'object' &&
    route !== null &&
    'path' in route &&
    typeof route.path === 'string'
  )
    return route.path;
  return 'unmatched';
}

export function requestLoggingMiddleware() {
  const logger = new Logger('HttpRequest');
  return (request: RequestWithId, response: Response, next: NextFunction) => {
    const requestId = getRequestId(request);
    const method = [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
      'HEAD',
    ].includes(request.method)
      ? request.method
      : 'OTHER';
    const startedAt = performance.now();
    let isLogged = false;
    logger.debug({ event: 'http_request_started', requestId, method });
    const finish = (outcome: 'completed' | 'aborted') => {
      if (isLogged) return;
      isLogged = true;
      const entry = {
        event: 'http_request_finished',
        requestId,
        method,
        route: getRequestRoute(request),
        outcome,
        status: outcome === 'completed' ? response.statusCode : null,
        durationMs: Math.round(performance.now() - startedAt),
      };
      if (response.statusCode >= 500) logger.error(entry);
      else if (outcome === 'aborted' || response.statusCode >= 400)
        logger.warn(entry);
      else logger.log(entry);
    };
    response.once('finish', () => finish('completed'));
    response.once('close', () => finish('aborted'));
    next();
  };
}
