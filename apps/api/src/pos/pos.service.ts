import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  FinancialDocument,
  ConfirmPosFiscalSaleCancellationRequest,
  CreatePosDiscountAuthorizationRequest,
  CreatePosReturnRequest,
  CreatePosSaleRequest,
  ConfirmPosFiscalSaleReceiptRequest,
  ConfirmPosFiscalDailyReportRequest,
  ClosePosShiftRequest,
  CreatePosFiscalDailyReportRequest,
  FailPosFiscalDailyReportRequest,
  EnrolPosLoyaltyRequest,
  OpenPosShiftRequest,
  PosBasketPricing,
  PosFiscalReceiptLine,
  PosFiscalSalePreparation,
  PosFiscalSalePreparationStatus,
  PosFiscalDailyReport,
  PosFiscalDailyReportStatus,
  PosFiscalDailyReportType,
  PosFiscalReturnPreparation,
  PosFiscalReturnPreparationStatus,
  PosCatalogItem,
  PosCatalogPage,
  PosCustomerOption,
  PosCustomerPaymentOptions,
  PosDiscountAuthorization,
  PosDiscountType,
  PosDatecsUnpLease,
  PosOfflineSyncEventResponse,
  PosLoyaltyAccount,
  PosLoyaltyLedger,
  PosPricingAdjustment,
  PosQuickAccess,
  PosReturn,
  PosReturnLine,
  PosReturnPage,
  PosSale,
  PosSaleInvoiceDocument,
  PosSaleLine,
  PosSalePayment,
  PosSalePage,
  PosShift,
  PosTerminalContext,
  PosTrackingMode,
  PosVatTreatment,
  PreparePosFiscalSaleRequest,
  ReservePosDatecsUnpLeaseRequest,
  ReportPosOfflineSyncEventRequest,
  PreparePosFiscalReturnRequest,
  ConfirmPosFiscalReturnRequest,
  ResolvePosFiscalReturnRequest,
  MarkPosFiscalSaleOutcomeUnknownRequest,
  PosWarrantyCardDocument,
  PricePosBasketRequest,
  UpdatePosQuickAccessRequest,
} from '@vista/contracts';
import type { PoolClient } from 'pg';

const DATECS_UNP_OFFLINE_BUFFER_SIZE = 20;

import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { TotpService } from '../auth/totp.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import { FinancialDocumentsService } from '../finance/financial-documents.service.js';
import { CardAuthorizationService } from './card-authorization.service.js';
import { renderPosWarrantyCard } from './pos-warranty-card-renderer.js';
import { canUseFiscalSimulator } from './fiscal-mode-policy.js';

interface AssignmentRow {
  business_location_id: string;
  business_location_name: string;
  cash_register_code: string;
  cash_register_id: string;
  cash_register_name: string;
  fiscal_device_label: string | null;
  fiscal_mode: 'disabled' | 'hardware' | 'simulator';
  operator_code: string;
  operator_id: string;
  payment_terminal_label: string | null;
  payment_terminal_mode: 'disabled' | 'hardware' | 'simulator';
  service_return_warehouse_id: string | null;
  service_return_warehouse_name: string | null;
  warehouse_id: string;
  warehouse_name: string;
}

interface ShiftRow {
  cash_register_id: string;
  cash_register_name: string;
  closed_at: Date | string | null;
  closing_cash_eur: string | null;
  expected_cash_eur: string;
  id: string;
  opened_at: Date | string;
  opening_cash_eur: string;
  operator_code: string;
  operator_id: string;
  shift_number: string;
  status: 'closed' | 'open';
  version: number;
  warehouse_id: string;
  warehouse_name: string;
}

interface CatalogRow {
  available_quantity: string;
  barcodes: string[];
  batches: Array<{
    batchId: string;
    batchNumber: string;
    expiresOn: string | null;
    quantity: string;
  }>;
  id: string;
  name: string;
  price_list_id: string | null;
  price_list_name: string | null;
  product_code: string;
  serial_numbers: string[];
  total_count: string;
  tracking_mode: PosCatalogItem['trackingMode'];
  unit_code: string;
  unit_price: string | null;
  vat_treatment: PosVatTreatment | null;
}

interface SaleProductRow {
  average_unit_cost_eur: string;
  category_id: string;
  category_name: string;
  id: string;
  name: string;
  price_list_id: string | null;
  product_code: string;
  tracking_mode: PosCatalogItem['trackingMode'];
  unit_code: string;
  unit_price: string | null;
  vat_treatment: PosVatTreatment | null;
  warranty_months: number | null;
}

interface PreparedSalePayment {
  accountDueOn?: string;
  adapter: string;
  advanceId?: string;
  amount: string;
  changeAmount: string;
  creditLimitEur?: string;
  method: PosSalePayment['method'];
  paymentTermsDays?: number;
  paymentTermsId?: string;
  providerReference?: string;
  status: PosSalePayment['status'];
  tenderedAmount: string | null;
}

type NormalizedSale = ReturnType<typeof normalizeSale>;
type NormalizedSaleLine = NormalizedSale['lines'][number];

interface ReadySaleLine extends NormalizedSaleLine {
  automaticDiscountTotal: string;
  baseNetTotal: string;
  grossTotal: string;
  loyaltyDiscountTotal: string;
  manualDiscountTotal: string;
  netTotal: string;
  pricingAdjustments: PosPricingAdjustment[];
  product: SaleProductRow;
  vatTotal: string;
}

interface FiscalSalePricingSnapshot {
  basketPricing: PosBasketPricing;
  payments: PreparedSalePayment[];
  preparedLines: ReadySaleLine[];
}

interface FiscalSalePreparationRow {
  cashier_account_id: string;
  cash_register_id: string;
  client_transaction_id: string;
  device_serial: string;
  finalized_sale_id: string | null;
  fiscal_document_number: string | null;
  fiscal_receipt_number: string | null;
  fiscal_response: ConfirmPosFiscalSaleReceiptRequest | null;
  id: string;
  operator_id: string;
  operator_identifier: string;
  pricing_snapshot: FiscalSalePricingSnapshot;
  request_digest: string;
  request_snapshot: CreatePosSaleRequest;
  shift_id: string;
  status: PosFiscalSalePreparationStatus;
  unique_sale_id: string;
}

interface FiscalDailyReportRow {
  cashier_account_id: string;
  cash_register_id: string;
  closing_cash_eur: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  failure_reason: string | null;
  fiscal_record_number: string | null;
  id: string;
  non_vat_sales_total_eur: string | null;
  operator_id: string;
  report_type: PosFiscalDailyReportType;
  shift_id: string;
  shift_number: string;
  shift_version: number | null;
  status: PosFiscalDailyReportStatus;
  tax_group_totals: Record<string, string> | null;
}

interface FiscalReturnPreparationRow {
  cashier_account_id: string;
  cash_register_id: string;
  completed_return_id: string | null;
  device_serial: string;
  failure_reason: string | null;
  fiscal_document_number: string | null;
  fiscal_reversals_since_daily_report: string | null;
  id: string;
  operator_id: string;
  operator_identifier: string;
  original_fiscal_document_number: string;
  original_sale_id: string;
  original_unique_sale_id: string;
  request_digest: string;
  request_snapshot: CreatePosReturnRequest;
  shift_id: string;
  status: PosFiscalReturnPreparationStatus;
  unique_reversal_id: string;
}

interface FiscalReturnConfirmation extends ConfirmPosFiscalReturnRequest {
  preparationId: string;
}

interface SaleRow {
  automatic_discount_total: string;
  base_net_total: string;
  cash_tendered: string;
  change_amount: string;
  completed_at: Date | string;
  currency_code: 'EUR';
  customer_name: string | null;
  customer_partner_id: string | null;
  fiscal_adapter: string;
  fiscal_receipt_number: string;
  fiscal_status: PosSale['fiscalStatus'];
  gross_total: string;
  id: string;
  invoice_document: PosSaleInvoiceDocument | null;
  loyalty_discount_total: string;
  loyalty_points_earned: number;
  loyalty_points_redeemed: number;
  manual_discount_total: string;
  net_total: string;
  sale_number: string;
  shift_id: string;
  status: PosSale['status'];
  total_count?: string;
  vat_total: string;
  warranty_cards: PosWarrantyCardDocument[];
}

export interface PosWarrantyCardContent {
  buffer: Buffer;
  fileName: string;
  mediaType: 'application/pdf';
}

interface SalePaymentRow {
  collected_amount: string;
  account_due_on: string | null;
  adapter: string;
  advance_number: string | null;
  amount: string;
  change_amount: string;
  customer_advance_id: string | null;
  id: string;
  payment_method: PosSalePayment['method'];
  provider_reference: string | null;
  refundable_amount: string;
  sale_id: string;
  status: PosSalePayment['status'];
  tendered_amount: string;
}

interface SaleLineRow {
  automatic_discount_total: string;
  base_net_total: string;
  batch_id: string | null;
  gross_total: string;
  id: string;
  loyalty_discount_total: string;
  manual_discount_total: string;
  net_total: string;
  product_code: string;
  product_id: string;
  product_name: string;
  pricing_adjustments: PosPricingAdjustment[];
  quantity: string;
  returnable_quantity: string;
  returnable_serial_numbers: string[];
  returned_quantity: string;
  returned_net_total: string;
  returned_vat_total: string;
  sale_id: string;
  serial_numbers: string[];
  unit_price: string;
  vat_total: string;
  vat_treatment: PosVatTreatment;
}

interface ReturnRow {
  completed_at: Date | string;
  fiscal_adapter: string;
  fiscal_document_number: string | null;
  fiscal_reversal_number: string;
  fiscal_reversals_since_daily_report: string | null;
  gross_total: string;
  id: string;
  loyalty_points_earned_reversed: number;
  loyalty_points_redeemed_restored: number;
  net_total: string;
  original_sale_id: string;
  original_sale_number: string;
  reason: string;
  return_number: string;
  shift_id: string;
  total_count?: string;
  vat_total: string;
}

interface ReturnRefundRow {
  adapter: string;
  amount: string;
  id: string;
  original_payment_id: string;
  provider_reference: string | null;
  refund_method: PosSalePayment['method'];
  return_id: string;
  status: PosSalePayment['status'];
}

interface ReturnLineRow {
  destination_warehouse_id: string;
  destination_warehouse_name: string;
  disposition: PosReturnLine['disposition'];
  gross_total: string;
  id: string;
  net_total: string;
  original_sale_line_id: string;
  product_code: string;
  product_id: string;
  product_name: string;
  quantity: string;
  return_id: string;
  serial_numbers: string[];
  vat_total: string;
}

interface IdempotencyRow {
  request_hash: string;
  response_body: unknown;
  status: 'completed' | 'failed' | 'processing';
}

interface CommercialRuleRow {
  code: string;
  discount_type: PosDiscountType;
  discount_value: string;
  id: string;
  items: Array<{ productId: string; requiredQuantity: string }>;
  name: string;
  priority: number;
  rule_type: 'bundle' | 'quantity';
}

interface LoyaltyAccountRow {
  balance: string;
  card_number: string;
  id: string;
  program_name: string;
  redemption_value_eur: string;
  status: PosLoyaltyAccount['status'];
}

