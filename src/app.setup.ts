import { type INestApplication, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  json,
  urlencoded,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import helmet from 'helmet';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from './common/http/request-id.middleware.js';
import type { EnvironmentVariables } from './config/environment.schema.js';
import { setupOpenApi } from './openapi.js';
import { requestLoggingMiddleware } from './common/http/request-logging.middleware.js';

export function configureApplication(
  app: INestApplication,
  configService: ConfigService<EnvironmentVariables, true>,
) {
  app.use(requestIdMiddleware);
  app.use(requestLoggingMiddleware());
  app.use(helmet());
  app.use(
    [
      '/v1/saju-profiles',
      '/v1/users/me',
      '/v1/readings',
      '/v1/reading-jobs',
      '/v1/reading-results',
    ],
    (_request: Request, response: Response, next: NextFunction) => {
      response.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  app.use(json({ limit: '100kb' }));
  app.use(urlencoded({ extended: true, limit: '100kb' }));
  app.enableCors({
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: configService.get('CORS_ORIGINS', { infer: true }),
  });
  app.enableVersioning({ type: VersioningType.URI });

  setupOpenApi(app);
}
