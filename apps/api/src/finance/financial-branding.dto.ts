import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import type {
  FinancialBrandingAsset,
  FinancialBrandingSettings,
  FinancialDocumentBranding,
  SaveFinancialBrandingRequest,
} from '@vista/contracts';

export class FinancialBrandingAssetDto implements FinancialBrandingAsset {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) fileName!: string;
  @ApiProperty({ type: String }) mediaType!: string;
  @ApiProperty({ type: String }) checksumSha256!: string;
  @ApiProperty({ type: Number }) byteSize!: number;
}
export class FinancialDocumentBrandingDto implements FinancialDocumentBranding {
  @ApiProperty({ type: Number }) version!: number;
  @ApiPropertyOptional({ type: FinancialBrandingAssetDto }) logo?: FinancialBrandingAssetDto;
  @ApiPropertyOptional({ type: FinancialBrandingAssetDto }) signature?: FinancialBrandingAssetDto;
  @ApiPropertyOptional({ type: String }) signatoryName?: string;
}
export class FinancialBrandingSettingsDto
  extends FinancialDocumentBrandingDto
  implements FinancialBrandingSettings
{
  @ApiProperty({ type: String, format: 'uuid' }) legalEntityId!: string;
  @ApiProperty({ type: String }) legalEntityName!: string;
}
export class SaveFinancialBrandingDto implements SaveFinancialBrandingRequest {
  @ApiProperty({ type: Number, minimum: 0 }) @IsInt() @Min(0) expectedVersion!: number;
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('loose')
  logoFileId?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('loose')
  signatureFileId?: string;
  @ApiPropertyOptional({ type: String, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  signatoryName?: string;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @IsBoolean() signatureConfirmed?: boolean;
}
