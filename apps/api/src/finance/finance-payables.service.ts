import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AllocateFinanceSupplierAdvanceRequest,
  CreateFinanceSupplierAdvanceRequest,
  CreateFinanceSupplierOffsetRequest,
  CreateFinanceSupplierPayableRequest,
  CreateFinanceSupplierPaymentRequest,
  FinancePaymentStatus,
  FinanceSupplierAdvancePage,
  FinanceSupplierBankMatchCandidate,
  FinanceSupplierOffset,
  FinanceSupplierOffsetPage,
  FinanceSupplierPayable,
  FinanceSupplierPayablePage,
  FinanceSupplierPayableStatus,
  FinanceSupplierPayment,
  FinanceSupplierPaymentAllocation,
  FinanceSupplierReferenceData,
  MatchFinanceSupplierBankTransactionRequest,
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
import type { FinanceSupplierListQueryDto } from './finance-payables.dto.js';
import { FinanceService } from './finance.service.js';

interface PayableRow {
  allocated_total: string;
  bgn_total: string;
  created_at: string | Date;
  currency_code: string;
  document_date: string;
  due_date: string;
  exchange_rate: string;
  id: string;
  outstanding_total: string;
  payable_number: string;
  payment_status: FinanceSupplierPayableStatus;
  rate_date: string;
  rate_source: string;
  source_supplier_invoice_id: string;
  source_supplier_invoice_number: string;
  supplier_name: string;
  supplier_partner_id: string;
  total: string;
  version: number;
}

interface SupplierPaymentRow {
  allocated_total: string;
  amount: string;
  available_total: string;
  id: string;
  notes: string | null;
  payment_date: string;
  payment_kind: FinanceSupplierPayment['kind'];
  payment_method: FinanceSupplierPayment['paymentMethod'];
  payment_number: string;
  payment_reference: string | null;
  recorded_at: string | Date;
  source_bank_transaction_id: string | null;
  supplier_name: string;
  supplier_partner_id: string;
  version: number;
}

interface AllocationRow {
  allocated_at: string | Date;
  amount: string;
  id: string;
  payable_number: string;
  supplier_payable_id: string;
  supplier_payment_id: string;
}

