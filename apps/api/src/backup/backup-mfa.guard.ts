import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { ApiErrorException } from '../common/api-error.exception.js';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';

@Injectable()
export class BackupMfaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>() as AuthenticatedRequest;
    if (!request.authentication?.twoFactorVerified) {
      throw new ApiErrorException(
        'BACKUP_MFA_REQUIRED',
        'A verified two-factor session is required for the Recovery console.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
