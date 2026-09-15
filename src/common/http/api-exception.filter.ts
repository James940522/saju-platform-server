import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { getRequestRoute } from './request-logging.middleware.js';
import {
  getRequestId,
  REQUEST_ID_HEADER,
  type RequestWithId,
} from './request-id.middleware.js';

type ErrorPayload = {
  fieldErrors?: unknown;
  message?: unknown;
  reason?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseErrorPayload(value: unknown): ErrorPayload {
  return isRecord(value) ? value : { message: value };
}

function parseFieldErrors(
  value: unknown,
): Record<string, readonly string[]> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const fieldErrors: Record<string, readonly string[]> = {};

  for (const [field, messages] of Object.entries(value)) {
    if (
      Array.isArray(messages) &&
      messages.every((message) => typeof message === 'string')
    ) {
      fieldErrors[field] = messages;
    }
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
}

function getDefaultMessage(status: number) {
  if (status === HttpStatus.NOT_FOUND) {
    return '요청한 리소스를 찾을 수 없습니다.';
  }

  if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
    return '서버 오류가 발생했습니다.';
  }

  return '요청을 처리할 수 없습니다.';
}

function getDefaultReason(status: number) {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'AUTHENTICATION_REQUIRED';
    case HttpStatus.FORBIDDEN:
      return 'ACCESS_DENIED';
    case HttpStatus.NOT_FOUND:
      return 'RESOURCE_NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    default:
      return `HTTP_${status}`;
  }
}

@Catch()
@Injectable()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<RequestWithId>();
    const response = httpContext.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const payload = parseErrorPayload(exceptionResponse);
    // Only expose this fixed public failure; arbitrary 5xx payloads remain private.
    const publicServerError =
      status === HttpStatus.SERVICE_UNAVAILABLE &&
      payload.reason === 'ACCOUNT_WITHDRAWAL_UNAVAILABLE'
        ? {
            reason: 'ACCOUNT_WITHDRAWAL_UNAVAILABLE',
            message:
              '탈퇴 요청을 접수하지 못했어요. 잠시 후 다시 시도해주세요.',
          }
        : null;
    const message =
      publicServerError?.message ??
      (status < HttpStatus.INTERNAL_SERVER_ERROR &&
      typeof payload.message === 'string'
        ? payload.message
        : getDefaultMessage(status));
    const fieldErrors = parseFieldErrors(payload.fieldErrors);
    const reason =
      typeof payload.reason === 'string'
        ? payload.reason
        : getDefaultReason(status);
    const requestId = getRequestId(request);

    response.setHeader(REQUEST_ID_HEADER, requestId);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Prisma error stacks can contain query arguments (including birth data).
      // Keep the request ID for correlation without logging provider messages.
      this.logger.error(
        `${request.method} ${getRequestRoute(request)} failed (requestId=${requestId}, status=${status})`,
      );
    }

    response.status(status).json({
      code: status,
      message,
      data:
        status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? publicServerError
            ? { reason: publicServerError.reason }
            : null
          : {
              reason,
              ...(fieldErrors ? { fieldErrors } : {}),
            },
    });
  }
}
