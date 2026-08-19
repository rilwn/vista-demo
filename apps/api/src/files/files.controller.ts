import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import type {
  AuthenticatedRequest,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  ManagedFileDto,
  ManagedFileListQueryDto,
  ManagedFilePageDto,
  ManagedFileUploadDto,
} from './files.dto.js';
import { FilesService, type ManagedFileContent, type ManagedFileUpload } from './files.service.js';

interface UploadedManagedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@ApiTags('managed files')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('files')
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  @Get()
  @RateLimitPolicy('read')
  @ApiQuery({ format: 'uuid', name: 'parentId', type: String })
  @ApiQuery({ enum: ['partner'], name: 'parentType' })
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: ManagedFilePageDto })
  list(
    @Query() query: ManagedFileListQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ManagedFilePageDto> {
    return this.files.list(query, request.authentication);
  }

  @Get(':id/versions')
  @RateLimitPolicy('read')
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ isArray: true, type: ManagedFileDto })
  versions(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ManagedFileDto[]> {
    return this.files.versions(id, request.authentication);
  }

  @Get(':id/content')
  @RateLimitPolicy('read')
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  @ApiOkResponse({
    content: {
      'application/pdf': { schema: { format: 'binary', type: 'string' } },
      'image/jpeg': { schema: { format: 'binary', type: 'string' } },
      'image/png': { schema: { format: 'binary', type: 'string' } },
      'image/webp': { schema: { format: 'binary', type: 'string' } },
    },
    description: 'Authorized content for an available managed file.',
  })
  async content(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    sendContent(response, await this.files.content(id, request.authentication));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      properties: {
        file: { format: 'binary', type: 'string' },
        parentId: { format: 'uuid', type: 'string' },
        parentType: { enum: ['partner'], type: 'string' },
      },
      required: ['file', 'parentId', 'parentType'],
      type: 'object',
    },
  })
  @ApiCreatedResponse({ type: ManagedFileDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  upload(
    @Body() input: ManagedFileUploadDto,
    @UploadedFile() file: UploadedManagedFile | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ManagedFileDto> {
    return this.files.upload(
      input,
      requiredFile(file),
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post(':id/versions')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      properties: { file: { format: 'binary', type: 'string' } },
      required: ['file'],
      type: 'object',
    },
  })
  @ApiCreatedResponse({ type: ManagedFileDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  uploadVersion(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @UploadedFile() file: UploadedManagedFile | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ManagedFileDto> {
    return this.files.uploadVersion(
      id,
      requiredFile(file),
      key,
      request.authentication,
      metadata(request),
    );
  }
}

function requiredFile(file: UploadedManagedFile | undefined): ManagedFileUpload {
  if (!file) {
    throw new ApiErrorException(
      'FILE_REQUIRED',
      'Choose a file before uploading.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return {
    buffer: file.buffer,
    fileName: file.originalname,
    mediaType: file.mimetype,
    sizeBytes: file.size,
  };
}

function metadata(request: AuthenticatedRequest): RequestSecurityMetadata {
  const correlated = request as CorrelatedRequest;
  const userAgent = request.header('user-agent');
  return {
    correlationId: correlated.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

function sendContent(response: Response, content: ManagedFileContent): void {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(content.fileName)}`,
  );
  response.setHeader('Content-Length', String(content.buffer.length));
  response.setHeader('Content-Type', content.mediaType);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.status(HttpStatus.OK).send(content.buffer);
}
