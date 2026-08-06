import { CanActivate, type ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, type Permission } from '@vista/auth';
import type { Request } from 'express';

import { ApiErrorException } from '../common/api-error.exception.js';
import { PUBLIC_ROUTE, REQUIRED_PERMISSIONS } from './auth.decorators.js';
import type { AuthenticatedRequest } from './authentication.types.js';
import { SessionService } from './session.service.js';

@Injectable()
export class SessionAuthenticationGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const publicRoute = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (publicRoute) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = readBearerToken(request.header('authorization'));
    if (!token) {
      throw authenticationRequired();
    }

    let authentication;
    try {
      authentication = await this.sessions.resolve(token);
    } catch {
      throw new ApiErrorException(
        'AUTHENTICATION_UNAVAILABLE',
        'Authentication is temporarily unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!authentication) {
      throw authenticationRequired();
    }
    (request as AuthenticatedRequest).authentication = authentication;

    const required =
      this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.some((permission) => !hasPermission(authentication.permissions, permission))) {
      throw new ApiErrorException(
        'PERMISSION_DENIED',
        'The account does not have permission to perform this action',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}

function readBearerToken(authorization: string | undefined): string | undefined {
  const match = authorization?.match(/^Bearer ([a-zA-Z0-9_-]{43})$/u);
  return match?.[1];
}

function authenticationRequired(): ApiErrorException {
  return new ApiErrorException(
    'AUTHENTICATION_REQUIRED',
    'Authentication is required',
    HttpStatus.UNAUTHORIZED,
  );
}
