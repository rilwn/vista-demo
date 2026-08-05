import { Module } from '@nestjs/common';

import { RedisService } from './redis.service.js';

@Module({
  exports: [RedisService],
  providers: [RedisService],
})
export class RedisModule {}
