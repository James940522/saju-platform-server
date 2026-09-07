import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { EnvironmentVariables } from './config/environment.schema.js';
import { AppModule } from './app.module.js';
import { configureApplication } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  configureApplication(app, configService);
  app.enableShutdownHooks();

  await app.listen(configService.get('PORT', { infer: true }), '0.0.0.0');
}
await bootstrap();
