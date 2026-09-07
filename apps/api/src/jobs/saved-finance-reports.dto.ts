import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches } from 'class-validator';
import type { SavedFinanceReport } from '@vista/contracts';
import { CreateFinanceReportExportDto } from './finance-report-exports.dto.js';

export class SavedFinanceReportDto
  extends CreateFinanceReportExportDto
  implements SavedFinanceReport
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

export class SavedFinanceReportPageDto {
  @ApiProperty({ type: [SavedFinanceReportDto] }) items!: SavedFinanceReportDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}
