import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type {
  CreatePosDiscountAuthorizationRequest,
  CreatePosReturnLineRequest,
  CreatePosReturnRefundRequest,
  CreatePosReturnRequest,
  CreatePosSalePaymentRequest,
  CreatePosSaleRequest,
  CreatePosSaleLineRequest,
  ClosePosShiftRequest,
  EnrolPosLoyaltyRequest,
  OpenPosShiftRequest,
  PosBasketPricing,
  PosCatalogItem,
  PosCatalogPage,
  PosCustomerOption,
  PosCustomerPaymentOptions,
  PosDiscountAuthorization,
  PosDiscountType,
  PosLoyaltyAccount,
  PosLoyaltyLedger,
  PosManualDiscountRequest,
  PosPricingAdjustment,
  PosQuickAccess,
  PosReturn,
  PosReturnLine,
  PosReturnPage,
  PosReturnRefund,
  PosSale,
  PosSaleInvoiceDocument,
  PosSaleLine,
  PosSalePayment,
  PosSalePage,
  PosShift,
  PosTerminalContext,
  PosVatTreatment,
  PosWarrantyCardDocument,
  PricePosBasketRequest,
  UpdatePosQuickAccessRequest,
} from '@vista/contracts';

const decimalPattern = /^\d+(\.\d{1,4})?$/u;

