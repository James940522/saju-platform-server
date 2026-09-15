import { ConfigService } from '@nestjs/config';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { EnvironmentVariables } from './config/environment.schema.js';
import { AppModule } from './app.module.js';
import { configureApplication } from './app.setup.js';
import { loggingOptions } from './config/logging.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  app.useLogger(
    new ConsoleLogger(
      loggingOptions({
        NODE_ENV: configService.get('NODE_ENV', { infer: true }),
        LOG_LEVEL: configService.get('LOG_LEVEL', { infer: true }),
      }),
    ),
  );

  configureApplication(app, configService);
  app.enableShutdownHooks();

  await app.listen(configService.get('PORT', { infer: true }), '0.0.0.0');
}
await bootstrap();
