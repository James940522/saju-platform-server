import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly shouldConnect: boolean;

  constructor(configService: ConfigService<EnvironmentVariables, true>) {
    const connectionString = configService.get('DATABASE_URL', { infer: true });

    super({
      adapter: new PrismaPg({ connectionString }),
    });

    this.shouldConnect =
      configService.get('NODE_ENV', { infer: true }) !== 'test';
  }

  async onModuleInit() {
    if (this.shouldConnect) {
      await this.$connect();
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
