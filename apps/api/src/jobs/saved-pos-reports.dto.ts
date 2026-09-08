import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches } from 'class-validator';
import type { SavedPosReport } from '@vista/contracts';
import { CreatePosReportExportDto } from './pos-report-exports.dto.js';

export class SavedPosReportDto extends CreatePosReportExportDto implements SavedPosReport {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID()
  id!: string;

  @ApiProperty({ minLength: 1, maxLength: 100, type: String })
  @IsString()
  @Length(1, 100)
  @Matches(/\S/u)
  name!: string;
}

export class SavedPosReportPageDto {
  @ApiProperty({ type: [SavedPosReportDto] }) items!: SavedPosReportDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}
