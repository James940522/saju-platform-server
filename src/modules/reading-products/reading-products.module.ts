import { Module } from '@nestjs/common';
import { ReadingProductsController } from './reading-products.controller.js';
import { ReadingProductsService } from './reading-products.service.js';

@Module({
  controllers: [ReadingProductsController],
  providers: [ReadingProductsService],
})
export class ReadingProductsModule {}
