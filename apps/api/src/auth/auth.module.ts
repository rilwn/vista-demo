import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RedisModule } from '../database/redis.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginRateLimitGuard } from './login-rate-limit.guard.js';
import { PasswordService } from './password.service.js';
import { SessionAuthenticationGuard } from './session-authentication.guard.js';
import { SessionService } from './session.service.js';
import { TotpService } from './totp.service.js';

@Module({
  controllers: [AuthController],
  exports: [PasswordService, SessionService, TotpService],
  imports: [AuditModule, DatabaseModule, RedisModule],
  providers: [
    AuthService,
    LoginRateLimitGuard,
    PasswordService,
    SessionAuthenticationGuard,
    SessionService,
    TotpService,
    { provide: APP_GUARD, useExisting: SessionAuthenticationGuard },
  ],
})
export class AuthModule {}
