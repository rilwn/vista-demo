import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CancelFinancialDocumentRequest,
  CreateFinancialDocumentLineRequest,
  CreateFinancialDocumentRequest,
  FinancialDocument,
  FinancialDocumentCorrectionReference,
  FinancialDocumentPage,
  FinancialDocumentReferenceData,
  FinancialDocumentStatus,
  FinancialDocumentType,
  VatTreatment,
} from '@vista/contracts';
import type { AppEnvironment } from '@vista/config';
import { calculateFinancialDocument } from '@vista/domain';
import type { PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import type { FinancialDocumentListQueryDto } from './financial-documents.dto.js';

interface HeaderRow {
  bgn_gross_total: string;
  bgn_net_total: string;
  bgn_vat_total: string;
  branch_name: string;
  business_location_id: string;
  business_location_name: string;
  cancellation_reason: string | null;
  cash_register_name: string | null;
  correction_of_document_id: string | null;
  correction_reason: string | null;
  created_at: string | Date;
  currency_code: string;
  customer_address: string;
  customer_name: string;
  customer_partner_id: string;
  customer_uic: string | null;
  customer_vat_number: string | null;
  document_type: FinancialDocumentType;
  draft_number: string;
  due_date: string | null;
  exchange_rate: string;
  gross_total: string;
  id: string;
  issue_date: string;
  issuer_address: string;
  issuer_name: string;
  issuer_uic: string | null;
  issuer_vat_number: string | null;
  legal_entity_id: string;
  net_total: string;
  notes: string | null;
  official_number: string | null;
  operator_name: string | null;
  rate_date: string;
  rate_source: string;
  source_invoice_number: string | null;
  source_sales_invoice_id: string | null;
  status: FinancialDocumentStatus;
  tax_event_date: string;
  vat_total: string;
  version: number;
}

interface LineRow {
  description: string;
  discount_percent: string;
  gross_total: string;
  id: string;
  line_number: number;
  net_total: string;
  product_id: string | null;
  quantity: string;
  unit_code: string;
  unit_price: string;
  vat_amount: string;
  vat_rate: string;
  vat_treatment: VatTreatment;
}

@Injectable()
export class FinancialDocumentsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async referenceData(): Promise<FinancialDocumentReferenceData> {
    const pool = this.database.getPool();
    const [scopes, customers, products, salesHeaders, salesLines, corrections] = await Promise.all([
      pool.query<{
        branch_id: string;
        branch_name: string;
        legal_entity_id: string;
        legal_entity_name: string;
        location_id: string;
        location_name: string;
      }>(
        `SELECT branch.id AS branch_id, branch.name AS branch_name,
                entity.id AS legal_entity_id, entity.name AS legal_entity_name,
                location.id AS location_id, location.name AS location_name
         FROM organization.business_locations location
         JOIN organization.branches branch ON branch.id = location.branch_id
         JOIN organization.legal_entities entity ON entity.id = branch.legal_entity_id
         WHERE location.active AND branch.active AND entity.active
         ORDER BY entity.name, branch.name, location.name, location.id`,
      ),
      pool.query<{ id: string; name: string; uic: string | null; vat_number: string | null }>(
        `SELECT partner.id, partner.display_name AS name, partner.uic, partner.vat_number
         FROM master_data.partners partner
         JOIN master_data.partner_roles role ON role.partner_id = partner.id AND role.role = 'customer'
         WHERE partner.active ORDER BY partner.display_name, partner.id`,
      ),
      pool.query<{
        code: string;
        id: string;
        name: string;
        unit_code: string;
        unit_name: string;
      }>(
        `SELECT product.id, product.product_code AS code, product.name,
                unit.code AS unit_code, unit.name AS unit_name
         FROM master_data.products product
         JOIN master_data.units unit ON unit.id = product.unit_id
         WHERE product.active AND unit.active ORDER BY product.name, product.id`,
      ),
      pool.query<{
        currency_code: string;
        customer_name: string;
        customer_partner_id: string;
        id: string;
        invoice_number: string;
        linked_document_types: FinancialDocumentType[];
        total: string;
      }>(
        `SELECT invoice.id, invoice.invoice_number, invoice.customer_partner_id,
                customer.display_name AS customer_name, invoice.currency_code,
                invoice.total::text,
                coalesce(array_agg(document.document_type ORDER BY document.document_type)
                  FILTER (WHERE document.id IS NOT NULL), '{}'::varchar[]) AS linked_document_types
         FROM sales.invoices invoice
         JOIN master_data.partners customer ON customer.id = invoice.customer_partner_id
         LEFT JOIN finance.financial_documents document
           ON document.source_sales_invoice_id = invoice.id AND document.status = 'draft'
         WHERE invoice.status = 'draft'
         GROUP BY invoice.id, customer.display_name
         ORDER BY invoice.recorded_at DESC, invoice.id DESC`,
      ),
      pool.query<{
        description: string;
        discount_percent: string;
        invoice_id: string;
        product_id: string;
        quantity: string;
        unit_code: string;
        unit_price: string;
        vat_treatment: VatTreatment;
      }>(
        `SELECT line.invoice_id, line.product_id, product.name AS description,
                line.quantity::text, line.unit_price::text, line.vat_treatment, unit.code AS unit_code,
                round(100 - ((100 - quotation_line.discount_percent)
                  * (100 - quotation.overall_discount_percent) / 100), 4)::text AS discount_percent
         FROM sales.invoice_lines line
         JOIN sales.quotation_lines quotation_line ON quotation_line.id = line.quotation_line_id
         JOIN sales.quotations quotation ON quotation.id = quotation_line.quotation_id
         JOIN master_data.products product ON product.id = line.product_id
         JOIN master_data.units unit ON unit.id = product.unit_id
         ORDER BY line.invoice_id, line.id`,
      ),
      pool.query<{
        currency_code: string;
        customer_name: string;
        customer_partner_id: string;
        document_type: 'invoice';
        draft_number: string;
        id: string;
      }>(
        `SELECT document.id, document.draft_number, document.document_type,
                document.customer_partner_id, document.customer_name, document.currency_code
         FROM finance.financial_documents document
         WHERE document.document_type = 'invoice' AND document.status = 'draft'
         ORDER BY document.issue_date DESC, document.id DESC`,
      ),
    ]);
    const scopeIds = scopes.rows.map((scope) => scope.location_id);
    const [registers, operators] = scopeIds.length
      ? await Promise.all([
          pool.query<{ business_location_id: string; id: string; name: string }>(
            `SELECT id, business_location_id, name FROM organization.cash_registers
             WHERE active AND business_location_id = ANY($1::uuid[]) ORDER BY name, id`,
            [scopeIds],
          ),
          pool.query<{ business_location_id: string; id: string; name: string }>(
            `SELECT operator.id, operator.business_location_id, employee.display_name AS name
             FROM organization.operators operator
             JOIN identity.user_accounts account ON account.id = operator.account_id
             JOIN identity.employees employee ON employee.id = account.employee_id
             WHERE operator.active AND account.status = 'active'
               AND operator.business_location_id = ANY($1::uuid[])
             ORDER BY employee.display_name, operator.id`,
            [scopeIds],
          ),
        ])
      : [{ rows: [] }, { rows: [] }];
    return {
      businessTimezone: this.environment.BUSINESS_TIMEZONE,
      correctionDocuments: corrections.rows.map((row) => ({
        currencyCode: row.currency_code,
        customerName: row.customer_name,
        customerPartnerId: row.customer_partner_id,
        id: row.id,
        number: row.draft_number,
        type: 'invoice',
      })),
      customers: customers.rows.map((row) => ({
        id: row.id,
        name: row.name,
        ...(row.uic ? { uic: row.uic } : {}),
        ...(row.vat_number ? { vatNumber: row.vat_number } : {}),
      })),
      products: products.rows.map((row) => ({
        code: row.code,
        id: row.id,
        name: row.name,
        unitCode: row.unit_code,
        unitName: row.unit_name,
      })),
      salesDrafts: salesHeaders.rows.map((row) => ({
        currencyCode: row.currency_code,
        customerName: row.customer_name,
        customerPartnerId: row.customer_partner_id,
        id: row.id,
        linkedDocumentTypes: row.linked_document_types,
        lines: salesLines.rows
          .filter((line) => line.invoice_id === row.id)
          .map((line) => ({
            description: line.description,
            discountPercent: line.discount_percent,
            productId: line.product_id,
            quantity: line.quantity,
            unitCode: line.unit_code,
            unitPrice: line.unit_price,
            vatTreatment: line.vat_treatment,
          })),
        number: row.invoice_number,
        total: row.total,
      })),
      scopes: scopes.rows.map((scope) => ({
        branchId: scope.branch_id,
        branchName: scope.branch_name,
        cashRegisters: registers.rows
          .filter((register) => register.business_location_id === scope.location_id)
          .map(({ id, name }) => ({ id, name })),
        legalEntityId: scope.legal_entity_id,
        legalEntityName: scope.legal_entity_name,
        locationId: scope.location_id,
        locationName: scope.location_name,
        operators: operators.rows
          .filter((operator) => operator.business_location_id === scope.location_id)
          .map(({ id, name }) => ({ id, name })),
      })),
    };
  }

  async list(query: FinancialDocumentListQueryDto): Promise<FinancialDocumentPage> {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 25);
    const filters: string[] = [];
    const values: unknown[] = [];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    if (query.status) filters.push(`document.status = ${add(query.status)}`);
    if (query.type) filters.push(`document.document_type = ${add(query.type)}`);
    if (query.customerPartnerId)
      filters.push(`document.customer_partner_id = ${add(query.customerPartnerId)}`);
    if (query.dateFrom) filters.push(`document.issue_date >= ${add(query.dateFrom)}`);
    if (query.dateTo) filters.push(`document.issue_date <= ${add(query.dateTo)}`);
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const count = await this.database
      .getPool()
      .query<{ count: string }>(
        `SELECT count(*)::text AS count FROM finance.financial_documents document ${where}`,
        values,
      );
    const totalItems = Number(count.rows[0]?.count ?? 0);
    const offset = (page - 1) * pageSize;
    const ids = await this.database.getPool().query<{ id: string }>(
      `SELECT document.id FROM finance.financial_documents document ${where}
       ORDER BY document.issue_date DESC, document.created_at DESC, document.id DESC
       LIMIT ${add(pageSize)} OFFSET ${add(offset)}`,
      values,
    );
    return {
      items: await Promise.all(ids.rows.map(({ id }) => this.document(id))),
      page,
      pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    };
  }

  async document(id: string): Promise<FinancialDocument> {
    const client = await this.database.getPool().connect();
    try {
      return await this.loadDocument(client, id);
    } finally {
      client.release();
    }
  }

  async create(
    input: CreateFinancialDocumentRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinancialDocument> {
    const normalized = normalizeInput(input);
    return this.command(
      'finance.financial-document.create',
      key,
      normalized,
      201,
      async (client, commandKey) => {
        const scope = await requireScope(client, normalized);
        const customer = await requireCustomer(client, normalized.customerPartnerId);
        const correction = await requireCorrection(client, normalized);
        const lines = normalized.sourceSalesInvoiceId
          ? await salesDraftLines(client, normalized, customer.id)
          : await manualLines(client, normalized.lines ?? []);
        if (!lines.length)
          throw inputError('FINANCE_DOCUMENT_LINES_REQUIRED', 'Add at least one document line.');
        let calculation;
        try {
          calculation = calculateFinancialDocument(lines, normalized.exchangeRate);
        } catch (error) {
          throw inputError(
            'FINANCE_DOCUMENT_CALCULATION_INVALID',
            error instanceof Error ? error.message : 'The document totals could not be calculated.',
          );
        }
        const id = randomUUID();
        const number = await nextDraftNumber(client, normalized, scope.locationCode);
        await client.query(
          `INSERT INTO finance.financial_documents (
           id, draft_number, document_type, legal_entity_id, branch_id, business_location_id,
           cash_register_id, operator_id, customer_partner_id, source_sales_invoice_id,
           correction_of_document_id, correction_reason, issue_date, tax_event_date, due_date,
           currency_code, exchange_rate, rate_date, rate_source,
           issuer_name, issuer_uic, issuer_vat_number, issuer_address,
           customer_name, customer_uic, customer_vat_number, customer_address,
           net_total, vat_total, gross_total, bgn_net_total, bgn_vat_total, bgn_gross_total,
           notes, created_by
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
           $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35
         )`,
          [
            id,
            number,
            normalized.documentType,
            scope.legalEntityId,
            scope.branchId,
            normalized.businessLocationId,
            normalized.cashRegisterId ?? null,
            normalized.operatorId ?? null,
            customer.id,
            normalized.sourceSalesInvoiceId ?? null,
            correction?.id ?? null,
            normalized.correctionReason ?? null,
            normalized.issueDate,
            normalized.taxEventDate,
            normalized.dueDate ?? null,
            normalized.currencyCode,
            normalized.exchangeRate,
            normalized.rateDate,
            normalized.rateSource,
            scope.issuerName,
            scope.issuerUic,
            scope.issuerVatNumber,
            scope.issuerAddress,
            customer.name,
            customer.uic,
            customer.vatNumber,
            customer.address,
            calculation.netTotal,
            calculation.vatTotal,
            calculation.grossTotal,
            calculation.bgnNetTotal,
            calculation.bgnVatTotal,
            calculation.bgnGrossTotal,
            normalized.notes ?? null,
            auth.accountId,
          ],
        );
        for (const [index, line] of lines.entries()) {
          const calculated = calculation.lines[index];
          if (!calculated) throw new Error('Financial line calculation mismatch');
          await client.query(
            `INSERT INTO finance.financial_document_lines (
             id, financial_document_id, line_number, product_id, description, unit_code,
             quantity, unit_price, discount_percent, vat_treatment, vat_rate,
             net_total, vat_amount, gross_total
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              randomUUID(),
              id,
              index + 1,
              line.productId ?? null,
              line.description,
              line.unitCode,
              calculated.quantity,
              calculated.unitPrice,
              calculated.discountPercent,
              calculated.vatTreatment,
              calculated.vatRate,
              calculated.netTotal,
              calculated.vatAmount,
              calculated.grossTotal,
            ],
          );
        }
        for (const summary of calculation.vatSummary) {
          await client.query(
            `INSERT INTO finance.financial_document_vat_summary (
             id, financial_document_id, vat_treatment, vat_rate, net_total, vat_amount
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              randomUUID(),
              id,
              summary.vatTreatment,
              summary.vatRate,
              summary.netTotal,
              summary.vatAmount,
            ],
          );
        }
        const document = await this.loadDocument(client, id);
        await this.sideEffects(
          client,
          id,
          'finance.financial-document.draft-created',
          document,
          auth,
          metadata,
          commandKey,
        );
        return document;
      },
    );
  }

  async cancel(
    id: string,
    input: CancelFinancialDocumentRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinancialDocument> {
    const reason = input.cancellationReason.trim();
    if (!reason)
      throw inputError(
        'FINANCE_DOCUMENT_CANCELLATION_REASON_REQUIRED',
        'Enter a cancellation reason.',
      );
    return this.command(
      `finance.financial-document.cancel:${id}`,
      key,
      { ...input, cancellationReason: reason },
      200,
      async (client, commandKey) => {
        const before = await this.loadDocument(client, id, true);
        if (before.version !== input.expectedVersion)
          throw new ApiErrorException(
            'FINANCE_DOCUMENT_VERSION_CONFLICT',
            'This document changed after it was opened. Refresh and try again.',
            HttpStatus.CONFLICT,
          );
        if (before.status === 'cancelled') return before;
        await client.query(
          `UPDATE finance.financial_documents
         SET status = 'cancelled', cancellation_reason = $2, cancelled_at = now(),
             cancelled_by = $3, version = version + 1, updated_at = now()
         WHERE id = $1`,
          [id, reason, auth.accountId],
        );
        const document = await this.loadDocument(client, id);
        await this.sideEffects(
          client,
          id,
          'finance.financial-document.draft-cancelled',
          document,
          auth,
          metadata,
          commandKey,
          before,
        );
        return document;
      },
    );
  }

  private async loadDocument(
    client: PoolClient,
    id: string,
    lock = false,
  ): Promise<FinancialDocument> {
    const header = await client.query<HeaderRow>(
      `${headerQuery()} WHERE document.id = $1${lock ? ' FOR UPDATE OF document' : ''}`,
      [id],
    );
    const row = header.rows[0];
    if (!row)
      throw new ApiErrorException(
        'FINANCE_DOCUMENT_NOT_FOUND',
        'The financial document was not found.',
        HttpStatus.NOT_FOUND,
      );
    const lines = await client.query<LineRow>(
      `SELECT id, line_number, product_id, description, unit_code, quantity::text,
              unit_price::text, discount_percent::text, vat_treatment, vat_rate::text,
              net_total::text, vat_amount::text, gross_total::text
       FROM finance.financial_document_lines WHERE financial_document_id = $1
       ORDER BY line_number`,
      [id],
    );
    const summaries = await client.query<{
      net_total: string;
      vat_amount: string;
      vat_rate: string;
      vat_treatment: VatTreatment;
    }>(
      `SELECT vat_treatment, vat_rate::text, net_total::text, vat_amount::text
       FROM finance.financial_document_vat_summary WHERE financial_document_id = $1
       ORDER BY vat_treatment, vat_rate`,
      [id],
    );
    const correction = row.correction_of_document_id
      ? await client.query<{
          currency_code: string;
          customer_name: string;
          customer_partner_id: string;
          document_type: 'invoice';
          draft_number: string;
          id: string;
        }>(
          `SELECT id, draft_number, document_type, customer_partner_id, customer_name, currency_code
           FROM finance.financial_documents WHERE id = $1`,
          [row.correction_of_document_id],
        )
      : { rows: [] };
    const correctionRow = correction.rows[0];
    return {
      bgnGrossTotal: row.bgn_gross_total,
      bgnNetTotal: row.bgn_net_total,
      bgnVatTotal: row.bgn_vat_total,
      branchName: row.branch_name,
      businessLocationId: row.business_location_id,
      businessLocationName: row.business_location_name,
      ...(row.cancellation_reason ? { cancellationReason: row.cancellation_reason } : {}),
      ...(row.cash_register_name ? { cashRegisterName: row.cash_register_name } : {}),
      ...(correctionRow
        ? {
            correctionOf: {
              currencyCode: correctionRow.currency_code,
              customerName: correctionRow.customer_name,
              customerPartnerId: correctionRow.customer_partner_id,
              id: correctionRow.id,
              number: correctionRow.draft_number,
              type: 'invoice',
            } satisfies FinancialDocumentCorrectionReference,
          }
        : {}),
      ...(row.correction_reason ? { correctionReason: row.correction_reason } : {}),
      createdAt: asIso(row.created_at),
      currencyCode: row.currency_code,
      customerPartnerId: row.customer_partner_id,
      customerSnapshot: {
        address: row.customer_address,
        name: row.customer_name,
        ...(row.customer_uic ? { uic: row.customer_uic } : {}),
        ...(row.customer_vat_number ? { vatNumber: row.customer_vat_number } : {}),
      },
      documentType: row.document_type,
      ...(row.due_date ? { dueDate: row.due_date } : {}),
      exchangeRate: row.exchange_rate,
      grossTotal: row.gross_total,
      id: row.id,
      issueDate: row.issue_date,
      issuerSnapshot: {
        address: row.issuer_address,
        name: row.issuer_name,
        ...(row.issuer_uic ? { uic: row.issuer_uic } : {}),
        ...(row.issuer_vat_number ? { vatNumber: row.issuer_vat_number } : {}),
      },
      legalEntityId: row.legal_entity_id,
      lines: lines.rows.map((line) => ({
        description: line.description,
        discountPercent: line.discount_percent,
        grossTotal: line.gross_total,
        id: line.id,
        lineNumber: line.line_number,
        netTotal: line.net_total,
        ...(line.product_id ? { productId: line.product_id } : {}),
        quantity: line.quantity,
        unitCode: line.unit_code,
        unitPrice: line.unit_price,
        vatAmount: line.vat_amount,
        vatRate: line.vat_rate,
        vatTreatment: line.vat_treatment,
      })),
      netTotal: row.net_total,
      ...(row.notes ? { notes: row.notes } : {}),
      number: row.draft_number,
      ...(row.official_number ? { officialNumber: row.official_number } : {}),
      ...(row.operator_name ? { operatorName: row.operator_name } : {}),
      rateDate: row.rate_date,
      rateSource: row.rate_source,
      ...(row.source_sales_invoice_id ? { sourceSalesInvoiceId: row.source_sales_invoice_id } : {}),
      ...(row.source_invoice_number ? { sourceSalesInvoiceNumber: row.source_invoice_number } : {}),
      status: row.status,
      taxEventDate: row.tax_event_date,
      vatSummary: summaries.rows.map((summary) => ({
        netTotal: summary.net_total,
        vatAmount: summary.vat_amount,
        vatRate: summary.vat_rate,
        vatTreatment: summary.vat_treatment,
      })),
      vatTotal: row.vat_total,
      version: row.version,
    };
  }

  private async command<T>(
    scope: string,
    key: string | undefined,
    payload: object,
    responseStatus: number,
    action: (client: PoolClient, key: string) => Promise<T>,
  ): Promise<T> {
    const idempotencyKey = validKey(key);
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claim(client, scope, idempotencyKey, hash);
      if (replay) {
        await client.query('COMMIT');
        return replay as T;
      }
      const result = await action(client, idempotencyKey);
      await client.query(
        `UPDATE platform.idempotency_keys
         SET status = 'completed', response_status = $3, response_body = $4
         WHERE scope = $1 AND idempotency_key = $2`,
        [scope, idempotencyKey, responseStatus, result],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error))
        throw new ApiErrorException(
          'FINANCE_DOCUMENT_CONFLICT',
          'This financial document conflicts with an existing draft.',
          HttpStatus.CONFLICT,
        );
      throw error;
    } finally {
      client.release();
    }
  }

  private async sideEffects(
    client: PoolClient,
    id: string,
    eventType: string,
    document: FinancialDocument,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    idempotencyKey: string,
    before?: FinancialDocument,
  ) {
    const eventKey = createHash('sha256').update(`${eventType}:${idempotencyKey}`).digest('hex');
    await client.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1, 'financial_document', $2, $3, 1, $4, $5, $6)`,
      [randomUUID(), id, eventType, metadata.correlationId, eventKey, document],
    );
    await this.audit.append(
      {
        action: eventType,
        actorAccountId: auth.accountId,
        after: document as unknown as Record<string, unknown>,
        ...(before ? { before: before as unknown as Record<string, unknown> } : {}),
        correlationId: metadata.correlationId,
        ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
        targetId: id,
        targetType: 'financial_document',
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
      client,
    );
  }
}

function normalizeInput(input: CreateFinancialDocumentRequest) {
  const documentType = input.documentType;
  const currencyCode = input.currencyCode.trim().toUpperCase();
  const correctionReason = input.correctionReason?.trim();
  const notes = input.notes?.trim();
  const rateSource = currencyCode === 'BGN' ? 'internal_bgn' : input.rateSource.trim();
  const exchangeRate =
    currencyCode === 'BGN' ? '1.00000000' : normalizeDecimal(input.exchangeRate, 8);
  if (!/^[A-Z]{3}$/u.test(currencyCode))
    throw inputError('FINANCE_CURRENCY_INVALID', 'Currency code must contain three letters.');
  if (decimalUnits(exchangeRate, 8) <= 0n)
    throw inputError('FINANCE_EXCHANGE_RATE_INVALID', 'Exchange rate must be greater than zero.');
  if (!rateSource)
    throw inputError(
      'FINANCE_RATE_SOURCE_REQUIRED',
      'Enter the source of the captured currency rate.',
    );
  const issueDate = normalizeDate(input.issueDate);
  const dueDate = input.dueDate ? normalizeDate(input.dueDate) : undefined;
  if (dueDate && dueDate < issueDate)
    throw inputError('FINANCE_DUE_DATE_INVALID', 'Due date cannot be before the document date.');
  if ((documentType === 'invoice' || documentType === 'proforma') && !dueDate)
    throw inputError('FINANCE_DUE_DATE_REQUIRED', 'Enter a due date for this document.');
  if (documentType === 'credit_note' || documentType === 'debit_note') {
    if (!input.correctionOfDocumentId || !correctionReason)
      throw inputError(
        'FINANCE_CORRECTION_LINK_REQUIRED',
        'Select the original invoice and enter the correction reason.',
      );
  } else if (input.correctionOfDocumentId || correctionReason) {
    throw inputError(
      'FINANCE_CORRECTION_LINK_INVALID',
      'Only credit and debit notes can correct an invoice.',
    );
  }
  if (!input.sourceSalesInvoiceId && !input.lines?.length)
    throw inputError(
      'FINANCE_DOCUMENT_LINES_REQUIRED',
      'Select a prepared Sales draft or add at least one line.',
    );
  return {
    businessLocationId: input.businessLocationId,
    ...(input.cashRegisterId ? { cashRegisterId: input.cashRegisterId } : {}),
    ...(input.correctionOfDocumentId
      ? { correctionOfDocumentId: input.correctionOfDocumentId }
      : {}),
    ...(correctionReason ? { correctionReason } : {}),
    currencyCode,
    customerPartnerId: input.customerPartnerId,
    documentType,
    ...(dueDate ? { dueDate } : {}),
    exchangeRate,
    issueDate,
    legalEntityId: input.legalEntityId,
    ...(input.lines ? { lines: input.lines.map(normalizeLine) } : {}),
    ...(notes ? { notes } : {}),
    ...(input.operatorId ? { operatorId: input.operatorId } : {}),
    rateDate: normalizeDate(input.rateDate),
    rateSource,
    ...(input.sourceSalesInvoiceId ? { sourceSalesInvoiceId: input.sourceSalesInvoiceId } : {}),
    taxEventDate: normalizeDate(input.taxEventDate),
  };
}

function normalizeLine(line: CreateFinancialDocumentLineRequest) {
  const description = line.description.trim();
  const unitCode = line.unitCode.trim().toUpperCase();
  if (!description)
    throw inputError('FINANCE_LINE_DESCRIPTION_REQUIRED', 'Enter a description for every line.');
  if (!unitCode) throw inputError('FINANCE_LINE_UNIT_REQUIRED', 'Enter a unit for every line.');
  return {
    description,
    discountPercent: normalizeDecimal(line.discountPercent, 4),
    ...(line.productId ? { productId: line.productId } : {}),
    quantity: normalizeDecimal(line.quantity, 4),
    unitCode,
    unitPrice: normalizeDecimal(line.unitPrice, 4),
    ...(line.vatRate ? { vatRate: normalizeDecimal(line.vatRate, 4) } : {}),
    vatTreatment: line.vatTreatment,
  };
}

async function requireScope(client: PoolClient, input: ReturnType<typeof normalizeInput>) {
  const result = await client.query<{
    branch_id: string;
    issuer_address: string;
    issuer_name: string;
    issuer_uic: string | null;
    issuer_vat_number: string | null;
    legal_entity_id: string;
    location_code: string;
  }>(
    `SELECT branch.id AS branch_id, entity.id AS legal_entity_id, entity.name AS issuer_name,
            entity.uic AS issuer_uic, entity.vat_number AS issuer_vat_number,
            location.code AS location_code,
            concat_ws(', ', location.address_line_1, nullif(location.address_line_2, ''),
                      concat_ws(' ', nullif(location.postal_code, ''), location.city),
                      location.country_code) AS issuer_address
     FROM organization.business_locations location
     JOIN organization.branches branch ON branch.id = location.branch_id
     JOIN organization.legal_entities entity ON entity.id = branch.legal_entity_id
     WHERE location.id = $1 AND entity.id = $2
       AND location.active AND branch.active AND entity.active FOR KEY SHARE OF location, branch, entity`,
    [input.businessLocationId, input.legalEntityId],
  );
  const row = result.rows[0];
  if (!row)
    throw inputError(
      'FINANCE_DOCUMENT_SCOPE_INVALID',
      'Select an active legal entity and business location from the same branch.',
    );
  if (input.cashRegisterId) {
    const register = await client.query(
      `SELECT id FROM organization.cash_registers
       WHERE id = $1 AND business_location_id = $2 AND active FOR KEY SHARE`,
      [input.cashRegisterId, input.businessLocationId],
    );
    if (!register.rowCount)
      throw inputError(
        'FINANCE_CASH_REGISTER_INVALID',
        'Select an active cash register at this business location.',
      );
  }
  if (input.operatorId) {
    const operator = await client.query(
      `SELECT id FROM organization.operators
       WHERE id = $1 AND business_location_id = $2 AND active FOR KEY SHARE`,
      [input.operatorId, input.businessLocationId],
    );
    if (!operator.rowCount)
      throw inputError(
        'FINANCE_OPERATOR_INVALID',
        'Select an active operator at this business location.',
      );
  }
  return {
    branchId: row.branch_id,
    issuerAddress: row.issuer_address,
    issuerName: row.issuer_name,
    issuerUic: row.issuer_uic,
    issuerVatNumber: row.issuer_vat_number,
    legalEntityId: row.legal_entity_id,
    locationCode: row.location_code,
  };
}

async function requireCustomer(client: PoolClient, id: string) {
  const result = await client.query<{
    address: string | null;
    id: string;
    name: string;
    uic: string | null;
    vat_number: string | null;
  }>(
    `SELECT partner.id, partner.display_name AS name, partner.uic, partner.vat_number,
            address.formatted AS address
     FROM master_data.partners partner
     JOIN master_data.partner_roles role ON role.partner_id = partner.id AND role.role = 'customer'
     LEFT JOIN LATERAL (
       SELECT concat_ws(', ', source.address_line_1, nullif(source.address_line_2, ''),
                        concat_ws(' ', nullif(source.postal_code, ''), source.city),
                        source.country_code) AS formatted
       FROM master_data.partner_addresses source
       WHERE source.partner_id = partner.id AND source.active
       ORDER BY CASE source.address_type WHEN 'billing' THEN 0 WHEN 'registered' THEN 1 ELSE 2 END,
                source.created_at, source.id LIMIT 1
     ) address ON true
     WHERE partner.id = $1 AND partner.active FOR KEY SHARE OF partner`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw inputError('FINANCE_CUSTOMER_INVALID', 'Select an active customer.');
  if (!row.address)
    throw inputError(
      'FINANCE_CUSTOMER_ADDRESS_REQUIRED',
      'Add a billing or registered address to the customer before preparing a financial document.',
    );
  return {
    address: row.address,
    id: row.id,
    name: row.name,
    uic: row.uic,
    vatNumber: row.vat_number,
  };
}

async function requireCorrection(client: PoolClient, input: ReturnType<typeof normalizeInput>) {
  if (!input.correctionOfDocumentId) return undefined;
  const result = await client.query<{
    currency_code: string;
    customer_partner_id: string;
    id: string;
  }>(
    `SELECT id, customer_partner_id, currency_code FROM finance.financial_documents
     WHERE id = $1 AND document_type = 'invoice' AND status = 'draft' FOR KEY SHARE`,
    [input.correctionOfDocumentId],
  );
  const row = result.rows[0];
  if (!row)
    throw inputError(
      'FINANCE_CORRECTION_SOURCE_INVALID',
      'Select an available original invoice draft.',
    );
  if (
    row.customer_partner_id !== input.customerPartnerId ||
    row.currency_code !== input.currencyCode
  )
    throw inputError(
      'FINANCE_CORRECTION_CONTEXT_MISMATCH',
      'A correction must use the original invoice customer and currency.',
    );
  return row;
}

async function salesDraftLines(
  client: PoolClient,
  input: ReturnType<typeof normalizeInput>,
  customerId: string,
) {
  if (input.documentType === 'credit_note' || input.documentType === 'debit_note')
    throw inputError(
      'FINANCE_CORRECTION_SALES_SOURCE_INVALID',
      'Correction notes must use the original Finance invoice link, not a Sales draft.',
    );
  const header = await client.query<{ currency_code: string; customer_partner_id: string }>(
    `SELECT customer_partner_id, currency_code FROM sales.invoices
     WHERE id = $1 AND status = 'draft' FOR KEY SHARE`,
    [input.sourceSalesInvoiceId],
  );
  const row = header.rows[0];
  if (!row)
    throw inputError('FINANCE_SALES_DRAFT_INVALID', 'Select an available Sales invoice draft.');
  if (row.customer_partner_id !== customerId || row.currency_code !== input.currencyCode)
    throw inputError(
      'FINANCE_SALES_DRAFT_CONTEXT_MISMATCH',
      'The customer and currency must match the selected Sales draft.',
    );
  const lines = await client.query<{
    description: string;
    discount_percent: string;
    product_id: string;
    quantity: string;
    unit_code: string;
    unit_price: string;
    vat_treatment: VatTreatment;
  }>(
    `SELECT line.product_id, product.name AS description, unit.code AS unit_code,
            line.quantity::text, line.unit_price::text, line.vat_treatment,
            round(100 - ((100 - quotation_line.discount_percent)
              * (100 - quotation.overall_discount_percent) / 100), 4)::text AS discount_percent
     FROM sales.invoice_lines line
     JOIN sales.quotation_lines quotation_line ON quotation_line.id = line.quotation_line_id
     JOIN sales.quotations quotation ON quotation.id = quotation_line.quotation_id
     JOIN master_data.products product ON product.id = line.product_id
     JOIN master_data.units unit ON unit.id = product.unit_id
     WHERE line.invoice_id = $1 ORDER BY line.id`,
    [input.sourceSalesInvoiceId],
  );
  return lines.rows.map((line) => ({
    description: line.description,
    discountPercent: normalizeDecimal(line.discount_percent, 4),
    productId: line.product_id,
    quantity: normalizeDecimal(line.quantity, 4),
    unitCode: line.unit_code,
    unitPrice: normalizeDecimal(line.unit_price, 4),
    vatTreatment: line.vat_treatment,
  }));
}

async function manualLines(client: PoolClient, lines: ReturnType<typeof normalizeLine>[]) {
  const productIds = lines.flatMap((line) => (line.productId ? [line.productId] : []));
  if (!productIds.length) return lines;
  const products = await client.query<{ id: string; name: string; unit_code: string }>(
    `SELECT product.id, product.name, unit.code AS unit_code
     FROM master_data.products product JOIN master_data.units unit ON unit.id = product.unit_id
     WHERE product.id = ANY($1::uuid[]) AND product.active AND unit.active FOR KEY SHARE OF product, unit`,
    [productIds],
  );
  if (products.rowCount !== new Set(productIds).size)
    throw inputError(
      'FINANCE_PRODUCT_INVALID',
      'One or more selected products are inactive or unavailable.',
    );
  return lines.map((line) => {
    if (!line.productId) return line;
    const product = products.rows.find(({ id }) => id === line.productId);
    if (!product)
      throw inputError('FINANCE_PRODUCT_INVALID', 'The selected product is unavailable.');
    return { ...line, description: product.name, unitCode: product.unit_code };
  });
}

async function nextDraftNumber(
  client: PoolClient,
  input: ReturnType<typeof normalizeInput>,
  locationCode: string,
) {
  const year = Number(input.issueDate.slice(0, 4));
  await client.query(
    `INSERT INTO finance.draft_document_sequences (
       business_location_id, cash_register_id, operator_id, document_type, sequence_year
     ) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [
      input.businessLocationId,
      input.cashRegisterId ?? null,
      input.operatorId ?? null,
      input.documentType,
      year,
    ],
  );
  const result = await client.query<{ allocated: string }>(
    `UPDATE finance.draft_document_sequences SET next_value = next_value + 1
     WHERE business_location_id = $1
       AND cash_register_id IS NOT DISTINCT FROM $2::uuid
       AND operator_id IS NOT DISTINCT FROM $3::uuid
       AND document_type = $4 AND sequence_year = $5
     RETURNING (next_value - 1)::text AS allocated`,
    [
      input.businessLocationId,
      input.cashRegisterId ?? null,
      input.operatorId ?? null,
      input.documentType,
      year,
    ],
  );
  const allocated = result.rows[0]?.allocated;
  if (!allocated) throw new Error('Draft sequence allocation failed');
  const prefix = { credit_note: 'DCN', debit_note: 'DDN', invoice: 'DINV', proforma: 'DPRO' }[
    input.documentType
  ];
  return `${prefix}-${locationCode}-${year}-${allocated.padStart(6, '0')}`;
}

