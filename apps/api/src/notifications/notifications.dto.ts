import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class NotificationListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @IsInt()
  @Max(100)
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  pageSize?: number;
}

export class NotificationMessageDto {
  @ApiProperty({ enum: ['in_system'] }) channel!: 'in_system';
  @ApiProperty({ type: String }) createdAt!: string;
  @ApiProperty({ type: String }) deliveredAt!: string;
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ additionalProperties: true, type: Object }) payload!: Record<string, unknown>;
  @ApiPropertyOptional({ type: String }) readAt?: string;
  @ApiProperty({ type: String }) templateKey!: string;
  @ApiProperty({ type: Number }) templateVersion!: number;
}

export class NotificationPageDto {
  @ApiProperty({ type: [NotificationMessageDto] }) items!: NotificationMessageDto[];
  @ApiProperty({ minimum: 0, type: Number }) unreadCount!: number;
}
