import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const correlationHeader = 'x-correlation-id';

export interface CorrelatedRequest extends Request {
  correlationId: string;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const suppliedId = request.header(correlationHeader);
    const correlationId = isValidCorrelationId(suppliedId) ? suppliedId : randomUUID();

    (request as CorrelatedRequest).correlationId = correlationId;
    response.setHeader(correlationHeader, correlationId);
    next();
  }
}

function isValidCorrelationId(value: string | undefined): value is string {
  return value !== undefined && /^[a-zA-Z0-9._:-]{1,128}$/.test(value);
}