function headerQuery() {
  return `SELECT document.id, document.draft_number, document.official_number,
                 document.document_type, document.status, document.legal_entity_id,
                 document.business_location_id, branch.name AS branch_name,
                 location.name AS business_location_name, register.name AS cash_register_name,
                 employee.display_name AS operator_name, document.customer_partner_id,
                 document.source_sales_invoice_id, source.invoice_number AS source_invoice_number,
                 document.correction_of_document_id, document.correction_reason,
                 document.issue_date::text, document.tax_event_date::text, document.due_date::text,
                 document.currency_code, document.exchange_rate::text, document.rate_date::text,
                 document.rate_source, document.issuer_name, document.issuer_uic,
                 document.issuer_vat_number, document.issuer_address, document.customer_name,
                 document.customer_uic, document.customer_vat_number, document.customer_address,
                 document.net_total::text, document.vat_total::text, document.gross_total::text,
                 document.bgn_net_total::text, document.bgn_vat_total::text,
                 document.bgn_gross_total::text, document.notes, document.cancellation_reason,
                 document.version, document.created_at
          FROM finance.financial_documents document
          JOIN organization.business_locations location ON location.id = document.business_location_id
          JOIN organization.branches branch ON branch.id = document.branch_id
          LEFT JOIN organization.cash_registers register ON register.id = document.cash_register_id
          LEFT JOIN organization.operators operator ON operator.id = document.operator_id
          LEFT JOIN identity.user_accounts account ON account.id = operator.account_id
          LEFT JOIN identity.employees employee ON employee.id = account.employee_id
          LEFT JOIN sales.invoices source ON source.id = document.source_sales_invoice_id`;
}

function normalizeDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw inputError('FINANCE_DATE_INVALID', 'Enter a valid calendar date.');
  return value;
}

function normalizeDecimal(value: string, scale: number) {
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`, 'u');
  if (!pattern.test(value))
    throw inputError(
      'FINANCE_DECIMAL_INVALID',
      `Enter a non-negative number with no more than ${scale} decimal places.`,
    );
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(scale, '0')}`;
}

function decimalUnits(value: string, scale: number) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(scale, '0')}`);
}

function inputError(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.BAD_REQUEST);
}

function validKey(key: string | undefined) {
  const normalized = key?.trim();
  if (!normalized || normalized.length > 200)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required.',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

async function claim(client: PoolClient, scope: string, key: string, hash: string) {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (scope, idempotency_key, request_hash, status, expires_at)
     VALUES ($1,$2,$3,'processing',now() + interval '24 hours')
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, hash],
  );
  if (inserted.rowCount) return undefined;
  const existing = await client.query<{
    request_hash: string;
    response_body: object | null;
    status: string;
  }>(
    `SELECT request_hash, status, response_body FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== hash)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used with different data.',
      HttpStatus.CONFLICT,
    );
  if (row.status === 'completed' && row.response_body) return row.response_body;
  throw new ApiErrorException(
    'IDEMPOTENT_REQUEST_IN_PROGRESS',
    'This request is already being processed.',
    HttpStatus.CONFLICT,
  );
}

function isUniqueViolation(error: unknown): error is { code: '23505' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function asIso(value: string | Date) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
