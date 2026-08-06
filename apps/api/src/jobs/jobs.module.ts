import { Module } from '@nestjs/common';

import { JobQueueService } from './job-queue.service.js';

@Module({
  exports: [JobQueueService],
  providers: [JobQueueService],
})
export class JobsModule {}
