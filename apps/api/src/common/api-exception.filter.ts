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
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<CorrelatedRequest>();
    const response = context.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const parsed = parseException(exception, status);
    const body: ApiErrorResponse = {
      error: {
        code: errorCodes[status] ?? 'INTERNAL_ERROR',
        correlationId: request.correlationId,
        message: parsed.message,
        timestamp: new Date().toISOString(),
        ...(parsed.details.length > 0 ? { details: parsed.details } : {}),
      },
    };

    response.status(status).json(body);
  }
}

function parseException(
  exception: unknown,
  status: number,
): { details: ApiErrorDetail[]; message: string } {
  if (!(exception instanceof HttpException)) {
    return { details: [], message: 'An unexpected error occurred' };
  }

  const exceptionResponse = exception.getResponse();
  if (typeof exceptionResponse === 'string') {
    return { details: [], message: exceptionResponse };
  }

  const message = isRecord(exceptionResponse) ? exceptionResponse['message'] : undefined;
  if (Array.isArray(message)) {
    return {
      details: message.map((entry) => ({ message: String(entry) })),
      message: 'Request validation failed',
    };
  }

  if (typeof message === 'string') {
    return { details: [], message };
  }

  return {
    details: [],
    message: status >= 500 ? 'A service dependency is unavailable' : 'Request failed',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