export class PosCatalogQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  customerPartnerId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 24, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 24;

  @ApiPropertyOptional({ maxLength: 120, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  shiftId!: string;
}

export class PosCustomerQueryDto {
  @ApiPropertyOptional({ maxLength: 120, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class PosQuickAccessQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  customerPartnerId?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  shiftId!: string;
}

export class UpdatePosQuickAccessDto implements UpdatePosQuickAccessRequest {
  @ApiProperty({ format: 'uuid', isArray: true, maxItems: 12, type: String })
  @IsArray()
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsUUID('loose', { each: true })
  productIds!: string[];

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  shiftId!: string;
}

export class PosSalePageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export class PosReturnPageQueryDto extends PosSalePageQueryDto {}

export class OpenPosShiftDto implements OpenPosShiftRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  cashRegisterId!: string;

  @ApiProperty({ example: '100.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  openingCashBgn!: string;
}

export class ClosePosShiftDto implements ClosePosShiftRequest {
  @ApiProperty({ example: '160.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  closingCashBgn!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  version!: number;
}

export class CreatePosSaleLineDto implements CreatePosSaleLineRequest {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  batchId?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  productId!: string;

  @ApiProperty({ example: '1.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  quantity!: string;

  @ApiPropertyOptional({ isArray: true, maxItems: 100, type: String })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  serialNumbers?: string[];
}

export class PosManualDiscountDto implements PosManualDiscountRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  authorizationId!: string;

  @ApiProperty({ enum: ['fixed_amount', 'percentage'] })
  @IsIn(['fixed_amount', 'percentage'])
  discountType!: PosDiscountType;

  @ApiProperty({ example: '10.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  discountValue!: string;
}

export class PricePosBasketDto implements PricePosBasketRequest {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  customerPartnerId?: string;

  @ApiProperty({ isArray: true, type: CreatePosSaleLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePosSaleLineDto)
  lines!: CreatePosSaleLineDto[];

  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  loyaltyPointsToRedeem?: number;

  @ApiPropertyOptional({ type: PosManualDiscountDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PosManualDiscountDto)
  manualDiscount?: PosManualDiscountDto;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  shiftId!: string;
}

export class CreatePosDiscountAuthorizationDto implements CreatePosDiscountAuthorizationRequest {
  @ApiProperty({ format: 'email', type: String })
  @IsEmail()
  @MaxLength(320)
  approverEmail!: string;

  @ApiProperty({ maxLength: 128, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  approverPassword!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  customerPartnerId?: string;

  @ApiProperty({ enum: ['fixed_amount', 'percentage'] })
  @IsIn(['fixed_amount', 'percentage'])
  discountType!: PosDiscountType;

  @ApiProperty({ example: '10.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  discountValue!: string;

  @ApiProperty({ isArray: true, type: CreatePosSaleLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePosSaleLineDto)
  lines!: CreatePosSaleLineDto[];

  @ApiProperty({ maxLength: 500, minLength: 3, type: String })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  shiftId!: string;

  @ApiPropertyOptional({ pattern: '^\\d{6}$', type: String })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/u)
  totpCode?: string;
}

export class EnrolPosLoyaltyDto implements EnrolPosLoyaltyRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  customerPartnerId!: string;
}

export class CreatePosSalePaymentDto implements CreatePosSalePaymentRequest {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  advanceId?: string;

  @ApiProperty({ example: '60.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  amount!: string;

  @ApiProperty({ enum: ['advance', 'card', 'cash', 'on_account'] })
  @IsIn(['advance', 'card', 'cash', 'on_account'])
  method!: CreatePosSalePaymentRequest['method'];

  @ApiPropertyOptional({ example: '100.0000', type: String })
  @IsOptional()
  @IsString()
  @Matches(decimalPattern)
  tenderedAmount?: string;
}

export class CreatePosSaleDto implements CreatePosSaleRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  clientTransactionId!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  customerLocationId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  customerPartnerId?: string;

  @ApiProperty({ isArray: true, type: CreatePosSaleLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePosSaleLineDto)
  lines!: CreatePosSaleLineDto[];

  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  loyaltyPointsToRedeem?: number;

  @ApiPropertyOptional({ type: PosManualDiscountDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PosManualDiscountDto)
  manualDiscount?: PosManualDiscountDto;

  @ApiProperty({ isArray: true, type: CreatePosSalePaymentDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => CreatePosSalePaymentDto)
  payments!: CreatePosSalePaymentDto[];

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  shiftId!: string;
}

class PosRegisterOptionDto {
  @ApiProperty({ format: 'uuid', type: String }) businessLocationId!: string;
  @ApiProperty({ type: String }) businessLocationName!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiPropertyOptional({ type: String }) fiscalDeviceLabel?: string;
  @ApiProperty({ enum: ['disabled', 'hardware', 'simulator'] })
  fiscalMode!: 'disabled' | 'hardware' | 'simulator';
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) operatorCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) operatorId!: string;
  @ApiPropertyOptional({ type: String }) paymentTerminalLabel?: string;
  @ApiProperty({ enum: ['disabled', 'hardware', 'simulator'] })
  paymentTerminalMode!: 'disabled' | 'hardware' | 'simulator';
  @ApiPropertyOptional({ format: 'uuid', type: String }) serviceReturnWarehouseId?: string;
  @ApiPropertyOptional({ type: String }) serviceReturnWarehouseName?: string;
  @ApiProperty({ format: 'uuid', type: String }) warehouseId!: string;
  @ApiProperty({ type: String }) warehouseName!: string;
}

export class PosShiftDto implements PosShift {
  @ApiProperty({ format: 'uuid', type: String }) cashRegisterId!: string;
  @ApiProperty({ type: String }) cashRegisterName!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) closedAt?: string;
  @ApiPropertyOptional({ type: String }) closingCashBgn?: string;
  @ApiProperty({ type: String }) expectedCashBgn!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'date-time', type: String }) openedAt!: string;
  @ApiProperty({ type: String }) openingCashBgn!: string;
  @ApiProperty({ type: String }) operatorCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) operatorId!: string;
  @ApiProperty({ type: String }) shiftNumber!: string;
  @ApiProperty({ enum: ['closed', 'open'] }) status!: 'closed' | 'open';
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ format: 'uuid', type: String }) warehouseId!: string;
  @ApiProperty({ type: String }) warehouseName!: string;
}

export class PosTerminalContextDto implements PosTerminalContext {
  @ApiPropertyOptional({ type: PosShiftDto }) currentShift?: PosShift;
  @ApiProperty({ isArray: true, type: PosRegisterOptionDto })
  registers!: PosTerminalContext['registers'];
}

class PosCatalogBatchDto {
  @ApiProperty({ format: 'uuid', type: String }) batchId!: string;
  @ApiProperty({ type: String }) batchNumber!: string;
  @ApiPropertyOptional({ format: 'date', type: String }) expiresOn?: string;
  @ApiProperty({ type: String }) quantity!: string;
}

export class PosCatalogItemDto implements PosCatalogItem {
  @ApiProperty({ type: String }) availableQuantity!: string;
  @ApiProperty({ isArray: true, type: String }) barcodes!: string[];
  @ApiProperty({ isArray: true, type: PosCatalogBatchDto }) batches!: PosCatalogItem['batches'];
  @ApiProperty({ enum: ['BGN'] }) currencyCode!: 'BGN';
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) priceListId?: string;
  @ApiPropertyOptional({ type: String }) priceListName?: string;
  @ApiProperty({ type: String }) productCode!: string;
  @ApiProperty({ isArray: true, type: String }) serialNumbers!: string[];
  @ApiProperty({ enum: ['batch', 'none', 'serial'] })
  trackingMode!: PosCatalogItem['trackingMode'];
  @ApiProperty({ type: String }) unitCode!: string;
  @ApiPropertyOptional({ type: String }) unitPrice?: string;
  @ApiPropertyOptional({ enum: ['exempt', 'ica', 'reduced_9', 'standard_20', 'zero'] })
  vatTreatment?: PosVatTreatment;
}

export class PosCatalogPageDto implements PosCatalogPage {
  @ApiProperty({ isArray: true, type: PosCatalogItemDto }) items!: PosCatalogItem[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

export class PosQuickAccessDto implements PosQuickAccess {
  @ApiProperty({ format: 'uuid', type: String }) cashRegisterId!: string;
  @ApiProperty({ isArray: true, type: PosCatalogItemDto }) items!: PosCatalogItem[];
  @ApiProperty({ format: 'uuid', isArray: true, type: String }) productIds!: string[];
}

class PosCustomerLocationOptionDto {
  @ApiProperty({ type: String }) city!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

export class PosCustomerOptionDto implements PosCustomerOption {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ type: () => PosLoyaltyAccountDto }) loyalty?: PosLoyaltyAccount;
  @ApiProperty({ isArray: true, type: PosCustomerLocationOptionDto })
  locations!: PosCustomerOption['locations'];
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ type: String }) uic?: string;
  @ApiPropertyOptional({ type: String }) vatNumber?: string;
}

class PosCustomerAdvanceOptionDto {
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ type: String }) availableAmount!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ enum: ['bank_transfer', 'card', 'cash', 'pos_terminal'] })
  paymentMethod!: PosCustomerPaymentOptions['advances'][number]['paymentMethod'];
  @ApiPropertyOptional({ type: String }) paymentReference?: string;
  @ApiProperty({ format: 'date', type: String }) receivedOn!: string;
}

export class PosCustomerPaymentOptionsDto implements PosCustomerPaymentOptions {
  @ApiProperty({ type: String }) advanceBalance!: string;
  @ApiProperty({ isArray: true, type: PosCustomerAdvanceOptionDto })
  advances!: PosCustomerPaymentOptions['advances'];
  @ApiProperty({ type: String }) availableCredit!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ type: Boolean }) onAccountAvailable!: boolean;
  @ApiProperty({ type: String }) outstandingBalance!: string;
  @ApiPropertyOptional({ type: Number }) paymentTermsDays?: number;
}

export class PosLoyaltyAccountDto implements PosLoyaltyAccount {
  @ApiProperty({ type: Number }) balance!: number;
  @ApiProperty({ type: String }) cardNumber!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) programName!: string;
  @ApiProperty({ type: String }) redemptionValueBgn!: string;
  @ApiProperty({ enum: ['active', 'suspended'] }) status!: PosLoyaltyAccount['status'];
}

class PosLoyaltyLedgerEntryDto {
  @ApiProperty({ type: Number }) balanceAfter!: number;
  @ApiProperty({
    enum: ['adjustment', 'earned', 'earned_reversed', 'redeemed', 'redemption_restored'],
  })
  entryType!: PosLoyaltyLedger['entries'][number]['entryType'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'date-time', type: String }) occurredAt!: string;
  @ApiProperty({ type: Number }) points!: number;
  @ApiProperty({ type: String }) reason!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) returnId?: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) saleId?: string;
}

