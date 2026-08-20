import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CreateFinanceBankStatementRequest,
  FinanceBankMatchCandidate,
  FinanceBankStatement,
  FinanceBankStatementPage,
  FinanceBankStatementSummary,
  FinanceBankTransaction,
  FinancePaymentStatus,
  MatchFinanceBankTransactionRequest,
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
import type { FinanceBankStatementListQueryDto } from './finance-bank.dto.js';

interface StatementSummaryRow {
  account_iban: string;
  bank_name: string;
  closing_balance: string;
  created_at: string | Date;
  currency_code: string;
  id: string;
  incoming_total: string;
  matched_incoming_count: string;
  matched_outgoing_count: string;
  opening_balance: string;
  outgoing_total: string;
  statement_date: string;
  statement_number: string;
  statement_reference: string;
  transaction_count: string;
  unmatched_incoming_count: string;
  unmatched_outgoing_count: string;
  version: number;
}

interface TransactionRow {
  amount: string;
  counterparty_iban: string | null;
  counterparty_name: string;
  direction: FinanceBankTransaction['direction'];
  document_number: string | null;
  id: string;
  line_number: number;
  match_method: NonNullable<FinanceBankTransaction['match']>['method'] | null;
  match_status: FinanceBankTransaction['matchStatus'];
  matched_at: string | Date | null;
  matched_customer_document_id: string | null;
  matched_payment_id: string | null;
  matched_supplier_payable_id: string | null;
  matched_supplier_payment_id: string | null;
  payment_number: string | null;
  payment_reference: string;
  supplier_name: string | null;
  supplier_partner_id: string | null;
  supplier_payable_number: string | null;
  supplier_payment_kind: 'advance' | 'offset' | 'payment' | null;
  supplier_payment_number: string | null;
  transaction_date: string;
  value_date: string;
  version: number;
  customer_name: string | null;
}

