import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
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

import { RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  AssignServiceWorkOrderDto,
  CancelServiceRequestDto,
  CompleteServiceWorkOrderDto,
  CreateServiceRequestDto,
  ListServiceRequestsQueryDto,
  ListServiceWorkOrdersQueryDto,
  ServiceEquipmentHistoryDto,
  ServiceReferenceDataDto,
  ServiceRequestDto,
  ServiceRequestPageDto,
  ServiceWorkOrderDto,
  ServiceWorkOrderPageDto,
  ServiceWorkOrderPhotoDto,
  StartServiceWorkOrderDto,
} from './service.dto.js';
import { ServiceOperationsService, type ServicePhotoUpload } from './service.service.js';

interface UploadedPhotoFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@ApiTags('service operations')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('service')
export class ServiceOperationsController {
  constructor(
    @Inject(ServiceOperationsService) private readonly service: ServiceOperationsService,
  ) {}

  @Get('reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.service' })
  @ApiOkResponse({ type: ServiceReferenceDataDto })
  referenceData(@Req() request: AuthenticatedRequest): Promise<ServiceReferenceDataDto> {
    return this.service.referenceData(request.authentication);
  }

  @Get('requests')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.service' })
  @ApiOkResponse({ type: ServiceRequestPageDto })
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    enum: ['new', 'scheduled', 'in_progress', 'completed', 'cancelled'],
    name: 'status',
    required: false,
  })
  requests(
    @Query() query: ListServiceRequestsQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceRequestPageDto> {
    return this.service.requests(query, request.authentication);
  }

  @Get('requests/:id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.service' })
  @ApiOkResponse({ type: ServiceRequestDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  request(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceRequestDto> {
    return this.service.request(id, request.authentication);
  }

  @Get('work-orders/my')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.service' })
  @ApiOkResponse({ type: ServiceWorkOrderPageDto })
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    enum: ['scheduled', 'in_progress', 'completed', 'cancelled'],
    name: 'status',
    required: false,
  })
  myWork(
    @Query() query: ListServiceWorkOrdersQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceWorkOrderPageDto> {
    return this.service.workOrders(query, request.authentication, true);
  }

  @Get('work-orders')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.service' })
  @ApiOkResponse({ type: ServiceWorkOrderPageDto })
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    enum: ['scheduled', 'in_progress', 'completed', 'cancelled'],
    name: 'status',
    required: false,
  })
  workOrders(
    @Query() query: ListServiceWorkOrdersQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceWorkOrderPageDto> {
    return this.service.workOrders(query, request.authentication);
  }

  @Get('work-orders/:id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.service' })
  @ApiOkResponse({ type: ServiceWorkOrderDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  workOrder(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceWorkOrderDto> {
    return this.service.workOrder(id, request.authentication);
  }

  @Get('work-orders/:id/photos/:photoId')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.service' })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOkResponse({
    content: {
      'image/jpeg': { schema: { format: 'binary', type: 'string' } },
      'image/png': { schema: { format: 'binary', type: 'string' } },
      'image/webp': { schema: { format: 'binary', type: 'string' } },
    },
    description: 'Access-controlled service photo evidence.',
  })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiParam({ format: 'uuid', name: 'photoId' })
  async photoContent(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    sendEvidence(response, await this.service.photoEvidence(id, photoId, request.authentication));
  }

  @Get('work-orders/:id/signature')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.service' })
  @ApiProduces('image/png')
  @ApiOkResponse({
    content: { 'image/png': { schema: { format: 'binary', type: 'string' } } },
    description: 'Access-controlled customer signature evidence.',
  })
  @ApiParam({ format: 'uuid', name: 'id' })
  async signatureContent(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    sendEvidence(response, await this.service.signatureEvidence(id, request.authentication));
  }

  @Get('equipment/:id/history')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.service' })
  @ApiOkResponse({ type: ServiceEquipmentHistoryDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  equipmentHistory(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceEquipmentHistoryDto> {
    return this.service.equipmentHistory(id, request.authentication);
  }

  @Post('requests')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.service' })
  @ApiBody({ type: CreateServiceRequestDto })
  @ApiCreatedResponse({ type: ServiceRequestDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createRequest(
    @Body() input: CreateServiceRequestDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceRequestDto> {
    return this.service.createRequest(input, key, request.authentication, metadata(request));
  }

  @Post('requests/:id/assign')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'edit', module: 'erp.service' })
  @ApiBody({ type: AssignServiceWorkOrderDto })
  @ApiCreatedResponse({ type: ServiceRequestDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  assign(
    @Param('id') id: string,
    @Body() input: AssignServiceWorkOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceRequestDto> {
    return this.service.assignWorkOrder(id, input, key, request.authentication, metadata(request));
  }

  @Post('requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'erp.service' })
  @ApiBody({ type: CancelServiceRequestDto })
  @ApiOkResponse({ type: ServiceRequestDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  cancelRequest(
    @Param('id') id: string,
    @Body() input: CancelServiceRequestDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceRequestDto> {
    return this.service.cancelRequest(id, input, key, request.authentication, metadata(request));
  }

  @Post('work-orders/:id/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'erp.service' })
  @ApiBody({ type: StartServiceWorkOrderDto })
  @ApiOkResponse({ type: ServiceWorkOrderDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  startWorkOrder(
    @Param('id') id: string,
    @Body() input: StartServiceWorkOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceWorkOrderDto> {
    return this.service.startWorkOrder(id, input, key, request.authentication, metadata(request));
  }

  @Post('work-orders/:id/photos')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'edit', module: 'erp.service' })
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      properties: { photo: { format: 'binary', type: 'string' } },
      required: ['photo'],
      type: 'object',
    },
  })
  @ApiCreatedResponse({ type: ServiceWorkOrderPhotoDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() photo: UploadedPhotoFile | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceWorkOrderPhotoDto> {
    if (!photo)
      throw new ApiErrorException(
        'SERVICE_PHOTO_REQUIRED',
        'Choose a service photo before uploading.',
        HttpStatus.BAD_REQUEST,
      );
    const input: ServicePhotoUpload = {
      buffer: photo.buffer,
      fileName: photo.originalname,
      mediaType: photo.mimetype,
      sizeBytes: photo.size,
    };
    return this.service.addPhoto(id, input, key, request.authentication, metadata(request));
  }

  @Post('work-orders/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'erp.service' })
  @ApiBody({ type: CompleteServiceWorkOrderDto })
  @ApiOkResponse({ type: ServiceWorkOrderDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  completeWorkOrder(
    @Param('id') id: string,
    @Body() input: CompleteServiceWorkOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceWorkOrderDto> {
    return this.service.completeWorkOrder(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }
}

function metadata(request: AuthenticatedRequest) {
  const correlated = request as CorrelatedRequest;
  const userAgent = request.header('user-agent');
  return {
    correlationId: correlated.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

function sendEvidence(
  response: Response,
  evidence: { content: Buffer; fileName: string; mediaType: string },
): void {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader(
    'Content-Disposition',
    `inline; filename="${safeEvidenceFileName(evidence.fileName)}"`,
  );
  response.setHeader('Content-Type', evidence.mediaType);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.send(evidence.content);
}

function safeEvidenceFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 180) || 'service-evidence';
}