export class PosLoyaltyLedgerDto implements PosLoyaltyLedger {
  @ApiProperty({ type: PosLoyaltyAccountDto }) account!: PosLoyaltyAccount;
  @ApiProperty({ isArray: true, type: PosLoyaltyLedgerEntryDto })
  entries!: PosLoyaltyLedger['entries'];
}

class PosPricingAdjustmentDto implements PosPricingAdjustment {
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ enum: ['automatic', 'loyalty', 'manual'] })
  source!: PosPricingAdjustment['source'];
}

class PosBasketPricedLineDto {
  @ApiProperty({ type: String }) automaticDiscountTotal!: string;
  @ApiProperty({ type: String }) baseNetTotal!: string;
  @ApiProperty({ type: String }) grossTotal!: string;
  @ApiProperty({ type: String }) loyaltyDiscountTotal!: string;
  @ApiProperty({ type: String }) manualDiscountTotal!: string;
  @ApiProperty({ type: String }) netTotal!: string;
  @ApiProperty({ isArray: true, type: PosPricingAdjustmentDto })
  pricingAdjustments!: PosPricingAdjustment[];
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) vatTotal!: string;
}

export class PosBasketPricingDto implements PosBasketPricing {
  @ApiProperty({ type: String }) automaticDiscountTotal!: string;
  @ApiProperty({ type: String }) baseNetTotal!: string;
  @ApiProperty({ type: String }) grossTotal!: string;
  @ApiProperty({ isArray: true, type: PosBasketPricedLineDto })
  lines!: PosBasketPricing['lines'];
  @ApiProperty({ type: Number }) loyaltyBalance!: number;
  @ApiProperty({ type: String }) loyaltyDiscountTotal!: string;
  @ApiProperty({ type: Number }) loyaltyPointsRedeemed!: number;
  @ApiProperty({ type: String }) manualDiscountTotal!: string;
  @ApiProperty({ type: String }) netTotal!: string;
  @ApiProperty({ type: String }) vatTotal!: string;
}