@Injectable()
export class FinanceBankService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async statements(query: FinanceBankStatementListQueryDto): Promise<FinanceBankStatementPage> {
    const page = query.page;
    const pageSize = query.pageSize;
    const values: unknown[] = [];
    const statusClause = query.status ? `WHERE summary.status = $${values.push(query.status)}` : '';
    const count = await this.database
      .getPool()
      .query<{ total: string }>(
        `SELECT count(*)::text AS total FROM (${statementSummaryQuery()}) summary ${statusClause}`,
        values,
      );
    const totalItems = Number(count.rows[0]?.total ?? 0);
    values.push(pageSize, (page - 1) * pageSize);
    const result = await this.database.getPool().query<StatementSummaryRow>(
      `SELECT summary.* FROM (${statementSummaryQuery()}) summary ${statusClause}
       ORDER BY summary.statement_date DESC, summary.created_at DESC, summary.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      items: result.rows.map(mapStatementSummary),
      page,
      pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    };
  }

  async statement(id: string): Promise<FinanceBankStatement> {
    const client = await this.database.getPool().connect();
    try {
      return await loadStatement(client, id);
    } finally {
      client.release();
    }
  }

  async matchCandidates(id: string): Promise<FinanceBankMatchCandidate[]> {
    const transaction = await this.database.getPool().query<{
      amount: string;
      counterparty_name: string;
      direction: string;
      match_status: string;
      payment_reference: string;
    }>(
      `SELECT amount::text, counterparty_name, direction, match_status, payment_reference
       FROM finance.bank_transactions WHERE id = $1`,
      [id],
    );
    const row = transaction.rows[0];
    if (!row) throw notFound('FINANCE_BANK_TRANSACTION_NOT_FOUND', 'Bank transaction not found.');
    if (row.direction !== 'incoming' || row.match_status === 'matched') return [];
    const candidates = await this.database.getPool().query<{
      customer_document_id: string;
      customer_name: string;
      document_number: string;
      due_date: string;
      outstanding_total: string;
      reference_matched: boolean;
      source_invoice_number: string;
    }>(
      `SELECT document.id AS customer_document_id, document.document_number,
              source.invoice_number AS source_invoice_number, customer.display_name AS customer_name,
              document.due_date::text, document.outstanding_total::text,
              ($1 ILIKE ('%' || document.document_number || '%')
                OR $1 ILIKE ('%' || source.invoice_number || '%')) AS reference_matched
       FROM finance.customer_documents document
       JOIN sales.invoices source ON source.id = document.source_sales_invoice_id
       JOIN master_data.partners customer ON customer.id = document.customer_partner_id
       WHERE document.review_state = 'pending_finance_review'
         AND document.currency_code = 'BGN'
         AND document.outstanding_total >= $2::numeric
       ORDER BY reference_matched DESC,
                (lower(customer.display_name) = lower($3)) DESC,
                (document.outstanding_total = $2::numeric) DESC,
                document.due_date, document.id
       LIMIT 50`,
      [row.payment_reference, row.amount, row.counterparty_name],
    );
    return candidates.rows
      .map((candidate) => ({
        customerDocumentId: candidate.customer_document_id,
        customerName: candidate.customer_name,
        documentNumber: candidate.document_number,
        dueDate: candidate.due_date,
        outstandingTotal: candidate.outstanding_total,
        referenceMatched: candidate.reference_matched,
        score:
          (candidate.reference_matched ? 60 : 0) +
          (decimalUnits(candidate.outstanding_total) === decimalUnits(row.amount) ? 30 : 0) +
          (candidate.customer_name.toLocaleLowerCase() === row.counterparty_name.toLocaleLowerCase()
            ? 10
            : 0),
        sourceInvoiceNumber: candidate.source_invoice_number,
      }))
      .sort((left, right) => right.score - left.score || left.dueDate.localeCompare(right.dueDate));
  }

  async createStatement(
    input: CreateFinanceBankStatementRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceBankStatement> {
    const normalized = normalizeStatement(input);
    return this.command(
      'finance.bank-statement.create',
      key,
      normalized,
      201,
      async (client, idempotencyKey) => {
        const id = randomUUID();
        const number = await this.nextNumber(client, 'bank_statement', 'BST');
        await client.query(
          `INSERT INTO finance.bank_statements (
           id, statement_number, statement_reference, bank_name, account_iban,
           statement_date, currency_code, opening_balance, closing_balance, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            id,
            number,
            normalized.statementReference,
            normalized.bankName,
            normalized.accountIban,
            normalized.statementDate,
            normalized.currencyCode,
            normalized.openingBalance,
            normalized.closingBalance,
            auth.accountId,
          ],
        );
        for (const [index, line] of normalized.lines.entries()) {
          const transactionId = randomUUID();
          await client.query(
            `INSERT INTO finance.bank_transactions (
             id, bank_statement_id, line_number, transaction_date, value_date, direction,
             amount, counterparty_name, counterparty_iban, payment_reference
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              transactionId,
              id,
              index + 1,
              line.transactionDate,
              line.valueDate,
              line.direction,
              line.amount,
              line.counterpartyName,
              line.counterpartyIban ?? null,
              line.paymentReference,
            ],
          );
          if (line.direction === 'incoming') {
            const exact = await exactReferenceCandidates(
              client,
              line.paymentReference,
              line.amount,
            );
            if (exact.length === 1)
              await this.allocateTransaction(
                client,
                transactionId,
                exact[0]!,
                'automatic_reference',
                auth,
                metadata,
                idempotencyKey,
              );
          }
        }
        const statement = await loadStatement(client, id);
        await this.sideEffects(
          client,
          'finance_bank_statement',
          id,
          'finance.bank-statement.created',
          statement,
          auth,
          metadata,
          idempotencyKey,
        );
        return statement;
      },
    );
  }

  async matchTransaction(
    id: string,
    input: MatchFinanceBankTransactionRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceBankStatement> {
    const normalized = {
      customerDocumentId: input.customerDocumentId,
      expectedVersion: input.expectedVersion,
    };
    return this.command(
      `finance.bank-transaction.match:${id}`,
      key,
      normalized,
      200,
      async (client, idempotencyKey) => {
        const transaction = await lockTransaction(client, id);
        if (transaction.version !== normalized.expectedVersion)
          throw conflict(
            'FINANCE_BANK_TRANSACTION_VERSION_CONFLICT',
            'This bank transaction changed after it was opened. Refresh and try again.',
          );
        if (transaction.match_status === 'matched')
          return loadStatement(client, transaction.bank_statement_id);
        await this.allocateTransaction(
          client,
          id,
          normalized.customerDocumentId,
          'manual',
          auth,
          metadata,
          idempotencyKey,
        );
        return loadStatement(client, transaction.bank_statement_id);
      },
    );
  }

  private async allocateTransaction(
    client: PoolClient,
    transactionId: string,
    customerDocumentId: string,
    method: 'automatic_reference' | 'manual',
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    commandKey: string,
  ) {
    const transaction = await lockTransaction(client, transactionId);
    if (transaction.match_status === 'matched') return;
    if (transaction.direction !== 'incoming')
      throw conflict(
        'FINANCE_BANK_TRANSACTION_DIRECTION_INVALID',
        'Only incoming bank transactions can be matched to customer collections.',
      );
    const documentResult = await client.query<{
      allocated_total: string;
      customer_partner_id: string;
      due_date: string;
      outstanding_total: string;
      payment_status: FinancePaymentStatus;
      review_state: string;
      total: string;
    }>(
      `SELECT customer_partner_id, total::text, allocated_total::text, outstanding_total::text,
              due_date::text, payment_status, review_state
       FROM finance.customer_documents WHERE id = $1 FOR UPDATE`,
      [customerDocumentId],
    );
    const document = documentResult.rows[0];
    if (!document)
      throw notFound('FINANCE_DOCUMENT_NOT_FOUND', 'The selected collection record was not found.');
    if (document.review_state !== 'pending_finance_review')
      throw conflict(
        'FINANCE_DOCUMENT_CANCELLED',
        'A bank transaction cannot be matched to a cancelled collection record.',
      );
    if (decimalUnits(transaction.amount) > decimalUnits(document.outstanding_total))
      throw conflict(
        'FINANCE_BANK_MATCH_EXCEEDS_BALANCE',
        'The bank transaction is greater than the remaining collection balance. Record the excess as an advance after the advance workflow is available.',
      );
    const paymentId = randomUUID();
    const paymentNumber = await this.nextNumber(client, 'payment', 'PAY');
    await client.query(
      `INSERT INTO finance.payments (
         id, payment_number, customer_partner_id, payment_date, payment_method,
         currency_code, amount, payment_reference, notes, recorded_by
       ) VALUES ($1,$2,$3,$4,'bank_transfer','BGN',$5,$6,$7,$8)`,
      [
        paymentId,
        paymentNumber,
        document.customer_partner_id,
        transaction.value_date,
        transaction.amount,
        transaction.payment_reference,
        `Matched from bank statement ${transaction.statement_number}, line ${transaction.line_number}.`,
        auth.accountId,
      ],
    );
    await client.query(
      `INSERT INTO finance.payment_allocations (
         id, payment_id, customer_document_id, amount, allocated_by
       ) VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), paymentId, customerDocumentId, transaction.amount, auth.accountId],
    );
    const allocatedTotal = decimalString(
      decimalUnits(document.allocated_total) + decimalUnits(transaction.amount),
    );
    const outstandingTotal = decimalString(
      decimalUnits(document.total) - decimalUnits(allocatedTotal),
    );
    const paymentStatus = statusFor(
      document.total,
      allocatedTotal,
      document.due_date,
      await this.businessDate(client),
    );
    await client.query(
      `UPDATE finance.customer_documents
       SET allocated_total = $2, outstanding_total = $3, payment_status = $4,
           version = version + 1, updated_at = now()
       WHERE id = $1`,
      [customerDocumentId, allocatedTotal, outstandingTotal, paymentStatus],
    );
    if (paymentStatus !== document.payment_status)
      await client.query(
        `INSERT INTO finance.payment_status_history (
           id, customer_document_id, previous_status, next_status, reason, changed_by
         ) VALUES ($1,$2,$3,$4,'bank_transaction_matched',$5)`,
        [randomUUID(), customerDocumentId, document.payment_status, paymentStatus, auth.accountId],
      );
    await client.query(
      `UPDATE finance.bank_transactions
       SET match_status = 'matched', match_method = $2, matched_customer_document_id = $3,
           matched_payment_id = $4, matched_by = $5, matched_at = now(),
           version = version + 1, updated_at = now()
       WHERE id = $1`,
      [transactionId, method, customerDocumentId, paymentId, auth.accountId],
    );
    await client.query(
      `UPDATE finance.bank_statements SET version = version + 1, updated_at = now() WHERE id = $1`,
      [transaction.bank_statement_id],
    );
    await this.sideEffects(
      client,
      'finance_bank_transaction',
      transactionId,
      'finance.bank-transaction.matched',
      {
        amount: transaction.amount,
        customerDocumentId,
        matchMethod: method,
        paymentId,
        paymentNumber,
        transactionId,
      },
      auth,
      metadata,
      `${commandKey}:${transactionId}`,
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
        throw conflict(
          'FINANCE_BANK_STATEMENT_CONFLICT',
          'This bank statement reference already exists for the selected account.',
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

function normalizeStatement(input: CreateFinanceBankStatementRequest) {
  const accountIban = normalizeIban(input.accountIban, 'Company account IBAN');
  const bankName = requiredText(input.bankName, 'Enter the bank name.');
  const statementReference = requiredText(
    input.statementReference,
    'Enter the statement reference.',
  );
  const currencyCode = input.currencyCode.trim().toUpperCase();
  if (currencyCode !== 'BGN')
    throw new ApiErrorException(
      'FINANCE_BANK_BGN_ONLY',
      'Foreign-currency bank statements require the approved BNB rate workflow.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  const openingBalance = normalizeSignedDecimal(input.openingBalance);
  const closingBalance = normalizeSignedDecimal(input.closingBalance);
  const statementDate = normalizeDate(input.statementDate);
  const lines = input.lines.map((line) => {
    const transactionDate = normalizeDate(line.transactionDate);
    const valueDate = normalizeDate(line.valueDate);
    if (valueDate < transactionDate)
      throw inputError(
        'FINANCE_BANK_VALUE_DATE_INVALID',
        'Value date cannot precede transaction date.',
      );
    return {
      amount: normalizePositiveDecimal(line.amount),
      ...(line.counterpartyIban
        ? { counterpartyIban: normalizeIban(line.counterpartyIban, 'Counterparty IBAN') }
        : {}),
      counterpartyName: requiredText(line.counterpartyName, 'Enter the counterparty name.'),
      direction: line.direction,
      paymentReference: requiredText(line.paymentReference, 'Enter the payment reference.'),
      transactionDate,
      valueDate,
    };
  });
  const calculatedClosing = lines.reduce(
    (total, line) =>
      total +
      (line.direction === 'incoming' ? decimalUnits(line.amount) : -decimalUnits(line.amount)),
    decimalUnits(openingBalance),
  );
  if (calculatedClosing !== decimalUnits(closingBalance))
    throw inputError(
      'FINANCE_BANK_BALANCE_MISMATCH',
      `Closing balance must be ${decimalString(calculatedClosing)} for the entered transactions.`,
    );
  return {
    accountIban,
    bankName,
    closingBalance,
    currencyCode,
    lines,
    openingBalance,
    statementDate,
    statementReference,
  };
}

async function exactReferenceCandidates(client: PoolClient, reference: string, amount: string) {
  const result = await client.query<{ id: string }>(
    `SELECT document.id
     FROM finance.customer_documents document
     JOIN sales.invoices source ON source.id = document.source_sales_invoice_id
     WHERE document.review_state = 'pending_finance_review'
       AND document.currency_code = 'BGN'
       AND document.outstanding_total >= $2::numeric
       AND ($1 ILIKE ('%' || document.document_number || '%')
         OR $1 ILIKE ('%' || source.invoice_number || '%'))
     ORDER BY document.id
     LIMIT 2`,
    [reference, amount],
  );
  return result.rows.map(({ id }) => id);
}

async function lockTransaction(client: PoolClient, id: string) {
  const result = await client.query<{
    amount: string;
    bank_statement_id: string;
    direction: string;
    line_number: number;
    match_status: string;
    payment_reference: string;
    statement_number: string;
    value_date: string;
    version: number;
  }>(
    `SELECT transaction.id, transaction.bank_statement_id, transaction.line_number,
            transaction.direction, transaction.amount::text, transaction.payment_reference,
            transaction.value_date::text, transaction.match_status, transaction.version,
            statement.statement_number
     FROM finance.bank_transactions transaction
     JOIN finance.bank_statements statement ON statement.id = transaction.bank_statement_id
     WHERE transaction.id = $1 FOR UPDATE OF transaction`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw notFound('FINANCE_BANK_TRANSACTION_NOT_FOUND', 'Bank transaction not found.');
  return row;
}

async function loadStatement(client: PoolClient, id: string): Promise<FinanceBankStatement> {
  const summary = await client.query<StatementSummaryRow>(
    `SELECT summary.* FROM (${statementSummaryQuery()}) summary WHERE summary.id = $1`,
    [id],
  );
  const row = summary.rows[0];
  if (!row) throw notFound('FINANCE_BANK_STATEMENT_NOT_FOUND', 'Bank statement not found.');
  const transactions = await client.query<TransactionRow>(
    `SELECT transaction.id, transaction.line_number, transaction.transaction_date::text,
            transaction.value_date::text, transaction.direction, transaction.amount::text,
            transaction.counterparty_name, transaction.counterparty_iban,
            transaction.payment_reference, transaction.match_status, transaction.match_method,
            transaction.matched_customer_document_id, transaction.matched_payment_id,
            transaction.matched_supplier_payable_id, transaction.matched_supplier_payment_id,
            transaction.matched_at, transaction.version, document.document_number,
            customer.display_name AS customer_name, payment.payment_number,
            supplier_payable.payable_number AS supplier_payable_number,
            supplier_payment.payment_number AS supplier_payment_number,
            supplier_payment.payment_kind AS supplier_payment_kind,
            supplier_payment.supplier_partner_id,
            supplier.display_name AS supplier_name
     FROM finance.bank_transactions transaction
     LEFT JOIN finance.customer_documents document
       ON document.id = transaction.matched_customer_document_id
     LEFT JOIN master_data.partners customer ON customer.id = document.customer_partner_id
     LEFT JOIN finance.payments payment ON payment.id = transaction.matched_payment_id
     LEFT JOIN finance.supplier_payables supplier_payable
       ON supplier_payable.id = transaction.matched_supplier_payable_id
     LEFT JOIN finance.supplier_payments supplier_payment
       ON supplier_payment.id = transaction.matched_supplier_payment_id
     LEFT JOIN master_data.partners supplier
       ON supplier.id = supplier_payment.supplier_partner_id
     WHERE transaction.bank_statement_id = $1
     ORDER BY transaction.line_number`,
    [id],
  );
  return { ...mapStatementSummary(row), transactions: transactions.rows.map(mapTransaction) };
}

function statementSummaryQuery() {
  return `SELECT statement.id, statement.statement_number, statement.statement_reference,
                 statement.bank_name, statement.account_iban, statement.statement_date::text,
                 statement.currency_code, statement.opening_balance::text,
                 statement.closing_balance::text, statement.version, statement.created_at,
                 count(transaction.id)::text AS transaction_count,
                 coalesce(sum(transaction.amount) FILTER (WHERE transaction.direction = 'incoming'), 0)::text AS incoming_total,
                 coalesce(sum(transaction.amount) FILTER (WHERE transaction.direction = 'outgoing'), 0)::text AS outgoing_total,
                 count(transaction.id) FILTER (
                   WHERE transaction.direction = 'incoming' AND transaction.match_status = 'matched'
                 )::text AS matched_incoming_count,
                 count(transaction.id) FILTER (
                   WHERE transaction.direction = 'incoming' AND transaction.match_status = 'unmatched'
                 )::text AS unmatched_incoming_count,
                 count(transaction.id) FILTER (
                   WHERE transaction.direction = 'outgoing' AND transaction.match_status = 'matched'
                 )::text AS matched_outgoing_count,
                 count(transaction.id) FILTER (
                   WHERE transaction.direction = 'outgoing' AND transaction.match_status = 'unmatched'
                 )::text AS unmatched_outgoing_count,
                 CASE WHEN count(transaction.id) FILTER (
                   WHERE transaction.match_status = 'unmatched'
                 ) = 0 THEN 'reconciled' ELSE 'open' END AS status
          FROM finance.bank_statements statement
          LEFT JOIN finance.bank_transactions transaction ON transaction.bank_statement_id = statement.id
          GROUP BY statement.id`;
}

function mapStatementSummary(row: StatementSummaryRow): FinanceBankStatementSummary {
  const unmatchedIncomingCount = Number(row.unmatched_incoming_count);
  const unmatchedOutgoingCount = Number(row.unmatched_outgoing_count);
  return {
    accountIban: row.account_iban,
    bankName: row.bank_name,
    closingBalance: row.closing_balance,
    createdAt: asIso(row.created_at),
    currencyCode: row.currency_code,
    id: row.id,
    incomingTotal: row.incoming_total,
    matchedIncomingCount: Number(row.matched_incoming_count),
    matchedOutgoingCount: Number(row.matched_outgoing_count),
    number: row.statement_number,
    openingBalance: row.opening_balance,
    outgoingTotal: row.outgoing_total,
    statementDate: row.statement_date,
    statementReference: row.statement_reference,
    status: unmatchedIncomingCount + unmatchedOutgoingCount === 0 ? 'reconciled' : 'open',
    transactionCount: Number(row.transaction_count),
    unmatchedIncomingCount,
    unmatchedOutgoingCount,
    version: row.version,
  };
}

function mapTransaction(row: TransactionRow): FinanceBankTransaction {
  return {
    amount: row.amount,
    ...(row.counterparty_iban ? { counterpartyIban: row.counterparty_iban } : {}),
    counterpartyName: row.counterparty_name,
    direction: row.direction,
    id: row.id,
    lineNumber: row.line_number,
    ...(row.match_status === 'matched' &&
    row.matched_customer_document_id &&
    row.document_number &&
    row.customer_name &&
    row.matched_at &&
    row.match_method &&
    row.payment_number
      ? {
          match: {
            customerDocumentId: row.matched_customer_document_id,
            customerName: row.customer_name,
            documentNumber: row.document_number,
            matchedAt: asIso(row.matched_at),
            method: row.match_method,
            paymentNumber: row.payment_number,
          },
        }
      : {}),
    ...(row.match_status === 'matched' &&
    row.matched_supplier_payment_id &&
    row.supplier_payment_number &&
    row.supplier_payment_kind &&
    row.supplier_partner_id &&
    row.supplier_name &&
    row.matched_at &&
    row.match_method
      ? {
          supplierMatch: {
            kind:
              row.supplier_payment_kind === 'advance' ? ('advance' as const) : ('payment' as const),
            matchedAt: asIso(row.matched_at),
            method: row.match_method,
            paymentNumber: row.supplier_payment_number,
            supplierName: row.supplier_name,
            supplierPartnerId: row.supplier_partner_id,
            ...(row.matched_supplier_payable_id
              ? { supplierPayableId: row.matched_supplier_payable_id }
              : {}),
            ...(row.supplier_payable_number
              ? { supplierPayableNumber: row.supplier_payable_number }
              : {}),
          },
        }
      : {}),
    matchStatus: row.match_status,
    paymentReference: row.payment_reference,
    transactionDate: row.transaction_date,
    valueDate: row.value_date,
    version: row.version,
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

function normalizeIban(value: string, label: string) {
  const iban = value.replace(/\s/gu, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/u.test(iban) || ibanRemainder(iban) !== 1)
    throw inputError('FINANCE_BANK_IBAN_INVALID', `${label} is not valid.`);
  return iban;
}

function ibanRemainder(iban: string) {
  let remainder = 0;
  for (const character of `${iban.slice(4)}${iban.slice(0, 4)}`) {
    const digits = /[A-Z]/u.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

function requiredText(value: string, message: string) {
  const normalized = value.trim();
  if (!normalized) throw inputError('FINANCE_BANK_FIELD_REQUIRED', message);
  return normalized;
}

function normalizeDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw inputError('FINANCE_DATE_INVALID', 'Enter a valid calendar date.');
  return value;
}

function normalizeSignedDecimal(value: string) {
  if (!/^-?\d+(\.\d{1,4})?$/u.test(value))
    throw inputError(
      'FINANCE_BANK_BALANCE_INVALID',
      'Enter a balance with no more than four decimal places.',
    );
  return decimalString(decimalUnits(value));
}

function normalizePositiveDecimal(value: string) {
  if (!/^\d+(\.\d{1,4})?$/u.test(value) || decimalUnits(value) <= 0n)
    throw inputError('FINANCE_AMOUNT_INVALID', 'Enter an amount greater than zero.');
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

function inputError(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.BAD_REQUEST);
}

function conflict(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.CONFLICT);
}

function notFound(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.NOT_FOUND);
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
  throw conflict('IDEMPOTENT_REQUEST_IN_PROGRESS', 'This request is already being processed.');
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
