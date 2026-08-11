import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CreateSupplierClaimRequest,
  CreateSupplierEvaluationRequest,
  CreateSupplierInvoiceRequest,
  ProcurementSupplierRecord,
  SupplierClaim,
  SupplierClaimStatus,
  SupplierClaimStatusEvent,
  SupplierCommercialProfile,
  SupplierEvaluation,
  SupplierInvoice,
  SupplierInvoiceLine,
  UpdateSupplierClaimStatusRequest,
  UpdateSupplierCommercialProfileRequest,
} from '@vista/contracts';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';

type ClaimedCommand = { request_hash: string; response_body: unknown; status: string };

@Injectable()
export class SupplierProcurementService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async suppliers(): Promise<ProcurementSupplierRecord[]> {
    const suppliers = await this.database.getPool().query<{ id: string }>(
      `SELECT partner.id
       FROM master_data.partners partner
       JOIN master_data.partner_roles role ON role.partner_id = partner.id
       WHERE partner.active AND role.role = 'supplier'
       ORDER BY partner.normalized_name, partner.id`,
    );
    return Promise.all(suppliers.rows.map((supplier) => this.supplier(supplier.id)));
  }

  async supplier(supplierId: string): Promise<ProcurementSupplierRecord> {
    const client = await this.database.getPool().connect();
    try {
      return await this.loadSupplier(client, supplierId);
    } finally {
      client.release();
    }
  }

  updateProfile(
    supplierId: string,
    input: UpdateSupplierCommercialProfileRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SupplierCommercialProfile> {
    const normalized = {
      ...(input.deliveryTerms?.trim() ? { deliveryTerms: input.deliveryTerms.trim() } : {}),
      expectedVersion: input.expectedVersion,
      ...(input.paymentTermsDays !== undefined ? { paymentTermsDays: input.paymentTermsDays } : {}),
    };
    return this.command(
      'supplier-profile.update',
      key,
      { supplierId, ...normalized },
      async (client, idempotencyKey) => {
        await this.requireSupplier(client, supplierId);
        const current = await client.query<{ version: number }>(
          `SELECT version FROM procurement.supplier_profiles
         WHERE supplier_partner_id = $1 FOR UPDATE`,
          [supplierId],
        );
        const row = current.rows[0];
        if ((row?.version ?? 0) !== normalized.expectedVersion)
          throw new ApiErrorException(
            'SUPPLIER_PROFILE_VERSION_CONFLICT',
            'The supplier terms changed. Reload before saving again',
            HttpStatus.CONFLICT,
          );
        if (row) {
          await client.query(
            `UPDATE procurement.supplier_profiles
           SET payment_terms_days = $2, delivery_terms = $3, version = version + 1,
               updated_by = $4, updated_at = now()
           WHERE supplier_partner_id = $1`,
            [
              supplierId,
              normalized.paymentTermsDays ?? null,
              normalized.deliveryTerms ?? null,
              auth.accountId,
            ],
          );
        } else {
          await client.query(
            `INSERT INTO procurement.supplier_profiles (
             supplier_partner_id, payment_terms_days, delivery_terms, updated_by
           ) VALUES ($1, $2, $3, $4)`,
            [
              supplierId,
              normalized.paymentTermsDays ?? null,
              normalized.deliveryTerms ?? null,
              auth.accountId,
            ],
          );
        }
        const result = (await this.loadSupplier(client, supplierId)).profile;
        await this.sideEffects(
          client,
          'supplier',
          supplierId,
          'procurement.supplier.profile.updated',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  createEvaluation(
    supplierId: string,
    input: CreateSupplierEvaluationRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SupplierEvaluation> {
    const normalized = {
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      score: input.score,
    };
    return this.command(
      'supplier-evaluation.create',
      key,
      { supplierId, ...normalized },
      async (client, idempotencyKey) => {
        await this.requireSupplier(client, supplierId);
        const id = randomUUID();
        await client.query(
          `INSERT INTO procurement.supplier_evaluations (
           id, supplier_partner_id, score, notes, evaluated_by
         ) VALUES ($1, $2, $3, $4, $5)`,
          [id, supplierId, normalized.score, normalized.notes ?? null, auth.accountId],
        );
        const result = await this.loadEvaluation(client, id);
        await this.sideEffects(
          client,
          'supplier_evaluation',
          id,
          'procurement.supplier.evaluated',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  async invoices(): Promise<SupplierInvoice[]> {
    const client = await this.database.getPool().connect();
    try {
      const ids = await client.query<{ id: string }>(
        `SELECT id FROM procurement.supplier_invoices
         ORDER BY invoice_date DESC, recorded_at DESC, id DESC`,
      );
      const invoices: SupplierInvoice[] = [];
      for (const row of ids.rows) invoices.push(await this.loadInvoice(client, row.id));
      return invoices;
    } finally {
      client.release();
    }
  }

  createInvoice(
    input: CreateSupplierInvoiceRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SupplierInvoice> {
    const normalized = normalizeInvoice(input);
    return this.command(
      'supplier-invoice.create',
      key,
      normalized,
      async (client, idempotencyKey) => {
        const order = await client.query<{ currency_code: string; supplier_partner_id: string }>(
          `SELECT currency_code, supplier_partner_id FROM procurement.purchase_orders
         WHERE id = $1 FOR UPDATE`,
          [normalized.purchaseOrderId],
        );
        const orderRow = order.rows[0];
        if (!orderRow)
          throw new ApiErrorException(
            'PURCHASE_ORDER_NOT_FOUND',
            'The purchase order was not found',
            HttpStatus.NOT_FOUND,
          );
        const lines = await client.query<{ id: string }>(
          `SELECT id FROM procurement.purchase_order_lines
         WHERE purchase_order_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
          [normalized.purchaseOrderId, normalized.lines.map((line) => line.orderLineId)],
        );
        if (lines.rowCount !== normalized.lines.length)
          throw new ApiErrorException(
            'SUPPLIER_INVOICE_LINE_NOT_FOUND',
            'One or more invoice lines do not belong to the purchase order',
            HttpStatus.NOT_FOUND,
          );
        const invoiceId = randomUUID();
        await client.query(
          `INSERT INTO procurement.supplier_invoices (
           id, purchase_order_id, supplier_partner_id, supplier_invoice_number,
           invoice_date, currency_code, recorded_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            invoiceId,
            normalized.purchaseOrderId,
            orderRow.supplier_partner_id,
            normalized.invoiceNumber,
            normalized.invoiceDate,
            orderRow.currency_code,
            auth.accountId,
          ],
        );
        for (const line of normalized.lines) {
          await client.query(
            `INSERT INTO procurement.supplier_invoice_lines (
             id, supplier_invoice_id, purchase_order_id, purchase_order_line_id,
             quantity, unit_price
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              randomUUID(),
              invoiceId,
              normalized.purchaseOrderId,
              line.orderLineId,
              line.quantity,
              line.unitPrice,
            ],
          );
          await client.query(
            `UPDATE procurement.purchase_order_lines
           SET invoiced_quantity = invoiced_quantity + $2 WHERE id = $1`,
            [line.orderLineId, line.quantity],
          );
        }
        await client.query(
          `UPDATE procurement.purchase_orders
         SET version = version + 1, updated_by = $2, updated_at = now() WHERE id = $1`,
          [normalized.purchaseOrderId, auth.accountId],
        );
        const result = await this.loadInvoice(client, invoiceId);
        await this.sideEffects(
          client,
          'supplier_invoice',
          invoiceId,
          'procurement.supplier_invoice.recorded',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  async claims(): Promise<SupplierClaim[]> {
    const client = await this.database.getPool().connect();
    try {
      const ids = await client.query<{ id: string }>(
        `SELECT id FROM procurement.supplier_claims ORDER BY created_at DESC, id DESC`,
      );
      const claims: SupplierClaim[] = [];
      for (const row of ids.rows) claims.push(await this.loadClaim(client, row.id));
      return claims;
    } finally {
      client.release();
    }
  }

  createClaim(
    input: CreateSupplierClaimRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SupplierClaim> {
    const normalized = {
      description: requiredText(input.description, 'Claim description', 2000),
      goodsReceiptLineId: input.goodsReceiptLineId,
      quantity: positiveDecimal(input.quantity),
      type: input.type,
    };
    return this.command(
      'supplier-claim.create',
      key,
      normalized,
      async (client, idempotencyKey) => {
        const source = await client.query<{
          goods_receipt_id: string;
          purchase_order_id: string;
          quantity: string;
          supplier_partner_id: string;
        }>(
          `SELECT line.goods_receipt_id, receipt.purchase_order_id,
                receipt.supplier_partner_id, line.quantity::text
         FROM procurement.goods_receipt_lines line
         JOIN procurement.goods_receipts receipt ON receipt.id = line.goods_receipt_id
         WHERE line.id = $1 FOR UPDATE OF line`,
          [normalized.goodsReceiptLineId],
        );
        const sourceRow = source.rows[0];
        if (!sourceRow)
          throw new ApiErrorException(
            'GOODS_RECEIPT_LINE_NOT_FOUND',
            'The goods receipt line was not found',
            HttpStatus.NOT_FOUND,
          );
        const claimed = await client.query<{ quantity: string }>(
          `SELECT COALESCE(sum(quantity), 0)::text AS quantity
         FROM procurement.supplier_claims WHERE goods_receipt_line_id = $1`,
          [normalized.goodsReceiptLineId],
        );
        if (
          decimalUnits(claimed.rows[0]?.quantity ?? '0') + decimalUnits(normalized.quantity) >
          decimalUnits(sourceRow.quantity)
        )
          throw new ApiErrorException(
            'SUPPLIER_CLAIM_QUANTITY_EXCEEDED',
            'The claimed quantity exceeds the received quantity still available for a claim',
            HttpStatus.CONFLICT,
          );
        const id = randomUUID();
        await client.query(
          `INSERT INTO procurement.supplier_claims (
           id, supplier_partner_id, purchase_order_id, goods_receipt_id,
           goods_receipt_line_id, claim_type, quantity, description, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
          [
            id,
            sourceRow.supplier_partner_id,
            sourceRow.purchase_order_id,
            sourceRow.goods_receipt_id,
            normalized.goodsReceiptLineId,
            normalized.type,
            normalized.quantity,
            normalized.description,
            auth.accountId,
          ],
        );
        await client.query(
          `INSERT INTO procurement.supplier_claim_status_history (
           id, supplier_claim_id, from_status, to_status, changed_by
         ) VALUES ($1, $2, NULL, 'open', $3)`,
          [randomUUID(), id, auth.accountId],
        );
        const result = await this.loadClaim(client, id);
        await this.sideEffects(
          client,
          'supplier_claim',
          id,
          'procurement.supplier_claim.created',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  updateClaimStatus(
    claimId: string,
    input: UpdateSupplierClaimStatusRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SupplierClaim> {
    const normalized = {
      expectedVersion: input.expectedVersion,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      status: input.status,
    };
    return this.command(
      'supplier-claim.status',
      key,
      { claimId, ...normalized },
      async (client, idempotencyKey) => {
        const current = await client.query<{ status: SupplierClaimStatus; version: number }>(
          `SELECT status, version FROM procurement.supplier_claims WHERE id = $1 FOR UPDATE`,
          [claimId],
        );
        const row = current.rows[0];
        if (!row)
          throw new ApiErrorException(
            'SUPPLIER_CLAIM_NOT_FOUND',
            'The supplier claim was not found',
            HttpStatus.NOT_FOUND,
          );
        if (row.version !== normalized.expectedVersion)
          throw new ApiErrorException(
            'SUPPLIER_CLAIM_VERSION_CONFLICT',
            'The claim changed. Reload before updating its status',
            HttpStatus.CONFLICT,
          );
        if (nextClaimStatus(row.status) !== normalized.status)
          throw new ApiErrorException(
            'SUPPLIER_CLAIM_TRANSITION_INVALID',
            'The requested claim status does not follow the controlled lifecycle',
            HttpStatus.CONFLICT,
          );
        await client.query(
          `UPDATE procurement.supplier_claims
         SET status = $2, version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1`,
          [claimId, normalized.status, auth.accountId],
        );
        await client.query(
          `INSERT INTO procurement.supplier_claim_status_history (
           id, supplier_claim_id, from_status, to_status, note, changed_by
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            claimId,
            row.status,
            normalized.status,
            normalized.note ?? null,
            auth.accountId,
          ],
        );
        const result = await this.loadClaim(client, claimId);
        await this.sideEffects(
          client,
          'supplier_claim',
          claimId,
          'procurement.supplier_claim.status_changed',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  async invoicesForOrder(client: PoolClient, purchaseOrderId: string): Promise<SupplierInvoice[]> {
    const ids = await client.query<{ id: string }>(
      `SELECT id FROM procurement.supplier_invoices
       WHERE purchase_order_id = $1 ORDER BY invoice_date, recorded_at, id`,
      [purchaseOrderId],
    );
    const invoices: SupplierInvoice[] = [];
    for (const row of ids.rows) invoices.push(await this.loadInvoice(client, row.id));
    return invoices;
  }

  private async loadSupplier(client: PoolClient, supplierId: string) {
    const supplier = await client.query<{
      delivery_terms: string | null;
      name: string;
      payment_terms_days: number | null;
      updated_at: string | null;
      version: number | null;
    }>(
      `SELECT partner.display_name AS name, profile.payment_terms_days,
              profile.delivery_terms, profile.version, profile.updated_at::text
       FROM master_data.partners partner
       JOIN master_data.partner_roles role ON role.partner_id = partner.id AND role.role = 'supplier'
       LEFT JOIN procurement.supplier_profiles profile ON profile.supplier_partner_id = partner.id
       WHERE partner.id = $1 AND partner.active`,
      [supplierId],
    );
    const row = supplier.rows[0];
    if (!row)
      throw new ApiErrorException(
        'SUPPLIER_NOT_FOUND',
        'The selected supplier was not found or is inactive',
        HttpStatus.NOT_FOUND,
      );
    const contacts = await client.query<{
      email: string | null;
      job_title: string | null;
      name: string;
      role: string | null;
      telephone: string | null;
    }>(
      `SELECT display_name AS name, job_title, contact_role AS role, telephone, email
       FROM master_data.partner_contacts
       WHERE partner_id = $1 AND active ORDER BY display_name, id`,
      [supplierId],
    );
    const evaluations = await client.query<{ id: string }>(
      `SELECT id FROM procurement.supplier_evaluations
       WHERE supplier_partner_id = $1 ORDER BY evaluated_at DESC, id DESC`,
      [supplierId],
    );
    const evaluationItems: SupplierEvaluation[] = [];
    for (const evaluation of evaluations.rows)
      evaluationItems.push(await this.loadEvaluation(client, evaluation.id));
    return {
      contacts: contacts.rows.map((contact) => ({
        ...(contact.email ? { email: contact.email } : {}),
        name: contact.name,
        ...(contact.role || contact.job_title
          ? { role: contact.role ?? contact.job_title ?? '' }
          : {}),
        ...(contact.telephone ? { telephone: contact.telephone } : {}),
      })),
      evaluations: evaluationItems,
      profile: {
        ...(row.delivery_terms ? { deliveryTerms: row.delivery_terms } : {}),
        ...(row.payment_terms_days !== null ? { paymentTermsDays: row.payment_terms_days } : {}),
        supplierName: row.name,
        supplierPartnerId: supplierId,
        ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
        version: row.version ?? 0,
      },
    } satisfies ProcurementSupplierRecord;
  }

  private async loadEvaluation(client: PoolClient, id: string): Promise<SupplierEvaluation> {
    const result = await client.query<{
      evaluated_at: string;
      evaluated_by: string;
      id: string;
      notes: string | null;
      score: number;
      supplier_partner_id: string;
    }>(
      `SELECT id, supplier_partner_id, score, notes, evaluated_by, evaluated_at::text
       FROM procurement.supplier_evaluations WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Supplier evaluation could not be loaded');
    return {
      evaluatedAt: row.evaluated_at,
      evaluatedByAccountId: row.evaluated_by,
      id: row.id,
      ...(row.notes ? { notes: row.notes } : {}),
      score: row.score,
      supplierPartnerId: row.supplier_partner_id,
    };
  }

  private async loadInvoice(client: PoolClient, id: string): Promise<SupplierInvoice> {
    const invoice = await client.query<{
      currency_code: string;
      id: string;
      invoice_date: string;
      invoice_number: string;
      purchase_order_id: string;
      recorded_at: string;
      supplier_name: string;
      supplier_partner_id: string;
      total: string;
    }>(
      `SELECT invoice.id, invoice.purchase_order_id, invoice.supplier_partner_id,
              supplier.display_name AS supplier_name,
              invoice.supplier_invoice_number AS invoice_number,
              invoice.invoice_date::text, invoice.currency_code, invoice.recorded_at::text,
              COALESCE(sum(line.line_total), 0)::text AS total
       FROM procurement.supplier_invoices invoice
       JOIN master_data.partners supplier ON supplier.id = invoice.supplier_partner_id
       LEFT JOIN procurement.supplier_invoice_lines line ON line.supplier_invoice_id = invoice.id
       WHERE invoice.id = $1
       GROUP BY invoice.id, supplier.display_name`,
      [id],
    );
    const row = invoice.rows[0];
    if (!row)
      throw new ApiErrorException(
        'SUPPLIER_INVOICE_NOT_FOUND',
        'The supplier invoice was not found',
        HttpStatus.NOT_FOUND,
      );
    const lines = await client.query<{
      id: string;
      line_total: string;
      order_line_id: string;
      product_id: string;
      product_name: string;
      quantity: string;
      unit_price: string;
    }>(
      `SELECT line.id, line.purchase_order_line_id AS order_line_id,
              order_line.product_id, product.name AS product_name,
              line.quantity::text, line.unit_price::text, line.line_total::text
       FROM procurement.supplier_invoice_lines line
       JOIN procurement.purchase_order_lines order_line ON order_line.id = line.purchase_order_line_id
       JOIN master_data.products product ON product.id = order_line.product_id
       WHERE line.supplier_invoice_id = $1 ORDER BY product.name, line.id`,
      [id],
    );
    return {
      currencyCode: row.currency_code,
      id: row.id,
      invoiceDate: row.invoice_date,
      invoiceNumber: row.invoice_number,
      lines: lines.rows.map(invoiceLine),
      purchaseOrderId: row.purchase_order_id,
      recordedAt: row.recorded_at,
      supplierName: row.supplier_name,
      supplierPartnerId: row.supplier_partner_id,
      total: row.total,
    };
  }

  private async loadClaim(client: PoolClient, id: string): Promise<SupplierClaim> {
    const claim = await client.query<{
      claim_type: SupplierClaim['type'];
      created_at: string;
      description: string;
      goods_receipt_id: string;
      goods_receipt_line_id: string;
      id: string;
      product_id: string;
      product_name: string;
      purchase_order_id: string;
      quantity: string;
      status: SupplierClaimStatus;
      supplier_name: string;
      supplier_partner_id: string;
      updated_at: string;
      version: number;
    }>(
      `SELECT claim.id, claim.supplier_partner_id, supplier.display_name AS supplier_name,
              claim.purchase_order_id, claim.goods_receipt_id, claim.goods_receipt_line_id,
              order_line.product_id, product.name AS product_name, claim.claim_type,
              claim.quantity::text, claim.description, claim.status, claim.version,
              claim.created_at::text, claim.updated_at::text
       FROM procurement.supplier_claims claim
       JOIN master_data.partners supplier ON supplier.id = claim.supplier_partner_id
       JOIN procurement.goods_receipt_lines receipt_line ON receipt_line.id = claim.goods_receipt_line_id
       JOIN procurement.purchase_order_lines order_line ON order_line.id = receipt_line.purchase_order_line_id
       JOIN master_data.products product ON product.id = order_line.product_id
       WHERE claim.id = $1`,
      [id],
    );
    const row = claim.rows[0];
    if (!row)
      throw new ApiErrorException(
        'SUPPLIER_CLAIM_NOT_FOUND',
        'The supplier claim was not found',
        HttpStatus.NOT_FOUND,
      );
    const history = await client.query<{
      changed_at: string;
      changed_by: string;
      from_status: SupplierClaimStatus | null;
      id: string;
      note: string | null;
      to_status: SupplierClaimStatus;
    }>(
      `SELECT id, from_status, to_status, note, changed_by, changed_at::text
       FROM procurement.supplier_claim_status_history
       WHERE supplier_claim_id = $1 ORDER BY changed_at, id`,
      [id],
    );
    return {
      createdAt: row.created_at,
      description: row.description,
      goodsReceiptId: row.goods_receipt_id,
      goodsReceiptLineId: row.goods_receipt_line_id,
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      purchaseOrderId: row.purchase_order_id,
      quantity: row.quantity,
      status: row.status,
      statusHistory: history.rows.map(statusEvent),
      supplierName: row.supplier_name,
      supplierPartnerId: row.supplier_partner_id,
      type: row.claim_type,
      updatedAt: row.updated_at,
      version: row.version,
    };
  }

  private async requireSupplier(client: PoolClient, supplierId: string) {
    const result = await client.query(
      `SELECT partner.id FROM master_data.partners partner
       JOIN master_data.partner_roles role ON role.partner_id = partner.id
       WHERE partner.id = $1 AND partner.active AND role.role = 'supplier'
       FOR KEY SHARE OF partner`,
      [supplierId],
    );
    if (!result.rowCount)
      throw new ApiErrorException(
        'SUPPLIER_NOT_FOUND',
        'The selected supplier was not found or is inactive',
        HttpStatus.NOT_FOUND,
      );
  }

  private async command<T>(
    scope: string,
    key: string | undefined,
    payload: object,
    action: (client: PoolClient, idempotencyKey: string) => Promise<T>,
  ): Promise<T> {
    const idempotencyKey = validKey(key);
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claimCommand(client, scope, idempotencyKey, hash);
      if (replay) {
        await client.query('COMMIT');
        return replay as T;
      }
      const result = await action(client, idempotencyKey);
      await client.query(
        `UPDATE platform.idempotency_keys
         SET status = 'completed', response_status = 201, response_body = $3
         WHERE scope = $1 AND idempotency_key = $2`,
        [scope, idempotencyKey, result],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error))
        throw new ApiErrorException(
          'PROCUREMENT_CONFLICT',
          'This supplier reference already exists',
          HttpStatus.CONFLICT,
        );
      throw error;
    } finally {
      client.release();
    }
  }

  private async sideEffects(
    client: PoolClient,
    targetType: string,
    targetId: string,
    eventType: string,
    payload: object,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    idempotencyKey: string,
  ) {
    await client.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
      [
        randomUUID(),
        targetType,
        targetId,
        eventType,
        metadata.correlationId,
        `${eventType}:${idempotencyKey}`,
        payload,
      ],
    );
    await this.audit.append(
      {
        action: eventType,
        actorAccountId: auth.accountId,
        after: payload as Record<string, unknown>,
        correlationId: metadata.correlationId,
        ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
        targetId,
        targetType,
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
      client,
    );
  }
}

function normalizeInvoice(input: CreateSupplierInvoiceRequest) {
  const lineIds = input.lines.map((line) => line.orderLineId);
  if (new Set(lineIds).size !== lineIds.length)
    throw new ApiErrorException(
      'SUPPLIER_INVOICE_LINE_DUPLICATE',
      'Each purchase-order line can appear only once on an invoice',
      HttpStatus.BAD_REQUEST,
    );
  return {
    invoiceDate: calendarDate(input.invoiceDate),
    invoiceNumber: requiredText(input.invoiceNumber, 'Invoice number', 120),
    lines: input.lines.map((line) => ({
      orderLineId: line.orderLineId,
      quantity: positiveDecimal(line.quantity),
      unitPrice: money(line.unitPrice),
    })),
    purchaseOrderId: input.purchaseOrderId,
  };
}

function invoiceLine(row: {
  id: string;
  line_total: string;
  order_line_id: string;
  product_id: string;
  product_name: string;
  quantity: string;
  unit_price: string;
}): SupplierInvoiceLine {
  return {
    id: row.id,
    lineTotal: row.line_total,
    orderLineId: row.order_line_id,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    unitPrice: row.unit_price,
  };
}

function statusEvent(row: {
  changed_at: string;
  changed_by: string;
  from_status: SupplierClaimStatus | null;
  id: string;
  note: string | null;
  to_status: SupplierClaimStatus;
}): SupplierClaimStatusEvent {
  return {
    changedAt: row.changed_at,
    changedByAccountId: row.changed_by,
    ...(row.from_status ? { fromStatus: row.from_status } : {}),
    id: row.id,
    ...(row.note ? { note: row.note } : {}),
    toStatus: row.to_status,
  };
}

function nextClaimStatus(status: SupplierClaimStatus): SupplierClaimStatus | undefined {
  const transitions: Partial<Record<SupplierClaimStatus, SupplierClaimStatus>> = {
    open: 'submitted',
    resolved: 'closed',
    submitted: 'resolved',
  };
  return transitions[status];
}

function requiredText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum)
    throw new ApiErrorException(
      'TEXT_INVALID',
      `${label} is required and must contain no more than ${maximum} characters`,
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function calendarDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new ApiErrorException(
      'DATE_INVALID',
      'Enter a valid calendar date',
      HttpStatus.BAD_REQUEST,
    );
  return value;
}

function positiveDecimal(value: string): string {
  const normalized = decimal(value);
  if (decimalUnits(normalized) <= 0n)
    throw new ApiErrorException(
      'QUANTITY_INVALID',
      'Quantity must be greater than zero',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function money(value: string): string {
  const normalized = decimal(value);
  if (decimalUnits(normalized) < 0n)
    throw new ApiErrorException(
      'MONEY_INVALID',
      'Amount cannot be negative',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function decimal(value: string): string {
  if (!/^\d+(\.\d{1,4})?$/u.test(value))
    throw new ApiErrorException(
      'DECIMAL_INVALID',
      'Enter a number with no more than four decimal places',
      HttpStatus.BAD_REQUEST,
    );
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(4, '0')}`;
}

function decimalUnits(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole ?? '0') * 10_000n + BigInt(fraction.padEnd(4, '0').slice(0, 4));
}

function validKey(key: string | undefined): string {
  const normalized = key?.trim();
  if (!normalized || normalized.length > 200)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

async function claimCommand(client: PoolClient, scope: string, key: string, hash: string) {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (
       scope, idempotency_key, request_hash, status, expires_at
     ) VALUES ($1, $2, $3, 'processing', now() + interval '24 hours')
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, hash],
  );
  if (inserted.rowCount) return undefined;
  const existing = await client.query<ClaimedCommand>(
    `SELECT request_hash, status, response_body FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== hash)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_CONFLICT',
      'The idempotency key was already used for another request',
      HttpStatus.CONFLICT,
    );
  if (row.status === 'completed' && isRecord(row.response_body)) return row.response_body;
  throw new ApiErrorException(
    'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    'The original request is still being processed',
    HttpStatus.CONFLICT,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
