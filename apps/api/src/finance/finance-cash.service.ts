import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CancelFinanceCashVoucherRequest,
  CreateFinanceCashVoucherRequest,
  FinanceCashDailyReport,
  FinanceCashReferenceData,
  FinanceCashVoucher,
  FinanceCashVoucherPage,
  FinancePaymentStatus,
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
import type {
  FinanceCashDailyReportQueryDto,
  FinanceCashVoucherListQueryDto,
} from './finance-cash.dto.js';

interface VoucherRow {
  amount: string;
  branch_name: string;
  business_location_id: string;
  business_location_name: string;
  cancellation_reason: string | null;
  cancelled_at: string | Date | null;
  cash_register_code: string;
  cash_register_id: string;
  cash_register_name: string;
  collection_number: string | null;
  counterparty_name: string;
  counterparty_partner_id: string | null;
  created_at: string | Date;
  currency_code: string;
  customer_document_id: string | null;
  direction: FinanceCashVoucher['direction'];
  id: string;
  issued_by_name: string;
  notes: string | null;
  operator_code: string;
  operator_id: string;
  operator_name: string;
  payment_number: string | null;
  payment_reference: string | null;
  purpose: string;
  status: FinanceCashVoucher['status'];
  version: number;
  voucher_date: string;
  voucher_number: string;
}

