import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CreatePosCashSaleRequest,
  ClosePosShiftRequest,
  OpenPosShiftRequest,
  PosCatalogItem,
  PosCatalogPage,
  PosCustomerOption,
  PosSale,
  PosSaleLine,
  PosSalePage,
  PosShift,
  PosTerminalContext,
  PosVatTreatment,
} from '@vista/contracts';
import type { PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';

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
  id: string;
  name: string;
  price_list_id: string | null;
  product_code: string;
  tracking_mode: PosCatalogItem['trackingMode'];
  unit_price: string | null;
  vat_treatment: PosVatTreatment | null;
  warranty_months: number | null;
}

interface SaleRow {
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
  net_total: string;
  sale_number: string;
  shift_id: string;
  status: PosSale['status'];
  total_count?: string;
  vat_total: string;
}

interface SaleLineRow {
  gross_total: string;
  id: string;
  net_total: string;
  product_code: string;
  product_id: string;
  product_name: string;
  quantity: string;
  sale_id: string;
  serial_numbers: string[];
  unit_price: string;
  vat_total: string;
  vat_treatment: PosVatTreatment;
}

interface IdempotencyRow {
  request_hash: string;
  response_body: unknown;
  status: 'completed' | 'failed' | 'processing';
}

@Injectable()
export class PosService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
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

  async customers(search: string | undefined): Promise<PosCustomerOption[]> {
    const result = await this.database.getPool().query<{
      display_name: string;
      id: string;
      locations: Array<{ city: string; id: string; name: string }>;
      uic: string | null;
      vat_number: string | null;
    }>(
      `SELECT partner.id, partner.display_name, partner.uic, partner.vat_number,
        COALESCE(json_agg(json_build_object(
          'id', location.id, 'name', location.name, 'city', location.city
        ) ORDER BY location.name, location.id) FILTER (WHERE location.id IS NOT NULL), '[]'::json)
          AS locations
       FROM master_data.partners partner
       JOIN master_data.partner_roles role
         ON role.partner_id = partner.id AND role.role = 'customer'
       LEFT JOIN master_data.customer_locations location
         ON location.partner_id = partner.id AND location.active
       WHERE partner.active
         AND ($1 = '' OR partner.normalized_name LIKE '%' || lower($1) || '%'
           OR coalesce(partner.uic, '') ILIKE '%' || $1 || '%'
           OR coalesce(partner.vat_number, '') ILIKE '%' || $1 || '%')
       GROUP BY partner.id
       ORDER BY partner.display_name, partner.id
       LIMIT 30`,
      [search?.trim() ?? ''],
    );
    return result.rows.map((row) => ({
      id: row.id,
      locations: row.locations,
      name: row.display_name,
      ...(row.uic ? { uic: row.uic } : {}),
      ...(row.vat_number ? { vatNumber: row.vat_number } : {}),
    }));
  }

  async completeCashSale(
    input: CreatePosCashSaleRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosSale> {
    const normalized = normalizeSale(input);
    return this.command(
      'pos.sale.cash.complete',
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
          const totals = calculatePosLineTotals(
            inputLine.quantity,
            product.unit_price,
            product.vat_treatment,
          );
          return {
            ...inputLine,
            grossTotal: totals.grossTotal,
            netTotal: totals.netTotal,
            product,
            vatTotal: totals.vatTotal,
          };
        });
        const netTotal = sum(preparedLines.map((line) => line.netTotal));
        const vatTotal = sum(preparedLines.map((line) => line.vatTotal));
        const grossTotal = add(netTotal, vatTotal);
        if (units(normalized.cashTendered) < units(grossTotal))
          throw new ApiErrorException(
            'POS_CASH_TENDER_INSUFFICIENT',
            `Cash received must be at least BGN ${plain(grossTotal)}`,
            HttpStatus.BAD_REQUEST,
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
             fiscal_adapter, completed_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'simulated',$13,
             'development-simulator',$14)`,
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
               unit_price, vat_treatment, net_total, vat_total, gross_total,
               price_list_id, stock_movement_id, batch_id
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              saleLineId,
              saleId,
              line.productId,
              line.product.product_code,
              line.product.name,
              line.quantity,
              line.product.unit_price,
              line.product.vat_treatment,
              line.netTotal,
              line.vatTotal,
              line.grossTotal,
              line.product.price_list_id,
              movementId,
              line.batchId ?? null,
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

        const changeAmount = subtract(normalized.cashTendered, grossTotal);
        await client.query(
          `INSERT INTO pos.payments (
             id, sale_id, payment_method, amount, tendered_amount, change_amount
           ) VALUES ($1,$2,'cash',$3,$4,$5)`,
          [randomUUID(), saleId, grossTotal, normalized.cashTendered, changeAmount],
        );
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
    const bySale = new Map<string, PosSaleLine[]>();
    for (const row of lines.rows) {
      const current = bySale.get(row.sale_id) ?? [];
      current.push(mapSaleLine(row));
      bySale.set(row.sale_id, current);
    }
    const count = await this.database.getPool().query<{ total: string }>(
      `SELECT count(*)::text AS total FROM pos.sales sale
       JOIN organization.operators operator ON operator.id = sale.operator_id
       WHERE operator.account_id = $1`,
      [authentication.accountId],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: rows.rows.map((row) => mapSale(row, bySale.get(row.id) ?? [])),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
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
    type: 'fiscal_receipt' | 'sale' | 'shift' | 'warranty_card',
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

  private async sale(client: PoolClient, id: string): Promise<PosSale> {
    const header = await client.query<SaleRow>(`${saleHeaderSql} WHERE sale.id = $1`, [id]);
    const lines = await client.query<SaleLineRow>(saleLinesSql, [[id]]);
    return mapSale(required(header.rows[0], 'POS sale lookup failed'), lines.rows.map(mapSaleLine));
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
    configuration.fiscal_device_label
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
      WHERE sale.shift_id = shift.id AND sale.status = 'completed'
        AND payment.payment_method = 'cash'
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

const saleProductsSql = `
  SELECT product.id, product.product_code, product.name, category.tracking_mode,
    product.pos_vat_treatment AS vat_treatment, product.warranty_months,
    balance.average_unit_cost_bgn::text, price.id AS price_list_id, price.unit_price
  FROM master_data.products product
  JOIN master_data.product_categories category
    ON category.id = product.category_id AND category.active
  JOIN inventory.stock_balances balance
    ON balance.product_id = product.id AND balance.warehouse_id = $2
  LEFT JOIN LATERAL (${applicablePriceSql(3)}) price ON true
  WHERE product.id = ANY($1::uuid[]) AND product.active
  FOR KEY SHARE OF product`;

const saleHeaderSql = `
  SELECT sale.id, sale.sale_number, sale.shift_id, sale.customer_partner_id,
    customer.display_name AS customer_name, sale.currency_code, sale.net_total::text,
    sale.vat_total::text, sale.gross_total::text, sale.status, sale.fiscal_status,
    sale.fiscal_receipt_number, sale.fiscal_adapter, sale.completed_at,
    payment.tendered_amount::text AS cash_tendered, payment.change_amount::text
  FROM pos.sales sale
  LEFT JOIN master_data.partners customer ON customer.id = sale.customer_partner_id
  JOIN pos.payments payment ON payment.sale_id = sale.id AND payment.payment_method = 'cash'`;

const saleLinesSql = `
  SELECT line.sale_id, line.id, line.product_id, line.product_code, line.product_name,
    line.quantity::text, line.unit_price::text, line.vat_treatment,
    line.net_total::text, line.vat_total::text, line.gross_total::text,
    COALESCE(array_agg(serial.serial_number ORDER BY serial.serial_number)
      FILTER (WHERE serial.serialized_item_id IS NOT NULL), '{}'::text[]) AS serial_numbers
  FROM pos.sale_lines line
  LEFT JOIN pos.sale_line_serials serial ON serial.sale_line_id = line.id
  WHERE line.sale_id = ANY($1::uuid[])
  GROUP BY line.id ORDER BY line.sale_id, line.id`;

function normalizeSale(input: CreatePosCashSaleRequest) {
  const productIds = input.lines.map((line) => line.productId);
  if (new Set(productIds).size !== productIds.length)
    throw new ApiErrorException(
      'POS_BASKET_PRODUCT_DUPLICATE',
      'Each product can appear only once in the basket',
      HttpStatus.BAD_REQUEST,
    );
  if (!input.customerPartnerId && input.customerLocationId)
    throw new ApiErrorException(
      'POS_CUSTOMER_LOCATION_REQUIRED',
      'Select the customer before choosing a receiving location',
      HttpStatus.BAD_REQUEST,
    );
  return {
    cashTendered: decimal(input.cashTendered, false),
    clientTransactionId: input.clientTransactionId,
    ...(input.customerLocationId ? { customerLocationId: input.customerLocationId } : {}),
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
    shiftId: input.shiftId,
  };
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

function mapSale(row: SaleRow, lines: PosSaleLine[]): PosSale {
  return {
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
    lines,
    netTotal: row.net_total,
    saleNumber: row.sale_number,
    shiftId: row.shift_id,
    status: row.status,
    vatTotal: row.vat_total,
  };
}

function mapSaleLine(row: SaleLineRow): PosSaleLine {
  return {
    grossTotal: row.gross_total,
    id: row.id,
    netTotal: row.net_total,
    productCode: row.product_code,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    serialNumbers: row.serial_numbers,
    unitPrice: row.unit_price,
    vatTotal: row.vat_total,
    vatTreatment: row.vat_treatment,
  };
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