@Injectable()
export class FinancePayablesService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(FinanceService) private readonly finance: FinanceService,
  ) {}

  async referenceData(): Promise<FinanceSupplierReferenceData> {
    const [invoices, suppliers, receivables, businessDate] = await Promise.all([
      this.database.getPool().query<{
        currency_code: string;
        id: string;
        invoice_date: string;
        invoice_number: string;
        payment_terms_days: number | null;
        suggested_due_date: string;
        supplier_name: string;
        supplier_partner_id: string;
        total: string;
      }>(
        `SELECT invoice.id, invoice.supplier_partner_id,
                supplier.display_name AS supplier_name,
                invoice.supplier_invoice_number AS invoice_number,
                invoice.invoice_date::text, invoice.currency_code,
                profile.payment_terms_days,
                (invoice.invoice_date + coalesce(profile.payment_terms_days, 0))::text
                  AS suggested_due_date,
                coalesce(sum(line.line_total), 0)::text AS total
         FROM procurement.supplier_invoices invoice
         JOIN master_data.partners supplier ON supplier.id = invoice.supplier_partner_id
         LEFT JOIN procurement.supplier_profiles profile
           ON profile.supplier_partner_id = invoice.supplier_partner_id
         LEFT JOIN procurement.supplier_invoice_lines line
           ON line.supplier_invoice_id = invoice.id
         LEFT JOIN finance.supplier_payables payable
           ON payable.source_supplier_invoice_id = invoice.id
         WHERE payable.id IS NULL
         GROUP BY invoice.id, supplier.display_name, profile.payment_terms_days
         HAVING coalesce(sum(line.line_total), 0) > 0
         ORDER BY invoice.invoice_date DESC, invoice.recorded_at DESC, invoice.id DESC`,
      ),
      this.database.getPool().query<{ id: string; name: string }>(
        `SELECT partner.id, partner.display_name AS name
         FROM master_data.partners partner
         JOIN master_data.partner_roles role
           ON role.partner_id = partner.id AND role.role = 'supplier'
         WHERE partner.active
         ORDER BY partner.normalized_name, partner.id`,
      ),
      this.database.getPool().query<{
        customer_name: string;
        customer_partner_id: string;
        due_date: string;
        id: string;
        number: string;
        outstanding_total: string;
        source_invoice_number: string;
        version: number;
      }>(
        `SELECT document.id, document.document_number AS number,
                document.customer_partner_id, customer.display_name AS customer_name,
                document.due_date::text, document.outstanding_total::text,
                source.invoice_number AS source_invoice_number, document.version
         FROM finance.customer_documents document
         JOIN master_data.partners customer ON customer.id = document.customer_partner_id
         JOIN sales.invoices source ON source.id = document.source_sales_invoice_id
         JOIN master_data.partner_roles supplier_role
           ON supplier_role.partner_id = document.customer_partner_id
          AND supplier_role.role = 'supplier'
         WHERE document.review_state = 'pending_finance_review'
           AND document.outstanding_total > 0
         ORDER BY document.due_date, document.document_number, document.id`,
      ),
      this.currentBusinessDate(),
    ]);
    return {
      businessDate,
      openReceivables: receivables.rows.map((row) => ({
        customerName: row.customer_name,
        customerPartnerId: row.customer_partner_id,
        dueDate: row.due_date,
        id: row.id,
        number: row.number,
        outstandingTotal: row.outstanding_total,
        sourceInvoiceNumber: row.source_invoice_number,
        version: row.version,
      })),
      supplierInvoices: invoices.rows.map((row) => ({
        currencyCode: row.currency_code,
        id: row.id,
        invoiceDate: row.invoice_date,
        invoiceNumber: row.invoice_number,
        ...(row.payment_terms_days !== null ? { paymentTermsDays: row.payment_terms_days } : {}),
        suggestedDueDate: row.suggested_due_date,
        supplierName: row.supplier_name,
        supplierPartnerId: row.supplier_partner_id,
        total: row.total,
      })),
      suppliers: suppliers.rows,
    };
  }

  async payables(query: FinanceSupplierListQueryDto): Promise<FinanceSupplierPayablePage> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (query.status) conditions.push(`payable.payment_status = $${values.push(query.status)}`);
    if (query.supplierPartnerId)
      conditions.push(`payable.supplier_partner_id = $${values.push(query.supplierPartnerId)}`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = await this.database
      .getPool()
      .query<{ total: string }>(
        `SELECT count(*)::text AS total FROM finance.supplier_payables payable ${where}`,
        values,
      );
    const totalItems = Number(count.rows[0]?.total ?? 0);
    const page = query.page;
    const pageSize = query.pageSize;
    values.push(pageSize, (page - 1) * pageSize);
    const ids = await this.database.getPool().query<{ id: string }>(
      `SELECT payable.id FROM finance.supplier_payables payable ${where}
       ORDER BY payable.due_date DESC, payable.created_at DESC, payable.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      items: await this.loadPayables(ids.rows.map((row) => row.id)),
      page,
      pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    };
  }

  async payable(id: string): Promise<FinanceSupplierPayable> {
    const rows = await this.loadPayables([id]);
    const payable = rows[0];
    if (!payable) throw notFound('FINANCE_SUPPLIER_PAYABLE_NOT_FOUND', 'Payable not found.');
    return payable;
  }

  async advances(query: FinanceSupplierListQueryDto): Promise<FinanceSupplierAdvancePage> {
    const conditions = [`payment.payment_kind = 'advance'`];
    const values: unknown[] = [];
    if (query.supplierPartnerId)
      conditions.push(`payment.supplier_partner_id = $${values.push(query.supplierPartnerId)}`);
    const where = `WHERE ${conditions.join(' AND ')}`;
    const count = await this.database
      .getPool()
      .query<{ total: string }>(
        `SELECT count(*)::text AS total FROM finance.supplier_payments payment ${where}`,
        values,
      );
    const totalItems = Number(count.rows[0]?.total ?? 0);
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const ids = await this.database.getPool().query<{ id: string }>(
      `SELECT payment.id FROM finance.supplier_payments payment ${where}
       ORDER BY payment.payment_date DESC, payment.recorded_at DESC, payment.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      items: await this.loadPayments(ids.rows.map((row) => row.id)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
    };
  }

  async offsets(query: FinanceSupplierListQueryDto): Promise<FinanceSupplierOffsetPage> {
    const values: unknown[] = [];
    const where = query.supplierPartnerId
      ? `WHERE offset_record.partner_id = $${values.push(query.supplierPartnerId)}`
      : '';
    const count = await this.database
      .getPool()
      .query<{ total: string }>(
        `SELECT count(*)::text AS total FROM finance.supplier_offsets offset_record ${where}`,
        values,
      );
    const totalItems = Number(count.rows[0]?.total ?? 0);
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await this.database.getPool().query<{
      amount: string;
      created_at: string | Date;
      customer_document_id: string;
      customer_document_number: string;
      id: string;
      offset_date: string;
      offset_number: string;
      partner_id: string;
      partner_name: string;
      reason: string;
      supplier_payable_id: string;
      supplier_payable_number: string;
    }>(
      `SELECT offset_record.id, offset_record.offset_number, offset_record.partner_id,
              partner.display_name AS partner_name, offset_record.customer_document_id,
              customer_document.document_number AS customer_document_number,
              offset_record.supplier_payable_id,
              payable.payable_number AS supplier_payable_number,
              offset_record.offset_date::text, offset_record.amount::text,
              offset_record.reason, offset_record.created_at
       FROM finance.supplier_offsets offset_record
       JOIN master_data.partners partner ON partner.id = offset_record.partner_id
       JOIN finance.customer_documents customer_document
         ON customer_document.id = offset_record.customer_document_id
       JOIN finance.supplier_payables payable
         ON payable.id = offset_record.supplier_payable_id
       ${where}
       ORDER BY offset_record.offset_date DESC, offset_record.created_at DESC, offset_record.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      items: rows.rows.map(mapOffset),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
    };
  }

  createPayable(
    input: CreateFinanceSupplierPayableRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceSupplierPayable> {
    const normalized = { dueDate: date(input.dueDate), supplierInvoiceId: input.supplierInvoiceId };
    return this.command(
      'finance.supplier-payable.create',
      key,
      normalized,
      201,
      async (client, idempotencyKey) => {
        const source = await client.query<{
          currency_code: string;
          invoice_date: string;
          invoice_number: string;
          supplier_partner_id: string;
        }>(
          `SELECT invoice.supplier_partner_id, invoice.supplier_invoice_number AS invoice_number,
                invoice.invoice_date::text, invoice.currency_code
         FROM procurement.supplier_invoices invoice
         WHERE invoice.id = $1
         FOR UPDATE OF invoice`,
          [normalized.supplierInvoiceId],
        );
        const sourceInvoice = source.rows[0];
        if (!sourceInvoice)
          throw notFound('FINANCE_SUPPLIER_INVOICE_NOT_FOUND', 'Supplier invoice not found.');
        const totalResult = await client.query<{ total: string }>(
          `SELECT coalesce(sum(line_total), 0)::text AS total
           FROM procurement.supplier_invoice_lines WHERE supplier_invoice_id = $1`,
          [normalized.supplierInvoiceId],
        );
        const invoice = {
          ...sourceInvoice,
          total: required(totalResult.rows[0], 'Supplier invoice total query failed').total,
        };
        if (invoice.currency_code !== 'BGN')
          throw unprocessable(
            'FINANCE_SUPPLIER_BNB_RATE_REQUIRED',
            'Foreign-currency supplier invoices require the approved BNB rate workflow.',
          );
        if (normalized.dueDate < invoice.invoice_date)
          throw badRequest(
            'FINANCE_SUPPLIER_DUE_DATE_INVALID',
            'Due date cannot be before the supplier invoice date.',
          );
        if (decimalUnits(invoice.total) <= 0n)
          throw badRequest(
            'FINANCE_SUPPLIER_TOTAL_INVALID',
            'Supplier invoice total must be positive.',
          );
        const id = randomUUID();
        const number = await this.nextNumber(client, 'supplier_payable', 'SP');
        const businessDate = await this.businessDate(client);
        const paymentStatus = payableStatus(invoice.total, '0', normalized.dueDate, businessDate);
        await client.query(
          `INSERT INTO finance.supplier_payables (
           id, payable_number, source_supplier_invoice_id, supplier_partner_id,
           document_date, due_date, currency_code, exchange_rate, rate_date, rate_source,
           total, allocated_total, outstanding_total, bgn_total, payment_status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,'BGN',1,$5,'internal_bgn_review',$7,0,$7,$7,$8,$9)`,
          [
            id,
            number,
            normalized.supplierInvoiceId,
            invoice.supplier_partner_id,
            invoice.invoice_date,
            normalized.dueDate,
            invoice.total,
            paymentStatus,
            auth.accountId,
          ],
        );
        await this.appendPayableHistory(
          client,
          id,
          undefined,
          paymentStatus,
          'supplier_invoice_added',
          auth.accountId,
        );
        const result = await this.loadPayable(client, id);
        await this.sideEffects(
          client,
          'finance_supplier_payable',
          id,
          'finance.supplier-payable.created',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        await this.finance.enqueuePaymentReminders(client, businessDate);
        return result;
      },
    );
  }

  recordPayment(
    payableId: string,
    input: CreateFinanceSupplierPaymentRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceSupplierPayable> {
    const normalized = normalizePayment(input);
    return this.command(
      `finance.supplier-payable.payment:${payableId}`,
      key,
      normalized,
      201,
      async (client, idempotencyKey) => {
        const payable = await this.lockPayable(client, payableId);
        if (decimalUnits(normalized.amount) > decimalUnits(payable.outstanding_total))
          throw conflict(
            'FINANCE_SUPPLIER_PAYMENT_EXCEEDS_BALANCE',
            'Payment exceeds the payable balance. Record the excess separately as a supplier advance.',
          );
        const payment = await this.insertSupplierPayment(client, {
          amount: normalized.amount,
          auth,
          kind: 'payment',
          method: normalized.paymentMethod,
          ...(normalized.notes ? { notes: normalized.notes } : {}),
          paymentDate: normalized.paymentDate,
          ...(normalized.paymentReference ? { paymentReference: normalized.paymentReference } : {}),
          supplierPartnerId: payable.supplier_partner_id,
        });
        await this.insertAllocation(
          client,
          payment.id,
          payableId,
          normalized.amount,
          auth.accountId,
        );
        await this.applyPayableAllocation(
          client,
          payable,
          normalized.amount,
          'supplier_payment_recorded',
          auth.accountId,
        );
        const result = await this.loadPayable(client, payableId);
        await this.sideEffects(
          client,
          'finance_supplier_payable',
          payableId,
          'finance.supplier-payment.recorded',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  createAdvance(
    input: CreateFinanceSupplierAdvanceRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceSupplierPayment> {
    const normalized = { ...normalizePayment(input), supplierPartnerId: input.supplierPartnerId };
    return this.command(
      'finance.supplier-advance.create',
      key,
      normalized,
      201,
      async (client, idempotencyKey) => {
        await this.requireSupplier(client, normalized.supplierPartnerId);
        const payment = await this.insertSupplierPayment(client, {
          amount: normalized.amount,
          auth,
          kind: 'advance',
          method: normalized.paymentMethod,
          ...(normalized.notes ? { notes: normalized.notes } : {}),
          paymentDate: normalized.paymentDate,
          ...(normalized.paymentReference ? { paymentReference: normalized.paymentReference } : {}),
          supplierPartnerId: normalized.supplierPartnerId,
        });
        const result = await this.loadPayment(client, payment.id);
        await this.sideEffects(
          client,
          'finance_supplier_payment',
          payment.id,
          'finance.supplier-advance.created',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  allocateAdvance(
    advanceId: string,
    input: AllocateFinanceSupplierAdvanceRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceSupplierPayment> {
    const normalized = {
      amount: positiveAmount(input.amount),
      expectedAdvanceVersion: input.expectedAdvanceVersion,
      expectedPayableVersion: input.expectedPayableVersion,
      supplierPayableId: input.supplierPayableId,
    };
    return this.command(
      `finance.supplier-advance.allocate:${advanceId}`,
      key,
      normalized,
      200,
      async (client, idempotencyKey) => {
        const payment = await this.lockSupplierPayment(client, advanceId);
        if (payment.payment_kind !== 'advance')
          throw conflict(
            'FINANCE_SUPPLIER_ADVANCE_REQUIRED',
            'Only a supplier advance can be allocated.',
          );
        if (payment.version !== normalized.expectedAdvanceVersion)
          throw conflict(
            'FINANCE_SUPPLIER_ADVANCE_VERSION_CONFLICT',
            'This advance changed. Refresh and try again.',
          );
        const payable = await this.lockPayable(client, normalized.supplierPayableId);
        if (payable.version !== normalized.expectedPayableVersion)
          throw conflict(
            'FINANCE_SUPPLIER_PAYABLE_VERSION_CONFLICT',
            'This payable changed. Refresh and try again.',
          );
        if (payment.supplier_partner_id !== payable.supplier_partner_id)
          throw conflict(
            'FINANCE_SUPPLIER_ADVANCE_PARTNER_MISMATCH',
            'Advance and payable must belong to the same supplier.',
          );
        if (decimalUnits(normalized.amount) > decimalUnits(payment.available_total))
          throw conflict(
            'FINANCE_SUPPLIER_ADVANCE_EXCEEDED',
            'Allocation exceeds the available advance.',
          );
        if (decimalUnits(normalized.amount) > decimalUnits(payable.outstanding_total))
          throw conflict(
            'FINANCE_SUPPLIER_PAYABLE_EXCEEDED',
            'Allocation exceeds the payable balance.',
          );
        await this.insertAllocation(
          client,
          advanceId,
          payable.id,
          normalized.amount,
          auth.accountId,
        );
        await client.query(
          `UPDATE finance.supplier_payments
         SET allocated_total = allocated_total + $2::numeric,
             available_total = available_total - $2::numeric,
             version = version + 1
         WHERE id = $1`,
          [advanceId, normalized.amount],
        );
        await this.applyPayableAllocation(
          client,
          payable,
          normalized.amount,
          'supplier_advance_allocated',
          auth.accountId,
        );
        const result = await this.loadPayment(client, advanceId);
        await this.sideEffects(
          client,
          'finance_supplier_payment',
          advanceId,
          'finance.supplier-advance.allocated',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  createOffset(
    input: CreateFinanceSupplierOffsetRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceSupplierOffset> {
    const normalized = {
      amount: positiveAmount(input.amount),
      customerDocumentId: input.customerDocumentId,
      expectedCustomerDocumentVersion: input.expectedCustomerDocumentVersion,
      expectedSupplierPayableVersion: input.expectedSupplierPayableVersion,
      offsetDate: date(input.offsetDate),
      reason: requiredText(input.reason, 'Enter the compensation reason.'),
      supplierPayableId: input.supplierPayableId,
    };
    return this.command(
      'finance.supplier-offset.create',
      key,
      normalized,
      201,
      async (client, idempotencyKey) => {
        const customerDocument = await this.lockCustomerDocument(
          client,
          normalized.customerDocumentId,
        );
        const payable = await this.lockPayable(client, normalized.supplierPayableId);
        if (customerDocument.version !== normalized.expectedCustomerDocumentVersion)
          throw conflict(
            'FINANCE_RECEIVABLE_VERSION_CONFLICT',
            'The customer balance changed. Refresh and try again.',
          );
        if (payable.version !== normalized.expectedSupplierPayableVersion)
          throw conflict(
            'FINANCE_SUPPLIER_PAYABLE_VERSION_CONFLICT',
            'The supplier balance changed. Refresh and try again.',
          );
        if (customerDocument.review_state !== 'pending_finance_review')
          throw conflict(
            'FINANCE_RECEIVABLE_CANCELLED',
            'Cancelled customer records cannot be offset.',
          );
        if (customerDocument.customer_partner_id !== payable.supplier_partner_id)
          throw conflict(
            'FINANCE_OFFSET_PARTNER_MISMATCH',
            'Both balances must belong to the same partner.',
          );
        if (decimalUnits(normalized.amount) > decimalUnits(customerDocument.outstanding_total))
          throw conflict(
            'FINANCE_OFFSET_RECEIVABLE_EXCEEDED',
            'Offset exceeds the customer receivable balance.',
          );
        if (decimalUnits(normalized.amount) > decimalUnits(payable.outstanding_total))
          throw conflict(
            'FINANCE_OFFSET_PAYABLE_EXCEEDED',
            'Offset exceeds the supplier payable balance.',
          );

        const customerPaymentId = randomUUID();
        const customerPaymentNumber = await this.nextNumber(client, 'payment', 'PAY');
        await client.query(
          `INSERT INTO finance.payments (
           id, payment_number, customer_partner_id, payment_date, payment_method,
           currency_code, amount, payment_reference, notes, recorded_by
         ) VALUES ($1,$2,$3,$4,'offset','BGN',$5,$6,$7,$8)`,
          [
            customerPaymentId,
            customerPaymentNumber,
            customerDocument.customer_partner_id,
            normalized.offsetDate,
            normalized.amount,
            null,
            normalized.reason,
            auth.accountId,
          ],
        );
        await client.query(
          `INSERT INTO finance.payment_allocations (
           id, payment_id, customer_document_id, amount, allocated_by
         ) VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), customerPaymentId, customerDocument.id, normalized.amount, auth.accountId],
        );
        const supplierPayment = await this.insertSupplierPayment(client, {
          amount: normalized.amount,
          auth,
          kind: 'offset',
          method: 'offset',
          notes: normalized.reason,
          paymentDate: normalized.offsetDate,
          supplierPartnerId: payable.supplier_partner_id,
        });
        await this.insertAllocation(
          client,
          supplierPayment.id,
          payable.id,
          normalized.amount,
          auth.accountId,
        );

        const customerAllocated = decimalString(
          decimalUnits(customerDocument.allocated_total) + decimalUnits(normalized.amount),
        );
        const customerOutstanding = decimalString(
          decimalUnits(customerDocument.total) - decimalUnits(customerAllocated),
        );
        const customerStatus = customerPaymentStatus(
          customerDocument.total,
          customerAllocated,
          customerDocument.due_date,
          await this.businessDate(client),
        );
        await client.query(
          `UPDATE finance.customer_documents
         SET allocated_total = $2, outstanding_total = $3, payment_status = $4,
             version = version + 1, updated_at = now()
         WHERE id = $1`,
          [customerDocument.id, customerAllocated, customerOutstanding, customerStatus],
        );
        if (customerStatus !== customerDocument.payment_status)
          await client.query(
            `INSERT INTO finance.payment_status_history (
             id, customer_document_id, previous_status, next_status, reason, changed_by
           ) VALUES ($1,$2,$3,$4,'supplier_offset_created',$5)`,
            [
              randomUUID(),
              customerDocument.id,
              customerDocument.payment_status,
              customerStatus,
              auth.accountId,
            ],
          );
        await this.applyPayableAllocation(
          client,
          payable,
          normalized.amount,
          'supplier_offset_created',
          auth.accountId,
        );

        const id = randomUUID();
        const number = await this.nextNumber(client, 'supplier_offset', 'OFF');
        await client.query(
          `INSERT INTO finance.supplier_offsets (
           id, offset_number, partner_id, customer_document_id, supplier_payable_id,
           customer_payment_id, supplier_payment_id, offset_date, amount, reason, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            number,
            payable.supplier_partner_id,
            customerDocument.id,
            payable.id,
            customerPaymentId,
            supplierPayment.id,
            normalized.offsetDate,
            normalized.amount,
            normalized.reason,
            auth.accountId,
          ],
        );
        const result = await this.loadOffset(client, id);
        await this.sideEffects(
          client,
          'finance_supplier_offset',
          id,
          'finance.supplier-offset.created',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  async bankMatchCandidates(transactionId: string): Promise<FinanceSupplierBankMatchCandidate[]> {
    const transaction = await this.database.getPool().query<{
      amount: string;
      counterparty_name: string;
      direction: string;
      match_status: string;
      payment_reference: string;
    }>(
      `SELECT amount::text, counterparty_name, direction, match_status, payment_reference
       FROM finance.bank_transactions WHERE id = $1`,
      [transactionId],
    );
    const row = transaction.rows[0];
    if (!row) throw notFound('FINANCE_BANK_TRANSACTION_NOT_FOUND', 'Bank transaction not found.');
    if (row.direction !== 'outgoing' || row.match_status === 'matched') return [];
    const candidates = await this.database.getPool().query<{
      due_date: string;
      outstanding_total: string;
      payable_number: string;
      reference_matched: boolean;
      source_supplier_invoice_number: string;
      supplier_name: string;
      supplier_partner_id: string;
      supplier_payable_id: string;
    }>(
      `SELECT payable.id AS supplier_payable_id, payable.payable_number,
              invoice.supplier_invoice_number AS source_supplier_invoice_number,
              payable.supplier_partner_id, supplier.display_name AS supplier_name,
              payable.due_date::text, payable.outstanding_total::text,
              ($1 ILIKE ('%' || payable.payable_number || '%')
                OR $1 ILIKE ('%' || invoice.supplier_invoice_number || '%')) AS reference_matched
       FROM finance.supplier_payables payable
       JOIN procurement.supplier_invoices invoice
         ON invoice.id = payable.source_supplier_invoice_id
       JOIN master_data.partners supplier ON supplier.id = payable.supplier_partner_id
       WHERE payable.currency_code = 'BGN' AND payable.outstanding_total >= $2::numeric
       ORDER BY reference_matched DESC,
                (lower(supplier.display_name) = lower($3)) DESC,
                (payable.outstanding_total = $2::numeric) DESC,
                payable.due_date, payable.id
       LIMIT 50`,
      [row.payment_reference, row.amount, row.counterparty_name],
    );
    return candidates.rows
      .map((candidate) => ({
        dueDate: candidate.due_date,
        outstandingTotal: candidate.outstanding_total,
        payableNumber: candidate.payable_number,
        referenceMatched: candidate.reference_matched,
        score:
          (candidate.reference_matched ? 60 : 0) +
          (decimalUnits(candidate.outstanding_total) === decimalUnits(row.amount) ? 30 : 0) +
          (candidate.supplier_name.toLocaleLowerCase() === row.counterparty_name.toLocaleLowerCase()
            ? 10
            : 0),
        sourceSupplierInvoiceNumber: candidate.source_supplier_invoice_number,
        supplierName: candidate.supplier_name,
        supplierPartnerId: candidate.supplier_partner_id,
        supplierPayableId: candidate.supplier_payable_id,
      }))
      .sort((left, right) => right.score - left.score || left.dueDate.localeCompare(right.dueDate));
  }

  matchBankTransaction(
    transactionId: string,
    input: MatchFinanceSupplierBankTransactionRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceSupplierPayment> {
    const normalized = {
      expectedVersion: input.expectedVersion,
      mode: input.mode,
      ...(input.supplierPartnerId ? { supplierPartnerId: input.supplierPartnerId } : {}),
      ...(input.supplierPayableId ? { supplierPayableId: input.supplierPayableId } : {}),
    };
    if (normalized.mode === 'payable' && !normalized.supplierPayableId)
      throw badRequest('FINANCE_SUPPLIER_PAYABLE_REQUIRED', 'Choose the supplier payable.');
    if (normalized.mode === 'advance' && !normalized.supplierPartnerId)
      throw badRequest('FINANCE_SUPPLIER_REQUIRED', 'Choose the supplier for the advance.');
    return this.command(
      `finance.bank-transaction.supplier-match:${transactionId}`,
      key,
      normalized,
      200,
      async (client, idempotencyKey) => {
        const transaction = await this.lockBankTransaction(client, transactionId);
        if (transaction.version !== normalized.expectedVersion)
          throw conflict(
            'FINANCE_BANK_TRANSACTION_VERSION_CONFLICT',
            'This bank transaction changed. Refresh and try again.',
          );
        if (transaction.match_status === 'matched') {
          if (!transaction.matched_supplier_payment_id)
            throw conflict(
              'FINANCE_BANK_TRANSACTION_ALREADY_MATCHED',
              'This transaction is already matched to another record.',
            );
          return this.loadPayment(client, transaction.matched_supplier_payment_id);
        }
        if (transaction.direction !== 'outgoing')
          throw conflict(
            'FINANCE_BANK_TRANSACTION_DIRECTION_INVALID',
            'Only outgoing transfers can be matched to supplier balances.',
          );

        let payable: Awaited<ReturnType<FinancePayablesService['lockPayable']>> | undefined;
        let supplierPartnerId = normalized.supplierPartnerId;
        if (normalized.mode === 'payable') {
          payable = await this.lockPayable(client, normalized.supplierPayableId!);
          supplierPartnerId = payable.supplier_partner_id;
          if (decimalUnits(transaction.amount) > decimalUnits(payable.outstanding_total))
            throw conflict(
              'FINANCE_SUPPLIER_BANK_MATCH_EXCEEDS_BALANCE',
              'The transfer exceeds the payable. Match it as a supplier advance, then allocate the required amount.',
            );
        } else {
          await this.requireSupplier(client, supplierPartnerId!);
        }
        const payment = await this.insertSupplierPayment(client, {
          amount: transaction.amount,
          auth,
          kind: payable ? 'payment' : 'advance',
          method: 'bank_transfer',
          notes: `Matched from bank statement ${transaction.statement_number}, line ${transaction.line_number}.`,
          paymentDate: transaction.value_date,
          paymentReference: transaction.payment_reference,
          sourceBankTransactionId: transaction.id,
          supplierPartnerId: supplierPartnerId!,
        });
        if (payable) {
          await this.insertAllocation(
            client,
            payment.id,
            payable.id,
            transaction.amount,
            auth.accountId,
          );
          await this.applyPayableAllocation(
            client,
            payable,
            transaction.amount,
            'bank_transaction_matched',
            auth.accountId,
          );
        }
        await client.query(
          `UPDATE finance.bank_transactions
         SET match_status = 'matched', match_method = 'manual',
             matched_supplier_payable_id = $2, matched_supplier_payment_id = $3,
             matched_by = $4, matched_at = now(), version = version + 1, updated_at = now()
         WHERE id = $1`,
          [transaction.id, payable?.id ?? null, payment.id, auth.accountId],
        );
        await client.query(
          `UPDATE finance.bank_statements SET version = version + 1, updated_at = now() WHERE id = $1`,
          [transaction.bank_statement_id],
        );
        const result = await this.loadPayment(client, payment.id);
        await this.sideEffects(
          client,
          'finance_bank_transaction',
          transaction.id,
          'finance.bank-transaction.supplier-matched',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  private async currentBusinessDate() {
    const result = await this.database
      .getPool()
      .query<{ date: string }>(`SELECT (now() AT TIME ZONE $1)::date::text AS date`, [
        this.environment.BUSINESS_TIMEZONE,
      ]);
    return required(result.rows[0], 'Business date calculation failed').date;
  }

  private async businessDate(client: PoolClient) {
    const result = await client.query<{ date: string }>(
      `SELECT (now() AT TIME ZONE $1)::date::text AS date`,
      [this.environment.BUSINESS_TIMEZONE],
    );
    return required(result.rows[0], 'Business date calculation failed').date;
  }

  private async loadPayables(ids: string[]) {
    if (!ids.length) return [];
    const client = await this.database.getPool().connect();
    try {
      const result = await this.loadPayablesWithClient(client, ids);
      const order = new Map(ids.map((id, index) => [id, index]));
      return result.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
    } finally {
      client.release();
    }
  }

  private async loadPayablesWithClient(client: PoolClient, ids: string[]) {
    const payableRows = await client.query<PayableRow>(
      `${payableQuery()} WHERE payable.id = ANY($1::uuid[])`,
      [ids],
    );
    const paymentRows = await client.query<SupplierPaymentRow>(
      `${paymentQuery()}
       WHERE payment.id IN (
         SELECT allocation.supplier_payment_id
         FROM finance.supplier_payment_allocations allocation
         WHERE allocation.supplier_payable_id = ANY($1::uuid[])
       )`,
      [ids],
    );
    const payments = await this.mapPaymentsWithAllocations(client, paymentRows.rows);
    const paymentsByPayable = new Map<string, FinanceSupplierPayment[]>();
    for (const payment of payments)
      for (const allocation of payment.allocations) {
        const current = paymentsByPayable.get(allocation.supplierPayableId) ?? [];
        if (!current.some((item) => item.id === payment.id)) current.push(payment);
        paymentsByPayable.set(allocation.supplierPayableId, current);
      }
    return payableRows.rows.map((row) => mapPayable(row, paymentsByPayable.get(row.id) ?? []));
  }

  private async loadPayable(client: PoolClient, id: string) {
    const rows = await this.loadPayablesWithClient(client, [id]);
    const payable = rows[0];
    if (!payable) throw notFound('FINANCE_SUPPLIER_PAYABLE_NOT_FOUND', 'Payable not found.');
    return payable;
  }

  private async loadPayments(ids: string[]) {
    if (!ids.length) return [];
    const client = await this.database.getPool().connect();
    try {
      const rows = await client.query<SupplierPaymentRow>(
        `${paymentQuery()} WHERE payment.id = ANY($1::uuid[])`,
        [ids],
      );
      const items = await this.mapPaymentsWithAllocations(client, rows.rows);
      const order = new Map(ids.map((id, index) => [id, index]));
      return items.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
    } finally {
      client.release();
    }
  }

  private async loadPayment(client: PoolClient, id: string) {
    const rows = await client.query<SupplierPaymentRow>(`${paymentQuery()} WHERE payment.id = $1`, [
      id,
    ]);
    const payments = await this.mapPaymentsWithAllocations(client, rows.rows);
    const payment = payments[0];
    if (!payment)
      throw notFound('FINANCE_SUPPLIER_PAYMENT_NOT_FOUND', 'Supplier payment not found.');
    return payment;
  }

  private async mapPaymentsWithAllocations(client: PoolClient, rows: SupplierPaymentRow[]) {
    if (!rows.length) return [];
    const allocationRows = await client.query<AllocationRow>(
      `SELECT allocation.id, allocation.supplier_payment_id,
              allocation.supplier_payable_id, payable.payable_number,
              allocation.amount::text, allocation.allocated_at
       FROM finance.supplier_payment_allocations allocation
       JOIN finance.supplier_payables payable ON payable.id = allocation.supplier_payable_id
       WHERE allocation.supplier_payment_id = ANY($1::uuid[])
       ORDER BY allocation.allocated_at, allocation.id`,
      [rows.map((row) => row.id)],
    );
    const byPayment = new Map<string, FinanceSupplierPaymentAllocation[]>();
    for (const row of allocationRows.rows) {
      const current = byPayment.get(row.supplier_payment_id) ?? [];
      current.push({
        allocatedAt: asIso(row.allocated_at),
        amount: row.amount,
        id: row.id,
        payableNumber: row.payable_number,
        supplierPayableId: row.supplier_payable_id,
      });
      byPayment.set(row.supplier_payment_id, current);
    }
    return rows.map((row) => mapPayment(row, byPayment.get(row.id) ?? []));
  }

  private async loadOffset(client: PoolClient, id: string) {
    const rows = await client.query<{
      amount: string;
      created_at: string | Date;
      customer_document_id: string;
      customer_document_number: string;
      id: string;
      offset_date: string;
      offset_number: string;
      partner_id: string;
      partner_name: string;
      reason: string;
      supplier_payable_id: string;
      supplier_payable_number: string;
    }>(
      `SELECT offset_record.id, offset_record.offset_number, offset_record.partner_id,
              partner.display_name AS partner_name, offset_record.customer_document_id,
              customer_document.document_number AS customer_document_number,
              offset_record.supplier_payable_id,
              payable.payable_number AS supplier_payable_number,
              offset_record.offset_date::text, offset_record.amount::text,
              offset_record.reason, offset_record.created_at
       FROM finance.supplier_offsets offset_record
       JOIN master_data.partners partner ON partner.id = offset_record.partner_id
       JOIN finance.customer_documents customer_document
         ON customer_document.id = offset_record.customer_document_id
       JOIN finance.supplier_payables payable ON payable.id = offset_record.supplier_payable_id
       WHERE offset_record.id = $1`,
      [id],
    );
    const row = rows.rows[0];
    if (!row) throw new Error('Supplier offset could not be loaded');
    return mapOffset(row);
  }

  private async lockPayable(client: PoolClient, id: string) {
    const result = await client.query<{
      allocated_total: string;
      due_date: string;
      id: string;
      outstanding_total: string;
      payment_status: FinanceSupplierPayableStatus;
      supplier_partner_id: string;
      total: string;
      version: number;
    }>(
      `SELECT id, supplier_partner_id, total::text, allocated_total::text,
              outstanding_total::text, due_date::text, payment_status, version
       FROM finance.supplier_payables WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('FINANCE_SUPPLIER_PAYABLE_NOT_FOUND', 'Payable not found.');
    if (decimalUnits(row.outstanding_total) <= 0n)
      throw conflict('FINANCE_SUPPLIER_PAYABLE_SETTLED', 'This payable has no remaining balance.');
    return row;
  }

  private async lockSupplierPayment(client: PoolClient, id: string) {
    const result = await client.query<{
      available_total: string;
      payment_kind: FinanceSupplierPayment['kind'];
      supplier_partner_id: string;
      version: number;
    }>(
      `SELECT supplier_partner_id, payment_kind, available_total::text, version
       FROM finance.supplier_payments WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('FINANCE_SUPPLIER_PAYMENT_NOT_FOUND', 'Supplier payment not found.');
    return row;
  }

  private async lockCustomerDocument(client: PoolClient, id: string) {
    const result = await client.query<{
      allocated_total: string;
      customer_partner_id: string;
      due_date: string;
      id: string;
      outstanding_total: string;
      payment_status: FinancePaymentStatus;
      review_state: string;
      total: string;
      version: number;
    }>(
      `SELECT id, customer_partner_id, total::text, allocated_total::text,
              outstanding_total::text, due_date::text, payment_status, review_state, version
       FROM finance.customer_documents WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('FINANCE_DOCUMENT_NOT_FOUND', 'Customer collection record not found.');
    return row;
  }

  private async lockBankTransaction(client: PoolClient, id: string) {
    const result = await client.query<{
      amount: string;
      bank_statement_id: string;
      direction: string;
      id: string;
      line_number: number;
      match_status: string;
      matched_supplier_payment_id: string | null;
      payment_reference: string;
      statement_number: string;
      value_date: string;
      version: number;
    }>(
      `SELECT transaction.id, transaction.bank_statement_id, transaction.line_number,
              transaction.direction, transaction.amount::text, transaction.payment_reference,
              transaction.value_date::text, transaction.match_status, transaction.version,
              transaction.matched_supplier_payment_id, statement.statement_number
       FROM finance.bank_transactions transaction
       JOIN finance.bank_statements statement ON statement.id = transaction.bank_statement_id
       WHERE transaction.id = $1 FOR UPDATE OF transaction`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('FINANCE_BANK_TRANSACTION_NOT_FOUND', 'Bank transaction not found.');
    return row;
  }

  private async requireSupplier(client: PoolClient, id: string) {
    const result = await client.query(
      `SELECT partner.id FROM master_data.partners partner
       JOIN master_data.partner_roles role
         ON role.partner_id = partner.id AND role.role = 'supplier'
       WHERE partner.id = $1 AND partner.active FOR KEY SHARE OF partner`,
      [id],
    );
    if (!result.rowCount) throw notFound('FINANCE_SUPPLIER_NOT_FOUND', 'Supplier not found.');
  }

  private async insertSupplierPayment(
    client: PoolClient,
    input: {
      amount: string;
      auth: AuthenticationContext;
      kind: FinanceSupplierPayment['kind'];
      method: FinanceSupplierPayment['paymentMethod'];
      notes?: string;
      paymentDate: string;
      paymentReference?: string;
      sourceBankTransactionId?: string;
      supplierPartnerId: string;
    },
  ) {
    const id = randomUUID();
    const type = input.kind === 'advance' ? 'supplier_advance' : 'supplier_payment';
    const prefix = input.kind === 'advance' ? 'SADV' : 'SPAY';
    const number = await this.nextNumber(client, type, prefix);
    const allocatedTotal = input.kind === 'advance' ? '0.0000' : input.amount;
    const availableTotal = input.kind === 'advance' ? input.amount : '0.0000';
    await client.query(
      `INSERT INTO finance.supplier_payments (
         id, payment_number, supplier_partner_id, payment_date, payment_kind,
         payment_method, currency_code, amount, allocated_total, available_total,
         payment_reference, notes, source_bank_transaction_id, recorded_by
       ) VALUES ($1,$2,$3,$4,$5,$6,'BGN',$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        number,
        input.supplierPartnerId,
        input.paymentDate,
        input.kind,
        input.method,
        input.amount,
        allocatedTotal,
        availableTotal,
        input.paymentReference ?? null,
        input.notes ?? null,
        input.sourceBankTransactionId ?? null,
        input.auth.accountId,
      ],
    );
    return { id, number };
  }

  private async insertAllocation(
    client: PoolClient,
    paymentId: string,
    payableId: string,
    amount: string,
    accountId: string,
  ) {
    await client.query(
      `INSERT INTO finance.supplier_payment_allocations (
         id, supplier_payment_id, supplier_payable_id, amount, allocated_by
       ) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (supplier_payment_id, supplier_payable_id)
       DO UPDATE SET amount = finance.supplier_payment_allocations.amount + excluded.amount,
                     allocated_at = now(), allocated_by = excluded.allocated_by`,
      [randomUUID(), paymentId, payableId, amount, accountId],
    );
  }

  private async applyPayableAllocation(
    client: PoolClient,
    payable: Awaited<ReturnType<FinancePayablesService['lockPayable']>>,
    amount: string,
    reason: string,
    accountId: string,
  ) {
    const allocated = decimalString(decimalUnits(payable.allocated_total) + decimalUnits(amount));
    const outstanding = decimalString(decimalUnits(payable.total) - decimalUnits(allocated));
    const status = payableStatus(
      payable.total,
      allocated,
      payable.due_date,
      await this.businessDate(client),
    );
    await client.query(
      `UPDATE finance.supplier_payables
       SET allocated_total = $2, outstanding_total = $3, payment_status = $4,
           version = version + 1, updated_at = now()
       WHERE id = $1`,
      [payable.id, allocated, outstanding, status],
    );
    if (status !== payable.payment_status)
      await this.appendPayableHistory(
        client,
        payable.id,
        payable.payment_status,
        status,
        reason,
        accountId,
      );
  }

  private async appendPayableHistory(
    client: PoolClient,
    payableId: string,
    previous: FinanceSupplierPayableStatus | undefined,
    next: FinanceSupplierPayableStatus,
    reason: string,
    accountId?: string,
  ) {
    await client.query(
      `INSERT INTO finance.supplier_payment_status_history (
         id, supplier_payable_id, previous_status, next_status, reason, changed_by
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), payableId, previous ?? null, next, reason, accountId ?? null],
    );
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
    const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claim(client, scope, idempotencyKey, requestHash);
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
        throw conflict('FINANCE_SUPPLIER_CONFLICT', 'This supplier Finance record already exists.');
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
    const compactKey = createHash('sha256').update(`${eventType}:${idempotencyKey}`).digest('hex');
    await client.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1,$2,$3,$4,1,$5,$6,$7)`,
      [
        randomUUID(),
        targetType,
        targetId,
        eventType,
        metadata.correlationId,
        `finance:${compactKey}`,
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

function payableQuery() {
  return `SELECT payable.id, payable.payable_number, payable.source_supplier_invoice_id,
                 invoice.supplier_invoice_number AS source_supplier_invoice_number,
                 payable.supplier_partner_id, supplier.display_name AS supplier_name,
                 payable.document_date::text, payable.due_date::text, payable.currency_code,
                 payable.exchange_rate::text, payable.rate_date::text, payable.rate_source,
                 payable.total::text, payable.allocated_total::text,
                 payable.outstanding_total::text, payable.bgn_total::text,
                 payable.payment_status, payable.version, payable.created_at
          FROM finance.supplier_payables payable
          JOIN procurement.supplier_invoices invoice
            ON invoice.id = payable.source_supplier_invoice_id
          JOIN master_data.partners supplier ON supplier.id = payable.supplier_partner_id`;
}

function paymentQuery() {
  return `SELECT payment.id, payment.payment_number, payment.supplier_partner_id,
                 supplier.display_name AS supplier_name, payment.payment_date::text,
                 payment.payment_kind, payment.payment_method, payment.amount::text,
                 payment.allocated_total::text, payment.available_total::text,
                 payment.payment_reference, payment.notes, payment.source_bank_transaction_id,
                 payment.version, payment.recorded_at
          FROM finance.supplier_payments payment
          JOIN master_data.partners supplier ON supplier.id = payment.supplier_partner_id`;
}

function mapPayable(row: PayableRow, payments: FinanceSupplierPayment[]): FinanceSupplierPayable {
  return {
    allocatedTotal: row.allocated_total,
    bgnTotal: row.bgn_total,
    createdAt: asIso(row.created_at),
    currencyCode: row.currency_code,
    documentDate: row.document_date,
    dueDate: row.due_date,
    exchangeRate: row.exchange_rate,
    id: row.id,
    number: row.payable_number,
    outstandingTotal: row.outstanding_total,
    paymentStatus: row.payment_status,
    payments,
    rateDate: row.rate_date,
    rateSource: row.rate_source,
    sourceSupplierInvoiceId: row.source_supplier_invoice_id,
    sourceSupplierInvoiceNumber: row.source_supplier_invoice_number,
    supplierName: row.supplier_name,
    supplierPartnerId: row.supplier_partner_id,
    total: row.total,
    version: row.version,
  };
}

function mapPayment(
  row: SupplierPaymentRow,
  allocations: FinanceSupplierPaymentAllocation[],
): FinanceSupplierPayment {
  return {
    allocatedTotal: row.allocated_total,
    allocations,
    amount: row.amount,
    availableTotal: row.available_total,
    id: row.id,
    kind: row.payment_kind,
    ...(row.notes ? { notes: row.notes } : {}),
    number: row.payment_number,
    paymentDate: row.payment_date,
    paymentMethod: row.payment_method,
    ...(row.payment_reference ? { paymentReference: row.payment_reference } : {}),
    recordedAt: asIso(row.recorded_at),
    ...(row.source_bank_transaction_id
      ? { sourceBankTransactionId: row.source_bank_transaction_id }
      : {}),
    supplierName: row.supplier_name,
    supplierPartnerId: row.supplier_partner_id,
    version: row.version,
  };
}

function mapOffset(row: {
  amount: string;
  created_at: string | Date;
  customer_document_id: string;
  customer_document_number: string;
  id: string;
  offset_date: string;
  offset_number: string;
  partner_id: string;
  partner_name: string;
  reason: string;
  supplier_payable_id: string;
  supplier_payable_number: string;
}): FinanceSupplierOffset {
  return {
    amount: row.amount,
    createdAt: asIso(row.created_at),
    customerDocumentId: row.customer_document_id,
    customerDocumentNumber: row.customer_document_number,
    id: row.id,
    number: row.offset_number,
    offsetDate: row.offset_date,
    partnerId: row.partner_id,
    partnerName: row.partner_name,
    reason: row.reason,
    supplierPayableId: row.supplier_payable_id,
    supplierPayableNumber: row.supplier_payable_number,
  };
}

function normalizePayment(input: CreateFinanceSupplierPaymentRequest) {
  const notes = input.notes?.trim();
  const paymentReference = input.paymentReference?.trim();
  return {
    amount: positiveAmount(input.amount),
    ...(notes ? { notes } : {}),
    paymentDate: date(input.paymentDate),
    paymentMethod: input.paymentMethod,
    ...(paymentReference ? { paymentReference } : {}),
  };
}

function payableStatus(total: string, allocated: string, dueDate: string, asOf: string) {
  const outstanding = decimalUnits(total) - decimalUnits(allocated);
  if (outstanding === 0n) return 'paid' as const;
  if (dueDate < asOf) return 'overdue' as const;
  return decimalUnits(allocated) === 0n ? ('unpaid' as const) : ('partially_paid' as const);
}

function customerPaymentStatus(
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

function positiveAmount(value: string) {
  if (!/^\d+(\.\d{1,4})?$/u.test(value) || decimalUnits(value) <= 0n)
    throw badRequest('FINANCE_AMOUNT_INVALID', 'Enter an amount greater than zero.');
  return decimalString(decimalUnits(value));
}

function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw badRequest('FINANCE_DATE_INVALID', 'Enter a valid calendar date.');
  return value;
}

function requiredText(value: string, message: string) {
  const normalized = value.trim();
  if (!normalized) throw badRequest('FINANCE_FIELD_REQUIRED', message);
  return normalized;
}

function decimalUnits(value: string) {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(4, '0').slice(0, 4)}`);
}

function decimalString(units: bigint) {
  return `${units / 10_000n}.${(units % 10_000n).toString().padStart(4, '0')}`;
}

function validKey(key: string | undefined) {
  const normalized = key?.trim();
  if (!normalized || normalized.length > 200)
    throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
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
    throw conflict(
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used with different data.',
    );
  if (row.status === 'completed' && row.response_body) return row.response_body;
  throw conflict('IDEMPOTENT_REQUEST_IN_PROGRESS', 'This request is already being processed.');
}

function badRequest(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.BAD_REQUEST);
}

function unprocessable(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.UNPROCESSABLE_ENTITY);
}

function conflict(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.CONFLICT);
}

function notFound(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.NOT_FOUND);
}

function isUniqueViolation(error: unknown): error is { code: '23505' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function asIso(value: string | Date) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