@Injectable()
export class FinanceCashService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async referenceData(): Promise<FinanceCashReferenceData> {
    const [registers, partners, collections, businessDate] = await Promise.all([
      this.database.getPool().query<{
        branch_name: string;
        business_location_id: string;
        business_location_name: string;
        cash_register_code: string;
        cash_register_id: string;
        cash_register_name: string;
        operator_code: string;
        operator_id: string;
        operator_name: string;
      }>(
        `SELECT register.id AS cash_register_id, register.code AS cash_register_code,
                register.name AS cash_register_name, location.id AS business_location_id,
                location.name AS business_location_name, branch.name AS branch_name,
                operator.id AS operator_id, operator.code AS operator_code,
                employee.display_name AS operator_name
         FROM organization.cash_registers register
         JOIN organization.business_locations location
           ON location.id = register.business_location_id
         JOIN organization.branches branch ON branch.id = location.branch_id
         JOIN organization.cash_register_operators assignment
           ON assignment.cash_register_id = register.id
          AND assignment.business_location_id = location.id AND assignment.active
         JOIN organization.operators operator
           ON operator.id = assignment.operator_id AND operator.active
         JOIN identity.user_accounts account ON account.id = operator.account_id
         JOIN identity.employees employee ON employee.id = account.employee_id
         WHERE register.active AND location.active AND branch.active AND account.status = 'active'
         ORDER BY branch.name, location.name, register.name, employee.display_name, operator.id`,
      ),
      this.database.getPool().query<{
        id: string;
        name: string;
        roles: Array<'customer' | 'supplier'>;
      }>(
        `SELECT partner.id, partner.display_name AS name,
                array_agg(role.role ORDER BY role.role) AS roles
         FROM master_data.partners partner
         JOIN master_data.partner_roles role ON role.partner_id = partner.id
         WHERE partner.active AND role.role IN ('customer', 'supplier')
         GROUP BY partner.id, partner.display_name
         ORDER BY partner.display_name, partner.id`,
      ),
      this.database.getPool().query<{
        customer_name: string;
        customer_partner_id: string;
        due_date: string;
        id: string;
        number: string;
        outstanding_total: string;
        source_invoice_number: string;
      }>(
        `SELECT document.id, document.document_number AS number,
                document.customer_partner_id, customer.display_name AS customer_name,
                document.due_date::text, document.outstanding_total::text,
                source.invoice_number AS source_invoice_number
         FROM finance.customer_documents document
         JOIN master_data.partners customer ON customer.id = document.customer_partner_id
         JOIN sales.invoices source ON source.id = document.source_sales_invoice_id
         WHERE document.review_state = 'pending_finance_review'
           AND document.currency_code = 'BGN' AND document.outstanding_total > 0
         ORDER BY document.due_date, document.document_number, document.id`,
      ),
      this.businessDate(),
    ]);
    const cashRegisters = new Map<string, FinanceCashReferenceData['cashRegisters'][number]>();
    for (const row of registers.rows) {
      const current = cashRegisters.get(row.cash_register_id);
      if (current) {
        current.operators.push({
          code: row.operator_code,
          id: row.operator_id,
          name: row.operator_name,
        });
      } else {
        cashRegisters.set(row.cash_register_id, {
          branchName: row.branch_name,
          businessLocationId: row.business_location_id,
          businessLocationName: row.business_location_name,
          code: row.cash_register_code,
          id: row.cash_register_id,
          name: row.cash_register_name,
          operators: [{ code: row.operator_code, id: row.operator_id, name: row.operator_name }],
        });
      }
    }
    return {
      businessDate,
      cashRegisters: [...cashRegisters.values()],
      openCollections: collections.rows.map((row) => ({
        customerName: row.customer_name,
        customerPartnerId: row.customer_partner_id,
        dueDate: row.due_date,
        id: row.id,
        number: row.number,
        outstandingTotal: row.outstanding_total,
        sourceInvoiceNumber: row.source_invoice_number,
      })),
      partners: partners.rows,
    };
  }

  async vouchers(query: FinanceCashVoucherListQueryDto): Promise<FinanceCashVoucherPage> {
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo)
      throw inputError(
        'FINANCE_CASH_DATE_RANGE_INVALID',
        'The start date cannot follow the end date.',
      );
    const values: unknown[] = [];
    const clauses: string[] = [];
    const add = (clause: string, value: unknown) => {
      values.push(value);
      clauses.push(clause.replace('?', `$${values.length}`));
    };
    if (query.cashRegisterId) add('voucher.cash_register_id = ?', query.cashRegisterId);
    if (query.dateFrom) add('voucher.voucher_date >= ?', query.dateFrom);
    if (query.dateTo) add('voucher.voucher_date <= ?', query.dateTo);
    if (query.direction) add('voucher.direction = ?', query.direction);
    if (query.status) add('voucher.status = ?', query.status);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const count = await this.database
      .getPool()
      .query<{ total: string }>(
        `SELECT count(*)::text AS total FROM finance.cash_vouchers voucher ${where}`,
        values,
      );
    const totalItems = Number(count.rows[0]?.total ?? 0);
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await this.database.getPool().query<VoucherRow>(
      `${voucherQuery()} ${where}
       ORDER BY voucher.voucher_date DESC, voucher.created_at DESC, voucher.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      items: result.rows.map(mapVoucher),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
    };
  }

  async voucher(id: string): Promise<FinanceCashVoucher> {
    const result = await this.database
      .getPool()
      .query<VoucherRow>(`${voucherQuery()} WHERE voucher.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw notFound('FINANCE_CASH_VOUCHER_NOT_FOUND', 'Cash voucher not found.');
    return mapVoucher(row);
  }

  async dailyReport(query: FinanceCashDailyReportQueryDto): Promise<FinanceCashDailyReport> {
    const reportDate = normalizeDate(query.date);
    const register = await this.database.getPool().query<{
      code: string;
      id: string;
      name: string;
    }>('SELECT id, code, name FROM organization.cash_registers WHERE id = $1', [query.cashRegisterId]);
    const registerRow = register.rows[0];
    if (!registerRow) throw notFound('FINANCE_CASH_REGISTER_NOT_FOUND', 'Cash register not found.');
    const [opening, totals, vouchers, generated] = await Promise.all([
      this.database.getPool().query<{ balance: string }>(
        `SELECT coalesce(sum(CASE WHEN direction = 'receipt' THEN amount ELSE -amount END), 0)::text AS balance
         FROM finance.cash_vouchers
         WHERE cash_register_id = $1 AND voucher_date < $2 AND status = 'issued'`,
        [query.cashRegisterId, reportDate],
      ),
      this.database.getPool().query<{
        payment_count: string;
        payment_total: string;
        receipt_count: string;
        receipt_total: string;
      }>(
        `SELECT count(*) FILTER (WHERE direction = 'receipt')::text AS receipt_count,
                count(*) FILTER (WHERE direction = 'payment')::text AS payment_count,
                coalesce(sum(amount) FILTER (WHERE direction = 'receipt'), 0)::text AS receipt_total,
                coalesce(sum(amount) FILTER (WHERE direction = 'payment'), 0)::text AS payment_total
         FROM finance.cash_vouchers
         WHERE cash_register_id = $1 AND voucher_date = $2 AND status = 'issued'`,
        [query.cashRegisterId, reportDate],
      ),
      this.database.getPool().query<VoucherRow>(
        `${voucherQuery()} WHERE voucher.cash_register_id = $1 AND voucher.voucher_date = $2
         ORDER BY voucher.created_at, voucher.id`,
        [query.cashRegisterId, reportDate],
      ),
      this.database
        .getPool()
        .query<{ generated_at: string | Date }>('SELECT now() AS generated_at'),
    ]);
    const summary = required(totals.rows[0], 'Daily cash totals query failed');
    const openingBalance = decimalString(decimalUnits(opening.rows[0]?.balance ?? '0'));
    const receiptTotal = decimalString(decimalUnits(summary.receipt_total));
    const paymentTotal = decimalString(decimalUnits(summary.payment_total));
    return {
      cashRegisterCode: registerRow.code,
      cashRegisterId: registerRow.id,
      cashRegisterName: registerRow.name,
      closingBalance: decimalString(
        decimalUnits(openingBalance) +
          decimalUnits(summary.receipt_total) -
          decimalUnits(summary.payment_total),
      ),
      generatedAt: asIso(required(generated.rows[0], 'Report timestamp query failed').generated_at),
      openingBalance,
      paymentCount: Number(summary.payment_count),
      paymentTotal,
      receiptCount: Number(summary.receipt_count),
      receiptTotal,
      reportDate,
      vouchers: vouchers.rows.map(mapVoucher),
    };
  }

  async createVoucher(
    input: CreateFinanceCashVoucherRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceCashVoucher> {
    const normalized = normalizeVoucher(input);
    return this.command(
      'finance.cash-voucher.create',
      key,
      normalized,
      201,
      async (client, commandKey) => {
        const businessDate = await this.businessDate(client);
        if (normalized.voucherDate > businessDate)
          throw inputError(
            'FINANCE_CASH_FUTURE_DATE_INVALID',
            'The voucher date cannot be after the current business date.',
          );
        const scope = await client.query<{
          business_location_id: string;
          cash_register_code: string;
          operator_code: string;
        }>(
          `SELECT register.business_location_id, register.code AS cash_register_code,
                  operator.code AS operator_code
           FROM organization.cash_registers register
           JOIN organization.cash_register_operators assignment
             ON assignment.cash_register_id = register.id
            AND assignment.business_location_id = register.business_location_id
            AND assignment.operator_id = $2 AND assignment.active
           JOIN organization.operators operator ON operator.id = assignment.operator_id
           JOIN organization.business_locations location
             ON location.id = register.business_location_id
           JOIN organization.branches branch ON branch.id = location.branch_id
           JOIN identity.user_accounts account ON account.id = operator.account_id
           WHERE register.id = $1 AND register.active AND operator.active
             AND location.active AND branch.active AND account.status = 'active'
           FOR KEY SHARE OF register, operator`,
          [normalized.cashRegisterId, normalized.operatorId],
        );
        const scopeRow = scope.rows[0];
        if (!scopeRow)
          throw inputError(
            'FINANCE_CASH_SCOPE_INVALID',
            'Choose an active operator assigned to the selected cash register.',
          );

        let counterpartyPartnerId = normalized.counterpartyPartnerId;
        let counterpartyName = normalized.counterpartyName;
        const customerDocumentId = normalized.customerDocumentId;
        let paymentId: string | undefined;
        let paymentNumber: string | undefined;
        let beforeDocument: CollectionRow | undefined;

        if (customerDocumentId) {
          if (normalized.direction !== 'receipt')
            throw inputError(
              'FINANCE_CASH_COLLECTION_DIRECTION_INVALID',
              'Only a cash receipt voucher can be allocated to a customer collection.',
            );
          const document = await client.query<CollectionRow>(
            `SELECT document.id, document.customer_partner_id, customer.display_name AS customer_name,
                    document.document_number, document.total::text, document.allocated_total::text,
                    document.outstanding_total::text, document.due_date::text,
                    document.payment_status, document.review_state, document.currency_code
             FROM finance.customer_documents document
             JOIN master_data.partners customer ON customer.id = document.customer_partner_id
             WHERE document.id = $1 FOR UPDATE OF document`,
            [customerDocumentId],
          );
          beforeDocument = document.rows[0];
          if (!beforeDocument)
            throw notFound(
              'FINANCE_DOCUMENT_NOT_FOUND',
              'The selected customer collection was not found.',
            );
          if (
            beforeDocument.review_state !== 'pending_finance_review' ||
            beforeDocument.currency_code !== 'BGN' ||
            decimalUnits(beforeDocument.outstanding_total) === 0n
          )
            throw conflict(
              'FINANCE_CASH_COLLECTION_UNAVAILABLE',
              'The selected customer collection cannot accept a cash receipt.',
            );
          if (decimalUnits(normalized.amount) > decimalUnits(beforeDocument.outstanding_total))
            throw conflict(
              'FINANCE_CASH_ALLOCATION_EXCEEDS_BALANCE',
              'The cash receipt exceeds the remaining collection balance.',
            );
          if (counterpartyPartnerId && counterpartyPartnerId !== beforeDocument.customer_partner_id)
            throw inputError(
              'FINANCE_CASH_COUNTERPARTY_MISMATCH',
              'The selected counterparty does not own this customer collection.',
            );
          counterpartyPartnerId = beforeDocument.customer_partner_id;
          counterpartyName = beforeDocument.customer_name;
        } else if (counterpartyPartnerId) {
          const partner = await client.query<{ display_name: string }>(
            'SELECT display_name FROM master_data.partners WHERE id = $1 AND active FOR KEY SHARE',
            [counterpartyPartnerId],
          );
          const partnerRow = partner.rows[0];
          if (!partnerRow)
            throw notFound(
              'FINANCE_CASH_PARTNER_NOT_FOUND',
              'The selected counterparty was not found.',
            );
          counterpartyName = partnerRow.display_name;
        }
        if (!counterpartyName)
          throw inputError(
            'FINANCE_CASH_COUNTERPARTY_REQUIRED',
            'Choose a counterparty or enter the counterparty name.',
          );

        const voucherId = randomUUID();
        const voucherNumber = await this.nextVoucherNumber(client, {
          businessLocationId: scopeRow.business_location_id,
          cashRegisterCode: scopeRow.cash_register_code,
          cashRegisterId: normalized.cashRegisterId,
          direction: normalized.direction,
          operatorCode: scopeRow.operator_code,
          operatorId: normalized.operatorId,
          voucherDate: normalized.voucherDate,
        });

        if (beforeDocument && customerDocumentId) {
          paymentId = randomUUID();
          paymentNumber = await this.nextInternalNumber(client, 'payment', 'PAY');
          await client.query(
            `INSERT INTO finance.payments (
               id, payment_number, customer_partner_id, payment_date, payment_method,
               currency_code, amount, payment_reference, notes, recorded_by
             ) VALUES ($1,$2,$3,$4,'cash','BGN',$5,$6,$7,$8)`,
            [
              paymentId,
              paymentNumber,
              beforeDocument.customer_partner_id,
              normalized.voucherDate,
              normalized.amount,
              normalized.paymentReference ?? voucherNumber,
              normalized.notes ?? `Allocated by cash receipt ${voucherNumber}.`,
              auth.accountId,
            ],
          );
          await client.query(
            `INSERT INTO finance.payment_allocations (
               id, payment_id, customer_document_id, amount, allocated_by
             ) VALUES ($1,$2,$3,$4,$5)`,
            [randomUUID(), paymentId, customerDocumentId, normalized.amount, auth.accountId],
          );
          const allocatedTotal = decimalString(
            decimalUnits(beforeDocument.allocated_total) + decimalUnits(normalized.amount),
          );
          const outstandingTotal = decimalString(
            decimalUnits(beforeDocument.total) - decimalUnits(allocatedTotal),
          );
          const paymentStatus = statusFor(
            beforeDocument.total,
            allocatedTotal,
            beforeDocument.due_date,
            businessDate,
          );
          await client.query(
            `UPDATE finance.customer_documents
             SET allocated_total = $2, outstanding_total = $3, payment_status = $4,
                 version = version + 1, updated_at = now()
             WHERE id = $1`,
            [customerDocumentId, allocatedTotal, outstandingTotal, paymentStatus],
          );
          if (paymentStatus !== beforeDocument.payment_status)
            await client.query(
              `INSERT INTO finance.payment_status_history (
                 id, customer_document_id, previous_status, next_status, reason, changed_by
               ) VALUES ($1,$2,$3,$4,'cash_voucher_recorded',$5)`,
              [
                randomUUID(),
                customerDocumentId,
                beforeDocument.payment_status,
                paymentStatus,
                auth.accountId,
              ],
            );
        }

        await client.query(
          `INSERT INTO finance.cash_vouchers (
             id, voucher_number, direction, business_location_id, cash_register_id,
             operator_id, voucher_date, amount, counterparty_partner_id, counterparty_name,
             customer_document_id, generated_payment_id, purpose, payment_reference,
             notes, issued_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            voucherId,
            voucherNumber,
            normalized.direction,
            scopeRow.business_location_id,
            normalized.cashRegisterId,
            normalized.operatorId,
            normalized.voucherDate,
            normalized.amount,
            counterpartyPartnerId ?? null,
            counterpartyName,
            customerDocumentId ?? null,
            paymentId ?? null,
            normalized.purpose,
            normalized.paymentReference ?? null,
            normalized.notes ?? null,
            auth.accountId,
          ],
        );
        const voucher = await loadVoucher(client, voucherId);
        await this.sideEffects(
          client,
          voucherId,
          'finance.cash-voucher.issued',
          { ...(paymentNumber ? { paymentNumber } : {}), voucher },
          auth,
          metadata,
          commandKey,
        );
        return voucher;
      },
    );
  }

  async cancelVoucher(
    id: string,
    input: CancelFinanceCashVoucherRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceCashVoucher> {
    const cancellationReason = requiredText(
      input.cancellationReason,
      'Enter a cancellation reason.',
    );
    return this.command(
      `finance.cash-voucher.cancel:${id}`,
      key,
      { cancellationReason, expectedVersion: input.expectedVersion },
      200,
      async (client, commandKey) => {
        const locked = await client.query<VoucherRow>(
          `${voucherQuery()} WHERE voucher.id = $1 FOR UPDATE OF voucher`,
          [id],
        );
        const row = locked.rows[0];
        if (!row) throw notFound('FINANCE_CASH_VOUCHER_NOT_FOUND', 'Cash voucher not found.');
        const before = mapVoucher(row);
        if (before.version !== input.expectedVersion)
          throw conflict(
            'FINANCE_CASH_VOUCHER_VERSION_CONFLICT',
            'This cash voucher changed after it was opened. Refresh and try again.',
          );
        if (before.status === 'cancelled') return before;
        if (before.customerDocumentId)
          throw conflict(
            'FINANCE_CASH_LINKED_REVERSAL_REQUIRED',
            'A receipt allocated to a customer collection requires the approved payment-reversal workflow and cannot be cancelled here.',
          );
        await client.query(
          `UPDATE finance.cash_vouchers
           SET status = 'cancelled', cancellation_reason = $2, cancelled_at = now(),
               cancelled_by = $3, version = version + 1, updated_at = now()
           WHERE id = $1`,
          [id, cancellationReason, auth.accountId],
        );
        const voucher = await loadVoucher(client, id);
        await this.sideEffects(
          client,
          id,
          'finance.cash-voucher.cancelled',
          voucher,
          auth,
          metadata,
          commandKey,
          before,
        );
        return voucher;
      },
    );
  }

  private async nextVoucherNumber(
    client: PoolClient,
    scope: {
      businessLocationId: string;
      cashRegisterCode: string;
      cashRegisterId: string;
      direction: FinanceCashVoucher['direction'];
      operatorCode: string;
      operatorId: string;
      voucherDate: string;
    },
  ) {
    const sequenceYear = Number(scope.voucherDate.slice(0, 4));
    await client.query(
      `INSERT INTO finance.cash_voucher_sequences (
         business_location_id, cash_register_id, operator_id, direction, sequence_year
       ) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [
        scope.businessLocationId,
        scope.cashRegisterId,
        scope.operatorId,
        scope.direction,
        sequenceYear,
      ],
    );
    const allocated = await client.query<{ value: string }>(
      `UPDATE finance.cash_voucher_sequences SET next_value = next_value + 1
       WHERE business_location_id = $1 AND cash_register_id = $2 AND operator_id = $3
         AND direction = $4 AND sequence_year = $5
       RETURNING (next_value - 1)::text AS value`,
      [
        scope.businessLocationId,
        scope.cashRegisterId,
        scope.operatorId,
        scope.direction,
        sequenceYear,
      ],
    );
    const value = required(allocated.rows[0], 'Cash voucher sequence allocation failed').value;
    const prefix = scope.direction === 'receipt' ? 'CRV' : 'CPV';
    return `${prefix}-${numberCode(scope.cashRegisterCode)}-${numberCode(scope.operatorCode)}-${sequenceYear}-${value.padStart(6, '0')}`;
  }

  private async nextInternalNumber(client: PoolClient, type: string, prefix: string) {
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

  private async businessDate(client?: PoolClient) {
    const executor = client ?? this.database.getPool();
    const result = await executor.query<{ date: string }>(
      `SELECT (now() AT TIME ZONE $1)::date::text AS date`,
      [this.environment.BUSINESS_TIMEZONE],
    );
    return required(result.rows[0], 'Business date calculation failed').date;
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
        throw conflict(
          'FINANCE_CASH_VOUCHER_CONFLICT',
          'This cash operation conflicts with an existing record.',
        );
      throw error;
    } finally {
      client.release();
    }
  }

  private async sideEffects(
    client: PoolClient,
    targetId: string,
    eventType: string,
    payload: object,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    idempotencyKey: string,
    before?: object,
  ) {
    const compactKey = createHash('sha256').update(idempotencyKey).digest('hex');
    await client.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1,'finance_cash_voucher',$2,$3,1,$4,$5,$6)`,
      [
        randomUUID(),
        targetId,
        eventType,
        metadata.correlationId,
        `${eventType}:${compactKey}`,
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
        targetType: 'finance_cash_voucher',
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
      client,
    );
  }
}

interface CollectionRow {
  allocated_total: string;
  currency_code: string;
  customer_name: string;
  customer_partner_id: string;
  document_number: string;
  due_date: string;
  id: string;
  outstanding_total: string;
  payment_status: FinancePaymentStatus;
  review_state: string;
  total: string;
}

function voucherQuery() {
  return `SELECT voucher.id, voucher.voucher_number, voucher.direction, voucher.status,
                 voucher.business_location_id, location.name AS business_location_name,
                 branch.name AS branch_name, voucher.cash_register_id,
                 register.code AS cash_register_code, register.name AS cash_register_name,
                 voucher.operator_id, operator.code AS operator_code,
                 operator_employee.display_name AS operator_name,
                 voucher.voucher_date::text, voucher.currency_code, voucher.amount::text,
                 voucher.counterparty_partner_id, voucher.counterparty_name,
                 voucher.customer_document_id, document.document_number AS collection_number,
                 payment.payment_number, voucher.purpose, voucher.payment_reference,
                 voucher.notes, voucher.cancellation_reason, voucher.cancelled_at,
                 voucher.version, issuer_employee.display_name AS issued_by_name,
                 voucher.created_at
          FROM finance.cash_vouchers voucher
          JOIN organization.business_locations location
            ON location.id = voucher.business_location_id
          JOIN organization.branches branch ON branch.id = location.branch_id
          JOIN organization.cash_registers register ON register.id = voucher.cash_register_id
          JOIN organization.operators operator ON operator.id = voucher.operator_id
          JOIN identity.user_accounts operator_account ON operator_account.id = operator.account_id
          JOIN identity.employees operator_employee
            ON operator_employee.id = operator_account.employee_id
          JOIN identity.user_accounts issuer_account ON issuer_account.id = voucher.issued_by
          JOIN identity.employees issuer_employee ON issuer_employee.id = issuer_account.employee_id
          LEFT JOIN finance.customer_documents document
            ON document.id = voucher.customer_document_id
          LEFT JOIN finance.payments payment ON payment.id = voucher.generated_payment_id`;
}

async function loadVoucher(client: PoolClient, id: string) {
  const result = await client.query<VoucherRow>(`${voucherQuery()} WHERE voucher.id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw notFound('FINANCE_CASH_VOUCHER_NOT_FOUND', 'Cash voucher not found.');
  return mapVoucher(row);
}

function mapVoucher(row: VoucherRow): FinanceCashVoucher {
  return {
    amount: row.amount,
    branchName: row.branch_name,
    businessLocationId: row.business_location_id,
    businessLocationName: row.business_location_name,
    ...(row.cancelled_at ? { cancelledAt: asIso(row.cancelled_at) } : {}),
    ...(row.cancellation_reason ? { cancellationReason: row.cancellation_reason } : {}),
    cashRegisterCode: row.cash_register_code,
    cashRegisterId: row.cash_register_id,
    cashRegisterName: row.cash_register_name,
    ...(row.collection_number ? { collectionNumber: row.collection_number } : {}),
    counterpartyName: row.counterparty_name,
    ...(row.counterparty_partner_id ? { counterpartyPartnerId: row.counterparty_partner_id } : {}),
    createdAt: asIso(row.created_at),
    currencyCode: row.currency_code,
    ...(row.customer_document_id ? { customerDocumentId: row.customer_document_id } : {}),
    direction: row.direction,
    id: row.id,
    issuedByName: row.issued_by_name,
    ...(row.notes ? { notes: row.notes } : {}),
    number: row.voucher_number,
    operatorCode: row.operator_code,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    ...(row.payment_number ? { paymentNumber: row.payment_number } : {}),
    ...(row.payment_reference ? { paymentReference: row.payment_reference } : {}),
    purpose: row.purpose,
    status: row.status,
    version: row.version,
    voucherDate: row.voucher_date,
  };
}

function normalizeVoucher(input: CreateFinanceCashVoucherRequest) {
  const counterpartyName = optionalText(input.counterpartyName);
  const notes = optionalText(input.notes);
  const paymentReference = optionalText(input.paymentReference);
  return {
    amount: normalizePositiveDecimal(input.amount),
    cashRegisterId: input.cashRegisterId,
    ...(counterpartyName ? { counterpartyName } : {}),
    ...(input.counterpartyPartnerId ? { counterpartyPartnerId: input.counterpartyPartnerId } : {}),
    ...(input.customerDocumentId ? { customerDocumentId: input.customerDocumentId } : {}),
    direction: input.direction,
    ...(notes ? { notes } : {}),
    operatorId: input.operatorId,
    ...(paymentReference ? { paymentReference } : {}),
    purpose: requiredText(input.purpose, 'Enter the reason for the cash movement.'),
    voucherDate: normalizeDate(input.voucherDate),
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
    throw inputError('FINANCE_CASH_DATE_INVALID', 'Enter a valid date.');
  return value;
}

function normalizePositiveDecimal(value: string) {
  if (!/^\d+(\.\d{1,4})?$/u.test(value) || decimalUnits(value) <= 0n)
    throw inputError(
      'FINANCE_CASH_AMOUNT_INVALID',
      'Enter an amount greater than zero with no more than four decimal places.',
    );
  return decimalString(decimalUnits(value));
}

function decimalUnits(value: string) {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const units = BigInt(`${whole}${fraction.padEnd(4, '0').slice(0, 4)}`);
  return negative ? -units : units;
}

function decimalString(units: bigint) {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  return `${negative ? '-' : ''}${absolute / 10_000n}.${(absolute % 10_000n).toString().padStart(4, '0')}`;
}

function requiredText(value: string, message: string) {
  const normalized = value.trim();
  if (!normalized) throw inputError('FINANCE_CASH_TEXT_REQUIRED', message);
  return normalized;
}

function optionalText(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function numberCode(value: string) {
  const code = value
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/gu, '-')
    .replaceAll(/^-|-$/gu, '');
  return code.slice(0, 30) || 'NA';
}

function asIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function validKey(key: string | undefined) {
  const normalized = key?.trim();
  if (!normalized || normalized.length > 200)
    throw inputError('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
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
  throw conflict('IDEMPOTENCY_REQUEST_IN_PROGRESS', 'This cash operation is already in progress.');
}

function inputError(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.BAD_REQUEST);
}

function conflict(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.CONFLICT);
}

function notFound(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.NOT_FOUND);
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
