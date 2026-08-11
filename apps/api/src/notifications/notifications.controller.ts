import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { NotificationMessage, NotificationPage } from '@vista/contracts';

import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  NotificationListQueryDto,
  NotificationMessageDto,
  NotificationPageDto,
} from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@ApiBearerAuth()
@RateLimitPolicy('read')
@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: NotificationPageDto })
  list(
    @Query() query: NotificationListQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<NotificationPage> {
    return this.notifications.list(request.authentication, query);
  }

  @Post(':id/read')
  @RateLimitPolicy('write')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ type: NotificationMessageDto })
  markRead(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<NotificationMessage> {
    return this.notifications.markRead(id, request.authentication);
  }
}