export class PosDiscountAuthorizationDto implements PosDiscountAuthorization {
  @ApiProperty({ type: String }) approverName!: string;
  @ApiProperty({ enum: ['fixed_amount', 'percentage'] })
  discountType!: PosDiscountType;
  @ApiProperty({ type: String }) discountValue!: string;
  @ApiProperty({ format: 'date-time', type: String }) expiresAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) reason!: string;
}

export class PosSaleLineDto implements PosSaleLine {
  @ApiProperty({ type: String }) automaticDiscountTotal!: string;
  @ApiProperty({ type: String }) baseNetTotal!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) batchId?: string;
  @ApiProperty({ type: String }) grossTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) loyaltyDiscountTotal!: string;
  @ApiProperty({ type: String }) manualDiscountTotal!: string;
  @ApiProperty({ type: String }) netTotal!: string;
  @ApiProperty({ type: String }) productCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ isArray: true, type: PosPricingAdjustmentDto })
  pricingAdjustments!: PosPricingAdjustment[];
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: String }) returnableQuantity!: string;
  @ApiProperty({ isArray: true, type: String }) returnableSerialNumbers!: string[];
  @ApiProperty({ type: String }) returnedQuantity!: string;
  @ApiProperty({ isArray: true, type: String }) serialNumbers!: string[];
  @ApiProperty({ type: String }) unitPrice!: string;
  @ApiProperty({ type: String }) vatTotal!: string;
  @ApiProperty({ enum: ['exempt', 'ica', 'reduced_9', 'standard_20', 'zero'] })
  vatTreatment!: PosSaleLine['vatTreatment'];
}

