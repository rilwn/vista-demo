import { Global, Module } from '@nestjs/common';

import { RequestLoggingMiddleware } from './request-logging.middleware.js';
import { StructuredLogger } from './structured-logger.service.js';

@Global()
@Module({
  exports: [RequestLoggingMiddleware, StructuredLogger],
  providers: [RequestLoggingMiddleware, StructuredLogger],
})
export class LoggingModule {}
