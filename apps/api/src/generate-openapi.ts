import 'dotenv/config';
import 'reflect-metadata';

import { writeFile } from 'node:fs/promises';

import { NestFactory } from '@nestjs/core';
import type { AppEnvironment } from '@vista/config';

import { AppModule } from './app.module.js';
import { configureHttpApplication } from './common/http-application.js';
import { APP_ENVIRONMENT } from './config/config.module.js';
import { configureOpenApi } from './openapi.js';

async function generateOpenApi(): Promise<void> {
  const application = await NestFactory.create(AppModule, { logger: false });
  const environment = application.get<AppEnvironment>(APP_ENVIRONMENT);
  configureHttpApplication(application, environment);
  const document = configureOpenApi(application);
  await application.init();

  const destination = new URL('../openapi.json', import.meta.url);
  await writeFile(destination, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await application.close();
  process.stdout.write(`Generated ${destination.pathname}\n`);
}

void generateOpenApi();