export class PosSalePaymentDto implements PosSalePayment {
  @ApiPropertyOptional({ format: 'date', type: String }) accountDueOn?: string;
  @ApiProperty({ type: String }) adapter!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) advanceId?: string;
  @ApiPropertyOptional({ type: String }) advanceNumber?: string;
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ type: String }) changeAmount!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ enum: ['advance', 'card', 'cash', 'on_account'] })
  method!: PosSalePayment['method'];
  @ApiPropertyOptional({ type: String }) providerReference?: string;
  @ApiProperty({ type: String }) refundableAmount!: string;
  @ApiProperty({ enum: ['completed', 'simulated'] }) status!: PosSalePayment['status'];
  @ApiProperty({ type: String }) tenderedAmount!: string;
}

class PosSaleInvoiceDocumentDto implements PosSaleInvoiceDocument {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) sourceFiscalReceiptNumber!: string;
  @ApiProperty({ enum: ['cancelled', 'draft'] }) status!: PosSaleInvoiceDocument['status'];
}

class PosWarrantyCardDocumentDto implements PosWarrantyCardDocument {
  @ApiProperty({ type: String }) customerLocationName!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) serialNumber!: string;
  @ApiProperty({ format: 'date', type: String }) warrantyEndsOn!: string;
  @ApiProperty({ format: 'date', type: String }) warrantyStartsOn!: string;
}

export class PosSaleDto implements PosSale {
  @ApiProperty({ type: String }) automaticDiscountTotal!: string;
  @ApiProperty({ type: String }) baseNetTotal!: string;
  @ApiProperty({ type: String }) cashTendered!: string;
  @ApiProperty({ type: String }) changeAmount!: string;
  @ApiProperty({ format: 'date-time', type: String }) completedAt!: string;
  @ApiProperty({ enum: ['BGN'] }) currencyCode!: 'BGN';
  @ApiPropertyOptional({ type: String }) customerName?: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) customerPartnerId?: string;
  @ApiProperty({ type: String }) fiscalAdapter!: string;
  @ApiProperty({ type: String }) fiscalReceiptNumber!: string;
  @ApiProperty({ enum: ['fiscalized', 'partially_reversed', 'reversed', 'simulated'] })
  fiscalStatus!: PosSale['fiscalStatus'];
  @ApiProperty({ type: String }) grossTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ type: PosSaleInvoiceDocumentDto })
  invoiceDocument?: PosSaleInvoiceDocument;
  @ApiProperty({ isArray: true, type: PosSaleLineDto }) lines!: PosSaleLine[];
  @ApiProperty({ type: String }) loyaltyDiscountTotal!: string;
  @ApiProperty({ type: Number }) loyaltyPointsEarned!: number;
  @ApiProperty({ type: Number }) loyaltyPointsRedeemed!: number;
  @ApiProperty({ type: String }) manualDiscountTotal!: string;
  @ApiProperty({ type: String }) netTotal!: string;
  @ApiProperty({ isArray: true, type: PosSalePaymentDto }) payments!: PosSalePayment[];
  @ApiProperty({ type: String }) saleNumber!: string;
  @ApiProperty({ format: 'uuid', type: String }) shiftId!: string;
  @ApiProperty({ enum: ['completed', 'partially_returned', 'returned'] })
  status!: PosSale['status'];
  @ApiProperty({ type: String }) vatTotal!: string;
  @ApiProperty({ isArray: true, type: PosWarrantyCardDocumentDto })
  warrantyCards!: PosWarrantyCardDocument[];
}

