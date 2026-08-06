import { HttpException } from '@nestjs/common';
import type { ApiErrorDetail } from '@vista/contracts';

export class ApiErrorException extends HttpException {
  constructor(code: string, message: string, status: number, details: ApiErrorDetail[] = []) {
    super({ code, ...(details.length === 0 ? {} : { details }), message }, status);
  }
}
