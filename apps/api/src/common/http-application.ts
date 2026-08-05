import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import helmet from 'helmet';

import { ApiExceptionFilter } from './api-exception.filter.js';
import { CorrelationIdMiddleware } from './correlation-id.middleware.js';

export function configureHttpApplication(
  application: INestApplication,
  environment: AppEnvironment,
): void {
  const correlationIds = new CorrelationIdMiddleware();
  application.use(correlationIds.use.bind(correlationIds));
  application.use(helmet(environment.NODE_ENV === 'production' ? {} : { hsts: false }));
  application.enableCors({
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: environment.CORS_ORIGINS,
  });
  application.setGlobalPrefix(environment.API_PREFIX);
  application.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  application.useGlobalFilters(new ApiExceptionFilter());
  application.enableShutdownHooks();
}
