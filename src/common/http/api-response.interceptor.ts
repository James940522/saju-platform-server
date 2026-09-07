import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import {
  RESPONSE_CONTRACT_METADATA,
  type ResponseContractOptions,
} from './response-contract.decorator.js';

const DEFAULT_SUCCESS_MESSAGE = '요청을 성공적으로 처리했습니다.';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const response = httpContext.getResponse<Response>();

    if (response.statusCode === HttpStatus.NO_CONTENT) {
      return next.handle();
    }

    const responseContract =
      this.reflector.getAllAndOverride<ResponseContractOptions>(
        RESPONSE_CONTRACT_METADATA,
        [context.getHandler(), context.getClass()],
      );

    return next.handle().pipe(
      map((data) => {
        const validatedData = responseContract
          ? responseContract.schema.parse(data)
          : data;

        return {
          code: response.statusCode,
          message: responseContract?.message ?? DEFAULT_SUCCESS_MESSAGE,
          data: validatedData,
        };
      }),
    );
  }
}
