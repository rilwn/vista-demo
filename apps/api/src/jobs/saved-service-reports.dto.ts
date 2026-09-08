import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches } from 'class-validator';
import type { SavedServiceReport } from '@vista/contracts';
import { CreateServiceReportExportDto } from './service-report-exports.dto.js';

export class SavedServiceReportDto
  extends CreateServiceReportExportDto
  implements SavedServiceReport
{
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID()
  id!: string;

  @ApiProperty({ minLength: 1, maxLength: 100, type: String })
  @IsString()
  @Length(1, 100)
  @Matches(/\S/u)
  name!: string;
}

export class SavedServiceReportPageDto {
  @ApiProperty({ type: [SavedServiceReportDto] }) items!: SavedServiceReportDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}