export class PosSalePageDto implements PosSalePage {
  @ApiProperty({ isArray: true, type: PosSaleDto }) items!: PosSale[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

export class CreatePosReturnLineDto implements CreatePosReturnLineRequest {
  @ApiProperty({ enum: ['restock', 'service'] })
  @IsIn(['restock', 'service'])
  disposition!: CreatePosReturnLineRequest['disposition'];

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  originalSaleLineId!: string;

  @ApiProperty({ example: '1.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  quantity!: string;

  @ApiPropertyOptional({ isArray: true, maxItems: 100, type: String })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  serialNumbers?: string[];
}

export class CreatePosReturnRefundDto implements CreatePosReturnRefundRequest {
  @ApiProperty({ example: '60.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  amount!: string;

  @ApiProperty({ enum: ['advance', 'card', 'cash', 'on_account'] })
  @IsIn(['advance', 'card', 'cash', 'on_account'])
  method!: CreatePosReturnRefundRequest['method'];

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  originalPaymentId!: string;
}

export class CreatePosReturnDto implements CreatePosReturnRequest {
  @ApiProperty({ isArray: true, type: CreatePosReturnLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePosReturnLineDto)
  lines!: CreatePosReturnLineDto[];

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  originalSaleId!: string;

  @ApiProperty({ maxLength: 1000, minLength: 3, type: String })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @ApiProperty({ isArray: true, type: CreatePosReturnRefundDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => CreatePosReturnRefundDto)
  refunds!: CreatePosReturnRefundDto[];

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  shiftId!: string;
}

export class PosReturnLineDto implements PosReturnLine {
  @ApiProperty({ format: 'uuid', type: String }) destinationWarehouseId!: string;
  @ApiProperty({ type: String }) destinationWarehouseName!: string;
  @ApiProperty({ enum: ['restock', 'service'] }) disposition!: PosReturnLine['disposition'];
  @ApiProperty({ type: String }) grossTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) netTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) originalSaleLineId!: string;
  @ApiProperty({ type: String }) productCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ isArray: true, type: String }) serialNumbers!: string[];
  @ApiProperty({ type: String }) vatTotal!: string;
}

export class PosReturnRefundDto implements PosReturnRefund {
  @ApiProperty({ type: String }) adapter!: string;
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ enum: ['advance', 'card', 'cash', 'on_account'] })
  method!: PosReturnRefund['method'];
  @ApiProperty({ format: 'uuid', type: String }) originalPaymentId!: string;
  @ApiPropertyOptional({ type: String }) providerReference?: string;
  @ApiProperty({ enum: ['completed', 'simulated'] }) status!: PosReturnRefund['status'];
}

export class PosReturnDto implements PosReturn {
  @ApiProperty({ format: 'date-time', type: String }) completedAt!: string;
  @ApiProperty({ type: String }) fiscalAdapter!: string;
  @ApiProperty({ type: String }) fiscalReversalNumber!: string;
  @ApiProperty({ type: String }) grossTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ isArray: true, type: PosReturnLineDto }) lines!: PosReturnLine[];
  @ApiProperty({ type: Number }) loyaltyPointsEarnedReversed!: number;
  @ApiProperty({ type: Number }) loyaltyPointsRedeemedRestored!: number;
  @ApiProperty({ type: String }) netTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) originalSaleId!: string;
  @ApiProperty({ type: String }) originalSaleNumber!: string;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ isArray: true, type: PosReturnRefundDto }) refunds!: PosReturnRefund[];
  @ApiProperty({ type: String }) returnNumber!: string;
  @ApiProperty({ format: 'uuid', type: String }) shiftId!: string;
  @ApiProperty({ type: String }) vatTotal!: string;
}

export class PosReturnPageDto implements PosReturnPage {
  @ApiProperty({ isArray: true, type: PosReturnDto }) items!: PosReturn[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}
