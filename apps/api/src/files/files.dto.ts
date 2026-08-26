import { Type } from 'class-transformer';
import { IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  managedFileParentTypes,
  type ManagedFile,
  type ManagedFilePage,
  type ManagedFileParentType,
  type ManagedFileStatus,
} from '@vista/contracts';

export class ManagedFileDto implements ManagedFile {
  @ApiProperty({ type: Number })
  byteSize!: number;

  @ApiProperty({ type: String })
  checksumSha256!: string;

  @ApiProperty({ format: 'date-time', type: String })
  createdAt!: string;

  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiPropertyOptional({ type: String })
  inspectionMethod?: string;

  @ApiProperty({ type: Boolean })
  isCurrent!: boolean;

  @ApiProperty({ format: 'uuid', type: String })
  issuerAccountId!: string;

  @ApiProperty({ type: String })
  mediaType!: string;

  @ApiProperty({ type: String })
  originalName!: string;

  @ApiProperty({ format: 'uuid', type: String })
  parentId!: string;

  @ApiProperty({ enum: managedFileParentTypes })
  parentType!: ManagedFileParentType;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  scannedAt?: string;

  @ApiProperty({ enum: ['available', 'deleted', 'quarantined', 'rejected'] })
  status!: ManagedFileStatus;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: Number })
  versionCount!: number;

  @ApiProperty({ format: 'uuid', type: String })
  versionGroupId!: string;
}

export class ManagedFilePageDto implements ManagedFilePage {
  @ApiProperty({ isArray: true, type: ManagedFileDto })
  items!: ManagedFileDto[];

  @ApiProperty({ type: Number })
  page!: number;

  @ApiProperty({ type: Number })
  pageSize!: number;

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: Number })
  totalPages!: number;
}

export class ManagedFileListQueryDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  parentId!: string;

  @ApiProperty({ enum: managedFileParentTypes })
  @IsIn(managedFileParentTypes)
  parentType!: ManagedFileParentType;

  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class ManagedFileUploadDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  parentId!: string;

  @ApiProperty({ enum: managedFileParentTypes })
  @IsIn(managedFileParentTypes)
  parentType!: ManagedFileParentType;
}
