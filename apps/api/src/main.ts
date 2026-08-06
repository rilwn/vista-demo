import 'dotenv/config';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { AppEnvironment } from '@vista/config';

import { AppModule } from './app.module.js';
import { configureHttpApplication } from './common/http-application.js';
import { APP_ENVIRONMENT } from './config/config.module.js';
import { configureOpenApi } from './openapi.js';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create(AppModule, { bufferLogs: true });
  const environment = application.get<AppEnvironment>(APP_ENVIRONMENT);

  configureHttpApplication(application, environment);
  configureOpenApi(application);
  application.flushLogs();
  await application.listen(environment.API_PORT, environment.API_HOST);
}

void bootstrap();
