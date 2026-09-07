import { type INestApplication, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from './common/http/request-id.middleware.js';
import type { EnvironmentVariables } from './config/environment.schema.js';
import { setupOpenApi } from './openapi.js';

export function configureApplication(
  app: INestApplication,
  configService: ConfigService<EnvironmentVariables, true>,
) {
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(json({ limit: '100kb' }));
  app.use(urlencoded({ extended: true, limit: '100kb' }));
  app.enableCors({
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: configService.get('CORS_ORIGINS', { infer: true }),
  });
  app.enableVersioning({ type: VersioningType.URI });

  setupOpenApi(app);
}
