import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches } from 'class-validator';
import type { SavedCrmReport } from '@vista/contracts';
import { CreateCrmReportExportDto } from './crm-report-exports.dto.js';

export class SavedCrmReportDto extends CreateCrmReportExportDto implements SavedCrmReport {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID()
  id!: string;

  @ApiProperty({ minLength: 1, maxLength: 100, type: String })
  @IsString()
  @Length(1, 100)
  @Matches(/\S/u)
  name!: string;
}

export class SavedCrmReportPageDto {
  @ApiProperty({ type: [SavedCrmReportDto] }) items!: SavedCrmReportDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}
