import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { StructuredLogger } from './structured-logger.service.js';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(private readonly logger: StructuredLogger) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = performance.now();

    response.once('finish', () => {
      this.logger.event('info', 'http.request.completed', {
        correlationId: (request as CorrelatedRequest).correlationId,
        durationMs: Math.round(performance.now() - startedAt),
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
      });
    });

    next();
  }
}