@Injectable()
export class PosService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TotpService) private readonly totp: TotpService,
    @Inject(FinancialDocumentsService)
    private readonly financialDocuments: FinancialDocumentsService,
    @Inject(CardAuthorizationService)
    private readonly cardAuthorizations: CardAuthorizationService,
  ) {}

  async terminalContext(authentication: AuthenticationContext): Promise<PosTerminalContext> {
    const [assignments, shifts] = await Promise.all([
      this.database.getPool().query<AssignmentRow>(assignmentSql, [authentication.accountId]),
      this.database.getPool().query<ShiftRow>(
        `${shiftSql} WHERE operator.account_id = $1
        AND shift.status = 'open' ORDER BY shift.opened_at DESC LIMIT 1`,
        [authentication.accountId],
      ),
    ]);
    if (!assignments.rowCount)
      throw new ApiErrorException(
        'POS_TERMINAL_NOT_ASSIGNED',
        'No active POS register is assigned to this account',
        HttpStatus.FORBIDDEN,
      );
    return {
      ...(shifts.rows[0] ? { currentShift: mapShift(shifts.rows[0]) } : {}),
      registers: assignments.rows.map((row) => ({
        businessLocationId: row.business_location_id,
        businessLocationName: row.business_location_name,
        code: row.cash_register_code,
        ...(row.fiscal_device_label ? { fiscalDeviceLabel: row.fiscal_device_label } : {}),
        fiscalMode: row.fiscal_mode,
        id: row.cash_register_id,
        name: row.cash_register_name,
        operatorCode: row.operator_code,
        operatorId: row.operator_id,
        ...(row.payment_terminal_label ? { paymentTerminalLabel: row.payment_terminal_label } : {}),
        paymentTerminalMode: row.payment_terminal_mode,
        ...(row.service_return_warehouse_id
          ? { serviceReturnWarehouseId: row.service_return_warehouse_id }
          : {}),
        ...(row.service_return_warehouse_name
          ? { serviceReturnWarehouseName: row.service_return_warehouse_name }
          : {}),
        warehouseId: row.warehouse_id,
        warehouseName: row.warehouse_name,
      })),
    };
  }

  async openShift(
    input: OpenPosShiftRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosShift> {
    const normalized = {
      cashRegisterId: input.cashRegisterId,
      openingCashEur: decimal(input.openingCashEur, false),
    };
    return this.command(
      'pos.shift.open',
      key,
      normalized,
      HttpStatus.CREATED,
      isPosShift,
      async (client, commandKey) => {
        const existing = await client.query(
          `SELECT id FROM pos.shifts
           WHERE status = 'open' AND (opened_by = $1 OR cash_register_id = $2)
           FOR UPDATE`,
          [authentication.accountId, normalized.cashRegisterId],
        );
        if (existing.rowCount)
          throw new ApiErrorException(
            'POS_SHIFT_ALREADY_OPEN',
            'This cashier or register already has an open shift',
            HttpStatus.CONFLICT,
          );
        const assignment = await client.query<AssignmentRow>(
          `${assignmentSql} AND register.id = $2 FOR UPDATE OF register, operator, configuration`,
          [authentication.accountId, normalized.cashRegisterId],
        );
        const selected = assignment.rows[0];
        if (!selected)
          throw new ApiErrorException(
            'POS_REGISTER_NOT_ASSIGNED',
            'The selected register is not assigned to this cashier',
            HttpStatus.FORBIDDEN,
          );
        this.requireUsableFiscalMode(selected.fiscal_mode);
        const shiftId = randomUUID();
        const shiftNumber = await this.nextNumber(client, selected, 'shift', 'SHIFT');
        await client.query(
          `INSERT INTO pos.shifts (
             id, shift_number, cash_register_id, operator_id, warehouse_id,
             opening_cash_eur, opened_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            shiftId,
            shiftNumber,
            selected.cash_register_id,
            selected.operator_id,
            selected.warehouse_id,
            normalized.openingCashEur,
            authentication.accountId,
          ],
        );
        const shift = await this.shift(client, shiftId);
        await this.sideEffects(
          client,
          'pos_shift',
          shiftId,
          'pos.shift.opened',
          shift,
          authentication,
          metadata,
          commandKey,
        );
        return shift;
      },
    );
  }

  async closeShift(
    id: string,
    input: ClosePosShiftRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosShift> {
    const normalized = {
      closingCashEur: decimal(input.closingCashEur, false),
      id,
      version: input.version,
    };
    return this.command(
      'pos.shift.close',
      key,
      normalized,
      HttpStatus.OK,
      isPosShift,
      async (client, commandKey) => {
        const locked = await client.query(
          `SELECT shift.id FROM pos.shifts shift
           JOIN organization.operators operator ON operator.id = shift.operator_id
           WHERE shift.id = $1 AND operator.account_id = $2 AND shift.status = 'open'
           FOR UPDATE OF shift`,
          [id, authentication.accountId],
        );
        if (!locked.rowCount)
          throw new ApiErrorException(
            'POS_SHIFT_NOT_OPEN',
            'This cashier shift is no longer open',
            HttpStatus.CONFLICT,
          );
        const unresolvedFiscal = await client.query(
          `SELECT id FROM pos.fiscal_sale_preparations
           WHERE shift_id = $1
             AND status IN ('prepared', 'printing', 'outcome_unknown', 'receipt_confirmed')
           FOR UPDATE`,
          [id],
        );
        const unresolvedFiscalReturn = await client.query(
          `SELECT id FROM pos.fiscal_return_preparations WHERE shift_id = $1
           AND status IN ('prepared', 'printing', 'outcome_unknown') FOR UPDATE`,
          [id],
        );
        if (unresolvedFiscal.rowCount || unresolvedFiscalReturn.rowCount)
          throw new ApiErrorException(
            'POS_FISCAL_SALE_REQUIRES_REVIEW',
            'Resolve the pending fiscal receipt before closing this shift.',
            HttpStatus.CONFLICT,
          );
        const configuredTerminal = await client.query<{
          fiscal_mode: AssignmentRow['fiscal_mode'];
        }>(
          `SELECT configuration.fiscal_mode
           FROM pos.terminal_configurations configuration
           WHERE configuration.cash_register_id = (
             SELECT shift.cash_register_id FROM pos.shifts shift WHERE shift.id = $1
           ) AND configuration.active`,
          [id],
        );
        if (configuredTerminal.rows[0]?.fiscal_mode === 'hardware')
          throw new ApiErrorException(
            'POS_FISCAL_Z_REPORT_REQUIRED',
            'Print and record the DATECS Z report before closing a hardware register shift.',
            HttpStatus.CONFLICT,
          );
        const updated = await client.query(
          `UPDATE pos.shifts SET status = 'closed', closing_cash_eur = $3,
             closed_by = $2, closed_at = now(), version = version + 1
           WHERE id = $1 AND version = $4`,
          [id, authentication.accountId, normalized.closingCashEur, normalized.version],
        );
        if (!updated.rowCount)
          throw new ApiErrorException(
            'POS_SHIFT_CONFLICT',
            'The cashier shift changed before it could be closed',
            HttpStatus.CONFLICT,
          );
        const shift = await this.shift(client, id);
        await this.sideEffects(
          client,
          'pos_shift',
          id,
          'pos.shift.closed',
          shift,
          authentication,
          metadata,
          commandKey,
        );
        return shift;
      },
    );
  }

  async catalog(
    shiftId: string,
    customerPartnerId: string | undefined,
    search: string | undefined,
    page: number,
    pageSize: number,
    authentication: AuthenticationContext,
  ): Promise<PosCatalogPage> {
    const shift = await this.requireOpenShiftFromPool(shiftId, authentication.accountId);
    if (customerPartnerId) await this.requireCustomerFromPool(customerPartnerId);
    const term = search?.trim() ?? '';
    const result = await this.database
      .getPool()
      .query<CatalogRow>(catalogSql, [
        shift.warehouseId,
        customerPartnerId ?? null,
        term,
        pageSize,
        (page - 1) * pageSize,
      ]);
    const total = Number(result.rows[0]?.total_count ?? 0);
    return {
      items: result.rows.map(mapCatalogItem),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  async quickAccess(
    shiftId: string,
    customerPartnerId: string | undefined,
    authentication: AuthenticationContext,
  ): Promise<PosQuickAccess> {
    const shift = await this.requireOpenShiftFromPool(shiftId, authentication.accountId);
    if (customerPartnerId) await this.requireCustomerFromPool(customerPartnerId);
    return this.quickAccessFor(
      this.database.getPool(),
      shift.cashRegisterId,
      shift.warehouseId,
      customerPartnerId,
    );
  }

  async updateQuickAccess(
    input: UpdatePosQuickAccessRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosQuickAccess> {
    const productIds = [...new Set(input.productIds)];
    if (productIds.length !== input.productIds.length || productIds.length > 12)
      throw new ApiErrorException(
        'POS_QUICK_ACCESS_INVALID',
        'Choose up to 12 different products for quick access',
        HttpStatus.BAD_REQUEST,
      );
    const normalized = { productIds, shiftId: input.shiftId };
    return this.command(
      'pos.quick_access.update',
      key,
      normalized,
      HttpStatus.OK,
      isPosQuickAccess,
      async (client, commandKey) => {
        const shift = await this.lockShift(client, normalized.shiftId, authentication.accountId);
        const products = productIds.length
          ? await client.query<{ id: string }>(
              `SELECT product.id FROM master_data.products product
               WHERE product.id = ANY($1::uuid[]) AND product.active
               FOR KEY SHARE OF product`,
              [productIds],
            )
          : { rowCount: 0 };
        if (products.rowCount !== productIds.length)
          throw new ApiErrorException(
            'POS_QUICK_ACCESS_PRODUCT_UNAVAILABLE',
            'One or more selected products are no longer active',
            HttpStatus.CONFLICT,
          );
        await client.query(`DELETE FROM pos.quick_access_products WHERE cash_register_id = $1`, [
          shift.cashRegisterId,
        ]);
        for (const [index, productId] of productIds.entries())
          await client.query(
            `INSERT INTO pos.quick_access_products (
               cash_register_id, product_id, display_order, updated_by
             ) VALUES ($1,$2,$3,$4)`,
            [shift.cashRegisterId, productId, index + 1, authentication.accountId],
          );
        const result = await this.quickAccessFor(
          client,
          shift.cashRegisterId,
          shift.warehouseId,
          undefined,
        );
        await this.sideEffects(
          client,
          'pos_quick_access',
          shift.cashRegisterId,
          'pos.quick_access.updated',
          result,
          authentication,
          metadata,
          commandKey,
        );
        return result;
      },
    );
  }

  async customers(search: string | undefined): Promise<PosCustomerOption[]> {
    const result = await this.database.getPool().query<{
      display_name: string;
      id: string;
      loyalty_balance: string | null;
      loyalty_card_number: string | null;
      loyalty_id: string | null;
      loyalty_program_name: string | null;
      loyalty_redemption_value_eur: string | null;
      loyalty_status: PosLoyaltyAccount['status'] | null;
      locations: Array<{ city: string; id: string; name: string }>;
      uic: string | null;
      vat_number: string | null;
    }>(
      `SELECT partner.id, partner.display_name, partner.uic, partner.vat_number,
        loyalty.id AS loyalty_id, loyalty.card_number AS loyalty_card_number,
        loyalty.status AS loyalty_status, program.name AS loyalty_program_name,
        program.redemption_value_eur::text AS loyalty_redemption_value_eur,
        CASE WHEN loyalty.id IS NULL THEN NULL ELSE COALESCE((
          SELECT sum(entry.points) FROM pos.loyalty_points_ledger entry
          WHERE entry.loyalty_account_id = loyalty.id
        ), 0)::text END AS loyalty_balance,
        COALESCE(json_agg(json_build_object(
          'id', location.id, 'name', location.name, 'city', location.city
        ) ORDER BY location.name, location.id) FILTER (WHERE location.id IS NOT NULL), '[]'::json)
          AS locations
       FROM master_data.partners partner
       JOIN master_data.partner_roles role
         ON role.partner_id = partner.id AND role.role = 'customer'
       LEFT JOIN master_data.customer_locations location
         ON location.partner_id = partner.id AND location.active
       LEFT JOIN pos.loyalty_accounts loyalty ON loyalty.customer_partner_id = partner.id
       LEFT JOIN pos.loyalty_programs program ON program.id = loyalty.program_id
       WHERE partner.active
         AND ($1 = '' OR partner.normalized_name LIKE '%' || lower($1) || '%'
           OR coalesce(partner.uic, '') ILIKE '%' || $1 || '%'
           OR coalesce(partner.vat_number, '') ILIKE '%' || $1 || '%'
           OR coalesce(loyalty.card_number, '') ILIKE '%' || upper($1) || '%')
       GROUP BY partner.id, loyalty.id, program.id
       ORDER BY partner.display_name, partner.id
       LIMIT 30`,
      [search?.trim() ?? ''],
    );
    return result.rows.map((row) => ({
      id: row.id,
      ...(row.loyalty_id &&
      row.loyalty_card_number &&
      row.loyalty_program_name &&
      row.loyalty_redemption_value_eur &&
      row.loyalty_status
        ? {
            loyalty: {
              balance: Number(row.loyalty_balance ?? 0),
              cardNumber: row.loyalty_card_number,
              id: row.loyalty_id,
              programName: row.loyalty_program_name,
              redemptionValueEur: row.loyalty_redemption_value_eur,
              status: row.loyalty_status,
            },
          }
        : {}),
      locations: row.locations,
      name: row.display_name,
      ...(row.uic ? { uic: row.uic } : {}),
      ...(row.vat_number ? { vatNumber: row.vat_number } : {}),
    }));
  }

  async customerPaymentOptions(customerPartnerId: string): Promise<PosCustomerPaymentOptions> {
    const result = await this.database.getPool().query<{
      available_credit: string;
      customer_name: string;
      customer_partner_id: string;
      on_account_available: boolean;
      outstanding_balance: string;
      payment_terms_days: number | null;
    }>(
      `WITH account_balance AS (
         SELECT entry.customer_partner_id,
           COALESCE(sum(CASE entry.entry_type
             WHEN 'charge' THEN entry.amount WHEN 'payment_reversal' THEN entry.amount ELSE -entry.amount END), 0) AS outstanding
         FROM finance.customer_account_entries entry
         WHERE entry.customer_partner_id = $1
         GROUP BY entry.customer_partner_id
       )
       SELECT partner.id AS customer_partner_id, partner.display_name AS customer_name,
         COALESCE(account_balance.outstanding, 0)::text AS outstanding_balance,
         CASE WHEN terms.id IS NOT NULL AND terms.status = 'active'
           AND terms.on_account_enabled
           AND terms.valid_from <= (now() AT TIME ZONE $2)::date
           AND (terms.valid_to IS NULL OR terms.valid_to >= (now() AT TIME ZONE $2)::date)
           THEN greatest(terms.credit_limit_eur - COALESCE(account_balance.outstanding, 0), 0)
           ELSE 0 END::text AS available_credit,
         (terms.id IS NOT NULL AND terms.status = 'active'
           AND terms.on_account_enabled
           AND terms.valid_from <= (now() AT TIME ZONE $2)::date
           AND (terms.valid_to IS NULL OR terms.valid_to >= (now() AT TIME ZONE $2)::date))
           AS on_account_available,
         terms.payment_terms_days
       FROM master_data.partners partner
       JOIN master_data.partner_roles role
         ON role.partner_id = partner.id AND role.role = 'customer'
       LEFT JOIN sales.customer_payment_terms terms
         ON terms.customer_partner_id = partner.id
       LEFT JOIN account_balance ON account_balance.customer_partner_id = partner.id
       WHERE partner.id = $1 AND partner.active`,
      [customerPartnerId, this.environment.BUSINESS_TIMEZONE],
    );
    const row = result.rows[0];
    if (!row)
      throw new ApiErrorException(
        'POS_CUSTOMER_NOT_AVAILABLE',
        'The selected customer is no longer available.',
        HttpStatus.NOT_FOUND,
      );
    const advances = await this.database.getPool().query<{
      advance_number: string;
      amount: string;
      available_amount: string;
      customer_partner_id: string;
      id: string;
      payment_method: PosCustomerPaymentOptions['advances'][number]['paymentMethod'];
      payment_reference: string | null;
      received_on: string;
    }>(
      `SELECT advance.id, advance.advance_number, advance.customer_partner_id,
         advance.amount::text, advance.received_on::text, advance.payment_method,
         advance.payment_reference,
         COALESCE(sum(CASE entry.entry_type
           WHEN 'applied' THEN -entry.amount ELSE entry.amount END), 0)::text
           AS available_amount
       FROM finance.customer_advances advance
       JOIN finance.customer_advance_entries entry ON entry.advance_id = advance.id
       WHERE advance.customer_partner_id = $1
       GROUP BY advance.id
       HAVING COALESCE(sum(CASE entry.entry_type
         WHEN 'applied' THEN -entry.amount ELSE entry.amount END), 0) > 0
       ORDER BY advance.received_on, advance.advance_number, advance.id`,
      [customerPartnerId],
    );
    const mappedAdvances = advances.rows.map((advance) => ({
      amount: advance.amount,
      availableAmount: advance.available_amount,
      customerPartnerId: advance.customer_partner_id,
      id: advance.id,
      number: advance.advance_number,
      paymentMethod: advance.payment_method,
      ...(advance.payment_reference ? { paymentReference: advance.payment_reference } : {}),
      receivedOn: advance.received_on,
    }));
    return {
      advanceBalance: sum(mappedAdvances.map((advance) => advance.availableAmount)),
      advances: mappedAdvances,
      availableCredit: fixed(units(row.available_credit)),
      customerName: row.customer_name,
      customerPartnerId: row.customer_partner_id,
      onAccountAvailable: row.on_account_available,
      outstandingBalance: fixed(units(row.outstanding_balance)),
      ...(row.payment_terms_days === null ? {} : { paymentTermsDays: row.payment_terms_days }),
    };
  }

  async priceBasket(
    input: PricePosBasketRequest,
    authentication: AuthenticationContext,
  ): Promise<PosBasketPricing> {
    const normalized = normalizeBasket(input);
    const client = await this.database.getPool().connect();
    try {
      const shift = await this.requireOpenShift(
        client,
        normalized.shiftId,
        authentication.accountId,
      );
      return await this.prepareBasketPricing(client, shift, normalized, authentication.accountId);
    } finally {
      client.release();
    }
  }

  async authorizeDiscount(
    input: CreatePosDiscountAuthorizationRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosDiscountAuthorization> {
    const normalizedBasket = normalizeBasket({
      ...(input.customerPartnerId ? { customerPartnerId: input.customerPartnerId } : {}),
      lines: input.lines,
      shiftId: input.shiftId,
    });
    const discountType = input.discountType;
    const discountValue = validDiscountValue(input.discountValue, discountType);
    const reason = input.reason.trim();
    const approverEmail = input.approverEmail.trim().toLowerCase();
    const commandInput = {
      approverEmail,
      basket: normalizedBasket,
      discountType,
      discountValue,
      reason,
    };
    return this.command(
      'pos.discount.authorize',
      key,
      commandInput,
      HttpStatus.CREATED,
      isPosDiscountAuthorization,
      async (client, commandKey) => {
        await this.lockShift(client, normalizedBasket.shiftId, authentication.accountId);
        const approver = await client.query<{
          active: boolean;
          display_name: string;
          id: string;
          is_administrative: boolean;
          password_hash: string;
          status: string;
        }>(
          `SELECT account.id, account.password_hash, account.status,
             employee.active, employee.display_name,
             COALESCE(bool_or(role.is_administrative), false) AS is_administrative
           FROM identity.employees employee
           JOIN identity.user_accounts account ON account.employee_id = employee.id
           LEFT JOIN iam.account_roles account_role ON account_role.account_id = account.id
           LEFT JOIN iam.roles role ON role.id = account_role.role_id
           WHERE employee.email = $1
           GROUP BY account.id, employee.id`,
          [approverEmail],
        );
        const account = approver.rows[0];
        const passwordMatches = await this.passwords.verify(
          input.approverPassword,
          account?.password_hash ?? 'invalid-password-hash',
        );
        if (!account || !account.active || account.status !== 'active' || !passwordMatches)
          throw discountApprovalFailed();
        if (account.id === authentication.accountId)
          throw new ApiErrorException(
            'POS_DISCOUNT_SELF_APPROVAL_FORBIDDEN',
            'A different authorized employee must approve this discount',
            HttpStatus.FORBIDDEN,
          );
        const permission = await client.query(
          `SELECT permission.id FROM iam.account_roles account_role
           JOIN iam.role_permissions role_permission ON role_permission.role_id = account_role.role_id
           JOIN iam.permissions permission ON permission.id = role_permission.permission_id
           WHERE account_role.account_id = $1
             AND permission.module IN ('pos', '*')
             AND permission.action IN ('approve', '*') LIMIT 1`,
          [account.id],
        );
        if (!permission.rowCount) throw discountApprovalFailed();
        const factors = await client.query<{ encrypted_secret: Buffer }>(
          `SELECT encrypted_secret FROM identity.authentication_factors
           WHERE account_id = $1 AND factor_type = 'totp' AND enabled
             AND verified_at IS NOT NULL AND encrypted_secret IS NOT NULL`,
          [account.id],
        );
        if (
          factors.rows.length &&
          !factors.rows.some((factor) =>
            input.totpCode ? this.totp.verify(input.totpCode, factor.encrypted_secret) : false,
          )
        )
          throw discountApprovalFailed();
        const pricing = await this.prepareBasketPricing(
          client,
          await this.shift(client, normalizedBasket.shiftId),
          {
            ...normalizedBasket,
            manualDiscount: { discountType, discountValue },
          },
          authentication.accountId,
          false,
        );
        if (units(pricing.manualDiscountTotal) <= 0n)
          throw new ApiErrorException(
            'POS_DISCOUNT_NOT_APPLICABLE',
            'The discount does not reduce the current basket',
            HttpStatus.BAD_REQUEST,
          );
        const id = randomUUID();
        const expiresAt = new Date(Date.now() + 5 * 60_000);
        const basketDigest = discountBasketDigest(normalizedBasket, discountType, discountValue);
        await client.query(
          `INSERT INTO pos.discount_authorizations (
             id, shift_id, cashier_account_id, approver_account_id,
             discount_type, discount_value, reason, basket_digest, expires_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            normalizedBasket.shiftId,
            authentication.accountId,
            account.id,
            discountType,
            discountValue,
            reason,
            basketDigest,
            expiresAt,
          ],
        );
        const result = {
          approverName: account.display_name,
          discountType,
          discountValue,
          expiresAt: expiresAt.toISOString(),
          id,
          reason,
        };
        await this.sideEffects(
          client,
          'pos_discount_authorization',
          id,
          'pos.discount.authorized',
          result,
          authentication,
          metadata,
          commandKey,
        );
        return result;
      },
    );
  }

  async enrolLoyalty(
    input: EnrolPosLoyaltyRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosLoyaltyAccount> {
    return this.command(
      'pos.loyalty.enrol',
      key,
      input,
      HttpStatus.CREATED,
      isPosLoyaltyAccount,
      async (client, commandKey) => {
        await this.requireCustomer(client, input.customerPartnerId);
        const existing = await this.loyaltyAccount(client, input.customerPartnerId, true);
        if (existing) return existing;
        const program = await client.query<{ id: string }>(
          `SELECT id FROM pos.loyalty_programs
           WHERE active AND CURRENT_DATE >= valid_from
             AND (valid_to IS NULL OR CURRENT_DATE <= valid_to)
           ORDER BY valid_from DESC, id LIMIT 1 FOR SHARE`,
        );
        if (!program.rows[0])
          throw new ApiErrorException(
            'POS_LOYALTY_PROGRAM_UNAVAILABLE',
            'Loyalty enrolment is not available today',
            HttpStatus.CONFLICT,
          );
        const id = randomUUID();
        const cardNumber = `VISTA-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
        await client.query(
          `INSERT INTO pos.loyalty_accounts (
             id, program_id, customer_partner_id, card_number, enrolled_by
           ) VALUES ($1,$2,$3,$4,$5)`,
          [id, program.rows[0].id, input.customerPartnerId, cardNumber, authentication.accountId],
        );
        const result = required(
          await this.loyaltyAccount(client, input.customerPartnerId),
          'POS loyalty account lookup failed',
        );
        await this.sideEffects(
          client,
          'pos_loyalty_account',
          id,
          'pos.loyalty.enrolled',
          result,
          authentication,
          metadata,
          commandKey,
        );
        return result;
      },
    );
  }

  async loyaltyLedger(customerPartnerId: string): Promise<PosLoyaltyLedger> {
    const client = await this.database.getPool().connect();
    try {
      await this.requireCustomer(client, customerPartnerId);
      const account = await this.loyaltyAccount(client, customerPartnerId);
      if (!account)
        throw new ApiErrorException(
          'POS_LOYALTY_ACCOUNT_NOT_FOUND',
          'This customer has not joined loyalty yet',
          HttpStatus.NOT_FOUND,
        );
      const entries = await client.query<{
        balance_after: string;
        entry_type: PosLoyaltyLedger['entries'][number]['entryType'];
        id: string;
        occurred_at: Date | string;
        points: number;
        reason: string;
        return_id: string | null;
        sale_id: string | null;
      }>(
        `SELECT entry.id, entry.entry_type, entry.points, entry.reason,
           entry.sale_id, entry.return_id, entry.occurred_at,
           sum(entry.points) OVER (
             PARTITION BY entry.loyalty_account_id
             ORDER BY entry.occurred_at, entry.id
           )::text AS balance_after
         FROM pos.loyalty_points_ledger entry
         WHERE entry.loyalty_account_id = $1
         ORDER BY entry.occurred_at DESC, entry.id DESC LIMIT 100`,
        [account.id],
      );
      return {
        account,
        entries: entries.rows.map((entry) => ({
          balanceAfter: Number(entry.balance_after),
          entryType: entry.entry_type,
          id: entry.id,
          occurredAt: iso(entry.occurred_at),
          points: entry.points,
          reason: entry.reason,
          ...(entry.return_id ? { returnId: entry.return_id } : {}),
          ...(entry.sale_id ? { saleId: entry.sale_id } : {}),
        })),
      };
    } finally {
      client.release();
    }
  }

  async prepareFiscalDailyReport(
    input: CreatePosFiscalDailyReportRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalDailyReport> {
    if (
      (input.type === 'z' && (!input.closingCashEur || !input.shiftVersion)) ||
      (input.type === 'x' &&
        (input.closingCashEur !== undefined || input.shiftVersion !== undefined))
    )
      throw new ApiErrorException(
        'POS_FISCAL_REPORT_CLOSE_SNAPSHOT_INVALID',
        'A Z report needs the counted cash and current shift version; an X report does not close a shift.',
        HttpStatus.BAD_REQUEST,
      );
    const closingCashEur = input.type === 'z' ? decimal(input.closingCashEur!, false) : undefined;
    return this.command(
      'pos.fiscal-daily-report.prepare',
      key,
      {
        closingCashEur,
        shiftId: input.shiftId,
        shiftVersion: input.shiftVersion,
        type: input.type,
      },
      HttpStatus.CREATED,
      isPosFiscalDailyReport,
      async (client, commandKey) => {
        const shift = await this.lockShift(client, input.shiftId, authentication.accountId);
        if (input.type === 'z' && input.shiftVersion !== shift.version)
          throw new ApiErrorException(
            'POS_SHIFT_CONFLICT',
            'The shift changed. Refresh the counted cash before printing its Z report.',
            HttpStatus.CONFLICT,
          );
        const assignment = await client.query<AssignmentRow>(
          `${assignmentSql} AND register.id = $2 FOR UPDATE OF register, operator, configuration`,
          [authentication.accountId, shift.cashRegisterId],
        );
        const terminal = required(assignment.rows[0], 'POS terminal lookup failed');
        if (terminal.fiscal_mode !== 'hardware')
          throw new ApiErrorException(
            'POS_DATECS_HARDWARE_REQUIRED',
            'A DATECS daily report needs a register assigned to fiscal hardware.',
            HttpStatus.CONFLICT,
          );
        const activeSale = await client.query(
          `SELECT id FROM pos.fiscal_sale_preparations
           WHERE cash_register_id = $1
             AND status IN ('prepared', 'printing', 'outcome_unknown', 'receipt_confirmed')
           FOR UPDATE`,
          [shift.cashRegisterId],
        );
        const activeReport = await client.query(
          `SELECT id FROM pos.fiscal_daily_reports
           WHERE cash_register_id = $1
             AND status IN ('prepared', 'printing', 'outcome_unknown')
           FOR UPDATE`,
          [shift.cashRegisterId],
        );
        const activeReturn = await client.query(
          `SELECT id FROM pos.fiscal_return_preparations
           WHERE cash_register_id = $1 AND status IN ('prepared', 'printing', 'outcome_unknown')
           FOR UPDATE`,
          [shift.cashRegisterId],
        );
        if (activeSale.rowCount || activeReport.rowCount || activeReturn.rowCount)
          throw new ApiErrorException(
            activeSale.rowCount
              ? 'POS_FISCAL_SALE_REQUIRES_REVIEW'
              : activeReport.rowCount
                ? 'POS_FISCAL_REPORT_REQUIRES_REVIEW'
                : 'POS_FISCAL_RETURN_REQUIRES_REVIEW',
            'Resolve the pending fiscal printer action before starting another one.',
            HttpStatus.CONFLICT,
          );
        const id = randomUUID();
        await client.query(
          `INSERT INTO pos.fiscal_daily_reports (
             id, shift_id, cash_register_id, operator_id, cashier_account_id,
             report_type, closing_cash_eur, shift_version
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            shift.id,
            shift.cashRegisterId,
            shift.operatorId,
            authentication.accountId,
            input.type,
            closingCashEur ?? null,
            input.type === 'z' ? shift.version : null,
          ],
        );
        const report = await this.fiscalDailyReport(client, id);
        await this.sideEffects(
          client,
          'pos_fiscal_daily_report',
          id,
          `pos.fiscal_daily_report.${input.type}.prepared`,
          report,
          authentication,
          metadata,
          commandKey,
        );
        return report;
      },
    );
  }

  async activeFiscalDailyReport(
    shiftId: string,
    authentication: AuthenticationContext,
  ): Promise<PosFiscalDailyReport | null> {
    const result = await this.database.getPool().query<FiscalDailyReportRow>(
      `${fiscalDailyReportSql}
       WHERE report.shift_id = $1 AND report.cashier_account_id = $2
         AND report.status IN ('prepared', 'printing', 'outcome_unknown')`,
      [shiftId, authentication.accountId],
    );
    return result.rows[0] ? mapFiscalDailyReport(result.rows[0]) : null;
  }

  async prepareFiscalSale(
    input: PreparePosFiscalSaleRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalSalePreparation> {
    const normalized = normalizeSale(input);
    const deviceSerial = input.deviceSerial.trim().toUpperCase();
    const operatorIdentifier = input.operatorIdentifier.trim().toUpperCase();
    const requestedUniqueSaleId = input.uniqueSaleId?.trim().toUpperCase();
    const requestDigest = digest({
      deviceSerial,
      normalized,
      operatorIdentifier,
      uniqueSaleId: requestedUniqueSaleId ?? null,
    });
    if (
      normalized.payments.length !== 1 ||
      normalized.payments[0]?.method !== 'cash' ||
      !normalized.payments[0].tenderedAmount
    )
      throw new ApiErrorException(
        'POS_DATECS_CASH_PAYMENT_REQUIRED',
        'This fiscal-device flow currently accepts one cash payment per receipt.',
        HttpStatus.BAD_REQUEST,
      );

    return this.command(
      'pos.fiscal-sale.prepare',
      key,
      { deviceSerial, normalized, operatorIdentifier, uniqueSaleId: requestedUniqueSaleId ?? null },
      HttpStatus.CREATED,
      isPosFiscalSalePreparation,
      async (client, commandKey) => {
        const shift = await this.lockShift(client, normalized.shiftId, authentication.accountId);
        const activeReport = await client.query(
          `SELECT id FROM pos.fiscal_daily_reports
           WHERE shift_id = $1 AND status IN ('prepared', 'printing', 'outcome_unknown')
           FOR UPDATE`,
          [shift.id],
        );
        if (activeReport.rowCount)
          throw new ApiErrorException(
            'POS_FISCAL_REPORT_REQUIRES_REVIEW',
            'Resolve the pending fiscal report before preparing another printer action.',
            HttpStatus.CONFLICT,
          );
        const activeReturn = await client.query(
          `SELECT id FROM pos.fiscal_return_preparations WHERE cash_register_id = $1
           AND status IN ('prepared', 'printing', 'outcome_unknown') FOR UPDATE`,
          [shift.cashRegisterId],
        );
        if (activeReturn.rowCount)
          throw new ApiErrorException(
            'POS_FISCAL_RETURN_REQUIRES_REVIEW',
            'Resolve the pending fiscal return before preparing another printer action.',
            HttpStatus.CONFLICT,
          );
        const assignment = await client.query<AssignmentRow>(
          `${assignmentSql} AND register.id = $2 FOR UPDATE OF register, operator, configuration`,
          [authentication.accountId, shift.cashRegisterId],
        );
        const terminal = required(assignment.rows[0], 'POS terminal lookup failed');
        if (terminal.warehouse_id !== shift.warehouseId)
          throw new ApiErrorException(
            'POS_TERMINAL_CHANGED',
            'The register assignment changed after this shift was opened',
            HttpStatus.CONFLICT,
          );
        this.requireUsableFiscalMode(terminal.fiscal_mode);
        if (terminal.fiscal_mode !== 'hardware')
          throw new ApiErrorException(
            'POS_DATECS_HARDWARE_REQUIRED',
            'A DATECS sale can be prepared only for a register assigned to fiscal hardware.',
            HttpStatus.CONFLICT,
          );

        const existing = await client.query<FiscalSalePreparationRow>(
          `SELECT * FROM pos.fiscal_sale_preparations
           WHERE client_transaction_id = $1 FOR UPDATE`,
          [normalized.clientTransactionId],
        );
        if (existing.rows[0]) {
          if (
            existing.rows[0].cashier_account_id !== authentication.accountId ||
            existing.rows[0].request_digest !== requestDigest
          )
            throw new ApiErrorException(
              'POS_TRANSACTION_ID_REUSED',
              'This checkout reference is already tied to another fiscal sale.',
              HttpStatus.CONFLICT,
            );
          return mapFiscalSalePreparation(existing.rows[0]);
        }

        const completedSale = await client.query(
          'SELECT id FROM pos.sales WHERE client_transaction_id = $1 FOR UPDATE',
          [normalized.clientTransactionId],
        );
        if (completedSale.rowCount)
          throw new ApiErrorException(
            'POS_TRANSACTION_ALREADY_COMPLETED',
            'This checkout reference already belongs to a completed sale.',
            HttpStatus.CONFLICT,
          );

        const openPreparation = await client.query(
          `SELECT id FROM pos.fiscal_sale_preparations
           WHERE cash_register_id = $1
             AND status IN ('prepared', 'printing', 'outcome_unknown', 'receipt_confirmed')
           FOR UPDATE`,
          [terminal.cash_register_id],
        );
        if (openPreparation.rowCount)
          throw new ApiErrorException(
            'POS_FISCAL_SALE_REQUIRES_REVIEW',
            'Resolve the register’s pending fiscal receipt before preparing another sale.',
            HttpStatus.CONFLICT,
          );
        const openReturnPreparation = await client.query(
          `SELECT id FROM pos.fiscal_return_preparations WHERE cash_register_id = $1
           AND status IN ('prepared', 'printing', 'outcome_unknown') FOR UPDATE`,
          [terminal.cash_register_id],
        );
        if (openReturnPreparation.rowCount)
          throw new ApiErrorException(
            'POS_FISCAL_RETURN_REQUIRES_REVIEW',
            'Resolve the register’s pending fiscal return before preparing another sale.',
            HttpStatus.CONFLICT,
          );

        if (normalized.customerPartnerId) {
          await this.requireCustomer(client, normalized.customerPartnerId);
          if (normalized.customerLocationId)
            await this.requireCustomerLocation(
              client,
              normalized.customerPartnerId,
              normalized.customerLocationId,
            );
        }

        const productIds = normalized.lines.map((line) => line.productId);
        const productResult = await client.query<SaleProductRow>(saleProductsSql, [
          productIds,
          shift.warehouseId,
          normalized.customerPartnerId ?? null,
        ]);
        if (productResult.rowCount !== productIds.length)
          throw new ApiErrorException(
            'POS_PRODUCT_UNAVAILABLE',
            'One or more basket items are inactive or unavailable at this register',
            HttpStatus.CONFLICT,
          );

        await client.query(
          `SELECT warehouse_id, product_id FROM inventory.stock_balances
           WHERE warehouse_id = $1 AND product_id = ANY($2::uuid[])
           ORDER BY product_id FOR UPDATE`,
          [shift.warehouseId, productIds],
        );
        const basketPricing = await this.prepareBasketPricing(
          client,
          shift,
          normalized,
          authentication.accountId,
        );

        const serialsByProduct = new Map<string, Array<{ id: string; serial_number: string }>>();
        const preparedLines: ReadySaleLine[] = [];
        for (const inputLine of normalized.lines) {
          const product = required(
            productResult.rows.find((row) => row.id === inputLine.productId),
            'POS product lookup failed',
          );
          if (!product.unit_price)
            throw new ApiErrorException(
              'POS_PRICE_UNAVAILABLE',
              `${product.name} does not have an active EUR selling price`,
              HttpStatus.CONFLICT,
            );
          if (!product.vat_treatment)
            throw new ApiErrorException(
              'POS_VAT_UNCONFIGURED',
              `${product.name} does not have an approved POS VAT treatment`,
              HttpStatus.CONFLICT,
            );
          if (product.tracking_mode === 'serial') {
            if (
              !isWhole(inputLine.quantity) ||
              inputLine.serialNumbers.length !== Number(inputLine.quantity)
            )
              throw new ApiErrorException(
                'POS_SERIAL_SELECTION_REQUIRED',
                `Select one available serial number for each ${product.name}`,
                HttpStatus.CONFLICT,
              );
            if (!normalized.customerPartnerId || !normalized.customerLocationId)
              throw new ApiErrorException(
                'POS_SERIAL_CUSTOMER_REQUIRED',
                'Select the customer and receiving location before selling a serialised item',
                HttpStatus.CONFLICT,
              );
          } else if (inputLine.serialNumbers.length) {
            throw new ApiErrorException(
              'POS_SERIAL_NOT_ALLOWED',
              `${product.name} does not use serial-number tracking`,
              HttpStatus.BAD_REQUEST,
            );
          }
          if (product.tracking_mode === 'batch' && !inputLine.batchId)
            throw new ApiErrorException(
              'POS_BATCH_REQUIRED',
              `Select a batch for ${product.name}`,
              HttpStatus.CONFLICT,
            );
          if (product.tracking_mode !== 'batch' && inputLine.batchId)
            throw new ApiErrorException(
              'POS_BATCH_NOT_ALLOWED',
              `${product.name} does not use batch tracking`,
              HttpStatus.BAD_REQUEST,
            );

          const quantity = units(inputLine.quantity);
          const available = await client.query<{ available_quantity: string }>(
            `SELECT (balance.quantity - COALESCE((
               SELECT sum(reservation.remaining_quantity)
               FROM inventory.stock_reservations reservation
               WHERE reservation.warehouse_id = balance.warehouse_id
                 AND reservation.product_id = balance.product_id
                 AND reservation.status = 'active'
             ), 0))::text AS available_quantity
             FROM inventory.stock_balances balance
             WHERE balance.warehouse_id = $1 AND balance.product_id = $2`,
            [shift.warehouseId, inputLine.productId],
          );
          if (units(available.rows[0]?.available_quantity ?? '0') < quantity)
            throw new ApiErrorException(
              'POS_STOCK_UNAVAILABLE',
              `There is not enough available stock for ${product.name}`,
              HttpStatus.CONFLICT,
            );

          if (inputLine.batchId) {
            const batch = await client.query(
              `SELECT batch_balance.batch_id
               FROM inventory.batch_stock_balances batch_balance
               JOIN inventory.batches batch ON batch.id = batch_balance.batch_id
               WHERE batch_balance.warehouse_id = $1 AND batch_balance.batch_id = $2
                 AND batch.product_id = $3
                 AND batch_balance.quantity - batch_balance.reserved_quantity >= $4
               FOR UPDATE OF batch_balance`,
              [shift.warehouseId, inputLine.batchId, inputLine.productId, inputLine.quantity],
            );
            if (!batch.rowCount)
              throw new ApiErrorException(
                'POS_BATCH_UNAVAILABLE',
                `The selected batch cannot supply ${product.name}`,
                HttpStatus.CONFLICT,
              );
          }

          const serials = inputLine.serialNumbers.length
            ? await client.query<{ id: string; serial_number: string }>(
                `SELECT item.id, item.serial_number
                 FROM inventory.serialized_items item
                 WHERE item.product_id = $1 AND item.warehouse_id = $2
                   AND item.status = 'available'
                   AND upper(item.serial_number) = ANY($3::text[])
                   AND NOT EXISTS (
                     SELECT 1 FROM inventory.stock_reservation_serials reserved
                     WHERE reserved.serialized_item_id = item.id AND reserved.active
                   )
                 ORDER BY item.serial_number FOR UPDATE OF item`,
                [
                  inputLine.productId,
                  shift.warehouseId,
                  inputLine.serialNumbers.map((serial) => serial.toUpperCase()),
                ],
              )
            : { rowCount: 0, rows: [] as Array<{ id: string; serial_number: string }> };
          if (serials.rowCount !== inputLine.serialNumbers.length)
            throw new ApiErrorException(
              'POS_SERIAL_UNAVAILABLE',
              `One or more selected serial numbers for ${product.name} are unavailable`,
              HttpStatus.CONFLICT,
            );
          serialsByProduct.set(inputLine.productId, serials.rows);

          preparedLines.push({
            ...inputLine,
            product,
            ...required(
              basketPricing.lines.find((line) => line.productId === inputLine.productId),
              'POS basket pricing line lookup failed',
            ),
          });
        }

        const paymentSnapshot = await prepareSalePayments(
          client,
          normalized.payments,
          basketPricing.grossTotal,
          normalized.customerPartnerId,
          terminal,
          normalized.clientTransactionId,
          this.cardAuthorizations,
          authentication.accountId,
          normalized.shiftId,
          this.environment.NODE_ENV,
          this.environment.BUSINESS_TIMEZONE,
        );
        const preparationId = randomUUID();
        const availableLease = await client.query<{ unique_sale_id: string }>(
          `SELECT unique_sale_id FROM pos.datecs_unp_leases
           WHERE cash_register_id = $1 AND reserved_by_account_id = $2
             AND device_serial = $3 AND operator_identifier = $4
             AND claimed_by_transaction_id IS NULL
             AND ($5::varchar IS NULL OR unique_sale_id = $5)
           ORDER BY substring(unique_sale_id from 15 for 7)::integer
           LIMIT 1 FOR UPDATE`,
          [
            shift.cashRegisterId,
            authentication.accountId,
            deviceSerial,
            operatorIdentifier,
            requestedUniqueSaleId ?? null,
          ],
        );
        const leasedUniqueSaleId = availableLease.rows[0]?.unique_sale_id;
        if (requestedUniqueSaleId && !leasedUniqueSaleId)
          throw new ApiErrorException(
            'POS_DATECS_UNP_LEASE_UNAVAILABLE',
            'This DATECS receipt reference is not available to this register. Refresh the terminal before continuing.',
            HttpStatus.CONFLICT,
          );

        let uniqueSaleId = leasedUniqueSaleId;
        if (!uniqueSaleId) {
          await client.query(
            `INSERT INTO pos.datecs_unp_sequences (device_serial, operator_identifier)
             VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [deviceSerial, operatorIdentifier],
          );
          const allocated = await client.query<{ allocated: string }>(
            `UPDATE pos.datecs_unp_sequences
             SET next_value = next_value + 1
             WHERE device_serial = $1 AND operator_identifier = $2
               AND next_value <= 9999999
             RETURNING (next_value - 1)::text AS allocated`,
            [deviceSerial, operatorIdentifier],
          );
          if (!allocated.rows[0])
            throw new ApiErrorException(
              'POS_DATECS_UNP_SEQUENCE_EXHAUSTED',
              'The DATECS sale sequence is full. Contact an administrator before continuing.',
              HttpStatus.CONFLICT,
            );
          uniqueSaleId = `${deviceSerial}-${operatorIdentifier}-${allocated.rows[0].allocated.padStart(7, '0')}`;
        }
        const pricingSnapshot: FiscalSalePricingSnapshot = {
          basketPricing,
          payments: paymentSnapshot,
          preparedLines,
        };
        const requestSnapshot: CreatePosSaleRequest = {
          clientTransactionId: normalized.clientTransactionId,
          ...(normalized.customerLocationId
            ? { customerLocationId: normalized.customerLocationId }
            : {}),
          ...(normalized.customerPartnerId
            ? { customerPartnerId: normalized.customerPartnerId }
            : {}),
          lines: normalized.lines.map((line) => ({
            ...(line.batchId ? { batchId: line.batchId } : {}),
            productId: line.productId,
            quantity: line.quantity,
            serialNumbers: line.serialNumbers,
          })),
          ...(normalized.loyaltyPointsToRedeem !== undefined
            ? { loyaltyPointsToRedeem: normalized.loyaltyPointsToRedeem }
            : {}),
          ...(normalized.manualDiscount
            ? {
                manualDiscount: {
                  authorizationId: required(
                    normalized.manualDiscount.authorizationId,
                    'POS discount authorization is required',
                  ),
                  discountType: normalized.manualDiscount.discountType,
                  discountValue: normalized.manualDiscount.discountValue,
                },
              }
            : {}),
          payments: normalized.payments,
          shiftId: normalized.shiftId,
        };
        await client.query(
          `INSERT INTO pos.fiscal_sale_preparations (
             id, client_transaction_id, shift_id, cash_register_id, operator_id,
             cashier_account_id, device_serial, operator_identifier, unique_sale_id,
             request_digest, request_snapshot, pricing_snapshot
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
          [
            preparationId,
            normalized.clientTransactionId,
            shift.id,
            terminal.cash_register_id,
            terminal.operator_id,
            authentication.accountId,
            deviceSerial,
            operatorIdentifier,
            uniqueSaleId,
            requestDigest,
            JSON.stringify(requestSnapshot),
            JSON.stringify(pricingSnapshot),
          ],
        );
        if (leasedUniqueSaleId) {
          const claimed = await client.query(
            `UPDATE pos.datecs_unp_leases
             SET claimed_by_transaction_id = $2, fiscal_preparation_id = $3
             WHERE unique_sale_id = $1 AND claimed_by_transaction_id IS NULL`,
            [leasedUniqueSaleId, normalized.clientTransactionId, preparationId],
          );
          if (!claimed.rowCount)
            throw new ApiErrorException(
              'POS_DATECS_UNP_LEASE_UNAVAILABLE',
              'This DATECS receipt reference has already been used. Refresh the terminal before continuing.',
              HttpStatus.CONFLICT,
            );
        }

        if (normalized.manualDiscount?.authorizationId) {
          const reserved = await client.query(
            `UPDATE pos.discount_authorizations
             SET reserved_by_fiscal_preparation_id = $2
             WHERE id = $1 AND consumed_by_sale_id IS NULL
               AND reserved_by_fiscal_preparation_id IS NULL AND expires_at > now()`,
            [normalized.manualDiscount.authorizationId, preparationId],
          );
          if (!reserved.rowCount)
            throw new ApiErrorException(
              'POS_DISCOUNT_AUTHORIZATION_INVALID',
              'This discount approval is already in use or has expired.',
              HttpStatus.CONFLICT,
            );
        }
        if (basketPricing.loyaltyPointsRedeemed > 0 && normalized.customerPartnerId) {
          const account = await client.query<{ id: string }>(
            `SELECT id FROM pos.loyalty_accounts
             WHERE customer_partner_id = $1 AND status = 'active' FOR UPDATE`,
            [normalized.customerPartnerId],
          );
          if (!account.rows[0])
            throw new ApiErrorException(
              'POS_LOYALTY_ACCOUNT_REQUIRED',
              'Choose an active loyalty customer before redeeming points.',
              HttpStatus.CONFLICT,
            );
          await client.query(
            `INSERT INTO pos.fiscal_preparation_loyalty_reservations (
               fiscal_preparation_id, loyalty_account_id, points
             ) VALUES ($1,$2,$3)`,
            [preparationId, account.rows[0].id, basketPricing.loyaltyPointsRedeemed],
          );
        }

        for (const line of preparedLines) {
          const reservation = await client.query<{ id: string }>(
            `INSERT INTO inventory.stock_reservations (
               warehouse_id, product_id, reference_type, reference_id,
               initial_quantity, remaining_quantity, created_by
             ) VALUES ($1,$2,'pos_fiscal_preparation',$3,$4,$4,$5)
             RETURNING id`,
            [
              shift.warehouseId,
              line.productId,
              preparationId,
              line.quantity,
              authentication.accountId,
            ],
          );
          const reservationId = required(reservation.rows[0], 'Stock reservation insert failed').id;
          if (line.batchId) {
            const batchReservation = await client.query(
              `UPDATE inventory.batch_stock_balances
               SET reserved_quantity = reserved_quantity + $3, updated_at = now()
               WHERE warehouse_id = $1 AND batch_id = $2
                 AND quantity - reserved_quantity >= $3`,
              [shift.warehouseId, line.batchId, line.quantity],
            );
            if (!batchReservation.rowCount)
              throw new ApiErrorException(
                'POS_BATCH_UNAVAILABLE',
                `The selected batch cannot supply ${line.product.name}`,
                HttpStatus.CONFLICT,
              );
          }
          for (const serial of serialsByProduct.get(line.productId) ?? [])
            await client.query(
              `INSERT INTO inventory.stock_reservation_serials (
                 reservation_id, serialized_item_id
               ) VALUES ($1,$2)`,
              [reservationId, serial.id],
            );
        }

        const preparation = await this.fiscalSalePreparation(client, preparationId);
        await this.sideEffects(
          client,
          'pos_fiscal_sale_preparation',
          preparationId,
          'pos.fiscal_sale.prepared',
          preparation,
          authentication,
          metadata,
          commandKey,
        );
        return preparation;
      },
    );
  }

  async reserveDatecsUnpLease(
    input: ReservePosDatecsUnpLeaseRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosDatecsUnpLease> {
    const deviceSerial = input.deviceSerial.trim().toUpperCase();
    const operatorIdentifier = input.operatorIdentifier.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/u.test(deviceSerial) || !/^[A-Z0-9]{4}$/u.test(operatorIdentifier))
      throw new ApiErrorException(
        'POS_DATECS_IDENTITY_INVALID',
        'Enter the DATECS device serial number and operator code from the printer settings.',
        HttpStatus.BAD_REQUEST,
      );

    return this.command(
      'pos.datecs-unp.reserve',
      key,
      { deviceSerial, operatorIdentifier, shiftId: input.shiftId },
      HttpStatus.CREATED,
      isPosDatecsUnpLease,
      async (client, commandKey) => {
        const shift = await this.lockShift(client, input.shiftId, authentication.accountId);
        const assignment = await client.query<AssignmentRow>(
          `${assignmentSql} AND register.id = $2 FOR UPDATE OF register, operator, configuration`,
          [authentication.accountId, shift.cashRegisterId],
        );
        const terminal = required(assignment.rows[0], 'POS terminal lookup failed');
        if (terminal.warehouse_id !== shift.warehouseId)
          throw new ApiErrorException(
            'POS_TERMINAL_CHANGED',
            'The register assignment changed after this shift was opened',
            HttpStatus.CONFLICT,
          );
        this.requireUsableFiscalMode(terminal.fiscal_mode);
        if (terminal.fiscal_mode !== 'hardware')
          throw new ApiErrorException(
            'POS_DATECS_HARDWARE_REQUIRED',
            'Offline receipt references can be reserved only for a register assigned to fiscal hardware.',
            HttpStatus.CONFLICT,
          );

        await client.query(
          `INSERT INTO pos.datecs_unp_sequences (device_serial, operator_identifier)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [deviceSerial, operatorIdentifier],
        );
        const sequence = await client.query<{ next_value: number }>(
          `SELECT next_value FROM pos.datecs_unp_sequences
           WHERE device_serial = $1 AND operator_identifier = $2 FOR UPDATE`,
          [deviceSerial, operatorIdentifier],
        );
        const available = await client.query<{ unique_sale_id: string }>(
          `SELECT unique_sale_id FROM pos.datecs_unp_leases
           WHERE cash_register_id = $1 AND reserved_by_account_id = $2
             AND device_serial = $3 AND operator_identifier = $4
             AND claimed_by_transaction_id IS NULL
           ORDER BY substring(unique_sale_id from 15 for 7)::integer
           FOR UPDATE`,
          [shift.cashRegisterId, authentication.accountId, deviceSerial, operatorIdentifier],
        );
        const missing = Math.max(0, DATECS_UNP_OFFLINE_BUFFER_SIZE - available.rows.length);
        if (missing) {
          const nextValue = Number(sequence.rows[0]?.next_value ?? 0);
          if (!nextValue || nextValue + missing > 10_000_000)
            throw new ApiErrorException(
              'POS_DATECS_UNP_SEQUENCE_EXHAUSTED',
              'The DATECS sale sequence is full. Contact an administrator before continuing.',
              HttpStatus.CONFLICT,
            );
          await client.query(
            `UPDATE pos.datecs_unp_sequences SET next_value = $3
             WHERE device_serial = $1 AND operator_identifier = $2`,
            [deviceSerial, operatorIdentifier, nextValue + missing],
          );
          for (let offset = 0; offset < missing; offset += 1) {
            const uniqueSaleId = `${deviceSerial}-${operatorIdentifier}-${String(nextValue + offset).padStart(7, '0')}`;
            await client.query(
              `INSERT INTO pos.datecs_unp_leases (
                 unique_sale_id, device_serial, operator_identifier,
                 cash_register_id, reserved_by_account_id
               ) VALUES ($1,$2,$3,$4,$5)`,
              [
                uniqueSaleId,
                deviceSerial,
                operatorIdentifier,
                shift.cashRegisterId,
                authentication.accountId,
              ],
            );
          }
        }
        const result: PosDatecsUnpLease = {
          cashRegisterId: shift.cashRegisterId,
          deviceSerial,
          operatorIdentifier,
          uniqueSaleIds: [
            ...available.rows.map((row) => row.unique_sale_id),
            ...Array.from({ length: missing }, (_, index) => {
              const first = Number(sequence.rows[0]!.next_value);
              return `${deviceSerial}-${operatorIdentifier}-${String(first + index).padStart(7, '0')}`;
            }),
          ],
        };
        await this.sideEffects(
          client,
          'pos_cash_register',
          shift.cashRegisterId,
          'pos.datecs.unp_lease.reserved',
          { leaseCount: result.uniqueSaleIds.length, deviceSerial, operatorIdentifier },
          authentication,
          metadata,
          commandKey,
        );
        return result;
      },
    );
  }

  async reportOfflineSyncEvent(
    input: ReportPosOfflineSyncEventRequest,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosOfflineSyncEventResponse> {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('pos.offline_sync_event'), hashtext($1))`,
        [`${authentication.accountId}:${input.clientEventId}`],
      );
      const existing = await client.query<{
        audit_event_id: string;
        cash_register_id: string;
        client_occurred_at_ms: string;
        client_transaction_id: string;
        device_serial: string;
        event_type: string;
        operator_identifier: string;
        reason_code: string;
        unique_sale_id: string;
      }>(
        `SELECT audit_event_id, cash_register_id, client_transaction_id, device_serial,
                event_type, operator_identifier, reason_code, unique_sale_id,
                floor(extract(epoch FROM client_occurred_at) * 1000)::bigint::text
                  AS client_occurred_at_ms
         FROM pos.offline_sync_events
         WHERE account_id = $1 AND client_event_id = $2`,
        [authentication.accountId, input.clientEventId],
      );
      if (existing.rows[0]) {
        const prior = existing.rows[0];
        const sameRequest =
          prior.cash_register_id === input.cashRegisterId &&
          prior.client_transaction_id === input.clientTransactionId &&
          prior.device_serial === input.deviceSerial &&
          prior.event_type === input.type &&
          prior.operator_identifier === input.operatorIdentifier &&
          prior.reason_code === input.reasonCode &&
          prior.unique_sale_id === input.uniqueSaleId &&
          Number(prior.client_occurred_at_ms) === Date.parse(input.occurredAt);
        if (!sameRequest)
          throw new ApiErrorException(
            'POS_OFFLINE_EVENT_IDEMPOTENCY_CONFLICT',
            'This offline sync event identifier was already used for different details.',
            HttpStatus.CONFLICT,
          );
        await client.query('COMMIT');
        return {
          auditEventId: prior.audit_event_id,
          clientEventId: input.clientEventId,
          duplicate: true,
        };
      }

      const lease = await client.query<{ claimed_by_transaction_id: string | null }>(
        `SELECT claimed_by_transaction_id
         FROM pos.datecs_unp_leases
         WHERE unique_sale_id = $1 AND cash_register_id = $2
           AND reserved_by_account_id = $3 AND device_serial = $4
           AND operator_identifier = $5
         FOR SHARE`,
        [
          input.uniqueSaleId,
          input.cashRegisterId,
          authentication.accountId,
          input.deviceSerial,
          input.operatorIdentifier,
        ],
      );
      const reservedLease = lease.rows[0];
      if (
        !reservedLease ||
        (reservedLease.claimed_by_transaction_id &&
          reservedLease.claimed_by_transaction_id !== input.clientTransactionId)
      )
        throw new ApiErrorException(
          'POS_OFFLINE_EVENT_REFERENCE_INVALID',
          'This offline receipt reference is not assigned to the signed-in cashier.',
          HttpStatus.CONFLICT,
        );

      const auditEvent = await this.audit.append(
        {
          action: `pos.offline_sync.${input.type}`,
          actorAccountId: authentication.accountId,
          after: {
            cashRegisterId: input.cashRegisterId,
            clientEventId: input.clientEventId,
            clientOccurredAt: input.occurredAt,
            clientTransactionId: input.clientTransactionId,
            deviceSerial: input.deviceSerial,
            operatorIdentifier: input.operatorIdentifier,
            reasonCode: input.reasonCode,
            type: input.type,
            uniqueSaleId: input.uniqueSaleId,
          },
          correlationId: metadata.correlationId,
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          targetId: input.clientTransactionId,
          targetType: 'pos_offline_checkout',
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await client.query(
        `INSERT INTO pos.offline_sync_events (
           id, account_id, client_event_id, client_transaction_id,
           cash_register_id, unique_sale_id, device_serial, operator_identifier,
           event_type, reason_code, client_occurred_at, audit_event_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          randomUUID(),
          authentication.accountId,
          input.clientEventId,
          input.clientTransactionId,
          input.cashRegisterId,
          input.uniqueSaleId,
          input.deviceSerial,
          input.operatorIdentifier,
          input.type,
          input.reasonCode,
          input.occurredAt,
          auditEvent.id,
        ],
      );
      await client.query('COMMIT');
      return {
        auditEventId: auditEvent.id,
        clientEventId: input.clientEventId,
        duplicate: false,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markFiscalDailyReportPrinting(
    reportId: string,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalDailyReport> {
    return this.updateFiscalDailyReportState(reportId, 'printing', key, authentication, metadata);
  }

  async markFiscalDailyReportOutcomeUnknown(
    reportId: string,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalDailyReport> {
    return this.updateFiscalDailyReportState(
      reportId,
      'outcome_unknown',
      key,
      authentication,
      metadata,
    );
  }

  async rejectFiscalDailyReport(
    reportId: string,
    input: FailPosFiscalDailyReportRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalDailyReport> {
    return this.command(
      'pos.fiscal-daily-report.reject',
      key,
      { input, reportId },
      HttpStatus.OK,
      isPosFiscalDailyReport,
      async (client, commandKey) => {
        const result = await client.query<FiscalDailyReportRow>(
          `${fiscalDailyReportSql}
           WHERE report.id = $1 AND report.cashier_account_id = $2 FOR UPDATE OF report`,
          [reportId, authentication.accountId],
        );
        const row = required(result.rows[0], 'Fiscal daily report was not found');
        if (row.status === 'failed') return mapFiscalDailyReport(row);
        if (!['prepared', 'printing'].includes(row.status))
          throw new ApiErrorException(
            'POS_FISCAL_REPORT_STATE_CONFLICT',
            'This printer action cannot be marked as rejected.',
            HttpStatus.CONFLICT,
          );
        await client.query(
          `UPDATE pos.fiscal_daily_reports SET status = 'failed', failure_reason = $2 WHERE id = $1`,
          [reportId, input.reason],
        );
        const report = await this.fiscalDailyReport(client, reportId);
        await this.sideEffects(
          client,
          'pos_fiscal_daily_report',
          reportId,
          `pos.fiscal_daily_report.${report.reportType}.rejected`,
          { reason: input.reason, report },
          authentication,
          metadata,
          commandKey,
        );
        return report;
      },
    );
  }

  async confirmFiscalDailyReport(
    reportId: string,
    input: ConfirmPosFiscalDailyReportRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalDailyReport> {
    const normalized = normalizeFiscalDailyReportResult(input);
    return this.command(
      'pos.fiscal-daily-report.confirm',
      key,
      { input: normalized, reportId },
      HttpStatus.OK,
      isPosFiscalDailyReport,
      async (client, commandKey) => {
        const found = await client.query<{ shift_id: string; status: PosFiscalDailyReportStatus }>(
          `SELECT shift_id, status FROM pos.fiscal_daily_reports
           WHERE id = $1 AND cashier_account_id = $2`,
          [reportId, authentication.accountId],
        );
        const initial = required(found.rows[0], 'Fiscal daily report was not found');
        if (initial.status === 'completed') {
          const report = await this.fiscalDailyReport(client, reportId);
          const taxGroups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
          if (
            report.fiscalRecordNumber !== normalized.fiscalRecordNumber ||
            units(report.nonVatSalesTotalEur ?? '0') !== units(normalized.nonVatSalesTotalEur) ||
            taxGroups.some(
              (group) =>
                units(report.taxGroupTotals?.[group] ?? '0') !==
                units(normalized.taxGroupTotals[group]),
            )
          )
            throw new ApiErrorException(
              'POS_FISCAL_REPORT_RESULT_CONFLICT',
              'This report was already recorded with different printer results.',
              HttpStatus.CONFLICT,
            );
          return report;
        }
        const shift = await this.lockShift(client, initial.shift_id, authentication.accountId);
        const result = await client.query<FiscalDailyReportRow>(
          `${fiscalDailyReportSql}
           WHERE report.id = $1 AND report.cashier_account_id = $2 FOR UPDATE OF report`,
          [reportId, authentication.accountId],
        );
        const row = required(result.rows[0], 'Fiscal daily report was not found');
        if (!['printing', 'outcome_unknown'].includes(row.status))
          throw new ApiErrorException(
            'POS_FISCAL_REPORT_STATE_CONFLICT',
            'Only a report sent to the printer can be confirmed.',
            HttpStatus.CONFLICT,
          );
        if (row.report_type === 'z') {
          if (row.shift_version !== shift.version)
            throw new ApiErrorException(
              'POS_SHIFT_CONFLICT',
              'The shift changed before the Z report was recorded. Keep the printed report and ask a manager to reconcile it.',
              HttpStatus.CONFLICT,
            );
          const closed = await client.query(
            `UPDATE pos.shifts SET status = 'closed', closing_cash_eur = $3,
               closed_by = $2, closed_at = now(), version = version + 1
             WHERE id = $1 AND version = $4 AND status = 'open'`,
            [row.shift_id, authentication.accountId, row.closing_cash_eur, row.shift_version],
          );
          if (!closed.rowCount)
            throw new ApiErrorException(
              'POS_SHIFT_CONFLICT',
              'The shift changed before the Z report was recorded. Keep the printed report and ask a manager to reconcile it.',
              HttpStatus.CONFLICT,
            );
        }
        await client.query(
          `UPDATE pos.fiscal_daily_reports SET status = 'completed',
             fiscal_record_number = $2, non_vat_sales_total_eur = $3,
             tax_group_totals = $4::jsonb, completed_at = now()
           WHERE id = $1`,
          [
            reportId,
            normalized.fiscalRecordNumber,
            normalized.nonVatSalesTotalEur,
            JSON.stringify(normalized.taxGroupTotals),
          ],
        );
        if (row.report_type === 'z')
          await this.sideEffects(
            client,
            'pos_shift',
            row.shift_id,
            'pos.shift.closed.with_fiscal_z_report',
            await this.shift(client, row.shift_id),
            authentication,
            metadata,
            commandKey,
          );
        const report = await this.fiscalDailyReport(client, reportId);
        await this.sideEffects(
          client,
          'pos_fiscal_daily_report',
          reportId,
          `pos.fiscal_daily_report.${report.reportType}.completed`,
          report,
          authentication,
          metadata,
          commandKey,
        );
        return report;
      },
    );
  }

  private async updateFiscalDailyReportState(
    reportId: string,
    next: 'printing' | 'outcome_unknown',
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalDailyReport> {
    const scope = `pos.fiscal-daily-report.${next}`;
    return this.command(
      scope,
      key,
      { reportId },
      HttpStatus.OK,
      isPosFiscalDailyReport,
      async (client, commandKey) => {
        const result = await client.query<FiscalDailyReportRow>(
          `${fiscalDailyReportSql}
           WHERE report.id = $1 AND report.cashier_account_id = $2 FOR UPDATE OF report`,
          [reportId, authentication.accountId],
        );
        const row = required(result.rows[0], 'Fiscal daily report was not found');
        if (row.status === next) return mapFiscalDailyReport(row);
        const allowed = next === 'printing' ? row.status === 'prepared' : row.status === 'printing';
        if (!allowed)
          throw new ApiErrorException(
            'POS_FISCAL_REPORT_STATE_CONFLICT',
            next === 'printing'
              ? 'Only a prepared daily report can be sent to the printer.'
              : 'Only a report being printed can be marked for review.',
            HttpStatus.CONFLICT,
          );
        await client.query('UPDATE pos.fiscal_daily_reports SET status = $2 WHERE id = $1', [
          reportId,
          next,
        ]);
        const report = await this.fiscalDailyReport(client, reportId);
        await this.sideEffects(
          client,
          'pos_fiscal_daily_report',
          reportId,
          `pos.fiscal_daily_report.${report.reportType}.${next}`,
          report,
          authentication,
          metadata,
          commandKey,
        );
        return report;
      },
    );
  }

  async activeFiscalSalePreparation(
    shiftId: string,
    authentication: AuthenticationContext,
  ): Promise<PosFiscalSalePreparation | null> {
    const client = await this.database.getPool().connect();
    try {
      const shift = await this.requireOpenShift(client, shiftId, authentication.accountId);
      const result = await client.query<FiscalSalePreparationRow>(
        `SELECT * FROM pos.fiscal_sale_preparations
         WHERE cash_register_id = $1
           AND status IN ('prepared', 'printing', 'outcome_unknown', 'receipt_confirmed')
         ORDER BY created_at, id LIMIT 1`,
        [shift.cashRegisterId],
      );
      const row = result.rows[0];
      if (!row) return null;
      if (row.cashier_account_id !== authentication.accountId)
        throw new ApiErrorException(
          'POS_FISCAL_PREPARATION_RESTRICTED',
          'A fiscal receipt from another cashier requires an authorized manager to reconcile it.',
          HttpStatus.FORBIDDEN,
        );
      return mapFiscalSalePreparation(row);
    } finally {
      client.release();
    }
  }

  async markFiscalSalePrinting(
    preparationId: string,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalSalePreparation> {
    return this.command(
      'pos.fiscal-sale.printing',
      key,
      { preparationId },
      HttpStatus.OK,
      isPosFiscalSalePreparation,
      async (client, commandKey) => {
        const result = await client.query<FiscalSalePreparationRow>(
          `SELECT * FROM pos.fiscal_sale_preparations
           WHERE id = $1 AND cashier_account_id = $2 FOR UPDATE`,
          [preparationId, authentication.accountId],
        );
        const row = required(result.rows[0], 'Fiscal sale preparation was not found');
        if (row.status === 'printing') return mapFiscalSalePreparation(row);
        if (row.status !== 'prepared')
          throw new ApiErrorException(
            'POS_FISCAL_PREPARATION_STATE_CONFLICT',
            'This fiscal sale can no longer be started. Review its current status.',
            HttpStatus.CONFLICT,
          );
        await client.query(
          `UPDATE pos.fiscal_sale_preparations SET status = 'printing', updated_at = now()
           WHERE id = $1`,
          [preparationId],
        );
        const preparation = await this.fiscalSalePreparation(client, preparationId);
        await this.sideEffects(
          client,
          'pos_fiscal_sale_preparation',
          preparationId,
          'pos.fiscal_sale.printing_started',
          preparation,
          authentication,
          metadata,
          commandKey,
        );
        return preparation;
      },
    );
  }

  async markFiscalSaleOutcomeUnknown(
    preparationId: string,
    input: MarkPosFiscalSaleOutcomeUnknownRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalSalePreparation> {
    return this.command(
      'pos.fiscal-sale.outcome-unknown',
      key,
      { input, preparationId },
      HttpStatus.OK,
      isPosFiscalSalePreparation,
      async (client, commandKey) => {
        const result = await client.query<FiscalSalePreparationRow>(
          `SELECT * FROM pos.fiscal_sale_preparations
           WHERE id = $1 AND cashier_account_id = $2 FOR UPDATE`,
          [preparationId, authentication.accountId],
        );
        const row = required(result.rows[0], 'Fiscal sale preparation was not found');
        if (row.status === 'outcome_unknown') return mapFiscalSalePreparation(row);
        if (row.status !== 'printing')
          throw new ApiErrorException(
            'POS_FISCAL_PREPARATION_STATE_CONFLICT',
            'Only a printing fiscal sale can be marked for review.',
            HttpStatus.CONFLICT,
          );
        await client.query(
          `UPDATE pos.fiscal_sale_preparations
           SET status = 'outcome_unknown', updated_at = now()
           WHERE id = $1`,
          [preparationId],
        );
        const preparation = await this.fiscalSalePreparation(client, preparationId);
        await this.sideEffects(
          client,
          'pos_fiscal_sale_preparation',
          preparationId,
          'pos.fiscal_sale.outcome_requires_review',
          { commandCode: input.commandCode, preparation },
          authentication,
          metadata,
          commandKey,
        );
        return preparation;
      },
    );
  }

  async cancelFiscalSalePreparation(
    preparationId: string,
    input: ConfirmPosFiscalSaleCancellationRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalSalePreparation> {
    return this.command(
      'pos.fiscal-sale.cancel',
      key,
      { input, preparationId },
      HttpStatus.OK,
      isPosFiscalSalePreparation,
      async (client, commandKey) => {
        const result = await client.query<FiscalSalePreparationRow>(
          `SELECT * FROM pos.fiscal_sale_preparations
           WHERE id = $1 AND cashier_account_id = $2 FOR UPDATE`,
          [preparationId, authentication.accountId],
        );
        const row = required(result.rows[0], 'Fiscal sale preparation was not found');
        if (row.status === 'cancelled') return mapFiscalSalePreparation(row);
        const printerCancellationConfirmed =
          input.evidence === 'printer_open_rejected' ||
          input.evidence === 'printer_receipt_cancelled';
        const safeBeforePrinting =
          row.status === 'prepared' && input.evidence === 'before_printing';
        const safePrinterResolution = row.status === 'printing' && printerCancellationConfirmed;
        if (!safeBeforePrinting && !safePrinterResolution)
          throw new ApiErrorException(
            'POS_FISCAL_PREPARATION_CANNOT_CANCEL',
            'Stock can be released only before printing starts or after the printer confirms cancellation.',
            HttpStatus.CONFLICT,
          );
        await this.releaseFiscalSaleReservations(client, row, authentication.accountId);
        await client.query(
          `UPDATE pos.fiscal_sale_preparations
           SET status = 'cancelled', printer_cancellation_confirmed = $2, updated_at = now()
           WHERE id = $1`,
          [preparationId, printerCancellationConfirmed],
        );
        const preparation = await this.fiscalSalePreparation(client, preparationId);
        await this.sideEffects(
          client,
          'pos_fiscal_sale_preparation',
          preparationId,
          safePrinterResolution
            ? input.evidence === 'printer_open_rejected'
              ? 'pos.fiscal_sale.printer_open_rejected'
              : 'pos.fiscal_sale.printer_cancellation_confirmed'
            : 'pos.fiscal_sale.cancelled_before_printing',
          { preparation, evidence: input.evidence },
          authentication,
          metadata,
          commandKey,
        );
        return preparation;
      },
    );
  }

  async confirmFiscalSaleReceipt(
    preparationId: string,
    input: ConfirmPosFiscalSaleReceiptRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosSale> {
    const normalized = normalizeFiscalSaleReceipt(input);
    const preparation = await this.command(
      'pos.fiscal-sale.receipt-confirm',
      key,
      { input: normalized, preparationId },
      HttpStatus.OK,
      isPosFiscalSalePreparation,
      async (client, commandKey) => {
        const result = await client.query<FiscalSalePreparationRow>(
          `SELECT * FROM pos.fiscal_sale_preparations
           WHERE id = $1 AND cashier_account_id = $2 FOR UPDATE`,
          [preparationId, authentication.accountId],
        );
        const row = required(result.rows[0], 'Fiscal sale preparation was not found');
        if (row.status === 'receipt_confirmed' || row.status === 'finalized') {
          if (
            digest(
              normalizeFiscalSaleReceipt(
                required(row.fiscal_response ?? undefined, 'Fiscal receipt evidence was not found'),
              ),
            ) !== digest(normalized)
          )
            throw new ApiErrorException(
              'POS_FISCAL_RECEIPT_CONFLICT',
              'The printer reported a different receipt for this prepared sale.',
              HttpStatus.CONFLICT,
            );
          return mapFiscalSalePreparation(row);
        }
        if (!['printing', 'outcome_unknown'].includes(row.status))
          throw new ApiErrorException(
            'POS_FISCAL_PREPARATION_STATE_CONFLICT',
            'The prepared sale was not sent to the fiscal printer.',
            HttpStatus.CONFLICT,
          );
        if (normalized.uniqueSaleId !== row.unique_sale_id)
          throw new ApiErrorException(
            'POS_FISCAL_RECEIPT_ID_MISMATCH',
            'The printer receipt does not belong to this prepared sale.',
            HttpStatus.CONFLICT,
          );
        const expectedChange = fiscalMinorUnitAmount(
          row.pricing_snapshot.payments[0]?.changeAmount ?? '0.0000',
          'change',
        );
        if (normalized.changeEur !== expectedChange)
          throw new ApiErrorException(
            'POS_FISCAL_RECEIPT_TOTAL_MISMATCH',
            'The printer change does not match the prepared cash sale.',
            HttpStatus.CONFLICT,
          );
        const fiscalReceiptNumber = `${row.device_serial}-${normalized.fiscalDocumentNumber}`;
        await client.query(
          `UPDATE pos.fiscal_sale_preparations
           SET status = 'receipt_confirmed', fiscal_document_number = $2,
               fiscal_receipt_number = $3, fiscal_response = $4::jsonb, updated_at = now()
           WHERE id = $1`,
          [
            preparationId,
            normalized.fiscalDocumentNumber,
            fiscalReceiptNumber,
            JSON.stringify(normalized),
          ],
        );
        const confirmed = await this.fiscalSalePreparation(client, preparationId);
        await this.sideEffects(
          client,
          'pos_fiscal_sale_preparation',
          preparationId,
          'pos.fiscal_sale.receipt_confirmed',
          confirmed,
          authentication,
          metadata,
          commandKey,
        );
        return confirmed;
      },
    );

    if (preparation.status === 'finalized') {
      const result = await this.database.getPool().query<{ id: string }>(
        `SELECT finalized_sale_id AS id FROM pos.fiscal_sale_preparations
         WHERE id = $1 AND cashier_account_id = $2`,
        [preparationId, authentication.accountId],
      );
      return this.saleFromPool(
        required(result.rows[0]?.id, 'Finalized POS sale link was not found'),
      );
    }

    const snapshot = await this.database
      .getPool()
      .query<{ request_snapshot: CreatePosSaleRequest }>(
        `SELECT request_snapshot FROM pos.fiscal_sale_preparations
         WHERE id = $1 AND cashier_account_id = $2 AND status = 'receipt_confirmed'`,
        [preparationId, authentication.accountId],
      );
    const requestSnapshot = required(
      snapshot.rows[0],
      'Confirmed fiscal sale was not found',
    ).request_snapshot;
    return this.completeSale(
      requestSnapshot,
      `datecs-finalize-${preparationId}`,
      authentication,
      metadata,
      preparationId,
    );
  }

  async finalizeConfirmedFiscalSale(
    preparationId: string,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosSale> {
    const result = await this.database.getPool().query<FiscalSalePreparationRow>(
      `SELECT * FROM pos.fiscal_sale_preparations
       WHERE id = $1 AND cashier_account_id = $2`,
      [preparationId, authentication.accountId],
    );
    const row = required(result.rows[0], 'Fiscal sale preparation was not found');
    if (row.status === 'finalized' && row.finalized_sale_id)
      return this.saleFromPool(row.finalized_sale_id);
    if (row.status !== 'receipt_confirmed')
      throw new ApiErrorException(
        'POS_FISCAL_RECEIPT_NOT_CONFIRMED',
        'Only a receipt already confirmed by the printer can be finalized.',
        HttpStatus.CONFLICT,
      );
    return this.completeSale(
      row.request_snapshot,
      `datecs-finalize-${preparationId}`,
      authentication,
      metadata,
      preparationId,
    );
  }

  async completeSale(
    input: CreatePosSaleRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    fiscalPreparationId?: string,
  ): Promise<PosSale> {
    const normalized = normalizeSale(input);
    return this.command(
      'pos.sale.complete',
      key,
      normalized,
      HttpStatus.CREATED,
      isPosSale,
      async (client, commandKey) => {
        const shift = await this.lockShift(client, normalized.shiftId, authentication.accountId);
        const activeReport = await client.query(
          `SELECT id FROM pos.fiscal_daily_reports
           WHERE shift_id = $1 AND status IN ('prepared', 'printing', 'outcome_unknown')
           FOR UPDATE`,
          [shift.id],
        );
        if (activeReport.rowCount)
          throw new ApiErrorException(
            'POS_FISCAL_REPORT_REQUIRES_REVIEW',
            'Resolve the pending fiscal report before completing a sale.',
            HttpStatus.CONFLICT,
          );
        const activeReturn = await client.query(
          `SELECT id FROM pos.fiscal_return_preparations WHERE cash_register_id = $1
           AND status IN ('prepared', 'printing', 'outcome_unknown') FOR UPDATE`,
          [shift.cashRegisterId],
        );
        if (activeReturn.rowCount)
          throw new ApiErrorException(
            'POS_FISCAL_RETURN_REQUIRES_REVIEW',
            'Resolve the pending fiscal return before completing another sale.',
            HttpStatus.CONFLICT,
          );
        const fiscalPreparation = fiscalPreparationId
          ? await client.query<FiscalSalePreparationRow>(
              `SELECT * FROM pos.fiscal_sale_preparations
               WHERE id = $1 AND cashier_account_id = $2 FOR UPDATE`,
              [fiscalPreparationId, authentication.accountId],
            )
          : undefined;
        const preparedFiscalSale = fiscalPreparation?.rows[0];
        if (fiscalPreparationId) {
          if (!preparedFiscalSale)
            throw new ApiErrorException(
              'POS_FISCAL_PREPARATION_NOT_FOUND',
              'The confirmed fiscal sale could not be found for this cashier.',
              HttpStatus.NOT_FOUND,
            );
          if (preparedFiscalSale.status !== 'receipt_confirmed')
            throw new ApiErrorException(
              'POS_FISCAL_PREPARATION_STATE_CONFLICT',
              'Only a confirmed fiscal receipt can be posted to the sale register.',
              HttpStatus.CONFLICT,
            );
          if (
            preparedFiscalSale.shift_id !== normalized.shiftId ||
            preparedFiscalSale.client_transaction_id !== normalized.clientTransactionId ||
            digest(normalized) !== digest(normalizeSale(preparedFiscalSale.request_snapshot))
          )
            throw new ApiErrorException(
              'POS_FISCAL_PREPARATION_SNAPSHOT_MISMATCH',
              'The fiscal receipt no longer matches its original checkout.',
              HttpStatus.CONFLICT,
            );
        }
        const existingSale = await client.query<{ id: string; shift_id: string }>(
          `SELECT id, shift_id FROM pos.sales
           WHERE client_transaction_id = $1 FOR UPDATE`,
          [normalized.clientTransactionId],
        );
        if (existingSale.rows[0]) {
          if (existingSale.rows[0].shift_id !== normalized.shiftId)
            throw new ApiErrorException(
              'POS_TRANSACTION_ID_REUSED',
              'This checkout reference belongs to another cashier shift',
              HttpStatus.CONFLICT,
            );
          return this.sale(client, existingSale.rows[0].id);
        }
        const assignment = await client.query<AssignmentRow>(
          `${assignmentSql} AND register.id = $2 FOR UPDATE OF configuration`,
          [authentication.accountId, shift.cashRegisterId],
        );
        const terminal = assignment.rows[0];
        if (!terminal || terminal.warehouse_id !== shift.warehouseId)
          throw new ApiErrorException(
            'POS_TERMINAL_CHANGED',
            'The register assignment changed after this shift was opened',
            HttpStatus.CONFLICT,
          );
        this.requireUsableFiscalMode(terminal.fiscal_mode);
        if (
          terminal.fiscal_mode !== 'simulator' &&
          !(terminal.fiscal_mode === 'hardware' && preparedFiscalSale)
        )
          throw new ApiErrorException(
            'POS_FISCAL_ADAPTER_UNAVAILABLE',
            'The approved fiscal-device adapter is not connected yet',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        if (terminal.fiscal_mode === 'simulator' && preparedFiscalSale)
          throw new ApiErrorException(
            'POS_FISCAL_REGISTER_CHANGED',
            'The register fiscal configuration changed after the receipt was printed.',
            HttpStatus.CONFLICT,
          );
        if (normalized.customerPartnerId) {
          await this.requireCustomer(client, normalized.customerPartnerId);
          if (normalized.customerLocationId)
            await this.requireCustomerLocation(
              client,
              normalized.customerPartnerId,
              normalized.customerLocationId,
            );
        }

        const productIds = normalized.lines.map((line) => line.productId);
        const products = preparedFiscalSale
          ? undefined
          : await client.query<SaleProductRow>(saleProductsSql, [
              productIds,
              shift.warehouseId,
              normalized.customerPartnerId ?? null,
            ]);
        if (products && products.rowCount !== productIds.length)
          throw new ApiErrorException(
            'POS_PRODUCT_UNAVAILABLE',
            'One or more basket items are inactive or unavailable at this register',
            HttpStatus.CONFLICT,
          );

        const basketPricing = preparedFiscalSale
          ? preparedFiscalSale.pricing_snapshot.basketPricing
          : await this.prepareBasketPricing(client, shift, normalized, authentication.accountId);

        const preparedLines = preparedFiscalSale
          ? preparedFiscalSale.pricing_snapshot.preparedLines
          : normalized.lines.map((inputLine) => {
              const product = required(
                products?.rows.find((row) => row.id === inputLine.productId),
                'POS product lookup failed',
              );
              if (!product.unit_price)
                throw new ApiErrorException(
                  'POS_PRICE_UNAVAILABLE',
                  `${product.name} does not have an active EUR selling price`,
                  HttpStatus.CONFLICT,
                );
              if (!product.vat_treatment)
                throw new ApiErrorException(
                  'POS_VAT_UNCONFIGURED',
                  `${product.name} does not have an approved POS VAT treatment`,
                  HttpStatus.CONFLICT,
                );
              if (product.tracking_mode === 'serial') {
                if (
                  !isWhole(inputLine.quantity) ||
                  inputLine.serialNumbers.length !== Number(inputLine.quantity)
                )
                  throw new ApiErrorException(
                    'POS_SERIAL_SELECTION_REQUIRED',
                    `Select one available serial number for each ${product.name}`,
                    HttpStatus.CONFLICT,
                  );
                if (!normalized.customerPartnerId || !normalized.customerLocationId)
                  throw new ApiErrorException(
                    'POS_SERIAL_CUSTOMER_REQUIRED',
                    'Select the customer and receiving location before selling a serialised item',
                    HttpStatus.CONFLICT,
                  );
              } else if (inputLine.serialNumbers.length) {
                throw new ApiErrorException(
                  'POS_SERIAL_NOT_ALLOWED',
                  `${product.name} does not use serial-number tracking`,
                  HttpStatus.BAD_REQUEST,
                );
              }
              if (product.tracking_mode === 'batch' && !inputLine.batchId)
                throw new ApiErrorException(
                  'POS_BATCH_REQUIRED',
                  `Select a batch for ${product.name}`,
                  HttpStatus.CONFLICT,
                );
              if (product.tracking_mode !== 'batch' && inputLine.batchId)
                throw new ApiErrorException(
                  'POS_BATCH_NOT_ALLOWED',
                  `${product.name} does not use batch tracking`,
                  HttpStatus.BAD_REQUEST,
                );
              const totals = required(
                basketPricing.lines.find((line) => line.productId === inputLine.productId),
                'POS basket pricing line lookup failed',
              );
              return {
                ...inputLine,
                product,
                ...totals,
              };
            });
        const netTotal = basketPricing.netTotal;
        const vatTotal = basketPricing.vatTotal;
        const grossTotal = basketPricing.grossTotal;
        const payments = preparedFiscalSale
          ? preparedFiscalSale.pricing_snapshot.payments
          : await prepareSalePayments(
              client,
              normalized.payments,
              grossTotal,
              normalized.customerPartnerId,
              terminal,
              normalized.clientTransactionId,
              this.cardAuthorizations,
              authentication.accountId,
              normalized.shiftId,
              this.environment.NODE_ENV,
              this.environment.BUSINESS_TIMEZONE,
            );

        const saleId = randomUUID();
        const saleNumber = await this.nextNumber(client, terminal, 'sale', 'SALE');
        const receiptNumber =
          preparedFiscalSale?.fiscal_receipt_number ??
          (await this.nextNumber(client, terminal, 'fiscal_receipt', 'SIM-RECEIPT'));
        const fiscalStatus = preparedFiscalSale ? 'fiscalized' : 'simulated';
        const fiscalAdapter = preparedFiscalSale ? 'datecs-fp2000' : 'development-simulator';
        await client.query(
          `INSERT INTO pos.sales (
             id, sale_number, client_transaction_id, shift_id, cash_register_id,
             operator_id, warehouse_id, customer_partner_id, customer_location_id,
             net_total, vat_total, gross_total, fiscal_status, fiscal_receipt_number,
             fiscal_adapter, completed_by, base_net_total, automatic_discount_total,
             manual_discount_total, loyalty_discount_total, loyalty_points_redeemed,
             discount_authorization_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             $15,$16,$17,$18,$19,$20,$21,$22)`,
          [
            saleId,
            saleNumber,
            normalized.clientTransactionId,
            shift.id,
            shift.cashRegisterId,
            shift.operatorId,
            shift.warehouseId,
            normalized.customerPartnerId ?? null,
            normalized.customerLocationId ?? null,
            netTotal,
            vatTotal,
            grossTotal,
            fiscalStatus,
            receiptNumber,
            fiscalAdapter,
            authentication.accountId,
            basketPricing.baseNetTotal,
            basketPricing.automaticDiscountTotal,
            basketPricing.manualDiscountTotal,
            basketPricing.loyaltyDiscountTotal,
            basketPricing.loyaltyPointsRedeemed,
            normalized.manualDiscount?.authorizationId ?? null,
          ],
        );

        for (const line of preparedLines) {
          if (fiscalPreparationId) {
            const held = await client.query(
              `SELECT id FROM inventory.stock_reservations
               WHERE reference_type = 'pos_fiscal_preparation'
                 AND reference_id = $1 AND warehouse_id = $2 AND product_id = $3
                 AND status = 'active' AND remaining_quantity = $4
               FOR UPDATE`,
              [fiscalPreparationId, shift.warehouseId, line.productId, line.quantity],
            );
            if (!held.rowCount)
              throw new ApiErrorException(
                'POS_FISCAL_RESERVATION_MISSING',
                'Reserved stock changed before this fiscal receipt could be posted. Contact a manager before continuing.',
                HttpStatus.CONFLICT,
              );
          }
          const balance = await client.query<{ average_unit_cost_eur: string }>(
            `SELECT balance.average_unit_cost_eur::text
             FROM inventory.stock_balances balance
             WHERE balance.warehouse_id = $1 AND balance.product_id = $2 FOR UPDATE`,
            [shift.warehouseId, line.productId],
          );
          const valuation = balance.rows[0];
          if (!valuation)
            throw new ApiErrorException(
              'POS_STOCK_UNAVAILABLE',
              `${line.product.name} is not stocked at this register`,
              HttpStatus.CONFLICT,
            );
          const available = await client.query<{ available_quantity: string }>(
            `SELECT (balance.quantity - COALESCE((
               SELECT sum(reservation.remaining_quantity)
               FROM inventory.stock_reservations reservation
               WHERE reservation.warehouse_id = balance.warehouse_id
                 AND reservation.product_id = balance.product_id
                 AND reservation.status = 'active'
                 AND ($3::uuid IS NULL OR reservation.reference_id <> $3::text
                   OR reservation.reference_type <> 'pos_fiscal_preparation')
             ), 0))::text AS available_quantity
             FROM inventory.stock_balances balance
             WHERE balance.warehouse_id = $1 AND balance.product_id = $2`,
            [shift.warehouseId, line.productId, fiscalPreparationId ?? null],
          );
          if (units(available.rows[0]?.available_quantity ?? '0') < units(line.quantity))
            throw new ApiErrorException(
              'POS_STOCK_UNAVAILABLE',
              `There is not enough available stock for ${line.product.name}`,
              HttpStatus.CONFLICT,
            );
          await client.query(
            `UPDATE inventory.stock_balances
             SET quantity = quantity - $3, updated_at = now()
             WHERE warehouse_id = $1 AND product_id = $2`,
            [shift.warehouseId, line.productId, line.quantity],
          );
          if (line.batchId) {
            const batch = await client.query(
              `UPDATE inventory.batch_stock_balances balance
               SET quantity = balance.quantity - $3,
                   reserved_quantity = balance.reserved_quantity -
                     CASE WHEN $5::uuid IS NULL THEN 0 ELSE $3::numeric END,
                   updated_at = now()
               FROM inventory.batches batch
               WHERE balance.warehouse_id = $1 AND balance.batch_id = $2
                 AND batch.id = balance.batch_id AND batch.product_id = $4
                 AND balance.quantity >= $3
                 AND ($5::uuid IS NULL OR balance.reserved_quantity >= $3)
               RETURNING balance.batch_id`,
              [
                shift.warehouseId,
                line.batchId,
                line.quantity,
                line.productId,
                fiscalPreparationId ?? null,
              ],
            );
            if (!batch.rowCount)
              throw new ApiErrorException(
                'POS_BATCH_UNAVAILABLE',
                `The selected batch cannot supply ${line.product.name}`,
                HttpStatus.CONFLICT,
              );
          }
          const serials = line.serialNumbers.length
            ? await client.query<{ id: string; serial_number: string }>(
                `SELECT item.id, item.serial_number
                 FROM inventory.serialized_items item
                 WHERE item.product_id = $1 AND item.warehouse_id = $2
                   AND item.status = 'available'
                   AND upper(item.serial_number) = ANY($3::text[])
                   AND (
                     ($4::uuid IS NULL AND NOT EXISTS (
                       SELECT 1 FROM inventory.stock_reservation_serials reserved
                       WHERE reserved.serialized_item_id = item.id AND reserved.active
                     )) OR ($4::uuid IS NOT NULL AND EXISTS (
                       SELECT 1 FROM inventory.stock_reservation_serials reserved
                       JOIN inventory.stock_reservations reservation
                         ON reservation.id = reserved.reservation_id
                       WHERE reserved.serialized_item_id = item.id AND reserved.active
                         AND reservation.reference_type = 'pos_fiscal_preparation'
                         AND reservation.reference_id = $4::text AND reservation.status = 'active'
                     ))
                   )
                 ORDER BY item.serial_number FOR UPDATE OF item`,
                [
                  line.productId,
                  shift.warehouseId,
                  line.serialNumbers.map((serial) => serial.toUpperCase()),
                  fiscalPreparationId ?? null,
                ],
              )
            : { rowCount: 0, rows: [] as Array<{ id: string; serial_number: string }> };
          if (serials.rowCount !== line.serialNumbers.length)
            throw new ApiErrorException(
              'POS_SERIAL_UNAVAILABLE',
              `One or more selected serial numbers for ${line.product.name} are unavailable`,
              HttpStatus.CONFLICT,
            );
          const saleLineId = randomUUID();
          const movementId = randomUUID();
          await client.query(
            `INSERT INTO inventory.stock_movements (
               id, warehouse_id, product_id, movement_type, quantity, reference_type,
               reference_id, actor_account_id, correlation_id, unit_cost_eur,
               customer_partner_id, batch_id
             ) VALUES ($1,$2,$3,'issue',$4,'pos_sale',$5,$6,$7,$8,$9,$10)`,
            [
              movementId,
              shift.warehouseId,
              line.productId,
              line.quantity,
              saleLineId,
              authentication.accountId,
              metadata.correlationId,
              valuation.average_unit_cost_eur,
              normalized.customerPartnerId ?? null,
              line.batchId ?? null,
            ],
          );
          await client.query(
            `INSERT INTO pos.sale_lines (
               id, sale_id, product_id, product_code, product_name, quantity,
               unit_price, unit_code, vat_treatment, net_total, vat_total, gross_total,
               price_list_id, stock_movement_id, batch_id, category_id, category_name,
               base_net_total, automatic_discount_total, manual_discount_total,
               loyalty_discount_total, pricing_adjustments
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               $18,$19,$20,$21,$22)`,
            [
              saleLineId,
              saleId,
              line.productId,
              line.product.product_code,
              line.product.name,
              line.quantity,
              line.product.unit_price,
              line.product.unit_code,
              line.product.vat_treatment,
              line.netTotal,
              line.vatTotal,
              line.grossTotal,
              line.product.price_list_id,
              movementId,
              line.batchId ?? null,
              line.product.category_id,
              line.product.category_name,
              line.baseNetTotal,
              line.automaticDiscountTotal,
              line.manualDiscountTotal,
              line.loyaltyDiscountTotal,
              JSON.stringify(line.pricingAdjustments),
            ],
          );
          if (serials.rows.length) {
            await client.query(
              `UPDATE inventory.serialized_items
               SET status = 'issued', issued_movement_id = $2
               WHERE id = ANY($1::uuid[])`,
              [serials.rows.map((serial) => serial.id), movementId],
            );
            for (const serial of serials.rows) {
              if (fiscalPreparationId)
                await client.query(
                  `UPDATE inventory.stock_reservation_serials reserved
                   SET active = false, ended_at = now()
                   FROM inventory.stock_reservations reservation
                   WHERE reserved.reservation_id = reservation.id
                     AND reserved.serialized_item_id = $1 AND reserved.active
                     AND reservation.reference_type = 'pos_fiscal_preparation'
                     AND reservation.reference_id = $2 AND reservation.status = 'active'`,
                  [serial.id, fiscalPreparationId],
                );
              await client.query(
                `INSERT INTO pos.sale_line_serials (
                   sale_line_id, serialized_item_id, serial_number
                 ) VALUES ($1,$2,$3)`,
                [saleLineId, serial.id, serial.serial_number],
              );
              await this.registerSoldEquipment(
                client,
                saleId,
                terminal,
                line.product,
                serial,
                required(normalized.customerPartnerId, 'Customer is required'),
                required(normalized.customerLocationId, 'Customer location is required'),
                authentication.accountId,
              );
            }
          }
        }

        if (normalized.manualDiscount)
          await client.query(
            `UPDATE pos.discount_authorizations
             SET consumed_by_sale_id = $2, consumed_at = now()
             WHERE id = $1 AND consumed_by_sale_id IS NULL`,
            [normalized.manualDiscount.authorizationId, saleId],
          );

        const loyalty = normalized.customerPartnerId
          ? await this.loyaltyAccount(client, normalized.customerPartnerId, true)
          : undefined;
        let loyaltyPointsEarned = 0;
        if (loyalty?.status === 'active') {
          const program = await client.query<{ earn_points_per_eur: number }>(
            `SELECT program.earn_points_per_eur
             FROM pos.loyalty_accounts account
             JOIN pos.loyalty_programs program ON program.id = account.program_id
             WHERE account.id = $1`,
            [loyalty.id],
          );
          loyaltyPointsEarned = Number(
            (units(grossTotal) * BigInt(program.rows[0]?.earn_points_per_eur ?? 0)) / 10_000n,
          );
          if (basketPricing.loyaltyPointsRedeemed > 0)
            await client.query(
              `INSERT INTO pos.loyalty_points_ledger (
                 id, loyalty_account_id, entry_type, points, sale_id,
                 reason, actor_account_id, correlation_id
               ) VALUES ($1,$2,'redeemed',$3,$4,$5,$6,$7)`,
              [
                randomUUID(),
                loyalty.id,
                -basketPricing.loyaltyPointsRedeemed,
                saleId,
                `Redeemed on ${saleNumber}`,
                authentication.accountId,
                metadata.correlationId,
              ],
            );
          if (loyaltyPointsEarned > 0)
            await client.query(
              `INSERT INTO pos.loyalty_points_ledger (
                 id, loyalty_account_id, entry_type, points, sale_id,
                 reason, actor_account_id, correlation_id
               ) VALUES ($1,$2,'earned',$3,$4,$5,$6,$7)`,
              [
                randomUUID(),
                loyalty.id,
                loyaltyPointsEarned,
                saleId,
                `Earned on ${saleNumber}`,
                authentication.accountId,
                metadata.correlationId,
              ],
            );
          await client.query(`UPDATE pos.sales SET loyalty_points_earned = $2 WHERE id = $1`, [
            saleId,
            loyaltyPointsEarned,
          ]);
        }

        for (const payment of payments) {
          const paymentId = randomUUID();
          await client.query(
            `INSERT INTO pos.payments (
               id, sale_id, payment_method, amount, tendered_amount, change_amount,
               provider_reference, adapter, status, customer_advance_id, account_due_on
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              paymentId,
              saleId,
              payment.method,
              payment.amount,
              payment.tenderedAmount,
              payment.changeAmount,
              payment.providerReference ?? null,
              payment.adapter,
              payment.status,
              payment.advanceId ?? null,
              payment.accountDueOn ?? null,
            ],
          );
          if (payment.method === 'advance')
            await client.query(
              `INSERT INTO finance.customer_advance_entries (
                 id, advance_id, entry_type, amount, pos_sale_id,
                 actor_account_id, correlation_id
               ) VALUES ($1,$2,'applied',$3,$4,$5,$6)`,
              [
                randomUUID(),
                payment.advanceId,
                payment.amount,
                saleId,
                authentication.accountId,
                metadata.correlationId,
              ],
            );
          if (payment.method === 'on_account')
            await client.query(
              `INSERT INTO finance.customer_account_entries (
                 id, customer_partner_id, payment_terms_id, entry_type, amount,
                 due_on, credit_limit_eur, payment_terms_days, pos_sale_id,
                 actor_account_id, correlation_id
               ) VALUES ($1,$2,$3,'charge',$4,$5,$6,$7,$8,$9,$10)`,
              [
                randomUUID(),
                normalized.customerPartnerId,
                payment.paymentTermsId,
                payment.amount,
                payment.accountDueOn,
                payment.creditLimitEur,
                payment.paymentTermsDays,
                saleId,
                authentication.accountId,
                metadata.correlationId,
              ],
            );
        }
        const requestDigest = digest(normalized);
        await client.query(
          `INSERT INTO pos.fiscal_operations (
             id, sale_id, operation_type, adapter, status, external_reference,
             request_digest, response_digest
           ) VALUES ($1,$2,'sale_receipt',$3,$4,$5,$6,$7)`,
          [
            randomUUID(),
            saleId,
            fiscalAdapter,
            preparedFiscalSale ? 'completed' : 'simulated',
            preparedFiscalSale?.unique_sale_id ?? receiptNumber,
            requestDigest,
            digest(preparedFiscalSale?.fiscal_response ?? { receiptNumber }),
          ],
        );
        if (fiscalPreparationId) {
          await client.query(
            `UPDATE inventory.stock_reservation_serials reserved
             SET active = false, ended_at = now()
             FROM inventory.stock_reservations reservation
             WHERE reserved.reservation_id = reservation.id AND reserved.active
               AND reservation.reference_type = 'pos_fiscal_preparation'
               AND reservation.reference_id = $1 AND reservation.status = 'active'`,
            [fiscalPreparationId],
          );
          await client.query(
            `UPDATE inventory.stock_reservations
             SET remaining_quantity = 0, status = 'consumed', ended_by = $2,
                 ended_at = now(), version = version + 1
             WHERE reference_type = 'pos_fiscal_preparation'
               AND reference_id = $1 AND status = 'active'`,
            [fiscalPreparationId, authentication.accountId],
          );
          await client.query(
            `UPDATE pos.discount_authorizations
             SET consumed_by_sale_id = $2, consumed_at = now(),
                 reserved_by_fiscal_preparation_id = NULL
             WHERE reserved_by_fiscal_preparation_id = $1 AND consumed_by_sale_id IS NULL`,
            [fiscalPreparationId, saleId],
          );
          await client.query(
            `UPDATE pos.fiscal_preparation_loyalty_reservations
             SET active = false, ended_at = now()
             WHERE fiscal_preparation_id = $1 AND active`,
            [fiscalPreparationId],
          );
          await client.query(
            `UPDATE pos.fiscal_sale_preparations
             SET status = 'finalized', finalized_sale_id = $2, updated_at = now()
             WHERE id = $1 AND status = 'receipt_confirmed'`,
            [fiscalPreparationId, saleId],
          );
        }
        const sale = await this.sale(client, saleId);
        await this.sideEffects(
          client,
          'pos_sale',
          saleId,
          'pos.sale.completed',
          sale,
          authentication,
          metadata,
          commandKey,
        );
        return sale;
      },
    );
  }

  async sales(
    page: number,
    pageSize: number,
    authentication: AuthenticationContext,
  ): Promise<PosSalePage> {
    const rows = await this.database.getPool().query<SaleRow>(
      `${saleHeaderSql}
       JOIN organization.operators operator ON operator.id = sale.operator_id
       WHERE operator.account_id = $1
       ORDER BY sale.completed_at DESC, sale.id DESC LIMIT $2 OFFSET $3`,
      [authentication.accountId, pageSize, (page - 1) * pageSize],
    );
    const ids = rows.rows.map((row) => row.id);
    const lines = ids.length
      ? await this.database.getPool().query<SaleLineRow>(saleLinesSql, [ids])
      : { rows: [] as SaleLineRow[] };
    const payments = ids.length
      ? await this.database.getPool().query<SalePaymentRow>(salePaymentsSql, [ids])
      : { rows: [] as SalePaymentRow[] };
    const bySale = new Map<string, PosSaleLine[]>();
    for (const row of lines.rows) {
      const current = bySale.get(row.sale_id) ?? [];
      current.push(mapSaleLine(row));
      bySale.set(row.sale_id, current);
    }
    const paymentsBySale = new Map<string, PosSalePayment[]>();
    for (const row of payments.rows) {
      const current = paymentsBySale.get(row.sale_id) ?? [];
      current.push(mapSalePayment(row));
      paymentsBySale.set(row.sale_id, current);
    }
    const count = await this.database.getPool().query<{ total: string }>(
      `SELECT count(*)::text AS total FROM pos.sales sale
       JOIN organization.operators operator ON operator.id = sale.operator_id
       WHERE operator.account_id = $1`,
      [authentication.accountId],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: rows.rows.map((row) =>
        mapSale(row, bySale.get(row.id) ?? [], paymentsBySale.get(row.id) ?? []),
      ),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  async saleByTransaction(
    transactionId: string,
    authentication: AuthenticationContext,
  ): Promise<PosSale> {
    const client = await this.database.getPool().connect();
    try {
      const result = await client.query<{ id: string }>(
        `SELECT sale.id FROM pos.sales sale
         JOIN organization.operators operator ON operator.id = sale.operator_id
         WHERE sale.client_transaction_id = $1 AND operator.account_id = $2`,
        [transactionId, authentication.accountId],
      );
      const row = result.rows[0];
      if (!row)
        throw new ApiErrorException(
          'POS_SALE_NOT_FOUND',
          'No completed sale was found for this checkout.',
          HttpStatus.NOT_FOUND,
        );
      return await this.sale(client, row.id);
    } finally {
      client.release();
    }
  }

  async saleById(saleId: string, authentication: AuthenticationContext): Promise<PosSale> {
    const client = await this.database.getPool().connect();
    try {
      const result = await client.query<{ id: string }>(
        `SELECT sale.id FROM pos.sales sale
         JOIN organization.operators operator ON operator.id = sale.operator_id
         WHERE sale.id = $1 AND operator.account_id = $2`,
        [saleId, authentication.accountId],
      );
      const row = result.rows[0];
      if (!row)
        throw new ApiErrorException(
          'POS_SALE_NOT_FOUND',
          'The sale was not found for this cashier account.',
          HttpStatus.NOT_FOUND,
        );
      return await this.sale(client, row.id);
    } finally {
      client.release();
    }
  }

  async createInvoiceDraft(
    saleId: string,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinancialDocument> {
    return this.financialDocuments.createFromPosReceipt(saleId, key, authentication, metadata);
  }

  async warrantyCardContent(
    saleId: string,
    cardId: string,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosWarrantyCardContent> {
    const result = await this.database.getPool().query<{
      card_number: string;
      customer_location_name: string;
      customer_name: string;
      fiscal_receipt_number: string;
      issued_at: Date | string;
      issuer_address: string;
      issuer_name: string;
      product_name: string;
      sale_number: string;
      serial_number: string;
      warranty_ends_on: string;
      warranty_starts_on: string;
    }>(
      `SELECT card.card_number, customer.display_name AS customer_name,
              customer_location.name AS customer_location_name,
              equipment.device_name AS product_name, equipment.serial_number,
              card.warranty_starts_on::text, card.warranty_ends_on::text, card.issued_at,
              sale.sale_number, sale.fiscal_receipt_number, entity.name AS issuer_name,
              concat_ws(', ', location.address_line_1, nullif(location.address_line_2, ''),
                        concat_ws(' ', nullif(location.postal_code, ''), location.city),
                        location.country_code) AS issuer_address
       FROM crm.warranty_cards card
       JOIN pos.sales sale ON sale.id = card.pos_sale_id
       JOIN organization.operators operator ON operator.id = sale.operator_id
       JOIN master_data.partners customer ON customer.id = card.customer_partner_id
       JOIN master_data.customer_locations customer_location
         ON customer_location.id = card.customer_location_id
       JOIN master_data.customer_equipment equipment ON equipment.id = card.customer_equipment_id
       JOIN organization.cash_registers register ON register.id = sale.cash_register_id
       JOIN organization.business_locations location ON location.id = register.business_location_id
       JOIN organization.branches branch ON branch.id = location.branch_id
       JOIN organization.legal_entities entity ON entity.id = branch.legal_entity_id
       WHERE sale.id = $1 AND card.id = $2 AND operator.account_id = $3`,
      [saleId, cardId, authentication.accountId],
    );
    const card = result.rows[0];
    if (!card)
      throw new ApiErrorException(
        'POS_WARRANTY_CARD_NOT_FOUND',
        'The warranty card was not found for this receipt.',
        HttpStatus.NOT_FOUND,
      );
    const buffer = await renderPosWarrantyCard({
      cardNumber: card.card_number,
      customerLocationName: card.customer_location_name,
      customerName: card.customer_name,
      fiscalReceiptNumber: card.fiscal_receipt_number,
      issuedAt: iso(card.issued_at),
      issuerAddress: card.issuer_address,
      issuerName: card.issuer_name,
      productName: card.product_name,
      saleNumber: card.sale_number,
      serialNumber: card.serial_number,
      warrantyEndsOn: card.warranty_ends_on,
      warrantyStartsOn: card.warranty_starts_on,
    });
    await this.audit.append({
      action: 'pos.warranty-card.downloaded',
      actorAccountId: authentication.accountId,
      correlationId: metadata.correlationId,
      ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
      targetId: cardId,
      targetType: 'warranty_card',
      ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
    });
    return {
      buffer,
      fileName: `${card.card_number.replaceAll(/[^A-Za-z0-9._-]/gu, '-')}.pdf`,
      mediaType: 'application/pdf',
    };
  }

  async prepareFiscalReturn(
    input: PreparePosFiscalReturnRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalReturnPreparation> {
    const normalized = normalizeReturn(input);
    const deviceSerial = input.deviceSerial.trim().toUpperCase();
    const operatorIdentifier = input.operatorIdentifier.trim().toUpperCase();
    const requestDigest = digest(normalized);
    if (
      !/^[A-Z0-9]{8}$/u.test(deviceSerial) ||
      !/^[A-Z0-9]{4}$/u.test(operatorIdentifier) ||
      Array.from(normalized.reason).length > 30 ||
      normalized.reason.includes(',') ||
      normalized.reason.includes('#') ||
      Array.from(normalized.reason).some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < 0x20 || code === 0x7f;
      })
    )
      throw new ApiErrorException(
        'POS_FISCAL_RETURN_REASON_INVALID',
        'Enter a printer-friendly reason of up to 30 characters without commas or #.',
        HttpStatus.BAD_REQUEST,
      );
    return this.command(
      'pos.fiscal-return.prepare',
      key,
      { deviceSerial, normalized, operatorIdentifier },
      HttpStatus.CREATED,
      isPosFiscalReturnPreparation,
      async (client, commandKey) => {
        const shift = await this.lockShift(client, normalized.shiftId, authentication.accountId);
        const assignment = await client.query<AssignmentRow>(
          `${assignmentSql} AND register.id = $2 FOR UPDATE OF register, operator, configuration`,
          [authentication.accountId, shift.cashRegisterId],
        );
        const terminal = required(assignment.rows[0], 'POS terminal lookup failed');
        if (terminal.fiscal_mode !== 'hardware')
          throw new ApiErrorException(
            'POS_DATECS_HARDWARE_REQUIRED',
            'A printer-linked return needs a register assigned to fiscal hardware.',
            HttpStatus.CONFLICT,
          );
        if (terminal.warehouse_id !== shift.warehouseId)
          throw new ApiErrorException(
            'POS_TERMINAL_CHANGED',
            'The register assignment changed after this shift was opened',
            HttpStatus.CONFLICT,
          );

        const pendingSale = await client.query(
          `SELECT id FROM pos.fiscal_sale_preparations WHERE cash_register_id = $1
           AND status IN ('prepared', 'printing', 'outcome_unknown', 'receipt_confirmed') FOR UPDATE`,
          [shift.cashRegisterId],
        );
        const pendingReport = await client.query(
          `SELECT id FROM pos.fiscal_daily_reports WHERE cash_register_id = $1
           AND status IN ('prepared', 'printing', 'outcome_unknown') FOR UPDATE`,
          [shift.cashRegisterId],
        );
        const pendingReturn = await client.query(
          `SELECT id FROM pos.fiscal_return_preparations WHERE cash_register_id = $1
           AND status IN ('prepared', 'printing', 'outcome_unknown') FOR UPDATE`,
          [shift.cashRegisterId],
        );
        if (pendingSale.rowCount || pendingReport.rowCount || pendingReturn.rowCount)
          throw new ApiErrorException(
            'POS_FISCAL_ACTION_REQUIRES_REVIEW',
            'Resolve the pending fiscal printer action before starting a return.',
            HttpStatus.CONFLICT,
          );

        const originalResult = await client.query<{
          business_location_id: string;
          customer_partner_id: string | null;
          fiscal_adapter: string;
          fiscal_status: string;
          gross_total: string;
          id: string;
          sale_number: string;
          warehouse_id: string;
        }>(
          `SELECT sale.id, sale.sale_number, sale.customer_partner_id, sale.warehouse_id,
             sale.gross_total::text, sale.fiscal_status, sale.fiscal_adapter,
             register.business_location_id
           FROM pos.sales sale
           JOIN organization.cash_registers register ON register.id = sale.cash_register_id
           WHERE sale.id = $1 FOR UPDATE OF sale`,
          [normalized.originalSaleId],
        );
        const original = originalResult.rows[0];
        if (!original)
          throw new ApiErrorException(
            'POS_ORIGINAL_SALE_NOT_FOUND',
            'The original POS sale was not found',
            HttpStatus.NOT_FOUND,
          );
        if (original.business_location_id !== terminal.business_location_id)
          throw new ApiErrorException(
            'POS_RETURN_LOCATION_MISMATCH',
            'Process this return at a register in the original business location',
            HttpStatus.CONFLICT,
          );
        const saleReturnPreparations = await client.query<FiscalReturnPreparationRow>(
          `SELECT * FROM pos.fiscal_return_preparations WHERE original_sale_id = $1
           AND status IN ('prepared', 'printing', 'outcome_unknown') FOR UPDATE`,
          [original.id],
        );
        if (saleReturnPreparations.rowCount)
          throw new ApiErrorException(
            'POS_FISCAL_RETURN_REQUIRES_REVIEW',
            'This sale already has a printer return awaiting confirmation.',
            HttpStatus.CONFLICT,
          );
        if (original.fiscal_status !== 'fiscalized' || original.fiscal_adapter !== 'datecs-fp2000')
          throw new ApiErrorException(
            'POS_FISCAL_ORIGINAL_REQUIRED',
            'A printer-linked return requires an original DATECS fiscal receipt.',
            HttpStatus.CONFLICT,
          );

        const sourcePreparation = await client.query<FiscalSalePreparationRow>(
          `SELECT * FROM pos.fiscal_sale_preparations
           WHERE finalized_sale_id = $1 AND status = 'finalized' FOR UPDATE`,
          [original.id],
        );
        const source = required(
          sourcePreparation.rows[0],
          'The original DATECS receipt link is missing',
        );
        if (
          source.device_serial !== deviceSerial ||
          source.operator_identifier !== operatorIdentifier
        )
          throw new ApiErrorException(
            'POS_FISCAL_DEVICE_MISMATCH',
            'Connect the fiscal printer that issued the original receipt.',
            HttpStatus.CONFLICT,
          );

        const priorReturn = await client.query(
          'SELECT id FROM pos.returns WHERE original_sale_id = $1 FOR UPDATE',
          [original.id],
        );
        if (priorReturn.rowCount)
          throw new ApiErrorException(
            'POS_FISCAL_PARTIAL_RETURN_UNSUPPORTED',
            'This printer workflow reverses a complete receipt. A sale with an earlier return needs an authorized reconciliation.',
            HttpStatus.CONFLICT,
          );

        const saleLines = await client.query<{
          id: string;
          quantity: string;
          tracking_mode: PosTrackingMode;
        }>(
          `SELECT line.id, line.quantity::text, category.tracking_mode
           FROM pos.sale_lines line
           JOIN master_data.products product ON product.id = line.product_id
           JOIN master_data.product_categories category ON category.id = product.category_id
           WHERE line.sale_id = $1 ORDER BY line.id FOR UPDATE OF line`,
          [original.id],
        );
        if (normalized.lines.length !== saleLines.rowCount)
          throw new ApiErrorException(
            'POS_FISCAL_FULL_RETURN_REQUIRED',
            'The DATECS printer reverses the complete receipt. Select every original item and its full quantity.',
            HttpStatus.CONFLICT,
          );
        const destinationIds = new Set<string>();
        for (const saleLine of saleLines.rows) {
          const selected = normalized.lines.find((line) => line.originalSaleLineId === saleLine.id);
          if (!selected || units(selected.quantity) !== units(saleLine.quantity))
            throw new ApiErrorException(
              'POS_FISCAL_FULL_RETURN_REQUIRED',
              'The DATECS printer reverses the complete receipt. Select every original item and its full quantity.',
              HttpStatus.CONFLICT,
            );
          if (saleLine.tracking_mode === 'serial') {
            const sourceSerials = await client.query<{ serial_number: string; status: string }>(
              `SELECT sold.serial_number, item.status FROM pos.sale_line_serials sold
               JOIN inventory.serialized_items item ON item.id = sold.serialized_item_id
               WHERE sold.sale_line_id = $1 ORDER BY sold.serial_number FOR UPDATE OF item`,
              [saleLine.id],
            );
            const expected = sourceSerials.rows
              .map((row) => row.serial_number.toUpperCase())
              .sort();
            const received = selected.serialNumbers.map((value) => value.toUpperCase()).sort();
            if (
              expected.length !== received.length ||
              expected.some((value, index) => value !== received[index]) ||
              sourceSerials.rows.some((row) => row.status !== 'issued')
            )
              throw new ApiErrorException(
                'POS_RETURN_SERIAL_SELECTION_REQUIRED',
                'Select every serial number from the original receipt.',
                HttpStatus.CONFLICT,
              );
          } else if (selected.serialNumbers.length) {
            throw new ApiErrorException(
              'POS_RETURN_SERIAL_NOT_ALLOWED',
              'A non-serialised product cannot include serial numbers.',
              HttpStatus.BAD_REQUEST,
            );
          }
          if (selected.disposition === 'service' && saleLine.tracking_mode !== 'serial')
            throw new ApiErrorException(
              'POS_SERVICE_RETURN_REQUIRES_DEVICE',
              'Only a serialised device can be routed to Service',
              HttpStatus.BAD_REQUEST,
            );
          const destination =
            selected.disposition === 'service'
              ? terminal.service_return_warehouse_id
              : original.warehouse_id;
          if (!destination)
            throw new ApiErrorException(
              'POS_SERVICE_RETURN_WAREHOUSE_REQUIRED',
              'A Service return warehouse has not been configured for this register',
              HttpStatus.CONFLICT,
            );
          destinationIds.add(destination);
        }
        const destinations = await client.query<{ id: string }>(
          `SELECT warehouse.id FROM master_data.warehouses warehouse
           WHERE warehouse.id = ANY($1::uuid[]) AND warehouse.active
             AND NOT EXISTS (SELECT 1 FROM inventory.stocktakes stocktake
               WHERE stocktake.warehouse_id = warehouse.id AND stocktake.status = 'open')
           FOR KEY SHARE OF warehouse`,
          [[...destinationIds]],
        );
        if (destinations.rowCount !== destinationIds.size)
          throw new ApiErrorException(
            'POS_RETURN_WAREHOUSE_UNAVAILABLE',
            'A return warehouse is unavailable or currently under stocktake',
            HttpStatus.CONFLICT,
          );

        const sourcePayments = await client.query<{ amount: string; method: string }>(
          `SELECT payment.amount::text, payment.payment_method AS method
           FROM pos.payments payment WHERE payment.sale_id = $1
           ORDER BY payment.recorded_at, payment.id FOR UPDATE OF payment`,
          [original.id],
        );
        if (
          sourcePayments.rowCount !== 1 ||
          sourcePayments.rows[0]?.method !== 'cash' ||
          units(sourcePayments.rows[0]?.amount ?? '0') !== units(original.gross_total)
        )
          throw new ApiErrorException(
            'POS_FISCAL_RETURN_PAYMENT_UNSUPPORTED',
            'This DATECS return workflow requires the original receipt to have been paid in full by cash.',
            HttpStatus.CONFLICT,
          );
        await prepareReturnRefunds(
          client,
          original.id,
          normalized.refunds,
          original.gross_total,
          terminal,
          this.environment.NODE_ENV,
        );

        await client.query(
          `INSERT INTO pos.datecs_unp_sequences (device_serial, operator_identifier)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [deviceSerial, operatorIdentifier],
        );
        const allocated = await client.query<{ allocated: string }>(
          `UPDATE pos.datecs_unp_sequences
           SET next_value = next_value + 1
           WHERE device_serial = $1 AND operator_identifier = $2
             AND next_value <= 9999999
           RETURNING (next_value - 1)::text AS allocated`,
          [deviceSerial, operatorIdentifier],
        );
        if (!allocated.rows[0])
          throw new ApiErrorException(
            'POS_DATECS_UNP_SEQUENCE_EXHAUSTED',
            'The DATECS return sequence is full. Contact an administrator before continuing.',
            HttpStatus.CONFLICT,
          );
        const uniqueReversalId = `${deviceSerial}-${operatorIdentifier}-${allocated.rows[0].allocated.padStart(7, '0')}`;
        const preparationId = randomUUID();
        await client.query(
          `INSERT INTO pos.fiscal_return_preparations (
             id, shift_id, cash_register_id, operator_id, cashier_account_id,
             original_sale_id, device_serial, operator_identifier,
             original_unique_sale_id, original_fiscal_document_number,
             unique_reversal_id, request_digest, request_snapshot
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
          [
            preparationId,
            shift.id,
            shift.cashRegisterId,
            shift.operatorId,
            authentication.accountId,
            original.id,
            deviceSerial,
            operatorIdentifier,
            source.unique_sale_id,
            required(source.fiscal_document_number, 'The source receipt number is missing'),
            uniqueReversalId,
            requestDigest,
            JSON.stringify(normalized),
          ],
        );
        const preparation = await this.fiscalReturnPreparation(client, preparationId);
        await this.sideEffects(
          client,
          'pos_fiscal_return_preparation',
          preparationId,
          'pos.fiscal_return.prepared',
          preparation,
          authentication,
          metadata,
          commandKey,
        );
        return preparation;
      },
    );
  }

  async activeFiscalReturnPreparation(
    shiftId: string,
    authentication: AuthenticationContext,
  ): Promise<PosFiscalReturnPreparation | null> {
    const client = await this.database.getPool().connect();
    try {
      const shift = await this.requireOpenShift(client, shiftId, authentication.accountId);
      const result = await client.query<FiscalReturnPreparationRow>(
        `SELECT * FROM pos.fiscal_return_preparations
         WHERE cash_register_id = $1 AND status IN ('prepared', 'printing', 'outcome_unknown')
         ORDER BY created_at, id LIMIT 1`,
        [shift.cashRegisterId],
      );
      const row = result.rows[0];
      if (!row) return null;
      if (row.cashier_account_id !== authentication.accountId)
        throw new ApiErrorException(
          'POS_FISCAL_PREPARATION_RESTRICTED',
          'A return from another cashier requires an authorized manager to reconcile it.',
          HttpStatus.FORBIDDEN,
        );
      return mapFiscalReturnPreparation(row);
    } finally {
      client.release();
    }
  }

  async markFiscalReturnPrinting(
    preparationId: string,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalReturnPreparation> {
    return this.command(
      'pos.fiscal-return.printing',
      key,
      { preparationId },
      HttpStatus.OK,
      isPosFiscalReturnPreparation,
      async (client, commandKey) => {
        const result = await client.query<FiscalReturnPreparationRow>(
          `SELECT * FROM pos.fiscal_return_preparations
           WHERE id = $1 AND cashier_account_id = $2 FOR UPDATE`,
          [preparationId, authentication.accountId],
        );
        const row = required(result.rows[0], 'Fiscal return preparation was not found');
        if (row.status === 'printing') return mapFiscalReturnPreparation(row);
        if (row.status !== 'prepared')
          throw new ApiErrorException(
            'POS_FISCAL_PREPARATION_STATE_CONFLICT',
            'This fiscal return cannot be started. Review its current status.',
            HttpStatus.CONFLICT,
          );
        await client.query(
          `UPDATE pos.fiscal_return_preparations SET status = 'printing', updated_at = now()
           WHERE id = $1`,
          [preparationId],
        );
        const preparation = await this.fiscalReturnPreparation(client, preparationId);
        await this.sideEffects(
          client,
          'pos_fiscal_return_preparation',
          preparationId,
          'pos.fiscal_return.printing_started',
          preparation,
          authentication,
          metadata,
          commandKey,
        );
        return preparation;
      },
    );
  }

  async markFiscalReturnOutcomeUnknown(
    preparationId: string,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalReturnPreparation> {
    return this.command(
      'pos.fiscal-return.outcome-unknown',
      key,
      { preparationId },
      HttpStatus.OK,
      isPosFiscalReturnPreparation,
      async (client, commandKey) => {
        const result = await client.query<FiscalReturnPreparationRow>(
          `SELECT * FROM pos.fiscal_return_preparations
           WHERE id = $1 AND cashier_account_id = $2 FOR UPDATE`,
          [preparationId, authentication.accountId],
        );
        const row = required(result.rows[0], 'Fiscal return preparation was not found');
        if (row.status === 'outcome_unknown') return mapFiscalReturnPreparation(row);
        if (row.status !== 'printing')
          throw new ApiErrorException(
            'POS_FISCAL_PREPARATION_STATE_CONFLICT',
            'Only a printing fiscal return can be marked for review.',
            HttpStatus.CONFLICT,
          );
        await client.query(
          `UPDATE pos.fiscal_return_preparations SET status = 'outcome_unknown', updated_at = now()
           WHERE id = $1`,
          [preparationId],
        );
        const preparation = await this.fiscalReturnPreparation(client, preparationId);
        await this.sideEffects(
          client,
          'pos_fiscal_return_preparation',
          preparationId,
          'pos.fiscal_return.outcome_requires_review',
          preparation,
          authentication,
          metadata,
          commandKey,
        );
        return preparation;
      },
    );
  }

  async resolveFiscalReturn(
    preparationId: string,
    input: ResolvePosFiscalReturnRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosFiscalReturnPreparation> {
    return this.command(
      'pos.fiscal-return.resolve',
      key,
      { input, preparationId },
      HttpStatus.OK,
      isPosFiscalReturnPreparation,
      async (client, commandKey) => {
        const result = await client.query<FiscalReturnPreparationRow>(
          `SELECT * FROM pos.fiscal_return_preparations
           WHERE id = $1 AND cashier_account_id = $2 FOR UPDATE`,
          [preparationId, authentication.accountId],
        );
        const row = required(result.rows[0], 'Fiscal return preparation was not found');
        if (row.status === 'cancelled' || row.status === 'rejected')
          return mapFiscalReturnPreparation(row);
        const safeBeforePrinting =
          row.status === 'prepared' && input.evidence === 'before_printing';
        const explicitPrinterRejection =
          row.status === 'printing' && input.evidence === 'printer_rejected';
        if (!safeBeforePrinting && !explicitPrinterRejection)
          throw new ApiErrorException(
            'POS_FISCAL_PREPARATION_CANNOT_RESOLVE',
            'A return with an uncertain printer result cannot be cancelled. Review the printer before continuing.',
            HttpStatus.CONFLICT,
          );
        const status = safeBeforePrinting ? 'cancelled' : 'rejected';
        await client.query(
          `UPDATE pos.fiscal_return_preparations
           SET status = $2, failure_reason = $3, updated_at = now() WHERE id = $1`,
          [preparationId, status, input.evidence],
        );
        const preparation = await this.fiscalReturnPreparation(client, preparationId);
        await this.sideEffects(
          client,
          'pos_fiscal_return_preparation',
          preparationId,
          safeBeforePrinting
            ? 'pos.fiscal_return.cancelled_before_printing'
            : 'pos.fiscal_return.printer_rejected',
          preparation,
          authentication,
          metadata,
          commandKey,
        );
        return preparation;
      },
    );
  }

  async confirmFiscalReturn(
    preparationId: string,
    input: ConfirmPosFiscalReturnRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosReturn> {
    const result = await this.database.getPool().query<FiscalReturnPreparationRow>(
      `SELECT * FROM pos.fiscal_return_preparations
       WHERE id = $1 AND cashier_account_id = $2`,
      [preparationId, authentication.accountId],
    );
    const preparation = required(result.rows[0], 'Fiscal return preparation was not found');
    if (input.uniqueReversalId !== preparation.unique_reversal_id)
      throw new ApiErrorException(
        'POS_FISCAL_RETURN_EVIDENCE_MISMATCH',
        'The printer result does not match this return reference.',
        HttpStatus.CONFLICT,
      );
    if (preparation.status === 'completed') {
      if (
        preparation.fiscal_document_number !== input.fiscalDocumentNumber ||
        preparation.fiscal_reversals_since_daily_report !==
          (input.fiscalReversalsSinceDailyReport ?? null)
      )
        throw new ApiErrorException(
          'POS_FISCAL_RETURN_EVIDENCE_MISMATCH',
          'The return was already confirmed with different printer evidence.',
          HttpStatus.CONFLICT,
        );
      const client = await this.database.getPool().connect();
      try {
        return await this.posReturn(
          client,
          required(
            preparation.completed_return_id ?? undefined,
            'Completed return link is missing',
          ),
        );
      } finally {
        client.release();
      }
    }
    return this.createReturn(preparation.request_snapshot, key, authentication, metadata, {
      ...input,
      preparationId,
    });
  }

  async createReturn(
    input: CreatePosReturnRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    fiscalConfirmation?: FiscalReturnConfirmation,
  ): Promise<PosReturn> {
    const normalized = normalizeReturn(input);
    return this.command(
      'pos.return.complete',
      key,
      { fiscalConfirmation: fiscalConfirmation ?? null, normalized },
      HttpStatus.CREATED,
      isPosReturn,
      async (client, commandKey) => {
        const shift = await this.lockShift(client, normalized.shiftId, authentication.accountId);
        const assignment = await client.query<AssignmentRow>(
          `${assignmentSql} AND register.id = $2 FOR UPDATE OF configuration`,
          [authentication.accountId, shift.cashRegisterId],
        );
        const terminal = required(assignment.rows[0], 'POS terminal lookup failed');
        this.requireUsableFiscalMode(terminal.fiscal_mode);
        let fiscalPreparation: FiscalReturnPreparationRow | undefined;
        if (terminal.fiscal_mode === 'hardware' && fiscalConfirmation) {
          const preparationResult = await client.query<FiscalReturnPreparationRow>(
            `SELECT * FROM pos.fiscal_return_preparations
             WHERE id = $1 AND cashier_account_id = $2 FOR UPDATE`,
            [fiscalConfirmation.preparationId, authentication.accountId],
          );
          fiscalPreparation = required(
            preparationResult.rows[0],
            'Fiscal return preparation was not found',
          );
          if (
            !['printing', 'outcome_unknown'].includes(fiscalPreparation.status) ||
            fiscalPreparation.request_digest !== digest(normalized) ||
            fiscalPreparation.original_sale_id !== normalized.originalSaleId ||
            fiscalPreparation.unique_reversal_id !== fiscalConfirmation.uniqueReversalId ||
            !/^\d{1,10}$/u.test(fiscalConfirmation.fiscalDocumentNumber) ||
            (fiscalConfirmation.fiscalReversalsSinceDailyReport !== undefined &&
              !/^\d{1,4}$/u.test(fiscalConfirmation.fiscalReversalsSinceDailyReport))
          )
            throw new ApiErrorException(
              'POS_FISCAL_RETURN_EVIDENCE_MISMATCH',
              'This printer result does not match a return awaiting confirmation.',
              HttpStatus.CONFLICT,
            );
          if (
            fiscalConfirmation.fiscalDocumentNumber ===
            fiscalPreparation.original_fiscal_document_number
          )
            throw new ApiErrorException(
              'POS_FISCAL_RETURN_EVIDENCE_MISMATCH',
              'The printer returned the original receipt number instead of a new reversal.',
              HttpStatus.CONFLICT,
            );
        } else if (terminal.fiscal_mode === 'hardware') {
          throw new ApiErrorException(
            'POS_FISCAL_ADAPTER_UNAVAILABLE',
            'Prepare and confirm the return through the assigned DATECS printer.',
            HttpStatus.CONFLICT,
          );
        } else if (fiscalConfirmation) {
          throw new ApiErrorException(
            'POS_FISCAL_DEVICE_MISMATCH',
            'A DATECS return confirmation cannot be posted on a simulator register.',
            HttpStatus.CONFLICT,
          );
        }

        const originalResult = await client.query<{
          business_location_id: string;
          customer_partner_id: string | null;
          fiscal_adapter: string;
          fiscal_status: string;
          gross_total: string;
          id: string;
          loyalty_points_earned: number;
          loyalty_points_redeemed: number;
          sale_number: string;
          warehouse_id: string;
        }>(
          `SELECT sale.id, sale.sale_number, sale.customer_partner_id, sale.warehouse_id,
             sale.gross_total::text, sale.loyalty_points_earned,
             sale.loyalty_points_redeemed, sale.fiscal_status, sale.fiscal_adapter,
             register.business_location_id
           FROM pos.sales sale
           JOIN organization.cash_registers register ON register.id = sale.cash_register_id
           WHERE sale.id = $1 FOR UPDATE OF sale`,
          [normalized.originalSaleId],
        );
        const original = originalResult.rows[0];
        if (!original)
          throw new ApiErrorException(
            'POS_ORIGINAL_SALE_NOT_FOUND',
            'The original POS sale was not found',
            HttpStatus.NOT_FOUND,
          );
        if (original.business_location_id !== terminal.business_location_id)
          throw new ApiErrorException(
            'POS_RETURN_LOCATION_MISMATCH',
            'Process this return at a register in the original business location',
            HttpStatus.CONFLICT,
          );
        const activeSaleReturn = await client.query<FiscalReturnPreparationRow>(
          `SELECT * FROM pos.fiscal_return_preparations WHERE original_sale_id = $1
           AND status IN ('prepared', 'printing', 'outcome_unknown') FOR UPDATE`,
          [original.id],
        );
        if (activeSaleReturn.rowCount && activeSaleReturn.rows[0]?.id !== fiscalPreparation?.id)
          throw new ApiErrorException(
            'POS_FISCAL_RETURN_REQUIRES_REVIEW',
            'This sale already has a printer return awaiting confirmation.',
            HttpStatus.CONFLICT,
          );
        if (
          fiscalPreparation &&
          (original.fiscal_status !== 'fiscalized' || original.fiscal_adapter !== 'datecs-fp2000')
        )
          throw new ApiErrorException(
            'POS_FISCAL_ORIGINAL_REQUIRED',
            'A printer-linked return requires the original DATECS fiscal receipt.',
            HttpStatus.CONFLICT,
          );

        const lineIds = normalized.lines.map((line) => line.originalSaleLineId);
        const lineResult = await client.query<{
          batch_id: string | null;
          category_id: string;
          category_name: string;
          gross_total: string;
          id: string;
          net_total: string;
          product_code: string;
          product_id: string;
          product_name: string;
          quantity: string;
          returned_gross_total: string;
          returned_net_total: string;
          returned_quantity: string;
          returned_vat_total: string;
          stock_movement_id: string;
          tracking_mode: PosTrackingMode;
          unit_cost_eur: string;
          unit_price: string;
          vat_total: string;
          vat_treatment: PosVatTreatment;
        }>(
          `SELECT line.id, line.product_id, line.product_code, line.product_name,
             line.category_id, line.category_name,
             line.quantity::text, line.unit_price::text, line.vat_treatment,
             line.net_total::text, line.vat_total::text, line.gross_total::text,
             line.stock_movement_id, line.batch_id, category.tracking_mode,
             movement.unit_cost_eur::text,
             COALESCE((SELECT sum(return_line.quantity)
               FROM pos.return_lines return_line
               WHERE return_line.original_sale_line_id = line.id), 0)::text
               AS returned_quantity
             ,COALESCE((SELECT sum(return_line.net_total)
               FROM pos.return_lines return_line
               WHERE return_line.original_sale_line_id = line.id), 0)::text
               AS returned_net_total
             ,COALESCE((SELECT sum(return_line.vat_total)
               FROM pos.return_lines return_line
               WHERE return_line.original_sale_line_id = line.id), 0)::text
               AS returned_vat_total
             ,COALESCE((SELECT sum(return_line.gross_total)
               FROM pos.return_lines return_line
               WHERE return_line.original_sale_line_id = line.id), 0)::text
               AS returned_gross_total
           FROM pos.sale_lines line
           JOIN master_data.products product ON product.id = line.product_id
           JOIN master_data.product_categories category ON category.id = product.category_id
           JOIN inventory.stock_movements movement ON movement.id = line.stock_movement_id
           WHERE line.sale_id = $1 AND line.id = ANY($2::uuid[])
           ORDER BY line.id FOR UPDATE OF line`,
          [original.id, lineIds],
        );
        if (lineResult.rowCount !== lineIds.length)
          throw new ApiErrorException(
            'POS_RETURN_LINE_NOT_FOUND',
            'One or more selected products do not belong to the original sale',
            HttpStatus.CONFLICT,
          );
        if (fiscalPreparation) {
          const allSaleLines = await client.query<{ total: string }>(
            'SELECT count(*)::text AS total FROM pos.sale_lines WHERE sale_id = $1',
            [original.id],
          );
          if (
            Number(allSaleLines.rows[0]?.total ?? 0) !== normalized.lines.length ||
            normalized.lines.some((selected) => {
              const line = lineResult.rows.find(
                (candidate) => candidate.id === selected.originalSaleLineId,
              );
              return !line || units(selected.quantity) !== units(line.quantity);
            })
          )
            throw new ApiErrorException(
              'POS_FISCAL_FULL_RETURN_REQUIRED',
              'The DATECS printer reverses the complete receipt. Select every original item and its full quantity.',
              HttpStatus.CONFLICT,
            );
        }

        const preparedLines = [] as Array<{
          destinationWarehouseId: string;
          input: (typeof normalized.lines)[number];
          line: (typeof lineResult.rows)[number];
          serials: Array<{ id: string; serial_number: string }>;
          totals: ReturnType<typeof calculatePosLineTotals>;
        }>;
        for (const inputLine of normalized.lines) {
          const line = required(
            lineResult.rows.find((candidate) => candidate.id === inputLine.originalSaleLineId),
            'POS return line lookup failed',
          );
          if (units(line.returned_quantity) + units(inputLine.quantity) > units(line.quantity))
            throw new ApiErrorException(
              'POS_RETURN_QUANTITY_EXCEEDED',
              `${line.product_name} has a smaller returnable quantity`,
              HttpStatus.CONFLICT,
            );
          if (line.tracking_mode === 'serial') {
            if (
              !isWhole(inputLine.quantity) ||
              inputLine.serialNumbers.length !== Number(inputLine.quantity)
            )
              throw new ApiErrorException(
                'POS_RETURN_SERIAL_SELECTION_REQUIRED',
                `Select each ${line.product_name} serial number being returned`,
                HttpStatus.CONFLICT,
              );
          } else if (inputLine.serialNumbers.length) {
            throw new ApiErrorException(
              'POS_RETURN_SERIAL_NOT_ALLOWED',
              `${line.product_name} does not use serial-number tracking`,
              HttpStatus.BAD_REQUEST,
            );
          }
          if (inputLine.disposition === 'service' && line.tracking_mode !== 'serial')
            throw new ApiErrorException(
              'POS_SERVICE_RETURN_REQUIRES_DEVICE',
              'Only a serialised device can be routed to Service',
              HttpStatus.BAD_REQUEST,
            );
          const destinationWarehouseId =
            inputLine.disposition === 'service'
              ? terminal.service_return_warehouse_id
              : original.warehouse_id;
          if (!destinationWarehouseId)
            throw new ApiErrorException(
              'POS_SERVICE_RETURN_WAREHOUSE_REQUIRED',
              'A Service return warehouse has not been configured for this register',
              HttpStatus.CONFLICT,
            );
          const serials = inputLine.serialNumbers.length
            ? await client.query<{ id: string; serial_number: string }>(
                `SELECT item.id, item.serial_number
                 FROM pos.sale_line_serials sold
                 JOIN inventory.serialized_items item ON item.id = sold.serialized_item_id
                 WHERE sold.sale_line_id = $1 AND item.status = 'issued'
                   AND upper(sold.serial_number) = ANY($2::text[])
                   AND NOT EXISTS (
                     SELECT 1 FROM pos.return_line_serials returned
                     JOIN pos.return_lines return_line ON return_line.id = returned.return_line_id
                     WHERE return_line.original_sale_line_id = sold.sale_line_id
                       AND returned.serialized_item_id = sold.serialized_item_id
                   )
                 ORDER BY item.serial_number FOR UPDATE OF item`,
                [
                  inputLine.originalSaleLineId,
                  inputLine.serialNumbers.map((serial) => serial.toUpperCase()),
                ],
              )
            : { rowCount: 0, rows: [] as Array<{ id: string; serial_number: string }> };
          if (serials.rowCount !== inputLine.serialNumbers.length)
            throw new ApiErrorException(
              'POS_RETURN_SERIAL_UNAVAILABLE',
              `One or more ${line.product_name} serial numbers were already returned or are unavailable`,
              HttpStatus.CONFLICT,
            );
          preparedLines.push({
            destinationWarehouseId,
            input: inputLine,
            line,
            serials: serials.rows,
            totals: calculateReturnLineTotals(line, inputLine.quantity),
          });
        }

        const destinationIds = [
          ...new Set(preparedLines.map((line) => line.destinationWarehouseId)),
        ];
        const destinations = await client.query<{ id: string }>(
          `SELECT warehouse.id FROM master_data.warehouses warehouse
           WHERE warehouse.id = ANY($1::uuid[]) AND warehouse.active
             AND NOT EXISTS (
               SELECT 1 FROM inventory.stocktakes stocktake
               WHERE stocktake.warehouse_id = warehouse.id AND stocktake.status = 'open'
             ) FOR KEY SHARE OF warehouse`,
          [destinationIds],
        );
        if (destinations.rowCount !== destinationIds.length)
          throw new ApiErrorException(
            'POS_RETURN_WAREHOUSE_UNAVAILABLE',
            'A return warehouse is unavailable or currently under stocktake',
            HttpStatus.CONFLICT,
          );

        const netTotal = sum(preparedLines.map((line) => line.totals.netTotal));
        const vatTotal = sum(preparedLines.map((line) => line.totals.vatTotal));
        const grossTotal = add(netTotal, vatTotal);
        const refunds = await prepareReturnRefunds(
          client,
          original.id,
          normalized.refunds,
          grossTotal,
          terminal,
          this.environment.NODE_ENV,
        );
        const returnId = randomUUID();
        const returnNumber = await this.nextNumber(client, terminal, 'return', 'RETURN');
        const reversalNumber = fiscalPreparation
          ? fiscalPreparation.unique_reversal_id
          : await this.nextNumber(client, terminal, 'fiscal_return', 'SIM-REVERSAL');
        const fiscalAdapter = fiscalPreparation ? 'datecs-fp2000' : 'development-simulator';
        await client.query(
          `INSERT INTO pos.returns (
             id, return_number, original_sale_id, shift_id, cash_register_id,
             operator_id, customer_partner_id, reason, net_total, vat_total,
             gross_total, fiscal_reversal_number, fiscal_adapter,
             fiscal_document_number, fiscal_reversals_since_daily_report, completed_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            returnId,
            returnNumber,
            original.id,
            shift.id,
            shift.cashRegisterId,
            shift.operatorId,
            original.customer_partner_id,
            normalized.reason,
            netTotal,
            vatTotal,
            grossTotal,
            reversalNumber,
            fiscalAdapter,
            fiscalConfirmation?.fiscalDocumentNumber ?? null,
            fiscalConfirmation?.fiscalReversalsSinceDailyReport ?? null,
            authentication.accountId,
          ],
        );

        for (const refund of refunds)
          await client.query(
            `INSERT INTO pos.return_refunds (
               id, return_id, original_payment_id, refund_method, amount,
               adapter, status, provider_reference
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              randomUUID(),
              returnId,
              refund.originalPaymentId,
              refund.method,
              refund.amount,
              refund.adapter,
              refund.status,
              refund.providerReference ?? null,
            ],
          );

        for (const refund of refunds) {
          if (refund.method === 'advance') {
            const source = await client.query<{ id: string }>(
              `SELECT id FROM finance.customer_advance_entries
               WHERE advance_id = $1 AND pos_sale_id = $2 AND entry_type = 'applied'`,
              [refund.advanceId, original.id],
            );
            await client.query(
              `INSERT INTO finance.customer_advance_entries (
                 id, advance_id, entry_type, amount, pos_sale_id, pos_return_id,
                 source_entry_id, actor_account_id, correlation_id
               ) VALUES ($1,$2,'restored',$3,$4,$5,$6,$7,$8)`,
              [
                randomUUID(),
                refund.advanceId,
                refund.amount,
                original.id,
                returnId,
                required(source.rows[0], 'Advance application entry is missing').id,
                authentication.accountId,
                metadata.correlationId,
              ],
            );
          }
          if (refund.method === 'on_account') {
            const source = await client.query<{
              credit_limit_eur: string;
              due_on: string;
              id: string;
              payment_terms_days: number;
              payment_terms_id: string;
            }>(
              `SELECT id, payment_terms_id, due_on::text, credit_limit_eur::text,
                 payment_terms_days
               FROM finance.customer_account_entries
               WHERE pos_sale_id = $1 AND entry_type = 'charge'`,
              [original.id],
            );
            const charge = required(source.rows[0], 'Customer account charge is missing');
            if (units(refund.releasedAmount) > 0n)
              await client.query(
                `INSERT INTO finance.customer_account_entries (
                 id, customer_partner_id, payment_terms_id, entry_type, amount,
                 due_on, credit_limit_eur, payment_terms_days, pos_sale_id,
                 pos_return_id, source_entry_id, actor_account_id, correlation_id
               ) VALUES ($1,$2,$3,'return_credit',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                [
                  randomUUID(),
                  original.customer_partner_id,
                  charge.payment_terms_id,
                  refund.releasedAmount,
                  charge.due_on,
                  charge.credit_limit_eur,
                  charge.payment_terms_days,
                  original.id,
                  returnId,
                  charge.id,
                  authentication.accountId,
                  metadata.correlationId,
                ],
              );
            if (units(refund.collectedRefundAmount) > 0n)
              await client.query(
                `INSERT INTO finance.pos_account_return_credits(pos_return_id,charge_entry_id,released_amount,refund_amount)
               VALUES($1,$2,$3,$4)`,
                [returnId, charge.id, refund.releasedAmount, refund.collectedRefundAmount],
              );
          }
        }

        for (const prepared of preparedLines) {
          const movementId = randomUUID();
          const returnLineId = randomUUID();
          await client.query(
            `INSERT INTO inventory.stock_movements (
               id, warehouse_id, product_id, movement_type, quantity, reference_type,
               reference_id, actor_account_id, correlation_id, unit_cost_eur,
               customer_partner_id, batch_id
             ) VALUES ($1,$2,$3,'return_in',$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              movementId,
              prepared.destinationWarehouseId,
              prepared.line.product_id,
              prepared.input.quantity,
              `pos_return_${prepared.input.disposition}`,
              returnLineId,
              authentication.accountId,
              metadata.correlationId,
              prepared.line.unit_cost_eur,
              original.customer_partner_id,
              prepared.line.batch_id,
            ],
          );
          await client.query(
            `INSERT INTO inventory.stock_balances (
               warehouse_id, product_id, quantity, average_unit_cost_eur
             ) VALUES ($1,$2,$3,$4)
             ON CONFLICT (warehouse_id, product_id) DO UPDATE SET
               average_unit_cost_eur = round((
                 inventory.stock_balances.quantity * inventory.stock_balances.average_unit_cost_eur
                 + EXCLUDED.quantity * EXCLUDED.average_unit_cost_eur
               ) / (inventory.stock_balances.quantity + EXCLUDED.quantity), 4),
               quantity = inventory.stock_balances.quantity + EXCLUDED.quantity,
               updated_at = now()`,
            [
              prepared.destinationWarehouseId,
              prepared.line.product_id,
              prepared.input.quantity,
              prepared.line.unit_cost_eur,
            ],
          );
          if (prepared.line.batch_id)
            await client.query(
              `INSERT INTO inventory.batch_stock_balances (warehouse_id, batch_id, quantity)
               VALUES ($1,$2,$3) ON CONFLICT (warehouse_id, batch_id) DO UPDATE SET
                 quantity = inventory.batch_stock_balances.quantity + EXCLUDED.quantity,
                 updated_at = now()`,
              [prepared.destinationWarehouseId, prepared.line.batch_id, prepared.input.quantity],
            );
          await client.query(
            `INSERT INTO inventory.stock_returns (
               return_movement_id, original_issue_movement_id, disposition, quantity
             ) VALUES ($1,$2,$3,$4)`,
            [
              movementId,
              prepared.line.stock_movement_id,
              prepared.input.disposition,
              prepared.input.quantity,
            ],
          );
          await client.query(
            `INSERT INTO pos.return_lines (
               id, return_id, original_sale_line_id, product_id, product_code,
               product_name, quantity, disposition, destination_warehouse_id,
               net_total, vat_total, gross_total, stock_movement_id, batch_id,
               category_id, category_name
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [
              returnLineId,
              returnId,
              prepared.line.id,
              prepared.line.product_id,
              prepared.line.product_code,
              prepared.line.product_name,
              prepared.input.quantity,
              prepared.input.disposition,
              prepared.destinationWarehouseId,
              prepared.totals.netTotal,
              prepared.totals.vatTotal,
              prepared.totals.grossTotal,
              movementId,
              prepared.line.batch_id,
              prepared.line.category_id,
              prepared.line.category_name,
            ],
          );
          if (prepared.serials.length) {
            const serialIds = prepared.serials.map((serial) => serial.id);
            await client.query(
              `UPDATE inventory.serialized_items SET warehouse_id = $2,
                 status = 'available', issued_movement_id = NULL
               WHERE id = ANY($1::uuid[])`,
              [serialIds, prepared.destinationWarehouseId],
            );
            await client.query(
              `INSERT INTO inventory.serial_item_return_events (
                 serialized_item_id, original_issue_movement_id,
                 return_movement_id, destination_warehouse_id
               ) SELECT unnest($1::uuid[]), $2, $3, $4`,
              [
                serialIds,
                prepared.line.stock_movement_id,
                movementId,
                prepared.destinationWarehouseId,
              ],
            );
            for (const serial of prepared.serials)
              await client.query(
                `INSERT INTO pos.return_line_serials (
                   return_line_id, serialized_item_id, serial_number
                 ) VALUES ($1,$2,$3)`,
                [returnLineId, serial.id, serial.serial_number],
              );
            await client.query(
              `UPDATE master_data.customer_equipment SET
                 status = $2, active = $3, updated_by = $4,
                 version = version + 1, updated_at = now()
               WHERE serialized_item_id = ANY($1::uuid[]) AND active`,
              [
                serialIds,
                prepared.input.disposition === 'service' ? 'under_repair' : 'retired',
                prepared.input.disposition === 'service',
                authentication.accountId,
              ],
            );
          }
        }

        const remaining = await client.query<{ quantity: string }>(
          `SELECT COALESCE(sum(line.quantity), 0) - COALESCE((
             SELECT sum(return_line.quantity) FROM pos.return_lines return_line
             JOIN pos.sale_lines returned_sale_line
               ON returned_sale_line.id = return_line.original_sale_line_id
             WHERE returned_sale_line.sale_id = $1
           ), 0) AS quantity
           FROM pos.sale_lines line WHERE line.sale_id = $1`,
          [original.id],
        );
        const fullyReturned = units(remaining.rows[0]?.quantity ?? '0') === 0n;
        await client.query(`UPDATE pos.sales SET status = $2, fiscal_status = $3 WHERE id = $1`, [
          original.id,
          fullyReturned ? 'returned' : 'partially_returned',
          fullyReturned ? 'reversed' : 'partially_reversed',
        ]);
        if (
          original.customer_partner_id &&
          (original.loyalty_points_earned > 0 || original.loyalty_points_redeemed > 0)
        ) {
          const account = await this.loyaltyAccount(client, original.customer_partner_id, true);
          if (account) {
            const previous = await client.query<{
              earned_reversed: string;
              redeemed_restored: string;
            }>(
              `SELECT
                 COALESCE(sum(loyalty_points_earned_reversed), 0)::text AS earned_reversed,
                 COALESCE(sum(loyalty_points_redeemed_restored), 0)::text AS redeemed_restored
               FROM pos.returns WHERE original_sale_id = $1 AND id <> $2`,
              [original.id, returnId],
            );
            const earlierEarned = Number(previous.rows[0]?.earned_reversed ?? 0);
            const earlierRestored = Number(previous.rows[0]?.redeemed_restored ?? 0);
            const earnedReversed = fullyReturned
              ? original.loyalty_points_earned - earlierEarned
              : Number(
                  (BigInt(original.loyalty_points_earned) * units(grossTotal)) /
                    units(original.gross_total),
                );
            const redeemedRestored = fullyReturned
              ? original.loyalty_points_redeemed - earlierRestored
              : Number(
                  (BigInt(original.loyalty_points_redeemed) * units(grossTotal)) /
                    units(original.gross_total),
                );
            const sourceEntries = await client.query<{
              entry_type: 'earned' | 'redeemed';
              id: string;
            }>(
              `SELECT id, entry_type FROM pos.loyalty_points_ledger
               WHERE sale_id = $1 AND return_id IS NULL
                 AND entry_type IN ('earned', 'redeemed')`,
              [original.id],
            );
            const earnedSource = sourceEntries.rows.find((entry) => entry.entry_type === 'earned');
            const redeemedSource = sourceEntries.rows.find(
              (entry) => entry.entry_type === 'redeemed',
            );
            if (earnedReversed > 0 && earnedSource)
              await client.query(
                `INSERT INTO pos.loyalty_points_ledger (
                   id, loyalty_account_id, entry_type, points, sale_id, return_id,
                   source_entry_id, reason, actor_account_id, correlation_id
                 ) VALUES ($1,$2,'earned_reversed',$3,$4,$5,$6,$7,$8,$9)`,
                [
                  randomUUID(),
                  account.id,
                  -earnedReversed,
                  original.id,
                  returnId,
                  earnedSource.id,
                  `Points reversed on ${returnNumber}`,
                  authentication.accountId,
                  metadata.correlationId,
                ],
              );
            if (redeemedRestored > 0 && redeemedSource)
              await client.query(
                `INSERT INTO pos.loyalty_points_ledger (
                   id, loyalty_account_id, entry_type, points, sale_id, return_id,
                   source_entry_id, reason, actor_account_id, correlation_id
                 ) VALUES ($1,$2,'redemption_restored',$3,$4,$5,$6,$7,$8,$9)`,
                [
                  randomUUID(),
                  account.id,
                  redeemedRestored,
                  original.id,
                  returnId,
                  redeemedSource.id,
                  `Redeemed points restored on ${returnNumber}`,
                  authentication.accountId,
                  metadata.correlationId,
                ],
              );
            await client.query(
              `UPDATE pos.returns SET loyalty_points_earned_reversed = $2,
                 loyalty_points_redeemed_restored = $3 WHERE id = $1`,
              [returnId, earnedReversed, redeemedRestored],
            );
          }
        }
        const requestDigest = digest(normalized);
        await client.query(
          `INSERT INTO pos.fiscal_operations (
             id, sale_id, return_id, operation_type, adapter, status,
             external_reference, request_digest, response_digest
           ) VALUES ($1,$2,$3,'return_reversal',$4,$5,$6,$7,$8)`,
          [
            randomUUID(),
            original.id,
            returnId,
            fiscalAdapter,
            fiscalPreparation ? 'completed' : 'simulated',
            reversalNumber,
            requestDigest,
            digest(
              fiscalConfirmation
                ? {
                    fiscalDocumentNumber: fiscalConfirmation.fiscalDocumentNumber,
                    fiscalReversalsSinceDailyReport:
                      fiscalConfirmation.fiscalReversalsSinceDailyReport,
                    uniqueReversalId: fiscalConfirmation.uniqueReversalId,
                  }
                : { reversalNumber },
            ),
          ],
        );
        if (fiscalPreparation && fiscalConfirmation) {
          const finalizedPreparation = await client.query(
            `UPDATE pos.fiscal_return_preparations SET status = 'completed',
               fiscal_document_number = $2, fiscal_reversals_since_daily_report = $3,
               completed_return_id = $4, updated_at = now()
             WHERE id = $1 AND status IN ('printing', 'outcome_unknown')`,
            [
              fiscalPreparation.id,
              fiscalConfirmation.fiscalDocumentNumber,
              fiscalConfirmation.fiscalReversalsSinceDailyReport,
              returnId,
            ],
          );
          if (!finalizedPreparation.rowCount)
            throw new ApiErrorException(
              'POS_FISCAL_RETURN_REQUIRES_REVIEW',
              'The printer-linked return changed while it was being confirmed. Reconcile the printer before retrying.',
              HttpStatus.CONFLICT,
            );
        }
        const result = await this.posReturn(client, returnId);
        await this.sideEffects(
          client,
          'pos_return',
          returnId,
          'pos.return.completed',
          result,
          authentication,
          metadata,
          commandKey,
        );
        return result;
      },
    );
  }

  async returns(
    page: number,
    pageSize: number,
    authentication: AuthenticationContext,
  ): Promise<PosReturnPage> {
    const rows = await this.database.getPool().query<ReturnRow>(
      `${returnHeaderSql}
       JOIN organization.operators operator ON operator.id = pos_return.operator_id
       WHERE operator.account_id = $1
       ORDER BY pos_return.completed_at DESC, pos_return.id DESC LIMIT $2 OFFSET $3`,
      [authentication.accountId, pageSize, (page - 1) * pageSize],
    );
    const ids = rows.rows.map((row) => row.id);
    const [lines, refunds] = ids.length
      ? await Promise.all([
          this.database.getPool().query<ReturnLineRow>(returnLinesSql, [ids]),
          this.database.getPool().query<ReturnRefundRow>(returnRefundsSql, [ids]),
        ])
      : [{ rows: [] as ReturnLineRow[] }, { rows: [] as ReturnRefundRow[] }];
    const mappedLines = groupBy(lines.rows, (line) => line.return_id, mapReturnLine);
    const mappedRefunds = groupBy(refunds.rows, (refund) => refund.return_id, mapReturnRefund);
    const count = await this.database.getPool().query<{ total: string }>(
      `SELECT count(*)::text AS total FROM pos.returns pos_return
       JOIN organization.operators operator ON operator.id = pos_return.operator_id
       WHERE operator.account_id = $1`,
      [authentication.accountId],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: rows.rows.map((row) =>
        mapReturn(row, mappedLines.get(row.id) ?? [], mappedRefunds.get(row.id) ?? []),
      ),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  private async prepareBasketPricing(
    client: PoolClient,
    shift: PosShift,
    input: ReturnType<typeof normalizeBasket>,
    cashierAccountId: string,
    requireAuthorization = true,
  ): Promise<PosBasketPricing> {
    if (input.customerPartnerId) await this.requireCustomer(client, input.customerPartnerId);
    const products = await client.query<SaleProductRow>(saleProductsSql, [
      input.lines.map((line) => line.productId),
      shift.warehouseId,
      input.customerPartnerId ?? null,
    ]);
    if (products.rowCount !== input.lines.length)
      throw new ApiErrorException(
        'POS_PRODUCT_UNAVAILABLE',
        'One or more basket items are inactive or unavailable at this register',
        HttpStatus.CONFLICT,
      );
    const prepared = input.lines.map((line) => {
      const product = required(
        products.rows.find((candidate) => candidate.id === line.productId),
        'POS pricing product lookup failed',
      );
      if (!product.unit_price)
        throw new ApiErrorException(
          'POS_PRICE_UNAVAILABLE',
          `${product.name} does not have an active EUR selling price`,
          HttpStatus.CONFLICT,
        );
      if (!product.vat_treatment)
        throw new ApiErrorException(
          'POS_VAT_UNCONFIGURED',
          `${product.name} does not have an approved POS VAT treatment`,
          HttpStatus.CONFLICT,
        );
      return {
        adjustments: [] as PosPricingAdjustment[],
        automatic: 0n,
        base: units(multiply(line.quantity, product.unit_price)),
        input: line,
        loyalty: 0n,
        manual: 0n,
        product,
      };
    });

    const rules = await client.query<CommercialRuleRow>(
      `SELECT rule.id, rule.code, rule.name, rule.rule_type, rule.discount_type,
         rule.discount_value::text, rule.priority,
         json_agg(json_build_object(
           'productId', item.product_id,
           'requiredQuantity', item.required_quantity::text
         ) ORDER BY item.product_id) AS items
       FROM sales.pos_commercial_rules rule
       JOIN sales.pos_commercial_rule_items item ON item.rule_id = rule.id
       WHERE rule.active AND CURRENT_DATE BETWEEN rule.valid_from AND rule.valid_to
       GROUP BY rule.id
       HAVING bool_and(item.product_id = ANY($1::uuid[]))
       ORDER BY rule.priority DESC, rule.code, rule.id`,
      [input.lines.map((line) => line.productId)],
    );
    const claimedProducts = new Set<string>();
    for (const rule of rules.rows) {
      if (rule.items.some((item) => claimedProducts.has(item.productId))) continue;
      const quantities = rule.items.map((item) => {
        const line = prepared.find((candidate) => candidate.input.productId === item.productId);
        return line ? units(line.input.quantity) / units(item.requiredQuantity) : 0n;
      });
      const sets = quantities.reduce<bigint | undefined>(
        (minimum, value) => (minimum === undefined || value < minimum ? value : minimum),
        undefined,
      );
      if (!sets || sets <= 0n) continue;
      if (rule.rule_type === 'quantity' && rule.items.length !== 1) continue;
      if (rule.rule_type === 'bundle' && rule.items.length < 2) continue;
      const weights = rule.items.map((item) => {
        const line = required(
          prepared.find((candidate) => candidate.input.productId === item.productId),
          'POS rule product lookup failed',
        );
        const qualifyingQuantity = fixed(units(item.requiredQuantity) * sets);
        return {
          key: item.productId,
          weight: units(
            multiply(
              qualifyingQuantity,
              required(line.product.unit_price ?? undefined, 'Missing POS price'),
            ),
          ),
        };
      });
      const qualifyingBase = weights.reduce((total, item) => total + item.weight, 0n);
      const requested =
        rule.discount_type === 'percentage'
          ? percentageOf(qualifyingBase, rule.discount_value)
          : units(rule.discount_value) * sets;
      const discount = requested > qualifyingBase ? qualifyingBase : requested;
      for (const allocation of allocate(discount, weights)) {
        const line = required(
          prepared.find((candidate) => candidate.input.productId === allocation.key),
          'POS discount allocation failed',
        );
        line.automatic += allocation.amount;
        line.adjustments.push({
          amount: fixed(allocation.amount),
          code: rule.code,
          label: rule.name,
          source: 'automatic',
        });
        claimedProducts.add(allocation.key);
      }
    }

    if (input.manualDiscount) {
      const remaining = prepared.map((line) => ({
        key: line.input.productId,
        weight: line.base - line.automatic,
      }));
      const available = remaining.reduce((total, line) => total + line.weight, 0n);
      const requested =
        input.manualDiscount.discountType === 'percentage'
          ? percentageOf(available, input.manualDiscount.discountValue)
          : units(input.manualDiscount.discountValue);
      const discount = requested > available ? available : requested;
      for (const allocation of allocate(discount, remaining)) {
        const line = required(
          prepared.find((candidate) => candidate.input.productId === allocation.key),
          'POS manual discount allocation failed',
        );
        line.manual += allocation.amount;
        if (allocation.amount > 0n)
          line.adjustments.push({
            amount: fixed(allocation.amount),
            code: 'MANUAL',
            label: 'Authorized manual discount',
            source: 'manual',
          });
      }
      if (requireAuthorization) {
        const authorizationId = input.manualDiscount.authorizationId;
        if (!authorizationId)
          throw new ApiErrorException(
            'POS_DISCOUNT_AUTHORIZATION_REQUIRED',
            'Ask an authorized employee to approve this discount',
            HttpStatus.FORBIDDEN,
          );
        const authorization = await client.query<{
          basket_digest: string;
          consumed_by_sale_id: string | null;
          reserved_by_fiscal_preparation_id: string | null;
        }>(
          `SELECT basket_digest, consumed_by_sale_id, reserved_by_fiscal_preparation_id
           FROM pos.discount_authorizations
           WHERE id = $1 AND shift_id = $2 AND cashier_account_id = $3
             AND discount_type = $4 AND discount_value = $5
             AND expires_at > now() FOR UPDATE`,
          [
            authorizationId,
            input.shiftId,
            cashierAccountId,
            input.manualDiscount.discountType,
            input.manualDiscount.discountValue,
          ],
        );
        const record = authorization.rows[0];
        if (
          !record ||
          record.consumed_by_sale_id ||
          record.reserved_by_fiscal_preparation_id ||
          record.basket_digest !==
            discountBasketDigest(
              input,
              input.manualDiscount.discountType,
              input.manualDiscount.discountValue,
            )
        )
          throw new ApiErrorException(
            'POS_DISCOUNT_AUTHORIZATION_INVALID',
            'This discount approval is no longer valid for the current basket',
            HttpStatus.CONFLICT,
          );
      }
    }

    const loyaltyAccount = input.customerPartnerId
      ? await this.loyaltyAccount(client, input.customerPartnerId, input.loyaltyPointsToRedeem > 0)
      : undefined;
    const loyaltyBalance = loyaltyAccount?.balance ?? 0;
    let loyaltyPointsRedeemed = 0;
    if (input.loyaltyPointsToRedeem > 0) {
      if (!loyaltyAccount || loyaltyAccount.status !== 'active')
        throw new ApiErrorException(
          'POS_LOYALTY_ACCOUNT_REQUIRED',
          'Choose an active loyalty customer before redeeming points',
          HttpStatus.CONFLICT,
        );
      if (input.loyaltyPointsToRedeem > loyaltyBalance)
        throw new ApiErrorException(
          'POS_LOYALTY_BALANCE_EXCEEDED',
          `This customer has ${loyaltyBalance} points available`,
          HttpStatus.CONFLICT,
        );
      const remaining = prepared.map((line) => ({
        key: line.input.productId,
        weight: line.base - line.automatic - line.manual,
      }));
      const available = remaining.reduce((total, line) => total + line.weight, 0n);
      const pointValue = units(loyaltyAccount.redemptionValueEur);
      loyaltyPointsRedeemed = Math.min(
        input.loyaltyPointsToRedeem,
        Number(pointValue > 0n ? available / pointValue : 0n),
      );
      const discount = pointValue * BigInt(loyaltyPointsRedeemed);
      for (const allocation of allocate(discount, remaining)) {
        const line = required(
          prepared.find((candidate) => candidate.input.productId === allocation.key),
          'POS loyalty allocation failed',
        );
        line.loyalty += allocation.amount;
        if (allocation.amount > 0n)
          line.adjustments.push({
            amount: fixed(allocation.amount),
            code: 'LOYALTY',
            label: `${loyaltyPointsRedeemed} loyalty points`,
            source: 'loyalty',
          });
      }
    }

    const lines = prepared.map((line) => {
      const net = line.base - line.automatic - line.manual - line.loyalty;
      const vatTotal = vat(
        fixed(net),
        required(line.product.vat_treatment ?? undefined, 'Missing POS VAT'),
      );
      return {
        automaticDiscountTotal: fixed(line.automatic),
        baseNetTotal: fixed(line.base),
        grossTotal: add(fixed(net), vatTotal),
        loyaltyDiscountTotal: fixed(line.loyalty),
        manualDiscountTotal: fixed(line.manual),
        netTotal: fixed(net),
        pricingAdjustments: line.adjustments,
        productId: line.input.productId,
        vatTotal,
      };
    });
    return {
      automaticDiscountTotal: sum(lines.map((line) => line.automaticDiscountTotal)),
      baseNetTotal: sum(lines.map((line) => line.baseNetTotal)),
      grossTotal: sum(lines.map((line) => line.grossTotal)),
      lines,
      loyaltyBalance,
      loyaltyDiscountTotal: sum(lines.map((line) => line.loyaltyDiscountTotal)),
      loyaltyPointsRedeemed,
      manualDiscountTotal: sum(lines.map((line) => line.manualDiscountTotal)),
      netTotal: sum(lines.map((line) => line.netTotal)),
      vatTotal: sum(lines.map((line) => line.vatTotal)),
    };
  }

  private async loyaltyAccount(
    client: PoolClient,
    customerPartnerId: string,
    lock = false,
  ): Promise<PosLoyaltyAccount | undefined> {
    if (lock)
      await client.query(
        `SELECT id FROM pos.loyalty_accounts
         WHERE customer_partner_id = $1 FOR UPDATE`,
        [customerPartnerId],
      );
    const result = await client.query<LoyaltyAccountRow>(
      `SELECT account.id, account.card_number, account.status, program.name AS program_name,
         program.redemption_value_eur::text,
         (COALESCE(sum(entry.points), 0) - COALESCE((
           SELECT sum(reservation.points)
           FROM pos.fiscal_preparation_loyalty_reservations reservation
           WHERE reservation.loyalty_account_id = account.id AND reservation.active
         ), 0))::text AS balance
       FROM pos.loyalty_accounts account
       JOIN pos.loyalty_programs program ON program.id = account.program_id
       LEFT JOIN pos.loyalty_points_ledger entry ON entry.loyalty_account_id = account.id
       WHERE account.customer_partner_id = $1
       GROUP BY account.id, program.id`,
      [customerPartnerId],
    );
    const row = result.rows[0];
    return row
      ? {
          balance: Number(row.balance),
          cardNumber: row.card_number,
          id: row.id,
          programName: row.program_name,
          redemptionValueEur: row.redemption_value_eur,
          status: row.status,
        }
      : undefined;
  }

  private async requireOpenShift(
    client: PoolClient,
    shiftId: string,
    accountId: string,
  ): Promise<PosShift> {
    const result = await client.query<ShiftRow>(
      `${shiftSql} WHERE shift.id = $1 AND operator.account_id = $2 AND shift.status = 'open'`,
      [shiftId, accountId],
    );
    if (!result.rows[0])
      throw new ApiErrorException(
        'POS_SHIFT_NOT_OPEN',
        'Open a cashier shift before pricing this basket',
        HttpStatus.CONFLICT,
      );
    return mapShift(result.rows[0]);
  }

  private requireUsableFiscalMode(mode: AssignmentRow['fiscal_mode']) {
    if (mode === 'disabled')
      throw new ApiErrorException(
        'POS_FISCAL_DEVICE_NOT_ASSIGNED',
        'Assign a fiscal device before opening a cashier shift',
        HttpStatus.CONFLICT,
      );
    if (mode === 'simulator' && !canUseFiscalSimulator(this.environment))
      throw new ApiErrorException(
        'POS_FISCAL_SIMULATOR_FORBIDDEN',
        'The development fiscal simulator cannot be used in production',
        HttpStatus.FORBIDDEN,
      );
  }

  private async requireOpenShiftFromPool(shiftId: string, accountId: string): Promise<PosShift> {
    const result = await this.database
      .getPool()
      .query<ShiftRow>(
        `${shiftSql} WHERE shift.id = $1 AND operator.account_id = $2 AND shift.status = 'open'`,
        [shiftId, accountId],
      );
    if (!result.rows[0])
      throw new ApiErrorException(
        'POS_SHIFT_NOT_OPEN',
        'Open a cashier shift before using the live catalog',
        HttpStatus.CONFLICT,
      );
    return mapShift(result.rows[0]);
  }

  private async lockShift(
    client: PoolClient,
    shiftId: string,
    accountId: string,
  ): Promise<PosShift> {
    const locked = await client.query(
      `SELECT shift.id FROM pos.shifts shift
       JOIN organization.operators operator ON operator.id = shift.operator_id
       WHERE shift.id = $1 AND operator.account_id = $2 AND shift.status = 'open'
       FOR UPDATE OF shift`,
      [shiftId, accountId],
    );
    if (!locked.rowCount)
      throw new ApiErrorException(
        'POS_SHIFT_NOT_OPEN',
        'This cashier shift is no longer open',
        HttpStatus.CONFLICT,
      );
    return this.shift(client, shiftId);
  }

  private async shift(client: PoolClient, id: string): Promise<PosShift> {
    const result = await client.query<ShiftRow>(`${shiftSql} WHERE shift.id = $1`, [id]);
    return mapShift(required(result.rows[0], 'POS shift lookup failed'));
  }

  private async requireCustomerFromPool(id: string) {
    const result = await this.database.getPool().query(
      `SELECT partner.id FROM master_data.partners partner
       JOIN master_data.partner_roles role
         ON role.partner_id = partner.id AND role.role = 'customer'
       WHERE partner.id = $1 AND partner.active`,
      [id],
    );
    if (!result.rowCount) throw customerNotFound();
  }

  private async requireCustomer(client: PoolClient, id: string) {
    const result = await client.query(
      `SELECT partner.id FROM master_data.partners partner
       JOIN master_data.partner_roles role
         ON role.partner_id = partner.id AND role.role = 'customer'
       WHERE partner.id = $1 AND partner.active FOR KEY SHARE OF partner`,
      [id],
    );
    if (!result.rowCount) throw customerNotFound();
  }

  private async requireCustomerLocation(client: PoolClient, partnerId: string, locationId: string) {
    const result = await client.query(
      `SELECT id FROM master_data.customer_locations
       WHERE id = $1 AND partner_id = $2 AND active FOR KEY SHARE`,
      [locationId, partnerId],
    );
    if (!result.rowCount)
      throw new ApiErrorException(
        'POS_CUSTOMER_LOCATION_NOT_FOUND',
        'The selected customer location is unavailable',
        HttpStatus.CONFLICT,
      );
  }

  private async registerSoldEquipment(
    client: PoolClient,
    saleId: string,
    terminal: AssignmentRow,
    product: SaleProductRow,
    serial: { id: string; serial_number: string },
    customerPartnerId: string,
    customerLocationId: string,
    actorAccountId: string,
  ) {
    const equipmentId = randomUUID();
    const purchaseDate = businessDate(this.environment.BUSINESS_TIMEZONE);
    const inserted = await client.query<{ warranty_end_date: string | null }>(
      `INSERT INTO master_data.customer_equipment (
         id, customer_location_id, product_id, serialized_item_id, device_name,
         serial_number, purchase_date, warranty_start_date, warranty_end_date,
         source_pos_sale_id, created_by, updated_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$7,
         CASE WHEN $8::integer IS NULL THEN NULL
              ELSE ($7::date + make_interval(months => $8))::date END,
         $9,$10,$10
       ) RETURNING warranty_end_date::text`,
      [
        equipmentId,
        customerLocationId,
        product.id,
        serial.id,
        product.name,
        serial.serial_number,
        purchaseDate,
        product.warranty_months,
        saleId,
        actorAccountId,
      ],
    );
    const warrantyEnd = inserted.rows[0]?.warranty_end_date;
    if (!warrantyEnd) return;
    const number = await this.nextNumber(client, terminal, 'warranty_card', 'WCR');
    await client.query(
      `INSERT INTO crm.warranty_cards (
         id, card_number, customer_partner_id, customer_location_id,
         customer_equipment_id, pos_sale_id, warranty_starts_on,
         warranty_ends_on, issued_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        number,
        customerPartnerId,
        customerLocationId,
        equipmentId,
        saleId,
        purchaseDate,
        warrantyEnd,
        actorAccountId,
      ],
    );
  }

  private async nextNumber(
    client: PoolClient,
    terminal: Pick<
      AssignmentRow,
      'cash_register_code' | 'cash_register_id' | 'operator_code' | 'operator_id'
    >,
    type: 'fiscal_receipt' | 'fiscal_return' | 'return' | 'sale' | 'shift' | 'warranty_card',
    prefix: string,
  ): Promise<string> {
    await client.query(
      `INSERT INTO pos.document_sequences (
         cash_register_id, operator_id, document_type
       ) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [terminal.cash_register_id, terminal.operator_id, type],
    );
    const result = await client.query<{ allocated: string }>(
      `UPDATE pos.document_sequences SET next_value = next_value + 1
       WHERE cash_register_id = $1 AND operator_id = $2 AND document_type = $3
       RETURNING (next_value - 1)::text AS allocated`,
      [terminal.cash_register_id, terminal.operator_id, type],
    );
    const year = new Intl.DateTimeFormat('en', {
      timeZone: this.environment.BUSINESS_TIMEZONE,
      year: 'numeric',
    }).format(new Date());
    const allocated = required(result.rows[0], 'POS number allocation failed').allocated;
    return `${prefix}-${terminal.cash_register_code}-${terminal.operator_code}-${year}-${allocated.padStart(6, '0')}`;
  }

  private async quickAccessFor(
    client: Pick<PoolClient, 'query'>,
    cashRegisterId: string,
    warehouseId: string,
    customerPartnerId: string | undefined,
  ): Promise<PosQuickAccess> {
    const result = await client.query<CatalogRow>(quickAccessSql, [
      warehouseId,
      customerPartnerId ?? null,
      cashRegisterId,
    ]);
    return {
      cashRegisterId,
      items: result.rows.map(mapCatalogItem),
      productIds: result.rows.map((row) => row.id),
    };
  }

  private async sale(client: PoolClient, id: string): Promise<PosSale> {
    const header = await client.query<SaleRow>(`${saleHeaderSql} WHERE sale.id = $1`, [id]);
    const lines = await client.query<SaleLineRow>(saleLinesSql, [[id]]);
    const payments = await client.query<SalePaymentRow>(salePaymentsSql, [[id]]);
    return mapSale(
      required(header.rows[0], 'POS sale lookup failed'),
      lines.rows.map(mapSaleLine),
      payments.rows.map(mapSalePayment),
    );
  }

  private async saleFromPool(id: string): Promise<PosSale> {
    const client = await this.database.getPool().connect();
    try {
      return await this.sale(client, id);
    } finally {
      client.release();
    }
  }

  private async releaseFiscalSaleReservations(
    client: PoolClient,
    row: FiscalSalePreparationRow,
    actorAccountId: string,
  ): Promise<void> {
    for (const line of row.pricing_snapshot.preparedLines) {
      if (line.batchId) {
        const releasedBatch = await client.query(
          `UPDATE inventory.batch_stock_balances
           SET reserved_quantity = reserved_quantity - $3, updated_at = now()
           WHERE warehouse_id = (
             SELECT shift.warehouse_id FROM pos.shifts shift WHERE shift.id = $1
           ) AND batch_id = $2 AND reserved_quantity >= $3`,
          [row.shift_id, line.batchId, line.quantity],
        );
        if (!releasedBatch.rowCount)
          throw new ApiErrorException(
            'POS_FISCAL_BATCH_RESERVATION_MISSING',
            'The reserved batch quantity could not be released safely. Contact a manager.',
            HttpStatus.CONFLICT,
          );
      }
    }
    await client.query(
      `UPDATE inventory.stock_reservation_serials reserved
       SET active = false, ended_at = now()
       FROM inventory.stock_reservations reservation
       WHERE reserved.reservation_id = reservation.id AND reserved.active
         AND reservation.reference_type = 'pos_fiscal_preparation'
         AND reservation.reference_id = $1 AND reservation.status = 'active'`,
      [row.id],
    );
    await client.query(
      `UPDATE inventory.stock_reservations
       SET status = 'released', ended_by = $2, ended_at = now(), version = version + 1
       WHERE reference_type = 'pos_fiscal_preparation'
         AND reference_id = $1 AND status = 'active'`,
      [row.id, actorAccountId],
    );
    await client.query(
      `UPDATE pos.discount_authorizations
       SET reserved_by_fiscal_preparation_id = NULL
       WHERE reserved_by_fiscal_preparation_id = $1 AND consumed_by_sale_id IS NULL`,
      [row.id],
    );
    await client.query(
      `UPDATE pos.fiscal_preparation_loyalty_reservations
       SET active = false, ended_at = now()
       WHERE fiscal_preparation_id = $1 AND active`,
      [row.id],
    );
  }

  private async fiscalSalePreparation(
    client: PoolClient,
    id: string,
  ): Promise<PosFiscalSalePreparation> {
    const result = await client.query<FiscalSalePreparationRow>(
      'SELECT * FROM pos.fiscal_sale_preparations WHERE id = $1',
      [id],
    );
    return mapFiscalSalePreparation(
      required(result.rows[0], 'POS fiscal-sale preparation lookup failed'),
    );
  }

  private async fiscalDailyReport(
    client: Pick<PoolClient, 'query'>,
    id: string,
  ): Promise<PosFiscalDailyReport> {
    const result = await client.query<FiscalDailyReportRow>(
      `${fiscalDailyReportSql} WHERE report.id = $1`,
      [id],
    );
    return mapFiscalDailyReport(required(result.rows[0], 'POS fiscal daily report lookup failed'));
  }

  private async fiscalReturnPreparation(
    client: Pick<PoolClient, 'query'>,
    id: string,
  ): Promise<PosFiscalReturnPreparation> {
    const result = await client.query<FiscalReturnPreparationRow>(
      `SELECT * FROM pos.fiscal_return_preparations WHERE id = $1`,
      [id],
    );
    return mapFiscalReturnPreparation(
      required(result.rows[0], 'POS fiscal return preparation lookup failed'),
    );
  }

  private async posReturn(client: PoolClient, id: string): Promise<PosReturn> {
    const header = await client.query<ReturnRow>(`${returnHeaderSql} WHERE pos_return.id = $1`, [
      id,
    ]);
    const [lines, refunds] = await Promise.all([
      client.query<ReturnLineRow>(returnLinesSql, [[id]]),
      client.query<ReturnRefundRow>(returnRefundsSql, [[id]]),
    ]);
    return mapReturn(
      required(header.rows[0], 'POS return lookup failed'),
      lines.rows.map(mapReturnLine),
      refunds.rows.map(mapReturnRefund),
    );
  }

  private async command<T>(
    scope: string,
    key: string | undefined,
    payload: object,
    responseStatus: number,
    isResponse: (value: unknown) => value is T,
    action: (client: PoolClient, commandKey: string) => Promise<T>,
  ): Promise<T> {
    const commandKey = validKey(key);
    const requestHash = digest(payload);
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claim(
        client,
        scope,
        commandKey,
        requestHash,
        this.environment.IDEMPOTENCY_TTL_SECONDS,
        isResponse,
      );
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }
      const result = await action(client, commandKey);
      await client.query(
        `UPDATE platform.idempotency_keys
         SET status = 'completed', response_status = $3, response_body = $4
         WHERE scope = $1 AND idempotency_key = $2`,
        [scope, commandKey, responseStatus, result],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async sideEffects(
    client: PoolClient,
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    result: object,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    commandKey: string,
  ) {
    await client.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1,$2,$3,$4,1,$5,$6,$7)`,
      [
        randomUUID(),
        aggregateType,
        aggregateId,
        eventType,
        metadata.correlationId,
        `${eventType}:${commandKey}`,
        result,
      ],
    );
    await this.audit.append(
      {
        action: eventType,
        actorAccountId: authentication.accountId,
        after: result as Record<string, unknown>,
        correlationId: metadata.correlationId,
        ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
        targetId: aggregateId,
        targetType: aggregateType,
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
      client,
    );
  }
}

const fiscalDailyReportSql = `
  SELECT report.*, shift.shift_number
  FROM pos.fiscal_daily_reports report
  JOIN pos.shifts shift ON shift.id = report.shift_id`;

const assignmentSql = `
  SELECT register.id AS cash_register_id, register.code AS cash_register_code,
    register.name AS cash_register_name, location.id AS business_location_id,
    location.name AS business_location_name, operator.id AS operator_id,
    operator.code AS operator_code, configuration.warehouse_id,
    warehouse.name AS warehouse_name, configuration.fiscal_mode,
    configuration.fiscal_device_label, configuration.payment_terminal_mode,
    configuration.payment_terminal_label, configuration.service_return_warehouse_id,
    service_warehouse.name AS service_return_warehouse_name
  FROM organization.operators operator
  JOIN organization.cash_register_operators assignment
    ON assignment.operator_id = operator.id
   AND assignment.business_location_id = operator.business_location_id
   AND assignment.active
  JOIN organization.cash_registers register
    ON register.id = assignment.cash_register_id AND register.active
  JOIN organization.business_locations location
    ON location.id = register.business_location_id AND location.active
  JOIN pos.terminal_configurations configuration
    ON configuration.cash_register_id = register.id AND configuration.active
  JOIN master_data.warehouses warehouse
    ON warehouse.id = configuration.warehouse_id AND warehouse.active
   AND warehouse.business_location_id = location.id
  LEFT JOIN master_data.warehouses service_warehouse
    ON service_warehouse.id = configuration.service_return_warehouse_id
   AND service_warehouse.active
  WHERE operator.account_id = $1 AND operator.active`;

const shiftSql = `
  SELECT shift.id, shift.shift_number, shift.cash_register_id, register.name AS cash_register_name,
    shift.operator_id, operator.code AS operator_code, shift.warehouse_id,
    warehouse.name AS warehouse_name, shift.status, shift.opening_cash_eur::text,
    shift.closing_cash_eur::text, shift.closed_at,
    (shift.opening_cash_eur + COALESCE((
      SELECT sum(payment.amount)
      FROM pos.sales sale
      JOIN pos.payments payment ON payment.sale_id = sale.id
      WHERE sale.shift_id = shift.id AND payment.payment_method = 'cash'
    ), 0) - COALESCE((
      SELECT sum(refund.amount)
      FROM pos.returns pos_return
      JOIN pos.return_refunds refund ON refund.return_id = pos_return.id
      WHERE pos_return.shift_id = shift.id AND refund.refund_method = 'cash'
    ), 0))::text AS expected_cash_eur,
    shift.opened_at, shift.version
  FROM pos.shifts shift
  JOIN organization.cash_registers register ON register.id = shift.cash_register_id
  JOIN organization.operators operator ON operator.id = shift.operator_id
  JOIN master_data.warehouses warehouse ON warehouse.id = shift.warehouse_id`;

function applicablePriceSql(customerParameter: number) {
  return `
  SELECT list.id, list.name, line.unit_price::text
  FROM sales.price_list_lines line
  JOIN sales.price_lists list ON list.id = line.price_list_id
  LEFT JOIN sales.promotional_campaigns campaign ON campaign.id = list.campaign_id
  WHERE line.product_id = product.id AND list.active AND list.currency_code = 'EUR'
    AND CURRENT_DATE BETWEEN list.valid_from AND list.valid_to
    AND (campaign.id IS NULL OR (
      campaign.active AND CURRENT_DATE BETWEEN campaign.valid_from AND campaign.valid_to
    ))
    AND (
      list.scope = 'all_customers'
      OR (list.scope = 'customer' AND list.customer_partner_id = $${customerParameter})
      OR (list.scope = 'customer_group' AND $${customerParameter}::uuid IS NOT NULL AND EXISTS (
        SELECT 1 FROM sales.customer_price_group_members member
        JOIN sales.customer_price_groups customer_group
          ON customer_group.id = member.customer_group_id AND customer_group.active
        WHERE member.customer_group_id = list.customer_group_id
          AND member.customer_partner_id = $${customerParameter}
      ))
    )
  ORDER BY list.priority DESC,
    CASE list.scope WHEN 'customer' THEN 3 WHEN 'customer_group' THEN 2 ELSE 1 END DESC,
    list.code, list.id
  LIMIT 1`;
}

const catalogSql = `
  WITH reserved AS (
    SELECT product_id, sum(remaining_quantity) AS quantity
    FROM inventory.stock_reservations
    WHERE warehouse_id = $1 AND status = 'active'
    GROUP BY product_id
  )
  SELECT product.id, product.product_code, product.name, unit.code AS unit_code,
    category.tracking_mode, product.pos_vat_treatment AS vat_treatment,
    GREATEST(balance.quantity - COALESCE(reserved.quantity, 0), 0)::text AS available_quantity,
    price.id AS price_list_id, price.name AS price_list_name, price.unit_price,
    COALESCE((SELECT array_agg(barcode.barcode ORDER BY barcode.barcode)
      FROM master_data.product_barcodes barcode
      WHERE barcode.product_id = product.id AND barcode.active), '{}'::text[]) AS barcodes,
    COALESCE((SELECT array_agg(item.serial_number ORDER BY item.serial_number)
      FROM inventory.serialized_items item
      WHERE item.product_id = product.id AND item.warehouse_id = $1
        AND item.status = 'available' AND NOT EXISTS (
          SELECT 1 FROM inventory.stock_reservation_serials selected
          WHERE selected.serialized_item_id = item.id AND selected.active
        )), '{}'::text[]) AS serial_numbers,
    COALESCE((SELECT json_agg(json_build_object(
        'batchId', batch.id, 'batchNumber', batch.batch_number,
        'expiresOn', batch.expires_at::text, 'quantity', batch_balance.quantity::text
      ) ORDER BY batch.expires_at NULLS LAST, batch.batch_number, batch.id)
      FROM inventory.batch_stock_balances batch_balance
      JOIN inventory.batches batch ON batch.id = batch_balance.batch_id
      WHERE batch_balance.warehouse_id = $1 AND batch.product_id = product.id
        AND batch_balance.quantity > 0), '[]'::json) AS batches,
    count(*) OVER()::text AS total_count
  FROM master_data.products product
  JOIN master_data.product_categories category
    ON category.id = product.category_id AND category.active
  JOIN master_data.units unit ON unit.id = product.unit_id AND unit.active
  JOIN inventory.stock_balances balance
    ON balance.product_id = product.id AND balance.warehouse_id = $1
  LEFT JOIN reserved ON reserved.product_id = product.id
  LEFT JOIN LATERAL (${applicablePriceSql(2)}) price ON true
  WHERE product.active AND balance.quantity > 0
    AND ($3 = '' OR product.name ILIKE '%' || $3 || '%'
      OR product.product_code ILIKE '%' || $3 || '%'
      OR EXISTS (SELECT 1 FROM master_data.product_barcodes barcode
        WHERE barcode.product_id = product.id AND barcode.active AND barcode.barcode = $3))
  ORDER BY product.name, product.id LIMIT $4 OFFSET $5`;

const quickAccessSql = `
  WITH reserved AS (
    SELECT product_id, sum(remaining_quantity) AS quantity
    FROM inventory.stock_reservations
    WHERE warehouse_id = $1 AND status = 'active'
    GROUP BY product_id
  )
  SELECT product.id, product.product_code, product.name, unit.code AS unit_code,
    category.tracking_mode, product.pos_vat_treatment AS vat_treatment,
    GREATEST(COALESCE(balance.quantity, 0) - COALESCE(reserved.quantity, 0), 0)::text
      AS available_quantity,
    price.id AS price_list_id, price.name AS price_list_name, price.unit_price,
    COALESCE((SELECT array_agg(barcode.barcode ORDER BY barcode.barcode)
      FROM master_data.product_barcodes barcode
      WHERE barcode.product_id = product.id AND barcode.active), '{}'::text[]) AS barcodes,
    COALESCE((SELECT array_agg(item.serial_number ORDER BY item.serial_number)
      FROM inventory.serialized_items item
      WHERE item.product_id = product.id AND item.warehouse_id = $1
        AND item.status = 'available' AND NOT EXISTS (
          SELECT 1 FROM inventory.stock_reservation_serials selected
          WHERE selected.serialized_item_id = item.id AND selected.active
        )), '{}'::text[]) AS serial_numbers,
    COALESCE((SELECT json_agg(json_build_object(
        'batchId', batch.id, 'batchNumber', batch.batch_number,
        'expiresOn', batch.expires_at::text, 'quantity', batch_balance.quantity::text
      ) ORDER BY batch.expires_at NULLS LAST, batch.batch_number, batch.id)
      FROM inventory.batch_stock_balances batch_balance
      JOIN inventory.batches batch ON batch.id = batch_balance.batch_id
      WHERE batch_balance.warehouse_id = $1 AND batch.product_id = product.id
        AND batch_balance.quantity > 0), '[]'::json) AS batches,
    count(*) OVER()::text AS total_count
  FROM pos.quick_access_products shortcut
  JOIN master_data.products product ON product.id = shortcut.product_id AND product.active
  JOIN master_data.product_categories category
    ON category.id = product.category_id AND category.active
  JOIN master_data.units unit ON unit.id = product.unit_id AND unit.active
  LEFT JOIN inventory.stock_balances balance
    ON balance.product_id = product.id AND balance.warehouse_id = $1
  LEFT JOIN reserved ON reserved.product_id = product.id
  LEFT JOIN LATERAL (${applicablePriceSql(2)}) price ON true
  WHERE shortcut.cash_register_id = $3
  ORDER BY shortcut.display_order, product.name, product.id`;

const saleProductsSql = `
  SELECT product.id, product.product_code, product.name, category.id AS category_id,
    category.name AS category_name, category.tracking_mode,
    unit.code AS unit_code,
    product.pos_vat_treatment AS vat_treatment, product.warranty_months,
    balance.average_unit_cost_eur::text, price.id AS price_list_id, price.unit_price
  FROM master_data.products product
  JOIN master_data.product_categories category
    ON category.id = product.category_id AND category.active
  JOIN master_data.units unit ON unit.id = product.unit_id AND unit.active
  JOIN inventory.stock_balances balance
    ON balance.product_id = product.id AND balance.warehouse_id = $2
  LEFT JOIN LATERAL (${applicablePriceSql(3)}) price ON true
  WHERE product.id = ANY($1::uuid[]) AND product.active
  FOR KEY SHARE OF product`;

const saleHeaderSql = `
  SELECT sale.id, sale.sale_number, sale.shift_id, sale.customer_partner_id,
    customer.display_name AS customer_name, sale.currency_code, sale.net_total::text,
    sale.vat_total::text, sale.gross_total::text, sale.status, sale.fiscal_status,
    sale.base_net_total::text, sale.automatic_discount_total::text,
    sale.manual_discount_total::text, sale.loyalty_discount_total::text,
    sale.loyalty_points_earned, sale.loyalty_points_redeemed,
    sale.fiscal_receipt_number, sale.fiscal_adapter, sale.completed_at,
    (SELECT json_build_object(
       'id', document.id,
       'number', coalesce(document.official_number,document.draft_number),
       'sourceFiscalReceiptNumber', document.source_fiscal_receipt_number,
       'status', document.status
     )
     FROM finance.financial_documents document
     WHERE document.source_pos_sale_id = sale.id AND document.status IN ('draft','issued')
     ORDER BY document.created_at DESC, document.id DESC LIMIT 1) AS invoice_document,
    COALESCE((SELECT json_agg(json_build_object(
       'id', card.id,
       'number', card.card_number,
       'customerName', customer_card.display_name,
       'customerLocationName', customer_location.name,
       'productName', equipment.device_name,
       'serialNumber', equipment.serial_number,
       'warrantyStartsOn', card.warranty_starts_on::text,
       'warrantyEndsOn', card.warranty_ends_on::text
     ) ORDER BY card.card_number)
     FROM crm.warranty_cards card
     JOIN master_data.partners customer_card ON customer_card.id = card.customer_partner_id
     JOIN master_data.customer_locations customer_location
       ON customer_location.id = card.customer_location_id
     JOIN master_data.customer_equipment equipment ON equipment.id = card.customer_equipment_id
     WHERE card.pos_sale_id = sale.id), '[]'::json) AS warranty_cards,
    COALESCE((SELECT sum(payment.tendered_amount) FROM pos.payments payment
      WHERE payment.sale_id = sale.id AND payment.payment_method = 'cash'), 0)::text
      AS cash_tendered,
    COALESCE((SELECT sum(payment.change_amount) FROM pos.payments payment
      WHERE payment.sale_id = sale.id AND payment.payment_method = 'cash'), 0)::text
      AS change_amount
  FROM pos.sales sale
  LEFT JOIN master_data.partners customer ON customer.id = sale.customer_partner_id`;

const saleLinesSql = `
  SELECT line.sale_id, line.id, line.product_id, line.product_code, line.product_name,
    line.batch_id, line.quantity::text, line.unit_price::text, line.vat_treatment,
    line.base_net_total::text, line.automatic_discount_total::text,
    line.manual_discount_total::text, line.loyalty_discount_total::text,
    line.pricing_adjustments,
    line.net_total::text, line.vat_total::text, line.gross_total::text,
    COALESCE((SELECT sum(return_line.quantity) FROM pos.return_lines return_line
      WHERE return_line.original_sale_line_id = line.id), 0)::text AS returned_quantity,
    COALESCE((SELECT sum(return_line.net_total) FROM pos.return_lines return_line
      WHERE return_line.original_sale_line_id = line.id), 0)::text AS returned_net_total,
    COALESCE((SELECT sum(return_line.vat_total) FROM pos.return_lines return_line
      WHERE return_line.original_sale_line_id = line.id), 0)::text AS returned_vat_total,
    (line.quantity - COALESCE((SELECT sum(return_line.quantity)
      FROM pos.return_lines return_line
      WHERE return_line.original_sale_line_id = line.id), 0))::text AS returnable_quantity,
    COALESCE((SELECT array_agg(serial.serial_number ORDER BY serial.serial_number)
      FROM pos.sale_line_serials serial
      WHERE serial.sale_line_id = line.id), '{}'::text[]) AS serial_numbers,
    COALESCE((SELECT array_agg(serial.serial_number ORDER BY serial.serial_number)
      FROM pos.sale_line_serials serial
      WHERE serial.sale_line_id = line.id AND NOT EXISTS (
        SELECT 1 FROM pos.return_line_serials returned
        JOIN pos.return_lines return_line ON return_line.id = returned.return_line_id
        WHERE return_line.original_sale_line_id = line.id
          AND returned.serialized_item_id = serial.serialized_item_id
      )), '{}'::text[]) AS returnable_serial_numbers
  FROM pos.sale_lines line
  WHERE line.sale_id = ANY($1::uuid[])
  ORDER BY line.sale_id, line.id`;

const salePaymentsSql = `
  SELECT payment.id, payment.sale_id, payment.payment_method,
    payment.customer_advance_id, advance.advance_number,
    (CASE WHEN payment.payment_method='on_account' THEN coalesce((SELECT sum(collection.amount)
      FROM finance.payments collection WHERE collection.source_pos_sale_id=payment.sale_id
        AND NOT EXISTS(SELECT 1 FROM finance.payment_reversals reversal WHERE reversal.payment_id=collection.id)),0)
      ELSE 0 END)::numeric(18,4)::text AS collected_amount,
    payment.account_due_on::text,
    payment.amount::text, COALESCE(payment.tendered_amount, payment.amount)::text
      AS tendered_amount,
    payment.change_amount::text, payment.provider_reference,
    (payment.amount - COALESCE((
      SELECT sum(refund.amount) FROM pos.returns pos_return
      JOIN pos.return_refunds refund ON refund.return_id = pos_return.id
      WHERE refund.original_payment_id = payment.id
    ), 0))::text AS refundable_amount,
    payment.adapter, payment.status
  FROM pos.payments payment
  LEFT JOIN finance.customer_advances advance ON advance.id = payment.customer_advance_id
  WHERE payment.sale_id = ANY($1::uuid[])
  ORDER BY payment.sale_id, payment.recorded_at, payment.id`;

const returnHeaderSql = `
  SELECT pos_return.id, pos_return.return_number, pos_return.original_sale_id,
    sale.sale_number AS original_sale_number, pos_return.shift_id, pos_return.reason,
    pos_return.net_total::text, pos_return.vat_total::text,
    pos_return.gross_total::text, pos_return.fiscal_reversal_number,
    pos_return.fiscal_adapter, pos_return.fiscal_document_number,
    pos_return.fiscal_reversals_since_daily_report, pos_return.completed_at,
    pos_return.loyalty_points_earned_reversed,
    pos_return.loyalty_points_redeemed_restored
  FROM pos.returns pos_return
  JOIN pos.sales sale ON sale.id = pos_return.original_sale_id`;

const returnLinesSql = `
  SELECT line.return_id, line.id, line.original_sale_line_id, line.product_id,
    line.product_code, line.product_name, line.quantity::text, line.disposition,
    line.destination_warehouse_id, warehouse.name AS destination_warehouse_name,
    line.net_total::text, line.vat_total::text, line.gross_total::text,
    COALESCE(array_agg(serial.serial_number ORDER BY serial.serial_number)
      FILTER (WHERE serial.serialized_item_id IS NOT NULL), '{}'::text[]) AS serial_numbers
  FROM pos.return_lines line
  JOIN master_data.warehouses warehouse ON warehouse.id = line.destination_warehouse_id
  LEFT JOIN pos.return_line_serials serial ON serial.return_line_id = line.id
  WHERE line.return_id = ANY($1::uuid[])
  GROUP BY line.id, warehouse.name ORDER BY line.return_id, line.id`;

const returnRefundsSql = `
  SELECT refund.id, refund.return_id, refund.refund_method, refund.amount::text,
    refund.original_payment_id, refund.adapter, refund.status, refund.provider_reference
  FROM pos.return_refunds refund
  WHERE refund.return_id = ANY($1::uuid[])
  ORDER BY refund.return_id, refund.recorded_at, refund.id`;

function normalizeSale(input: CreatePosSaleRequest) {
  const basket = normalizeBasket(input);
  if (!input.customerPartnerId && input.customerLocationId)
    throw new ApiErrorException(
      'POS_CUSTOMER_LOCATION_REQUIRED',
      'Select the customer before choosing a receiving location',
      HttpStatus.BAD_REQUEST,
    );
  return {
    ...basket,
    clientTransactionId: input.clientTransactionId,
    ...(input.customerLocationId ? { customerLocationId: input.customerLocationId } : {}),
    payments: input.payments.map((payment) => ({
      ...(payment.advanceId ? { advanceId: payment.advanceId } : {}),
      amount: decimal(payment.amount, true),
      method: payment.method,
      ...(payment.tenderedAmount ? { tenderedAmount: decimal(payment.tenderedAmount, false) } : {}),
    })),
  };
}

function normalizeFiscalSaleReceipt(
  input: ConfirmPosFiscalSaleReceiptRequest,
): ConfirmPosFiscalSaleReceiptRequest {
  return {
    changeEur: fiscalMinorUnitAmount(input.changeEur, 'change'),
    fiscalDocumentNumber: input.fiscalDocumentNumber,
    ...(input.fiscalReceiptsSinceDailyReport
      ? { fiscalReceiptsSinceDailyReport: input.fiscalReceiptsSinceDailyReport }
      : {}),
    uniqueSaleId: input.uniqueSaleId,
  };
}

function normalizeFiscalDailyReportResult(
  input: ConfirmPosFiscalDailyReportRequest,
): ConfirmPosFiscalDailyReportRequest {
  const groups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
  const amount = (value: string) => {
    if (!/^-?\d{1,12}(?:\.\d{1,2})?$/u.test(value))
      throw new ApiErrorException(
        'POS_FISCAL_REPORT_TOTAL_INVALID',
        'The printer report contains an invalid amount.',
        HttpStatus.BAD_REQUEST,
      );
    return value;
  };
  if (!/^\d{1,4}$/u.test(input.fiscalRecordNumber))
    throw new ApiErrorException(
      'POS_FISCAL_REPORT_RECORD_INVALID',
      'The printer report has an invalid fiscal record number.',
      HttpStatus.BAD_REQUEST,
    );
  const taxGroupTotals = Object.fromEntries(
    groups.map((group) => [group, amount(input.taxGroupTotals[group])]),
  ) as ConfirmPosFiscalDailyReportRequest['taxGroupTotals'];
  return {
    fiscalRecordNumber: input.fiscalRecordNumber,
    nonVatSalesTotalEur: amount(input.nonVatSalesTotalEur),
    taxGroupTotals,
  };
}

function normalizeBasket(input: PricePosBasketRequest) {
  const productIds = input.lines.map((line) => line.productId);
  if (new Set(productIds).size !== productIds.length)
    throw new ApiErrorException(
      'POS_BASKET_PRODUCT_DUPLICATE',
      'Each product can appear only once in the basket',
      HttpStatus.BAD_REQUEST,
    );
  return {
    ...(input.customerPartnerId ? { customerPartnerId: input.customerPartnerId } : {}),
    lines: input.lines.map((line) => {
      const serialNumbers = [...new Set((line.serialNumbers ?? []).map((serial) => serial.trim()))];
      if (serialNumbers.some((serial) => !serial))
        throw new ApiErrorException(
          'POS_SERIAL_INVALID',
          'Serial numbers cannot be empty',
          HttpStatus.BAD_REQUEST,
        );
      return {
        ...(line.batchId ? { batchId: line.batchId } : {}),
        productId: line.productId,
        quantity: decimal(line.quantity, true),
        serialNumbers,
      };
    }),
    loyaltyPointsToRedeem: input.loyaltyPointsToRedeem ?? 0,
    ...(input.manualDiscount
      ? {
          manualDiscount: {
            ...(input.manualDiscount.authorizationId
              ? { authorizationId: input.manualDiscount.authorizationId }
              : {}),
            discountType: input.manualDiscount.discountType,
            discountValue: validDiscountValue(
              input.manualDiscount.discountValue,
              input.manualDiscount.discountType,
            ),
          },
        }
      : {}),
    shiftId: input.shiftId,
  };
}

function normalizeReturn(input: CreatePosReturnRequest) {
  if (!Array.isArray(input.refunds) || input.refunds.length === 0)
    throw new ApiErrorException(
      'POS_RETURN_REFUNDS_REQUIRED',
      'Choose the original payment and refund amount for this return.',
      HttpStatus.BAD_REQUEST,
    );
  const lineIds = input.lines.map((line) => line.originalSaleLineId);
  if (new Set(lineIds).size !== lineIds.length)
    throw new ApiErrorException(
      'POS_RETURN_LINE_DUPLICATE',
      'Each product can appear only once in a return',
      HttpStatus.BAD_REQUEST,
    );
  const reason = input.reason.trim();
  if (reason.length < 3)
    throw new ApiErrorException(
      'POS_RETURN_REASON_REQUIRED',
      'Enter a short reason for the return',
      HttpStatus.BAD_REQUEST,
    );
  return {
    lines: input.lines.map((line) => {
      const serialNumbers = [...new Set((line.serialNumbers ?? []).map((serial) => serial.trim()))];
      if (serialNumbers.some((serial) => !serial))
        throw new ApiErrorException(
          'POS_RETURN_SERIAL_INVALID',
          'Returned serial numbers cannot be empty',
          HttpStatus.BAD_REQUEST,
        );
      return {
        disposition: line.disposition,
        originalSaleLineId: line.originalSaleLineId,
        quantity: decimal(line.quantity, true),
        serialNumbers,
      };
    }),
    originalSaleId: input.originalSaleId,
    reason,
    refunds: input.refunds.map((refund) => ({
      amount: decimal(refund.amount, true),
      method: refund.method,
      originalPaymentId: refund.originalPaymentId,
    })),
    shiftId: input.shiftId,
  };
}

async function prepareReturnRefunds(
  client: PoolClient,
  saleId: string,
  refunds: ReturnType<typeof normalizeReturn>['refunds'],
  grossTotal: string,
  terminal: AssignmentRow,
  nodeEnvironment: string,
) {
  if (new Set(refunds.map((refund) => refund.originalPaymentId)).size !== refunds.length)
    throw new ApiErrorException(
      'POS_REFUND_PAYMENT_DUPLICATE',
      'Each original payment can be refunded only once in this return',
      HttpStatus.BAD_REQUEST,
    );
  if (units(sum(refunds.map((refund) => refund.amount))) !== units(grossTotal))
    throw new ApiErrorException(
      'POS_REFUND_TOTAL_MISMATCH',
      `Refunds must equal the EUR ${plain(grossTotal)} return total`,
      HttpStatus.BAD_REQUEST,
    );
  const selectedPayments = await client.query<{
    account_due_on: string | null;
    amount: string;
    customer_advance_id: string | null;
    id: string;
    method: PosSalePayment['method'];
  }>(
    `SELECT payment.id, payment.payment_method AS method,
       payment.customer_advance_id, payment.account_due_on::text,
       payment.amount::text
     FROM pos.payments payment
     WHERE payment.sale_id = $1 AND payment.id = ANY($2::uuid[])
     ORDER BY payment.recorded_at, payment.id FOR UPDATE OF payment`,
    [saleId, refunds.map((refund) => refund.originalPaymentId)],
  );
  if (selectedPayments.rowCount !== refunds.length)
    throw new ApiErrorException(
      'POS_REFUND_PAYMENT_NOT_FOUND',
      'One or more original payments were not found on this sale',
      HttpStatus.CONFLICT,
    );
  const deferredRefund = sum(
    refunds.filter((refund) => refund.method === 'on_account').map((refund) => refund.amount),
  );
  let releasedAmount = '0.0000';
  let collectedRefundAmount = '0.0000';
  if (units(deferredRefund) > 0n) {
    await client.query(
      `SELECT terms.id FROM sales.customer_payment_terms terms JOIN pos.sales sale
      ON sale.customer_partner_id=terms.customer_partner_id WHERE sale.id=$1 FOR UPDATE OF terms`,
      [saleId],
    );
    const balance = (
      await client.query<{ amount: string }>(
        `SELECT coalesce(sum(CASE WHEN entry_type IN ('charge','payment_reversal')
      THEN amount ELSE -amount END),0)::text AS amount FROM finance.customer_account_entries WHERE pos_sale_id=$1`,
        [saleId],
      )
    ).rows[0]!.amount;
    releasedAmount = units(deferredRefund) < units(balance) ? deferredRefund : balance;
    collectedRefundAmount = subtract(deferredRefund, releasedAmount);
  }
  // Read already-posted refunds only after the payment locks are held. This
  // gives a waiting concurrent return a fresh snapshot and prevents the same
  // original payment from being refunded twice.
  const refunded = await client.query<{
    original_payment_id: string;
    refunded_amount: string;
  }>(
    `SELECT original_payment_id, sum(amount)::text AS refunded_amount
     FROM pos.return_refunds
     WHERE original_payment_id = ANY($1::uuid[])
     GROUP BY original_payment_id`,
    [refunds.map((refund) => refund.originalPaymentId)],
  );
  const refundedByPayment = new Map(
    refunded.rows.map((row) => [row.original_payment_id, row.refunded_amount]),
  );
  return refunds.map((refund) => {
    const originalPayment = selectedPayments.rows.find(
      (row) => row.id === refund.originalPaymentId,
    );
    const remaining = originalPayment
      ? {
          ...originalPayment,
          remaining_amount: subtract(
            originalPayment.amount,
            refundedByPayment.get(originalPayment.id) ?? '0',
          ),
        }
      : undefined;
    if (!remaining || remaining.method !== refund.method)
      throw new ApiErrorException(
        'POS_REFUND_PAYMENT_MISMATCH',
        'The refund method no longer matches its original payment',
        HttpStatus.CONFLICT,
      );
    if (units(refund.amount) > units(remaining.remaining_amount))
      throw new ApiErrorException(
        'POS_REFUND_METHOD_EXCEEDED',
        `The ${refund.method} refund is greater than the amount paid by that method`,
        HttpStatus.CONFLICT,
      );
    if (refund.method === 'cash')
      return {
        adapter: 'cash-drawer',
        amount: refund.amount,
        method: refund.method,
        originalPaymentId: refund.originalPaymentId,
        status: 'completed' as const,
      };
    if (refund.method === 'advance')
      return {
        adapter: 'customer-advance',
        advanceId: required(remaining.customer_advance_id, 'Customer advance link is missing'),
        amount: refund.amount,
        method: refund.method,
        originalPaymentId: refund.originalPaymentId,
        status: 'completed' as const,
      };
    if (refund.method === 'on_account')
      return {
        releasedAmount,
        collectedRefundAmount,
        accountDueOn: required(remaining.account_due_on, 'Customer account due date is missing'),
        adapter: 'customer-account',
        amount: refund.amount,
        method: refund.method,
        originalPaymentId: refund.originalPaymentId,
        status: 'completed' as const,
      };
    if (terminal.payment_terminal_mode === 'disabled')
      throw new ApiErrorException(
        'POS_PAYMENT_TERMINAL_NOT_ASSIGNED',
        'Card refund is not available on this register',
        HttpStatus.CONFLICT,
      );
    if (terminal.payment_terminal_mode === 'hardware')
      throw new ApiErrorException(
        'POS_PAYMENT_ADAPTER_UNAVAILABLE',
        'The approved card-terminal refund adapter is not connected yet',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    if (nodeEnvironment === 'production')
      throw new ApiErrorException(
        'POS_PAYMENT_SIMULATOR_FORBIDDEN',
        'The development card simulator cannot be used in production',
        HttpStatus.FORBIDDEN,
      );
    return {
      adapter: 'development-card-simulator',
      amount: refund.amount,
      method: refund.method,
      originalPaymentId: refund.originalPaymentId,
      providerReference: `SIM-REFUND-${randomUUID()}`,
      status: 'simulated' as const,
    };
  });
}

async function prepareSalePayments(
  client: PoolClient,
  payments: ReturnType<typeof normalizeSale>['payments'],
  grossTotal: string,
  customerPartnerId: string | undefined,
  terminal: AssignmentRow,
  clientTransactionId: string,
  cardAuthorizations: CardAuthorizationService,
  cashierAccountId: string,
  shiftId: string,
  nodeEnvironment: string,
  businessTimezone: string,
) {
  if (new Set(payments.map((payment) => payment.method)).size !== payments.length)
    throw new ApiErrorException(
      'POS_PAYMENT_METHOD_DUPLICATE',
      'Enter each payment method only once',
      HttpStatus.BAD_REQUEST,
    );
  if (units(sum(payments.map((payment) => payment.amount))) !== units(grossTotal))
    throw new ApiErrorException(
      'POS_PAYMENT_TOTAL_MISMATCH',
      `Payments must equal the EUR ${plain(grossTotal)} sale total`,
      HttpStatus.BAD_REQUEST,
    );
  if (
    payments.some((payment) => payment.method === 'advance' || payment.method === 'on_account') &&
    !customerPartnerId
  )
    throw new ApiErrorException(
      'POS_CUSTOMER_PAYMENT_REQUIRES_CUSTOMER',
      'Choose the customer before using an advance or customer account',
      HttpStatus.BAD_REQUEST,
    );
  const prepared = [] as Array<{
    accountDueOn?: string;
    adapter: string;
    advanceId?: string;
    amount: string;
    changeAmount: string;
    creditLimitEur?: string;
    method: PosSalePayment['method'];
    paymentTermsDays?: number;
    paymentTermsId?: string;
    providerReference?: string;
    status: PosSalePayment['status'];
    tenderedAmount: string | null;
  }>;
  for (const payment of payments) {
    if (payment.method !== 'advance' && payment.advanceId)
      throw new ApiErrorException(
        'POS_ADVANCE_LINK_NOT_ALLOWED',
        'An advance can be selected only for an advance payment',
        HttpStatus.BAD_REQUEST,
      );
    if (payment.method === 'cash') {
      const tenderedAmount = payment.tenderedAmount ?? payment.amount;
      if (units(tenderedAmount) < units(payment.amount))
        throw new ApiErrorException(
          'POS_CASH_TENDER_INSUFFICIENT',
          `Cash received must be at least EUR ${plain(payment.amount)}`,
          HttpStatus.BAD_REQUEST,
        );
      prepared.push({
        adapter: 'cash-drawer',
        amount: payment.amount,
        changeAmount: subtract(tenderedAmount, payment.amount),
        method: payment.method,
        status: 'completed' as const,
        tenderedAmount,
      });
      continue;
    }
    if (payment.method === 'advance') {
      if (!payment.advanceId)
        throw new ApiErrorException(
          'POS_ADVANCE_REQUIRED',
          'Choose the customer advance to use',
          HttpStatus.BAD_REQUEST,
        );
      if (payment.tenderedAmount)
        throw new ApiErrorException(
          'POS_ADVANCE_TENDER_NOT_ALLOWED',
          'Cash received is not used with a customer advance',
          HttpStatus.BAD_REQUEST,
        );
      const advance = await client.query<{
        customer_partner_id: string;
        id: string;
      }>(
        `SELECT id, customer_partner_id FROM finance.customer_advances
         WHERE id = $1 FOR UPDATE`,
        [payment.advanceId],
      );
      if (advance.rows[0]?.customer_partner_id !== customerPartnerId)
        throw new ApiErrorException(
          'POS_ADVANCE_NOT_AVAILABLE',
          'The selected advance is not available for this customer',
          HttpStatus.CONFLICT,
        );
      const balance = await client.query<{ available_amount: string }>(
        `SELECT COALESCE(sum(CASE entry.entry_type
           WHEN 'applied' THEN -entry.amount ELSE entry.amount END), 0)::text
           AS available_amount
         FROM finance.customer_advance_entries entry WHERE entry.advance_id = $1`,
        [payment.advanceId],
      );
      if (units(balance.rows[0]?.available_amount ?? '0') < units(payment.amount))
        throw new ApiErrorException(
          'POS_ADVANCE_BALANCE_EXCEEDED',
          'The advance balance is smaller than the amount entered',
          HttpStatus.CONFLICT,
        );
      prepared.push({
        adapter: 'customer-advance',
        advanceId: payment.advanceId,
        amount: payment.amount,
        changeAmount: '0.0000',
        method: payment.method,
        status: 'completed',
        tenderedAmount: null,
      });
      continue;
    }
    if (payment.method === 'on_account') {
      if (payment.tenderedAmount)
        throw new ApiErrorException(
          'POS_ACCOUNT_TENDER_NOT_ALLOWED',
          'Cash received is not used with a customer-account payment',
          HttpStatus.BAD_REQUEST,
        );
      const terms = await client.query<{
        credit_limit_eur: string;
        due_on: string;
        id: string;
        outstanding_balance: string;
        payment_terms_days: number;
      }>(
        `SELECT terms.id, terms.credit_limit_eur::text, terms.payment_terms_days,
           ((now() AT TIME ZONE $2)::date + terms.payment_terms_days)::text AS due_on,
           COALESCE((SELECT sum(CASE entry.entry_type
             WHEN 'charge' THEN entry.amount WHEN 'payment_reversal' THEN entry.amount ELSE -entry.amount END)
             FROM finance.customer_account_entries entry
             WHERE entry.customer_partner_id = terms.customer_partner_id), 0)::text
             AS outstanding_balance
         FROM sales.customer_payment_terms terms
         WHERE terms.customer_partner_id = $1 AND terms.status = 'active'
           AND terms.on_account_enabled
           AND terms.valid_from <= (now() AT TIME ZONE $2)::date
           AND (terms.valid_to IS NULL OR terms.valid_to >= (now() AT TIME ZONE $2)::date)
         FOR UPDATE OF terms`,
        [customerPartnerId, businessTimezone],
      );
      const account = terms.rows[0];
      if (!account)
        throw new ApiErrorException(
          'POS_ACCOUNT_NOT_AVAILABLE',
          'On-account payment is not available for this customer',
          HttpStatus.CONFLICT,
        );
      if (
        units(account.outstanding_balance) + units(payment.amount) >
        units(account.credit_limit_eur)
      )
        throw new ApiErrorException(
          'POS_ACCOUNT_CREDIT_EXCEEDED',
          'This sale would exceed the customer’s available credit',
          HttpStatus.CONFLICT,
        );
      prepared.push({
        accountDueOn: account.due_on,
        adapter: 'customer-account',
        amount: payment.amount,
        changeAmount: '0.0000',
        creditLimitEur: account.credit_limit_eur,
        method: payment.method,
        paymentTermsDays: account.payment_terms_days,
        paymentTermsId: account.id,
        status: 'completed',
        tenderedAmount: null,
      });
      continue;
    }
    if (payment.tenderedAmount && units(payment.tenderedAmount) !== units(payment.amount))
      throw new ApiErrorException(
        'POS_CARD_TENDER_INVALID',
        'A card payment must equal its authorised amount',
        HttpStatus.BAD_REQUEST,
      );
    if (terminal.payment_terminal_mode === 'disabled')
      throw new ApiErrorException(
        'POS_PAYMENT_TERMINAL_NOT_ASSIGNED',
        'Card payment is not available on this register',
        HttpStatus.CONFLICT,
      );
    if (terminal.payment_terminal_mode === 'hardware')
      throw new ApiErrorException(
        'POS_PAYMENT_ADAPTER_UNAVAILABLE',
        'The approved card-terminal adapter is not connected yet',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    if (nodeEnvironment === 'production')
      throw new ApiErrorException(
        'POS_PAYMENT_SIMULATOR_FORBIDDEN',
        'The development card simulator cannot be used in production',
        HttpStatus.FORBIDDEN,
      );
    const authorization = await cardAuthorizations.authorize(
      {
        amountEur: payment.amount,
        cashRegisterId: terminal.cash_register_id,
        idempotencyKey: `pos-sale:${clientTransactionId}:card`,
      },
      {
        cashierAccountId,
        clientTransactionId,
        shiftId,
      },
    );
    prepared.push({
      adapter: authorization.adapter,
      amount: payment.amount,
      changeAmount: '0.0000',
      method: payment.method,
      providerReference: authorization.providerReference,
      status: 'simulated' as const,
      tenderedAmount: null,
    });
  }
  return prepared;
}

function mapShift(row: ShiftRow): PosShift {
  return {
    cashRegisterId: row.cash_register_id,
    cashRegisterName: row.cash_register_name,
    ...(row.closed_at ? { closedAt: iso(row.closed_at) } : {}),
    ...(row.closing_cash_eur ? { closingCashEur: row.closing_cash_eur } : {}),
    expectedCashEur: row.expected_cash_eur,
    id: row.id,
    openedAt: iso(row.opened_at),
    openingCashEur: row.opening_cash_eur,
    operatorCode: row.operator_code,
    operatorId: row.operator_id,
    shiftNumber: row.shift_number,
    status: row.status,
    version: row.version,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name,
  };
}

function mapCatalogItem(row: CatalogRow): PosCatalogItem {
  return {
    availableQuantity: row.available_quantity,
    barcodes: row.barcodes,
    batches: row.batches.map((batch) => ({
      batchId: batch.batchId,
      batchNumber: batch.batchNumber,
      ...(batch.expiresOn ? { expiresOn: batch.expiresOn } : {}),
      quantity: batch.quantity,
    })),
    currencyCode: 'EUR',
    id: row.id,
    name: row.name,
    ...(row.price_list_id ? { priceListId: row.price_list_id } : {}),
    ...(row.price_list_name ? { priceListName: row.price_list_name } : {}),
    productCode: row.product_code,
    serialNumbers: row.serial_numbers,
    trackingMode: row.tracking_mode,
    unitCode: row.unit_code,
    ...(row.unit_price ? { unitPrice: row.unit_price } : {}),
    ...(row.vat_treatment ? { vatTreatment: row.vat_treatment } : {}),
  };
}

function mapSale(row: SaleRow, lines: PosSaleLine[], payments: PosSalePayment[]): PosSale {
  return {
    automaticDiscountTotal: row.automatic_discount_total,
    baseNetTotal: row.base_net_total,
    cashTendered: row.cash_tendered,
    changeAmount: row.change_amount,
    completedAt: iso(row.completed_at),
    currencyCode: row.currency_code,
    ...(row.customer_name ? { customerName: row.customer_name } : {}),
    ...(row.customer_partner_id ? { customerPartnerId: row.customer_partner_id } : {}),
    fiscalAdapter: row.fiscal_adapter,
    fiscalReceiptNumber: row.fiscal_receipt_number,
    fiscalStatus: row.fiscal_status,
    grossTotal: row.gross_total,
    id: row.id,
    ...(row.invoice_document ? { invoiceDocument: row.invoice_document } : {}),
    lines,
    loyaltyDiscountTotal: row.loyalty_discount_total,
    loyaltyPointsEarned: row.loyalty_points_earned,
    loyaltyPointsRedeemed: row.loyalty_points_redeemed,
    manualDiscountTotal: row.manual_discount_total,
    netTotal: row.net_total,
    payments,
    saleNumber: row.sale_number,
    shiftId: row.shift_id,
    status: row.status,
    vatTotal: row.vat_total,
    warrantyCards: row.warranty_cards,
  };
}

function mapFiscalSalePreparation(row: FiscalSalePreparationRow): PosFiscalSalePreparation {
  const payment = row.pricing_snapshot.payments[0];
  if (!payment || payment.method !== 'cash' || !payment.tenderedAmount)
    throw new Error('A DATECS preparation is missing its cash tender snapshot.');
  const lines: PosFiscalReceiptLine[] = row.pricing_snapshot.preparedLines.map((line) => {
    const unitPriceNet = required(line.product.unit_price ?? undefined, 'Missing POS unit price');
    const treatment = required(line.product.vat_treatment ?? undefined, 'Missing POS VAT');
    const unitPriceGross = add(unitPriceNet, vat(unitPriceNet, treatment));
    const preDiscountGross = multiply(unitPriceGross, line.quantity);
    const discountEur = subtract(preDiscountGross, line.grossTotal);
    const unitPriceEur = fiscalMinorUnitAmount(unitPriceGross, 'unit price');
    const grossTotalEur = fiscalMinorUnitAmount(line.grossTotal, 'line total');
    const formattedDiscount = fiscalMinorUnitAmount(discountEur, 'discount');
    if (units(discountEur) < 0n)
      throw new ApiErrorException(
        'POS_FISCAL_LINE_ROUNDING_UNSUPPORTED',
        `${line.product.name} cannot be represented exactly by the fiscal device. Review its price and quantity precision.`,
        HttpStatus.CONFLICT,
      );
    if (
      units(multiply(unitPriceEur, line.quantity)) - units(formattedDiscount) !==
      units(grossTotalEur)
    )
      throw new ApiErrorException(
        'POS_FISCAL_LINE_ROUNDING_UNSUPPORTED',
        `${line.product.name} cannot be represented exactly by the fiscal device. Review its price and quantity precision.`,
        HttpStatus.CONFLICT,
      );
    return {
      description: line.product.name,
      ...(units(formattedDiscount) > 0n ? { discountEur: formattedDiscount } : {}),
      grossTotalEur,
      quantity: line.quantity.replace(/0+$/u, '').replace(/\.$/u, ''),
      unitCode: line.product.unit_code,
      unitPriceEur,
      vatTreatment: treatment,
    };
  });
  const totalGrossEur = fiscalMinorUnitAmount(
    row.pricing_snapshot.basketPricing.grossTotal,
    'sale total',
  );
  const cashTenderedEur = fiscalMinorUnitAmount(payment.tenderedAmount, 'cash tender');
  const changeEur = fiscalMinorUnitAmount(payment.changeAmount, 'change');
  if (
    units(sum(lines.map((line) => line.grossTotalEur))) !== units(totalGrossEur) ||
    units(cashTenderedEur) - units(totalGrossEur) !== units(changeEur)
  )
    throw new ApiErrorException(
      'POS_FISCAL_TOTAL_ROUNDING_UNSUPPORTED',
      'The sale total does not reconcile to the fiscal device’s EUR cent precision.',
      HttpStatus.CONFLICT,
    );
  return {
    cashTenderedEur,
    changeEur,
    deviceSerial: row.device_serial,
    ...(row.fiscal_document_number ? { fiscalDocumentNumber: row.fiscal_document_number } : {}),
    ...(row.fiscal_receipt_number ? { fiscalReceiptNumber: row.fiscal_receipt_number } : {}),
    id: row.id,
    lines,
    status: row.status,
    totalGrossEur,
    uniqueSaleId: row.unique_sale_id,
  };
}

function mapFiscalDailyReport(row: FiscalDailyReportRow): PosFiscalDailyReport {
  return {
    ...(row.closing_cash_eur ? { closingCashEur: row.closing_cash_eur } : {}),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    createdAt: iso(row.created_at),
    ...(row.fiscal_record_number ? { fiscalRecordNumber: row.fiscal_record_number } : {}),
    id: row.id,
    ...(row.non_vat_sales_total_eur ? { nonVatSalesTotalEur: row.non_vat_sales_total_eur } : {}),
    reportType: row.report_type,
    shiftId: row.shift_id,
    shiftNumber: row.shift_number,
    status: row.status,
    ...(row.tax_group_totals
      ? {
          taxGroupTotals: {
            A: row.tax_group_totals['A'] ?? '0.00',
            B: row.tax_group_totals['B'] ?? '0.00',
            C: row.tax_group_totals['C'] ?? '0.00',
            D: row.tax_group_totals['D'] ?? '0.00',
            E: row.tax_group_totals['E'] ?? '0.00',
            F: row.tax_group_totals['F'] ?? '0.00',
            G: row.tax_group_totals['G'] ?? '0.00',
            H: row.tax_group_totals['H'] ?? '0.00',
          },
        }
      : {}),
  };
}

function mapFiscalReturnPreparation(row: FiscalReturnPreparationRow): PosFiscalReturnPreparation {
  return {
    deviceSerial: row.device_serial,
    ...(row.fiscal_document_number ? { fiscalDocumentNumber: row.fiscal_document_number } : {}),
    ...(row.fiscal_reversals_since_daily_report
      ? { fiscalReversalsSinceDailyReport: row.fiscal_reversals_since_daily_report }
      : {}),
    id: row.id,
    operatorIdentifier: row.operator_identifier,
    originalFiscalDocumentNumber: row.original_fiscal_document_number,
    originalSaleId: row.original_sale_id,
    originalUniqueSaleId: row.original_unique_sale_id,
    request: row.request_snapshot,
    status: row.status,
    uniqueReversalId: row.unique_reversal_id,
  };
}

function fiscalMinorUnitAmount(value: string, label: string): string {
  const amount = units(value);
  if (amount < 0n || amount % 100n !== 0n)
    throw new ApiErrorException(
      'POS_FISCAL_MINOR_UNIT_REQUIRED',
      `The ${label} must be an exact EUR cent amount before it can be printed.`,
      HttpStatus.CONFLICT,
    );
  const cents = amount / 100n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

function mapSaleLine(row: SaleLineRow): PosSaleLine {
  return {
    automaticDiscountTotal: row.automatic_discount_total,
    baseNetTotal: row.base_net_total,
    ...(row.batch_id ? { batchId: row.batch_id } : {}),
    grossTotal: row.gross_total,
    id: row.id,
    loyaltyDiscountTotal: row.loyalty_discount_total,
    manualDiscountTotal: row.manual_discount_total,
    netTotal: row.net_total,
    productCode: row.product_code,
    productId: row.product_id,
    productName: row.product_name,
    pricingAdjustments: row.pricing_adjustments,
    quantity: row.quantity,
    returnableQuantity: row.returnable_quantity,
    returnableSerialNumbers: row.returnable_serial_numbers,
    returnedQuantity: row.returned_quantity,
    returnedNetTotal: row.returned_net_total,
    returnedVatTotal: row.returned_vat_total,
    serialNumbers: row.serial_numbers,
    unitPrice: row.unit_price,
    vatTotal: row.vat_total,
    vatTreatment: row.vat_treatment,
  };
}

function mapSalePayment(row: SalePaymentRow): PosSalePayment {
  return {
    ...(row.payment_method === 'on_account' ? { collectedAmount: row.collected_amount } : {}),
    ...(row.account_due_on ? { accountDueOn: row.account_due_on } : {}),
    adapter: row.adapter,
    ...(row.customer_advance_id ? { advanceId: row.customer_advance_id } : {}),
    ...(row.advance_number ? { advanceNumber: row.advance_number } : {}),
    amount: row.amount,
    changeAmount: row.change_amount,
    id: row.id,
    method: row.payment_method,
    ...(row.provider_reference ? { providerReference: row.provider_reference } : {}),
    refundableAmount: row.refundable_amount,
    status: row.status,
    tenderedAmount: row.tendered_amount,
  };
}

function mapReturn(
  row: ReturnRow,
  lines: PosReturnLine[],
  refunds: PosReturn['refunds'],
): PosReturn {
  return {
    completedAt: iso(row.completed_at),
    fiscalAdapter: row.fiscal_adapter,
    ...(row.fiscal_document_number ? { fiscalDocumentNumber: row.fiscal_document_number } : {}),
    fiscalReversalNumber: row.fiscal_reversal_number,
    ...(row.fiscal_reversals_since_daily_report
      ? { fiscalReversalsSinceDailyReport: row.fiscal_reversals_since_daily_report }
      : {}),
    grossTotal: row.gross_total,
    id: row.id,
    lines,
    loyaltyPointsEarnedReversed: row.loyalty_points_earned_reversed,
    loyaltyPointsRedeemedRestored: row.loyalty_points_redeemed_restored,
    netTotal: row.net_total,
    originalSaleId: row.original_sale_id,
    originalSaleNumber: row.original_sale_number,
    reason: row.reason,
    refunds,
    returnNumber: row.return_number,
    shiftId: row.shift_id,
    vatTotal: row.vat_total,
  };
}

function mapReturnLine(row: ReturnLineRow): PosReturnLine {
  return {
    destinationWarehouseId: row.destination_warehouse_id,
    destinationWarehouseName: row.destination_warehouse_name,
    disposition: row.disposition,
    grossTotal: row.gross_total,
    id: row.id,
    netTotal: row.net_total,
    originalSaleLineId: row.original_sale_line_id,
    productCode: row.product_code,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    serialNumbers: row.serial_numbers,
    vatTotal: row.vat_total,
  };
}

function mapReturnRefund(row: ReturnRefundRow): PosReturn['refunds'][number] {
  return {
    adapter: row.adapter,
    amount: row.amount,
    id: row.id,
    method: row.refund_method,
    originalPaymentId: row.original_payment_id,
    ...(row.provider_reference ? { providerReference: row.provider_reference } : {}),
    status: row.status,
  };
}

function groupBy<Row, Value>(
  rows: Row[],
  key: (row: Row) => string,
  mapper: (row: Row) => Value,
): Map<string, Value[]> {
  const result = new Map<string, Value[]>();
  for (const row of rows) {
    const id = key(row);
    result.set(id, [...(result.get(id) ?? []), mapper(row)]);
  }
  return result;
}

async function claim<T>(
  client: PoolClient,
  scope: string,
  key: string,
  hash: string,
  ttlSeconds: number,
  isResponse: (value: unknown) => value is T,
): Promise<T | undefined> {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (
       scope, idempotency_key, request_hash, status, expires_at
     ) VALUES ($1,$2,$3,'processing',now() + make_interval(secs => $4))
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, hash, ttlSeconds],
  );
  if (inserted.rowCount) return undefined;
  const existing = await client.query<IdempotencyRow>(
    `SELECT request_hash, status, response_body FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
    [scope, key],
  );
  const row = required(existing.rows[0], 'Idempotency record disappeared');
  if (row.request_hash !== hash)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REUSED',
      'This request key was already used for different POS details',
      HttpStatus.CONFLICT,
    );
  if (row.status === 'completed' && isResponse(row.response_body)) return row.response_body;
  throw new ApiErrorException(
    'IDEMPOTENCY_REQUEST_INCOMPLETE',
    'The earlier POS request has not completed; review the current shift before retrying',
    HttpStatus.CONFLICT,
  );
}

function validKey(value: string | undefined) {
  const key = value?.trim();
  if (!key || key.length > 255)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required',
      HttpStatus.BAD_REQUEST,
    );
  return key;
}

function decimal(value: string, positive: boolean) {
  if (!/^\d+(\.\d{1,4})?$/u.test(value))
    throw new ApiErrorException(
      'POS_DECIMAL_INVALID',
      'Enter a number with no more than four decimal places',
      HttpStatus.BAD_REQUEST,
    );
  const normalized = `${value.split('.')[0]}.${(value.split('.')[1] ?? '').padEnd(4, '0')}`;
  if (positive && units(normalized) <= 0n)
    throw new ApiErrorException(
      'POS_QUANTITY_INVALID',
      'Product quantity must be greater than zero',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function units(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(4, '0').slice(0, 4)}`);
}

function fixed(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const text = absolute.toString().padStart(5, '0');
  return `${sign}${text.slice(0, -4)}.${text.slice(-4)}`;
}

function multiply(left: string, right: string): string {
  return fixed((units(left) * units(right) + 5_000n) / 10_000n);
}

function vat(net: string, treatment: PosVatTreatment): string {
  const rate =
    treatment === 'reduced_9' ? 9n : treatment === 'standard_20' || treatment === 'ica' ? 20n : 0n;
  return fixed((units(net) * rate + 50n) / 100n);
}

export function calculatePosLineTotals(
  quantity: string,
  unitPrice: string,
  treatment: PosVatTreatment,
) {
  const netTotal = multiply(quantity, unitPrice);
  const vatTotal = vat(netTotal, treatment);
  return { grossTotal: add(netTotal, vatTotal), netTotal, vatTotal };
}

function calculateReturnLineTotals(
  line: {
    gross_total: string;
    net_total: string;
    quantity: string;
    returned_gross_total: string;
    returned_net_total: string;
    returned_quantity: string;
    returned_vat_total: string;
    vat_total: string;
  },
  quantity: string,
) {
  const completesLine = units(line.returned_quantity) + units(quantity) === units(line.quantity);
  if (completesLine) {
    const netTotal = subtract(line.net_total, line.returned_net_total);
    const vatTotal = subtract(line.vat_total, line.returned_vat_total);
    return { grossTotal: add(netTotal, vatTotal), netTotal, vatTotal };
  }
  const netTotal = fixed((units(line.net_total) * units(quantity)) / units(line.quantity));
  const vatTotal = fixed((units(line.vat_total) * units(quantity)) / units(line.quantity));
  return { grossTotal: add(netTotal, vatTotal), netTotal, vatTotal };
}

function validDiscountValue(value: string, type: PosDiscountType) {
  const normalized = decimal(value, true);
  if (type === 'percentage' && units(normalized) > 1_000_000n)
    throw new ApiErrorException(
      'POS_DISCOUNT_PERCENTAGE_INVALID',
      'Percentage discounts cannot be greater than 100%',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function percentageOf(value: bigint, percentage: string) {
  return (value * units(percentage) + 500_000n) / 1_000_000n;
}

function allocate(
  amount: bigint,
  weights: Array<{ key: string; weight: bigint }>,
): Array<{ amount: bigint; key: string }> {
  const eligible = weights.filter((item) => item.weight > 0n);
  const totalWeight = eligible.reduce((total, item) => total + item.weight, 0n);
  if (amount <= 0n || totalWeight <= 0n)
    return weights.map((item) => ({ amount: 0n, key: item.key }));
  let allocated = 0n;
  return eligible.map((item, index) => {
    const share =
      index === eligible.length - 1 ? amount - allocated : (amount * item.weight) / totalWeight;
    allocated += share;
    return { amount: share, key: item.key };
  });
}

function discountBasketDigest(
  basket: ReturnType<typeof normalizeBasket>,
  discountType: PosDiscountType,
  discountValue: string,
) {
  return digest({
    customerPartnerId: basket.customerPartnerId ?? null,
    discountType,
    discountValue,
    lines: basket.lines,
    shiftId: basket.shiftId,
  });
}

function discountApprovalFailed() {
  return new ApiErrorException(
    'POS_DISCOUNT_APPROVAL_FAILED',
    'The approver details are incorrect or this account cannot approve POS discounts',
    HttpStatus.UNAUTHORIZED,
  );
}

function add(left: string, right: string): string {
  return fixed(units(left) + units(right));
}

function subtract(left: string, right: string): string {
  return fixed(units(left) - units(right));
}

function sum(values: string[]): string {
  return fixed(values.reduce((total, value) => total + units(value), 0n));
}

function plain(value: string): string {
  return Number(value).toFixed(2);
}

function isWhole(value: string) {
  return /^\d+\.0{4}$/u.test(value);
}

function businessDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    required(parts.find((candidate) => candidate.type === type)?.value, `Missing ${type}`);
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function iso(value: Date | string) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function customerNotFound() {
  return new ApiErrorException(
    'POS_CUSTOMER_NOT_FOUND',
    'The selected customer is unavailable',
    HttpStatus.NOT_FOUND,
  );
}

function isPosShift(value: unknown): value is PosShift {
  return Boolean(value && typeof value === 'object' && 'shiftNumber' in value);
}

function isPosSale(value: unknown): value is PosSale {
  return Boolean(value && typeof value === 'object' && 'saleNumber' in value);
}

function isPosFiscalSalePreparation(value: unknown): value is PosFiscalSalePreparation {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'uniqueSaleId' in value &&
    'status' in value &&
    'lines' in value &&
    Array.isArray(value.lines),
  );
}

function isPosDatecsUnpLease(value: unknown): value is PosDatecsUnpLease {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'cashRegisterId' in value &&
    'deviceSerial' in value &&
    'operatorIdentifier' in value &&
    'uniqueSaleIds' in value &&
    Array.isArray(value.uniqueSaleIds),
  );
}

function isPosFiscalDailyReport(value: unknown): value is PosFiscalDailyReport {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'id' in value &&
    'reportType' in value &&
    'shiftId' in value &&
    'status' in value,
  );
}

function isPosFiscalReturnPreparation(value: unknown): value is PosFiscalReturnPreparation {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'id' in value &&
    'originalSaleId' in value &&
    'uniqueReversalId' in value &&
    'request' in value &&
    'status' in value,
  );
}

function isPosReturn(value: unknown): value is PosReturn {
  return Boolean(value && typeof value === 'object' && 'returnNumber' in value);
}

function isPosQuickAccess(value: unknown): value is PosQuickAccess {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'cashRegisterId' in value &&
    'productIds' in value &&
    Array.isArray(value.productIds) &&
    'items' in value &&
    Array.isArray(value.items),
  );
}

function isPosDiscountAuthorization(value: unknown): value is PosDiscountAuthorization {
  return Boolean(
    value && typeof value === 'object' && 'approverName' in value && 'expiresAt' in value,
  );
}

function isPosLoyaltyAccount(value: unknown): value is PosLoyaltyAccount {
  return Boolean(value && typeof value === 'object' && 'cardNumber' in value && 'balance' in value);
}
