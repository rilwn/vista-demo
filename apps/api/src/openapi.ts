import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

export function configureOpenApi(application: INestApplication): OpenAPIObject {
  const configuration = new DocumentBuilder()
    .setTitle('Vista Integrated Information System API')
    .setDescription('Versioned API for Vista Service ERP, CRM, POS, and backup/DR modules.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(application, configuration);
  SwaggerModule.setup('api/docs', application, document);
  return document;
}
