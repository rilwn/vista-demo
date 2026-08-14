import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CancelFinanceCustomerDocumentRequest,
  CreateFinanceCustomerDocumentRequest,
  CreateFinancePaymentRequest,
  FinanceCustomerDocument,
  FinancePayment,
  FinancePaymentMethod,
  FinancePaymentStatus,
  FinancePaymentStatusHistoryEntry,
  FinanceReferenceData,
  FinanceSummary,
} from '@vista/contracts';
import type { AppEnvironment } from '@vista/config';
import type { PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import type { BackgroundJobContext } from '../jobs/job-handler-registry.service.js';

interface DocumentRow {
  allocated_total: string;
  bgn_total: string;
  created_at: string | Date;
  currency_code: string;
  customer_name: string;
  customer_partner_id: string;
  document_date: string;
  document_number: string;
  due_date: string;
  exchange_rate: string;
  id: string;
  outstanding_total: string;
  payment_status: FinancePaymentStatus;
  rate_date: string;
  rate_source: string;
  review_state: FinanceCustomerDocument['reviewState'];
  source_invoice_number: string;
  source_sales_invoice_id: string;
  total: string;
  version: number;
}

@Injectable()
export class FinanceService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async referenceData(): Promise<FinanceReferenceData> {
    const result = await this.database.getPool().query<{
      currency_code: string;
      customer_name: string;
      customer_partner_id: string;
      id: string;
      invoice_number: string;
      recorded_at: string | Date;
      total: string;
    }>(
      `SELECT invoice.id, invoice.invoice_number, invoice.customer_partner_id,
              customer.display_name AS customer_name, invoice.currency_code,
              invoice.total::text, invoice.recorded_at
       FROM sales.invoices invoice
       JOIN master_data.partners customer ON customer.id = invoice.customer_partner_id
       LEFT JOIN finance.customer_documents document
         ON document.source_sales_invoice_id = invoice.id
       WHERE invoice.status = 'draft' AND invoice.currency_code = 'BGN' AND document.id IS NULL
       ORDER BY invoice.recorded_at DESC, invoice.id DESC`,
    );
    return {
      invoiceDrafts: result.rows.map((row) => ({
        currencyCode: row.currency_code,
        customerName: row.customer_name,
        customerPartnerId: row.customer_partner_id,
        id: row.id,
        number: row.invoice_number,
        recordedAt: asIso(row.recorded_at),
        total: row.total,
      })),
    };
  }

  async documents(): Promise<FinanceCustomerDocument[]> {
    const result = await this.database
      .getPool()
      .query<{ id: string }>(
        `SELECT id FROM finance.customer_documents ORDER BY created_at DESC, id DESC`,
      );
    return Promise.all(result.rows.map((row) => this.document(row.id)));
  }

  async document(id: string): Promise<FinanceCustomerDocument> {
    const client = await this.database.getPool().connect();
    try {
      return await this.loadDocument(client, id);
    } finally {
      client.release();
    }
  }

  async summary(): Promise<FinanceSummary> {
    const result = await this.database.getPool().query<{
      active_documents: string;
      overdue_outstanding: string;
      paid_documents: string;
      total_outstanding: string;
    }>(
      `SELECT count(*) FILTER (WHERE review_state = 'pending_finance_review')::text AS active_documents,
              count(*) FILTER (WHERE payment_status = 'paid')::text AS paid_documents,
              coalesce(sum(outstanding_total) FILTER (WHERE review_state = 'pending_finance_review'), 0)::text AS total_outstanding,
              coalesce(sum(outstanding_total) FILTER (WHERE payment_status = 'overdue'), 0)::text AS overdue_outstanding
       FROM finance.customer_documents`,
    );
    const row = required(result.rows[0], 'Finance summary query failed');
    return {
      activeDocuments: Number(row.active_documents),
      overdueOutstanding: row.overdue_outstanding,
      paidDocuments: Number(row.paid_documents),
      totalOutstanding: row.total_outstanding,
    };
  }

  async createDocument(
    input: CreateFinanceCustomerDocumentRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceCustomerDocument> {
    const normalized = {
      dueDate: normalizeDate(input.dueDate),
      salesInvoiceId: input.salesInvoiceId,
    };
    return this.command(
      'finance.document.create',
      key,
      normalized,
      201,
      async (client, commandKey) => {
        const source = await client.query<{
          currency_code: string;
          customer_partner_id: string;
          id: string;
          total: string;
        }>(
          `SELECT id, customer_partner_id, currency_code, total::text FROM sales.invoices
         WHERE id = $1 AND status = 'draft' FOR KEY SHARE`,
          [normalized.salesInvoiceId],
        );
        const invoice = source.rows[0];
        if (!invoice)
          throw new ApiErrorException(
            'FINANCE_SOURCE_INVOICE_NOT_FOUND',
            'The selected sales invoice draft was not found.',
            HttpStatus.NOT_FOUND,
          );
        if (invoice.currency_code !== 'BGN')
          throw new ApiErrorException(
            'FINANCE_BNB_RATE_REQUIRED',
            'Foreign-currency invoice drafts require the approved BNB rate workflow before Finance review.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        const documentDate = await this.businessDate(client);
        if (normalized.dueDate < documentDate)
          throw new ApiErrorException(
            'FINANCE_DUE_DATE_INVALID',
            'The due date cannot be before the Finance review date.',
            HttpStatus.BAD_REQUEST,
          );
        const id = randomUUID();
        const number = await this.nextNumber(client, 'collection_review', 'FIN-REV');
        const initialStatus = statusFor(invoice.total, '0.0000', normalized.dueDate, documentDate);
        await client.query(
          `INSERT INTO finance.customer_documents (
           id, document_number, source_sales_invoice_id, customer_partner_id, document_date,
           due_date, currency_code, exchange_rate, rate_date, rate_source, total,
           allocated_total, outstanding_total, bgn_total, payment_status, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, 'BGN', 1, $5, 'internal_bgn_review',
                   $7, 0, $7, $7, $8, $9)`,
          [
            id,
            number,
            invoice.id,
            invoice.customer_partner_id,
            documentDate,
            normalized.dueDate,
            invoice.total,
            initialStatus,
            auth.accountId,
          ],
        );
        await this.appendStatusHistory(
          client,
          id,
          undefined,
          initialStatus,
          'document_imported',
          auth.accountId,
        );
        const document = await this.loadDocument(client, id);
        await this.sideEffects(
          client,
          'finance_customer_document',
          id,
          'finance.document.created',
          document,
          auth,
          metadata,
          commandKey,
        );
        return document;
      },
    );
  }

  async recordPayment(
    id: string,
    input: CreateFinancePaymentRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceCustomerDocument> {
    const normalized = normalizePayment(input);
    return this.command(
      `finance.document.payment:${id}`,
      key,
      normalized,
      201,
      async (client, commandKey) => {
        const before = await this.lockDocument(client, id);
        if (before.reviewState === 'cancelled')
          throw new ApiErrorException(
            'FINANCE_DOCUMENT_CANCELLED',
            'Payments cannot be recorded against a cancelled Finance review document.',
            HttpStatus.CONFLICT,
          );
        if (decimalUnits(before.outstandingTotal) === 0n)
          throw new ApiErrorException(
            'FINANCE_DOCUMENT_SETTLED',
            'This Finance review document has no remaining balance.',
            HttpStatus.CONFLICT,
          );
        if (decimalUnits(normalized.amount) > decimalUnits(before.outstandingTotal))
          throw new ApiErrorException(
            'FINANCE_ALLOCATION_EXCEEDS_BALANCE',
            'The payment amount exceeds the remaining balance.',
            HttpStatus.CONFLICT,
          );

        const paymentId = randomUUID();
        const paymentNumber = await this.nextNumber(client, 'payment', 'PAY');
        await client.query(
          `INSERT INTO finance.payments (
           id, payment_number, customer_partner_id, payment_date, payment_method,
           currency_code, amount, payment_reference, notes, recorded_by
         ) VALUES ($1, $2, $3, $4, $5, 'BGN', $6, $7, $8, $9)`,
          [
            paymentId,
            paymentNumber,
            before.customerPartnerId,
            normalized.paymentDate,
            normalized.paymentMethod,
            normalized.amount,
            normalized.paymentReference ?? null,
            normalized.notes ?? null,
            auth.accountId,
          ],
        );
        await client.query(
          `INSERT INTO finance.payment_allocations (
           id, payment_id, customer_document_id, amount, allocated_by
         ) VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), paymentId, id, normalized.amount, auth.accountId],
        );
        const allocatedTotal = decimalString(
          decimalUnits(before.allocatedTotal) + decimalUnits(normalized.amount),
        );
        const outstandingTotal = decimalString(
          decimalUnits(before.total) - decimalUnits(allocatedTotal),
        );
        const paymentStatus = statusFor(
          before.total,
          allocatedTotal,
          before.dueDate,
          await this.businessDate(client),
        );
        await client.query(
          `UPDATE finance.customer_documents
         SET allocated_total = $2, outstanding_total = $3, payment_status = $4,
             version = version + 1, updated_at = now()
         WHERE id = $1`,
          [id, allocatedTotal, outstandingTotal, paymentStatus],
        );
        if (paymentStatus !== before.paymentStatus)
          await this.appendStatusHistory(
            client,
            id,
            before.paymentStatus,
            paymentStatus,
            'payment_recorded',
            auth.accountId,
          );
        const document = await this.loadDocument(client, id);
        await this.sideEffects(
          client,
          'finance_payment',
          paymentId,
          'finance.payment.recorded',
          { document, payment: document.payments.find((payment) => payment.id === paymentId) },
          auth,
          metadata,
          commandKey,
          before,
        );
        return document;
      },
    );
  }

  async cancelDocument(
    id: string,
    input: CancelFinanceCustomerDocumentRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceCustomerDocument> {
    const cancellationReason = input.cancellationReason.trim();
    if (!cancellationReason)
      throw new ApiErrorException(
        'FINANCE_CANCELLATION_REASON_REQUIRED',
        'Enter a cancellation reason.',
        HttpStatus.BAD_REQUEST,
      );
    return this.command(
      `finance.document.cancel:${id}`,
      key,
      { cancellationReason, expectedVersion: input.expectedVersion },
      200,
      async (client, commandKey) => {
        const before = await this.lockDocument(client, id);
        if (before.version !== input.expectedVersion)
          throw new ApiErrorException(
            'FINANCE_DOCUMENT_VERSION_CONFLICT',
            'This Finance review document changed after it was opened. Refresh and try again.',
            HttpStatus.CONFLICT,
          );
        if (before.reviewState === 'cancelled') return before;
        if (decimalUnits(before.allocatedTotal) > 0n)
          throw new ApiErrorException(
            'FINANCE_DOCUMENT_HAS_PAYMENTS',
            'A Finance review document with recorded payments cannot be cancelled.',
            HttpStatus.CONFLICT,
          );
        await client.query(
          `UPDATE finance.customer_documents
           SET review_state = 'cancelled', payment_status = 'cancelled',
               cancellation_reason = $2, cancelled_at = now(), cancelled_by = $3,
               version = version + 1, updated_at = now()
           WHERE id = $1`,
          [id, cancellationReason, auth.accountId],
        );
        await this.appendStatusHistory(
          client,
          id,
          before.paymentStatus,
          'cancelled',
          'document_cancelled',
          auth.accountId,
        );
        const document = await this.loadDocument(client, id);
        await this.sideEffects(
          client,
          'finance_customer_document',
          id,
          'finance.document.cancelled',
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

  async detectPaymentStatuses(context: BackgroundJobContext) {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const asOf = await this.businessDate(client);
      const result = await client.query<{ id: string; payment_status: FinancePaymentStatus }>(
        `SELECT id, payment_status FROM finance.customer_documents
         WHERE review_state = 'pending_finance_review' AND outstanding_total > 0
           AND due_date < $1 AND payment_status <> 'overdue'
         ORDER BY due_date, id FOR UPDATE SKIP LOCKED`,
        [asOf],
      );
      const documentIds: string[] = [];
      for (const row of result.rows) {
        await client.query(
          `UPDATE finance.customer_documents
           SET payment_status = 'overdue', version = version + 1, updated_at = now()
           WHERE id = $1`,
          [row.id],
        );
        await this.appendStatusHistory(
          client,
          row.id,
          row.payment_status,
          'overdue',
          'scheduled_due_date_check',
        );
        await this.systemSideEffects(client, row.id, context);
        documentIds.push(row.id);
      }
      await client.query('COMMIT');
      return { asOf, documentIds, updatedCount: documentIds.length };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadDocument(client: PoolClient, id: string): Promise<FinanceCustomerDocument> {
    const result = await client.query<DocumentRow>(`${documentQuery()} WHERE document.id = $1`, [
      id,
    ]);
    const row = result.rows[0];
    if (!row) throw documentNotFound();
    const [payments, history] = await Promise.all([
      client.query<PaymentRow>(
        `SELECT payment.id, payment.payment_number, payment.payment_date::text,
                payment.payment_method, payment.amount::text, payment.payment_reference,
                payment.notes, payment.recorded_at, allocation.allocated_at
         FROM finance.payment_allocations allocation
         JOIN finance.payments payment ON payment.id = allocation.payment_id
         WHERE allocation.customer_document_id = $1
         ORDER BY allocation.allocated_at DESC, payment.id DESC`,
        [id],
      ),
      client.query<HistoryRow>(
        `SELECT history.id, history.previous_status, history.next_status, history.reason,
                history.changed_at, employee.display_name AS changed_by_name
         FROM finance.payment_status_history history
         LEFT JOIN identity.user_accounts account ON account.id = history.changed_by
         LEFT JOIN identity.employees employee ON employee.id = account.employee_id
         WHERE history.customer_document_id = $1
         ORDER BY history.changed_at DESC, history.id DESC`,
        [id],
      ),
    ]);
    return mapDocument(row, payments.rows.map(mapPayment), history.rows.map(mapHistory));
  }

  private async lockDocument(client: PoolClient, id: string): Promise<FinanceCustomerDocument> {
    const result = await client.query<DocumentRow>(
      `${documentQuery()} WHERE document.id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw documentNotFound();
    return mapDocument(row, [], []);
  }

  private async appendStatusHistory(
    client: PoolClient,
    documentId: string,
    previousStatus: FinancePaymentStatus | undefined,
    nextStatus: FinancePaymentStatus,
    reason: string,
    changedBy?: string,
  ) {
    await client.query(
      `INSERT INTO finance.payment_status_history (
         id, customer_document_id, previous_status, next_status, reason, changed_by
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), documentId, previousStatus ?? null, nextStatus, reason, changedBy ?? null],
    );
  }

  private async businessDate(client: PoolClient) {
    const result = await client.query<{ date: string }>(
      `SELECT (now() AT TIME ZONE $1)::date::text AS date`,
      [this.environment.BUSINESS_TIMEZONE],
    );
    return required(result.rows[0], 'Business date calculation failed').date;
  }

  private async nextNumber(client: PoolClient, type: string, prefix: string) {
    const businessDate = await this.businessDate(client);
    await client.query(
      `INSERT INTO finance.internal_document_sequences (document_type)
       VALUES ($1) ON CONFLICT (document_type) DO NOTHING`,
      [type],
    );
    const result = await client.query<{ allocated: string }>(
      `UPDATE finance.internal_document_sequences SET next_value = next_value + 1
       WHERE document_type = $1 RETURNING (next_value - 1)::text AS allocated`,
      [type],
    );
    return `${prefix}-${businessDate.slice(0, 4)}-${required(result.rows[0], 'Sequence allocation failed').allocated.padStart(6, '0')}`;
  }

  private async command<T>(
    scope: string,
    key: string | undefined,
    payload: object,
    responseStatus: number,
    action: (client: PoolClient, idempotencyKey: string) => Promise<T>,
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
          'This Finance operation conflicts with an existing record.',
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
    before?: object,
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
        ...(before ? { before: before as Record<string, unknown> } : {}),
        correlationId: metadata.correlationId,
        ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
        targetId,
        targetType,
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
      client,
    );
  }

  private async systemSideEffects(client: PoolClient, id: string, context: BackgroundJobContext) {
    const eventType = 'finance.document.overdue';
    await client.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1, 'finance_customer_document', $2, $3, 1, $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        id,
        eventType,
        context.correlationId,
        `${eventType}:${context.idempotencyKey}:${id}`,
        { documentId: id, scheduledFor: context.payload['scheduledFor'] },
      ],
    );
    await this.audit.append(
      {
        action: eventType,
        after: { status: 'overdue' },
        correlationId: context.correlationId,
        metadata: { jobId: context.jobId, jobName: context.name },
        targetId: id,
        targetType: 'finance_customer_document',
      },
      client,
    );
  }
}

interface PaymentRow {
  allocated_at: string | Date;
  amount: string;
  id: string;
  notes: string | null;
  payment_date: string;
  payment_method: FinancePaymentMethod;
  payment_number: string;
  payment_reference: string | null;
  recorded_at: string | Date;
}

interface HistoryRow {
  changed_at: string | Date;
  changed_by_name: string | null;
  id: string;
  next_status: FinancePaymentStatus;
  previous_status: FinancePaymentStatus | null;
  reason: string;
}

function documentQuery() {
  return `SELECT document.id, document.document_number, document.source_sales_invoice_id,
                 source.invoice_number AS source_invoice_number,
                 document.customer_partner_id, customer.display_name AS customer_name,
                 document.document_date::text, document.due_date::text, document.currency_code,
                 document.exchange_rate::text, document.rate_date::text, document.rate_source,
                 document.total::text, document.allocated_total::text,
                 document.outstanding_total::text, document.bgn_total::text,
                 document.payment_status, document.review_state, document.version,
                 document.created_at
          FROM finance.customer_documents document
          JOIN sales.invoices source ON source.id = document.source_sales_invoice_id
          JOIN master_data.partners customer ON customer.id = document.customer_partner_id`;
}

function mapDocument(
  row: DocumentRow,
  payments: FinancePayment[],
  statusHistory: FinancePaymentStatusHistoryEntry[],
): FinanceCustomerDocument {
  return {
    allocatedTotal: row.allocated_total,
    bgnTotal: row.bgn_total,
    createdAt: asIso(row.created_at),
    currencyCode: row.currency_code,
    customerName: row.customer_name,
    customerPartnerId: row.customer_partner_id,
    documentDate: row.document_date,
    dueDate: row.due_date,
    exchangeRate: row.exchange_rate,
    id: row.id,
    number: row.document_number,
    outstandingTotal: row.outstanding_total,
    paymentStatus: row.payment_status,
    payments,
    rateDate: row.rate_date,
    rateSource: row.rate_source,
    reviewState: row.review_state,
    sourceInvoiceNumber: row.source_invoice_number,
    sourceSalesInvoiceId: row.source_sales_invoice_id,
    statusHistory,
    total: row.total,
    version: row.version,
  };
}

function mapPayment(row: PaymentRow): FinancePayment {
  return {
    amount: row.amount,
    allocatedAt: asIso(row.allocated_at),
    id: row.id,
    ...(row.notes ? { notes: row.notes } : {}),
    number: row.payment_number,
    paymentDate: row.payment_date,
    paymentMethod: row.payment_method,
    ...(row.payment_reference ? { paymentReference: row.payment_reference } : {}),
    recordedAt: asIso(row.recorded_at),
  };
}

function mapHistory(row: HistoryRow): FinancePaymentStatusHistoryEntry {
  return {
    changedAt: asIso(row.changed_at),
    ...(row.changed_by_name ? { changedByName: row.changed_by_name } : {}),
    id: row.id,
    nextStatus: row.next_status,
    ...(row.previous_status ? { previousStatus: row.previous_status } : {}),
    reason: row.reason,
  };
}

function normalizePayment(input: CreateFinancePaymentRequest) {
  const paymentReference = input.paymentReference?.trim();
  const notes = input.notes?.trim();
  return {
    amount: normalizePositiveDecimal(input.amount),
    ...(notes ? { notes } : {}),
    paymentDate: normalizeDate(input.paymentDate),
    paymentMethod: input.paymentMethod,
    ...(paymentReference ? { paymentReference } : {}),
  };
}

function statusFor(
  total: string,
  allocated: string,
  dueDate: string,
  asOf: string,
): FinancePaymentStatus {
  const outstanding = decimalUnits(total) - decimalUnits(allocated);
  if (outstanding === 0n) return 'paid';
  if (dueDate < asOf) return 'overdue';
  return decimalUnits(allocated) === 0n ? 'unpaid' : 'partially_paid';
}

function normalizeDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw new ApiErrorException(
      'FINANCE_DATE_INVALID',
      'Enter a valid date.',
      HttpStatus.BAD_REQUEST,
    );
  return value;
}

function normalizePositiveDecimal(value: string) {
  if (!/^\d+(\.\d{1,4})?$/u.test(value))
    throw new ApiErrorException(
      'FINANCE_AMOUNT_INVALID',
      'Enter a positive amount with no more than four decimal places.',
      HttpStatus.BAD_REQUEST,
    );
  const normalized = decimalString(decimalUnits(value));
  if (decimalUnits(normalized) <= 0n)
    throw new ApiErrorException(
      'FINANCE_AMOUNT_INVALID',
      'The amount must be greater than zero.',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function decimalUnits(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(4, '0').slice(0, 4)}`);
}

function decimalString(units: bigint) {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const whole = absolute / 10_000n;
  const fraction = (absolute % 10_000n).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function validKey(value: string | undefined) {
  const key = value?.trim();
  if (!key || key.length > 200)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required.',
      HttpStatus.BAD_REQUEST,
    );
  return key;
}

async function claim(client: PoolClient, scope: string, key: string, hash: string) {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (
       scope, idempotency_key, request_hash, status, expires_at
     ) VALUES ($1, $2, $3, 'processing', now() + interval '24 hours')
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, hash],
  );
  if (inserted.rowCount) return undefined;
  const existing = await client.query<{
    request_hash: string;
    response_body: unknown;
    status: string;
  }>(
    `SELECT request_hash, status, response_body FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (row?.request_hash !== hash || row.status !== 'completed')
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_CONFLICT',
      'The idempotency key was already used for another request.',
      HttpStatus.CONFLICT,
    );
  return row.response_body;
}

function documentNotFound() {
  return new ApiErrorException(
    'FINANCE_DOCUMENT_NOT_FOUND',
    'The Finance review document was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

function asIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
