import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorDetail, ApiErrorResponse } from '@vista/contracts';
import type { Response } from 'express';

import type { CorrelatedRequest } from './correlation-id.middleware.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';

const errorCodes: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'REQUEST_INVALID',
  [HttpStatus.UNAUTHORIZED]: 'AUTHENTICATION_REQUIRED',
  [HttpStatus.FORBIDDEN]: 'PERMISSION_DENIED',
  [HttpStatus.NOT_FOUND]: 'RESOURCE_NOT_FOUND',
  [HttpStatus.CONFLICT]: 'RESOURCE_CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'DEPENDENCY_UNAVAILABLE',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<CorrelatedRequest>();
    const response = context.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const parsed = parseException(exception, status);
    const body: ApiErrorResponse = {
      error: {
        code: parsed.code ?? errorCodes[status] ?? 'INTERNAL_ERROR',
        correlationId: request.correlationId,
        message: parsed.message,
        timestamp: new Date().toISOString(),
        ...(parsed.details.length > 0 ? { details: parsed.details } : {}),
      },
    };

    this.logger.event(status >= 500 ? 'error' : 'warn', 'http.request.failed', {
      correlationId: request.correlationId,
      exceptionType: exception instanceof Error ? exception.constructor.name : typeof exception,
      method: request.method,
      path: request.path,
      statusCode: status,
    });

    response.status(status).json(body);
  }
}

function parseException(
  exception: unknown,
  status: number,
): { code?: string; details: ApiErrorDetail[]; message: string } {
  if (!(exception instanceof HttpException)) {
    return { details: [], message: 'An unexpected error occurred' };
  }

  const exceptionResponse = exception.getResponse();
  if (typeof exceptionResponse === 'string') {
    return { details: [], message: exceptionResponse };
  }

  const message = isRecord(exceptionResponse) ? exceptionResponse['message'] : undefined;
  const code = isRecord(exceptionResponse) ? exceptionResponse['code'] : undefined;
  const details = isRecord(exceptionResponse) ? exceptionResponse['details'] : undefined;
  if (Array.isArray(message)) {
    return {
      details: message.map((entry) => ({ message: String(entry) })),
      message: 'Request validation failed',
    };
  }

  if (typeof message === 'string') {
    return {
      ...(typeof code === 'string' ? { code } : {}),
      details: Array.isArray(details)
        ? details.filter(isApiErrorDetail).map((detail) => ({
            ...(typeof detail['field'] === 'string' ? { field: detail['field'] } : {}),
            message: String(detail['message']),
          }))
        : [],
      message,
    };
  }

  return {
    details: [],
    message: status >= 500 ? 'A service dependency is unavailable' : 'Request failed',
  };
}

function isApiErrorDetail(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value['message'] === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
