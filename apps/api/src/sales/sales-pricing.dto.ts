import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  priceListScopes,
  type CreateCustomerPriceGroupRequest,
  type CreatePriceListLineRequest,
  type CreatePriceListRequest,
  type CreatePromotionalCampaignRequest,
  type CustomerPriceGroup,
  type PriceList,
  type PriceListLine,
  type PriceListScope,
  type PromotionalCampaign,
  type SalesPricingReferenceData,
  type SalesResolvedPrice,
  type UpdateCustomerPriceGroupRequest,
  type UpdatePriceListRequest,
  type UpdatePromotionalCampaignRequest,
} from '@vista/contracts';

const decimalPattern = /^\d+(\.\d{1,4})?$/u;

export class CreateCustomerPriceGroupDto implements CreateCustomerPriceGroupRequest {
  @ApiProperty({ maxLength: 40, type: String })
  @IsString()
  @MaxLength(40)
  code!: string;

  @ApiProperty({ format: 'uuid', isArray: true, maxItems: 500, type: String })
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('loose', { each: true })
  customerPartnerIds!: string[];

  @ApiProperty({ maxLength: 150, type: String })
  @IsString()
  @MaxLength(150)
  name!: string;
}

export class UpdateCustomerPriceGroupDto implements UpdateCustomerPriceGroupRequest {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiProperty({ format: 'uuid', isArray: true, maxItems: 500, type: String })
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('loose', { each: true })
  customerPartnerIds!: string[];

  @ApiProperty({ maxLength: 150, type: String })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  version!: number;
}

export class CreatePromotionalCampaignDto implements CreatePromotionalCampaignRequest {
  @ApiProperty({ maxLength: 40, type: String })
  @IsString()
  @MaxLength(40)
  code!: string;

  @ApiProperty({ maxLength: 150, type: String })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  validFrom!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  validTo!: string;
}

export class UpdatePromotionalCampaignDto implements UpdatePromotionalCampaignRequest {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiProperty({ maxLength: 150, type: String })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  validFrom!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  validTo!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  version!: number;
}

export class CreatePriceListLineDto implements CreatePriceListLineRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  productId!: string;

  @ApiProperty({ example: '125.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  unitPrice!: string;
}

export class CreatePriceListDto implements CreatePriceListRequest {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  campaignId?: string;

  @ApiProperty({ maxLength: 40, type: String })
  @IsString()
  @MaxLength(40)
  code!: string;

  @ApiProperty({ example: 'BGN', type: String })
  @IsString()
  @Matches(/^[A-Za-z]{3}$/u)
  currencyCode!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  customerGroupId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  customerPartnerId?: string;

  @ApiProperty({ isArray: true, type: CreatePriceListLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CreatePriceListLineDto)
  lines!: CreatePriceListLineDto[];

  @ApiProperty({ maxLength: 150, type: String })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ maximum: 1000, minimum: -1000, type: Number })
  @IsInt()
  @Min(-1000)
  @Max(1000)
  priority!: number;

  @ApiProperty({ enum: priceListScopes })
  @IsIn(priceListScopes)
  scope!: PriceListScope;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  validFrom!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  validTo!: string;
}

export class UpdatePriceListDto extends CreatePriceListDto implements UpdatePriceListRequest {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  version!: number;
}

export class ResolveSalesPriceQueryDto {
  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  asOf!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  customerPartnerId!: string;

  @ApiProperty({ example: 'BGN', maxLength: 3, minLength: 3, type: String })
  @IsString()
  @Matches(/^[A-Za-z]{3}$/u)
  currencyCode!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  productId!: string;
}

class PricingOptionDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

class PricingProductOptionDto extends PricingOptionDto {
  @ApiProperty({ type: String }) productCode!: string;
}

export class CustomerPriceGroupDto implements CustomerPriceGroup {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ format: 'uuid', isArray: true, type: String }) customerPartnerIds!: string[];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ format: 'date-time', type: String }) updatedAt!: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class PromotionalCampaignDto implements PromotionalCampaign {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ format: 'date-time', type: String }) updatedAt!: string;
  @ApiProperty({ format: 'date', type: String }) validFrom!: string;
  @ApiProperty({ format: 'date', type: String }) validTo!: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class PriceListLineDto implements PriceListLine {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) productCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) unitPrice!: string;
}

export class PriceListDto implements PriceList {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiPropertyOptional({ type: PricingOptionDto }) campaign?: PricingOptionDto;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiPropertyOptional({ type: PricingOptionDto }) customer?: PricingOptionDto;
  @ApiPropertyOptional({ type: PricingOptionDto }) customerGroup?: PricingOptionDto;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ isArray: true, type: PriceListLineDto }) lines!: PriceListLine[];
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Number }) priority!: number;
  @ApiProperty({ enum: priceListScopes }) scope!: PriceListScope;
  @ApiProperty({ format: 'date-time', type: String }) updatedAt!: string;
  @ApiProperty({ format: 'date', type: String }) validFrom!: string;
  @ApiProperty({ format: 'date', type: String }) validTo!: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class SalesPricingReferenceDataDto implements SalesPricingReferenceData {
  @ApiProperty({ isArray: true, type: PromotionalCampaignDto })
  campaigns!: PromotionalCampaign[];
  @ApiProperty({ isArray: true, type: CustomerPriceGroupDto })
  customerGroups!: CustomerPriceGroup[];
  @ApiProperty({ isArray: true, type: PricingOptionDto })
  customers!: SalesPricingReferenceData['customers'];
  @ApiProperty({ isArray: true, type: PricingProductOptionDto })
  products!: SalesPricingReferenceData['products'];
}

export class SalesResolvedPriceDto implements SalesResolvedPrice {
  @ApiProperty({ format: 'date', type: String }) asOf!: string;
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ type: Boolean }) matched!: boolean;
  @ApiPropertyOptional({ type: String }) priceListCode?: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) priceListId?: string;
  @ApiPropertyOptional({ type: String }) priceListName?: string;
  @ApiPropertyOptional({ type: Number }) priority?: number;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiPropertyOptional({ type: String }) unitPrice?: string;
}
