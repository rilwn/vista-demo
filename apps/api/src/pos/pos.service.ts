import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  FinancialDocument,
  CreatePosDiscountAuthorizationRequest,
  CreatePosReturnRequest,
  CreatePosSaleRequest,
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
  PosWarrantyCardDocument,
  PricePosBasketRequest,
  UpdatePosQuickAccessRequest,
} from '@vista/contracts';
import type { PoolClient } from 'pg';

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
import { renderPosWarrantyCard } from './pos-warranty-card-renderer.js';

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
  closing_cash_bgn: string | null;
  expected_cash_bgn: string;
  id: string;
  opened_at: Date | string;
  opening_cash_bgn: string;
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
  average_unit_cost_bgn: string;
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

interface SaleRow {
  automatic_discount_total: string;
  base_net_total: string;
  cash_tendered: string;
  change_amount: string;
  completed_at: Date | string;
  currency_code: 'BGN';
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
  sale_id: string;
  serial_numbers: string[];
  unit_price: string;
  vat_total: string;
  vat_treatment: PosVatTreatment;
}

interface ReturnRow {
  completed_at: Date | string;
  fiscal_adapter: string;
  fiscal_reversal_number: string;
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
  redemption_value_bgn: string;
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
      openingCashBgn: decimal(input.openingCashBgn, false),
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
             opening_cash_bgn, opened_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            shiftId,
            shiftNumber,
            selected.cash_register_id,
            selected.operator_id,
            selected.warehouse_id,
            normalized.openingCashBgn,
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
      closingCashBgn: decimal(input.closingCashBgn, false),
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
        const updated = await client.query(
          `UPDATE pos.shifts SET status = 'closed', closing_cash_bgn = $3,
             closed_by = $2, closed_at = now(), version = version + 1
           WHERE id = $1 AND version = $4`,
          [id, authentication.accountId, normalized.closingCashBgn, normalized.version],
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
      loyalty_redemption_value_bgn: string | null;
      loyalty_status: PosLoyaltyAccount['status'] | null;
      locations: Array<{ city: string; id: string; name: string }>;
      uic: string | null;
      vat_number: string | null;
    }>(
      `SELECT partner.id, partner.display_name, partner.uic, partner.vat_number,
        loyalty.id AS loyalty_id, loyalty.card_number AS loyalty_card_number,
        loyalty.status AS loyalty_status, program.name AS loyalty_program_name,
        program.redemption_value_bgn::text AS loyalty_redemption_value_bgn,
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
      row.loyalty_redemption_value_bgn &&
      row.loyalty_status
        ? {
            loyalty: {
              balance: Number(row.loyalty_balance ?? 0),
              cardNumber: row.loyalty_card_number,
              id: row.loyalty_id,
              programName: row.loyalty_program_name,
              redemptionValueBgn: row.loyalty_redemption_value_bgn,
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
             WHEN 'charge' THEN entry.amount ELSE -entry.amount END), 0) AS outstanding
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
           THEN greatest(terms.credit_limit_bgn - COALESCE(account_balance.outstanding, 0), 0)
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

  async completeSale(
    input: CreatePosSaleRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
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
        if (terminal.fiscal_mode !== 'simulator')
          throw new ApiErrorException(
            'POS_FISCAL_ADAPTER_UNAVAILABLE',
            'The approved fiscal-device adapter is not connected yet',
            HttpStatus.SERVICE_UNAVAILABLE,
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
        const products = await client.query<SaleProductRow>(saleProductsSql, [
          productIds,
          shift.warehouseId,
          normalized.customerPartnerId ?? null,
        ]);
        if (products.rowCount !== productIds.length)
          throw new ApiErrorException(
            'POS_PRODUCT_UNAVAILABLE',
            'One or more basket items are inactive or unavailable at this register',
            HttpStatus.CONFLICT,
          );

        const basketPricing = await this.prepareBasketPricing(
          client,
          shift,
          normalized,
          authentication.accountId,
        );

        const preparedLines = normalized.lines.map((inputLine) => {
          const product = required(
            products.rows.find((row) => row.id === inputLine.productId),
            'POS product lookup failed',
          );
          if (!product.unit_price)
            throw new ApiErrorException(
              'POS_PRICE_UNAVAILABLE',
              `${product.name} does not have an active BGN selling price`,
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
        const payments = await prepareSalePayments(
          client,
          normalized.payments,
          grossTotal,
          normalized.customerPartnerId,
          terminal,
          this.environment.NODE_ENV,
          this.environment.BUSINESS_TIMEZONE,
        );

        const saleId = randomUUID();
        const saleNumber = await this.nextNumber(client, terminal, 'sale', 'SALE');
        const receiptNumber = await this.nextNumber(
          client,
          terminal,
          'fiscal_receipt',
          'SIM-RECEIPT',
        );
        await client.query(
          `INSERT INTO pos.sales (
             id, sale_number, client_transaction_id, shift_id, cash_register_id,
             operator_id, warehouse_id, customer_partner_id, customer_location_id,
             net_total, vat_total, gross_total, fiscal_status, fiscal_receipt_number,
             fiscal_adapter, completed_by, base_net_total, automatic_discount_total,
             manual_discount_total, loyalty_discount_total, loyalty_points_redeemed,
             discount_authorization_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'simulated',$13,
             'development-simulator',$14,$15,$16,$17,$18,$19,$20)`,
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
            receiptNumber,
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
          const balance = await client.query<{ average_unit_cost_bgn: string }>(
            `SELECT balance.average_unit_cost_bgn::text
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
             ), 0))::text AS available_quantity
             FROM inventory.stock_balances balance
             WHERE balance.warehouse_id = $1 AND balance.product_id = $2`,
            [shift.warehouseId, line.productId],
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
               SET quantity = balance.quantity - $3, updated_at = now()
               FROM inventory.batches batch
               WHERE balance.warehouse_id = $1 AND balance.batch_id = $2
                 AND batch.id = balance.batch_id AND batch.product_id = $4
                 AND balance.quantity >= $3
               RETURNING balance.batch_id`,
              [shift.warehouseId, line.batchId, line.quantity, line.productId],
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
                   AND NOT EXISTS (
                     SELECT 1 FROM inventory.stock_reservation_serials reserved
                     WHERE reserved.serialized_item_id = item.id AND reserved.active
                   )
                 ORDER BY item.serial_number FOR UPDATE OF item`,
                [
                  line.productId,
                  shift.warehouseId,
                  line.serialNumbers.map((serial) => serial.toUpperCase()),
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
               reference_id, actor_account_id, correlation_id, unit_cost_bgn,
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
              valuation.average_unit_cost_bgn,
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
          const program = await client.query<{ earn_points_per_bgn: number }>(
            `SELECT program.earn_points_per_bgn
             FROM pos.loyalty_accounts account
             JOIN pos.loyalty_programs program ON program.id = account.program_id
             WHERE account.id = $1`,
            [loyalty.id],
          );
          loyaltyPointsEarned = Number(
            (units(grossTotal) * BigInt(program.rows[0]?.earn_points_per_bgn ?? 0)) / 10_000n,
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
                 due_on, credit_limit_bgn, payment_terms_days, pos_sale_id,
                 actor_account_id, correlation_id
               ) VALUES ($1,$2,$3,'charge',$4,$5,$6,$7,$8,$9,$10)`,
              [
                randomUUID(),
                normalized.customerPartnerId,
                payment.paymentTermsId,
                payment.amount,
                payment.accountDueOn,
                payment.creditLimitBgn,
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
           ) VALUES ($1,$2,'sale_receipt','development-simulator','simulated',$3,$4,$5)`,
          [randomUUID(), saleId, receiptNumber, requestDigest, digest({ receiptNumber })],
        );
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

  async createReturn(
    input: CreatePosReturnRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosReturn> {
    const normalized = normalizeReturn(input);
    return this.command(
      'pos.return.complete',
      key,
      normalized,
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
        if (terminal.fiscal_mode !== 'simulator')
          throw new ApiErrorException(
            'POS_FISCAL_ADAPTER_UNAVAILABLE',
            'The approved fiscal-device return adapter is not connected yet',
            HttpStatus.SERVICE_UNAVAILABLE,
          );

        const originalResult = await client.query<{
          business_location_id: string;
          customer_partner_id: string | null;
          gross_total: string;
          id: string;
          loyalty_points_earned: number;
          loyalty_points_redeemed: number;
          sale_number: string;
          warehouse_id: string;
        }>(
          `SELECT sale.id, sale.sale_number, sale.customer_partner_id, sale.warehouse_id,
             sale.gross_total::text, sale.loyalty_points_earned,
             sale.loyalty_points_redeemed,
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
          unit_cost_bgn: string;
          unit_price: string;
          vat_total: string;
          vat_treatment: PosVatTreatment;
        }>(
          `SELECT line.id, line.product_id, line.product_code, line.product_name,
             line.category_id, line.category_name,
             line.quantity::text, line.unit_price::text, line.vat_treatment,
             line.net_total::text, line.vat_total::text, line.gross_total::text,
             line.stock_movement_id, line.batch_id, category.tracking_mode,
             movement.unit_cost_bgn::text,
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
        const reversalNumber = await this.nextNumber(
          client,
          terminal,
          'fiscal_return',
          'SIM-REVERSAL',
        );
        await client.query(
          `INSERT INTO pos.returns (
             id, return_number, original_sale_id, shift_id, cash_register_id,
             operator_id, customer_partner_id, reason, net_total, vat_total,
             gross_total, fiscal_reversal_number, fiscal_adapter, completed_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             'development-simulator',$13)`,
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
              credit_limit_bgn: string;
              due_on: string;
              id: string;
              payment_terms_days: number;
              payment_terms_id: string;
            }>(
              `SELECT id, payment_terms_id, due_on::text, credit_limit_bgn::text,
                 payment_terms_days
               FROM finance.customer_account_entries
               WHERE pos_sale_id = $1 AND entry_type = 'charge'`,
              [original.id],
            );
            const charge = required(source.rows[0], 'Customer account charge is missing');
            await client.query(
              `INSERT INTO finance.customer_account_entries (
                 id, customer_partner_id, payment_terms_id, entry_type, amount,
                 due_on, credit_limit_bgn, payment_terms_days, pos_sale_id,
                 pos_return_id, source_entry_id, actor_account_id, correlation_id
               ) VALUES ($1,$2,$3,'return_credit',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [
                randomUUID(),
                original.customer_partner_id,
                charge.payment_terms_id,
                refund.amount,
                charge.due_on,
                charge.credit_limit_bgn,
                charge.payment_terms_days,
                original.id,
                returnId,
                charge.id,
                authentication.accountId,
                metadata.correlationId,
              ],
            );
          }
        }

        for (const prepared of preparedLines) {
          const movementId = randomUUID();
          const returnLineId = randomUUID();
          await client.query(
            `INSERT INTO inventory.stock_movements (
               id, warehouse_id, product_id, movement_type, quantity, reference_type,
               reference_id, actor_account_id, correlation_id, unit_cost_bgn,
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
              prepared.line.unit_cost_bgn,
              original.customer_partner_id,
              prepared.line.batch_id,
            ],
          );
          await client.query(
            `INSERT INTO inventory.stock_balances (
               warehouse_id, product_id, quantity, average_unit_cost_bgn
             ) VALUES ($1,$2,$3,$4)
             ON CONFLICT (warehouse_id, product_id) DO UPDATE SET
               average_unit_cost_bgn = round((
                 inventory.stock_balances.quantity * inventory.stock_balances.average_unit_cost_bgn
                 + EXCLUDED.quantity * EXCLUDED.average_unit_cost_bgn
               ) / (inventory.stock_balances.quantity + EXCLUDED.quantity), 4),
               quantity = inventory.stock_balances.quantity + EXCLUDED.quantity,
               updated_at = now()`,
            [
              prepared.destinationWarehouseId,
              prepared.line.product_id,
              prepared.input.quantity,
              prepared.line.unit_cost_bgn,
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
           ) VALUES ($1,$2,$3,'return_reversal','development-simulator','simulated',$4,$5,$6)`,
          [
            randomUUID(),
            original.id,
            returnId,
            reversalNumber,
            requestDigest,
            digest({ reversalNumber }),
          ],
        );
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
          `${product.name} does not have an active BGN selling price`,
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
        }>(
          `SELECT basket_digest, consumed_by_sale_id
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
      const pointValue = units(loyaltyAccount.redemptionValueBgn);
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
         program.redemption_value_bgn::text,
         COALESCE(sum(entry.points), 0)::text AS balance
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
          redemptionValueBgn: row.redemption_value_bgn,
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
    if (mode === 'simulator' && this.environment.NODE_ENV === 'production')
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
    warehouse.name AS warehouse_name, shift.status, shift.opening_cash_bgn::text,
    shift.closing_cash_bgn::text, shift.closed_at,
    (shift.opening_cash_bgn + COALESCE((
      SELECT sum(payment.amount)
      FROM pos.sales sale
      JOIN pos.payments payment ON payment.sale_id = sale.id
      WHERE sale.shift_id = shift.id AND payment.payment_method = 'cash'
    ), 0) - COALESCE((
      SELECT sum(refund.amount)
      FROM pos.returns pos_return
      JOIN pos.return_refunds refund ON refund.return_id = pos_return.id
      WHERE pos_return.shift_id = shift.id AND refund.refund_method = 'cash'
    ), 0))::text AS expected_cash_bgn,
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
  WHERE line.product_id = product.id AND list.active AND list.currency_code = 'BGN'
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
    balance.average_unit_cost_bgn::text, price.id AS price_list_id, price.unit_price
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
       'number', document.draft_number,
       'sourceFiscalReceiptNumber', document.source_fiscal_receipt_number,
       'status', document.status
     )
     FROM finance.financial_documents document
     WHERE document.source_pos_sale_id = sale.id AND document.status = 'draft'
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
    pos_return.fiscal_adapter, pos_return.completed_at,
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
      `Refunds must equal the BGN ${plain(grossTotal)} return total`,
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
      `Payments must equal the BGN ${plain(grossTotal)} sale total`,
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
    creditLimitBgn?: string;
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
          `Cash received must be at least BGN ${plain(payment.amount)}`,
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
        credit_limit_bgn: string;
        due_on: string;
        id: string;
        outstanding_balance: string;
        payment_terms_days: number;
      }>(
        `SELECT terms.id, terms.credit_limit_bgn::text, terms.payment_terms_days,
           ((now() AT TIME ZONE $2)::date + terms.payment_terms_days)::text AS due_on,
           COALESCE((SELECT sum(CASE entry.entry_type
             WHEN 'charge' THEN entry.amount ELSE -entry.amount END)
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
        units(account.credit_limit_bgn)
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
        creditLimitBgn: account.credit_limit_bgn,
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
    prepared.push({
      adapter: 'development-card-simulator',
      amount: payment.amount,
      changeAmount: '0.0000',
      method: payment.method,
      providerReference: `SIM-CARD-${randomUUID()}`,
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
    ...(row.closing_cash_bgn ? { closingCashBgn: row.closing_cash_bgn } : {}),
    expectedCashBgn: row.expected_cash_bgn,
    id: row.id,
    openedAt: iso(row.opened_at),
    openingCashBgn: row.opening_cash_bgn,
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
    currencyCode: 'BGN',
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
    serialNumbers: row.serial_numbers,
    unitPrice: row.unit_price,
    vatTotal: row.vat_total,
    vatTreatment: row.vat_treatment,
  };
}

function mapSalePayment(row: SalePaymentRow): PosSalePayment {
  return {
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
    fiscalReversalNumber: row.fiscal_reversal_number,
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
