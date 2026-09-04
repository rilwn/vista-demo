import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CreateCustomerAdvanceRequest,
  CustomerAdvance,
  CustomerPaymentAccount,
  CustomerPaymentAccountReferenceData,
  UpsertCustomerPaymentTermsRequest,
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

interface AccountRow {
  customer_name: string;
  customer_partner_id: string;
  terms_credit_limit_bgn: string | null;
  terms_id: string | null;
  terms_on_account_enabled: boolean | null;
  terms_payment_terms_days: number | null;
  terms_status: 'active' | 'suspended' | null;
  terms_valid_from: string | null;
  terms_valid_to: string | null;
  terms_version: number | null;
  uic: string | null;
}

interface AdvanceRow {
  advance_number: string;
  amount: string;
  available_amount: string;
  customer_partner_id: string;
  id: string;
  payment_method: CustomerAdvance['paymentMethod'];
  payment_reference: string | null;
  received_on: string;
}

@Injectable()
export class FinanceCustomerAccountsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async referenceData(): Promise<CustomerPaymentAccountReferenceData> {
    const result = await this.database.getPool().query<{
      id: string;
      name: string;
      uic: string | null;
    }>(
      `SELECT partner.id, partner.display_name AS name, partner.uic
       FROM master_data.partners partner
       JOIN master_data.partner_roles role
         ON role.partner_id = partner.id AND role.role = 'customer'
       WHERE partner.active
       ORDER BY partner.normalized_name, partner.id`,
    );
    return {
      customers: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        ...(row.uic ? { uic: row.uic } : {}),
      })),
    };
  }

  async list(): Promise<CustomerPaymentAccount[]> {
    const rows = await this.database.getPool().query<{ customer_partner_id: string }>(
      `SELECT partner.id AS customer_partner_id
       FROM master_data.partners partner
       JOIN master_data.partner_roles role
         ON role.partner_id = partner.id AND role.role = 'customer'
       WHERE EXISTS (
         SELECT 1 FROM sales.customer_payment_terms terms
         WHERE terms.customer_partner_id = partner.id
       ) OR EXISTS (
         SELECT 1 FROM finance.customer_advances advance
         WHERE advance.customer_partner_id = partner.id
       ) OR EXISTS (
         SELECT 1 FROM finance.customer_account_entries entry
         WHERE entry.customer_partner_id = partner.id
       )
       ORDER BY partner.normalized_name, partner.id`,
    );
    return Promise.all(rows.rows.map((row) => this.account(row.customer_partner_id)));
  }

  async account(customerPartnerId: string): Promise<CustomerPaymentAccount> {
    const client = await this.database.getPool().connect();
    try {
      return await this.loadAccount(client, customerPartnerId);
    } finally {
      client.release();
    }
  }

  async upsertTerms(
    customerPartnerId: string,
    input: UpsertCustomerPaymentTermsRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CustomerPaymentAccount> {
    const normalized = normalizeTerms(input);
    return this.command(
      `finance.customer-payment-terms.upsert:${customerPartnerId}`,
      key,
      normalized,
      HttpStatus.OK,
      async (client, idempotencyKey) => {
        await this.requireCustomer(client, customerPartnerId);
        const current = await client.query<{ id: string; version: number }>(
          `SELECT id, version FROM sales.customer_payment_terms
           WHERE customer_partner_id = $1 FOR UPDATE`,
          [customerPartnerId],
        );
        const before = current.rows[0];
        if (before && normalized.expectedVersion !== before.version)
          throw new ApiErrorException(
            'CUSTOMER_PAYMENT_TERMS_CHANGED',
            'The customer payment terms changed while you were editing them. Refresh and try again.',
            HttpStatus.CONFLICT,
          );
        if (!before && normalized.expectedVersion !== undefined)
          throw new ApiErrorException(
            'CUSTOMER_PAYMENT_TERMS_CHANGED',
            'These customer payment terms no longer match the current record.',
            HttpStatus.CONFLICT,
          );
        const id = before?.id ?? randomUUID();
        if (before)
          await client.query(
            `UPDATE sales.customer_payment_terms
             SET on_account_enabled = $2, credit_limit_bgn = $3,
                 payment_terms_days = $4, valid_from = $5, valid_to = $6,
                 status = $7, version = version + 1, updated_by = $8,
                 updated_at = now()
             WHERE id = $1`,
            [
              id,
              normalized.onAccountEnabled,
              normalized.creditLimitBgn,
              normalized.paymentTermsDays,
              normalized.validFrom,
              normalized.validTo ?? null,
              normalized.status,
              auth.accountId,
            ],
          );
        else
          await client.query(
            `INSERT INTO sales.customer_payment_terms (
               id, customer_partner_id, on_account_enabled, credit_limit_bgn,
               payment_terms_days, valid_from, valid_to, status, created_by, updated_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
            [
              id,
              customerPartnerId,
              normalized.onAccountEnabled,
              normalized.creditLimitBgn,
              normalized.paymentTermsDays,
              normalized.validFrom,
              normalized.validTo ?? null,
              normalized.status,
              auth.accountId,
            ],
          );
        const account = await this.loadAccount(client, customerPartnerId);
        await this.sideEffects(
          client,
          'customer_payment_terms',
          id,
          before
            ? 'finance.customer-payment-terms.updated'
            : 'finance.customer-payment-terms.created',
          account,
          auth,
          metadata,
          idempotencyKey,
        );
        return account;
      },
    );
  }

  async createAdvance(
    input: CreateCustomerAdvanceRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CustomerAdvance> {
    const normalized = normalizeAdvance(input);
    return this.command(
      'finance.customer-advance.create',
      key,
      normalized,
      HttpStatus.CREATED,
      async (client, idempotencyKey) => {
        await this.requireCustomer(client, normalized.customerPartnerId);
        const id = randomUUID();
        const number = await this.nextNumber(client);
        await client.query(
          `INSERT INTO finance.customer_advances (
             id, advance_number, customer_partner_id, amount, received_on,
             payment_method, payment_reference, recorded_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            number,
            normalized.customerPartnerId,
            normalized.amount,
            normalized.receivedOn,
            normalized.paymentMethod,
            normalized.paymentReference ?? null,
            auth.accountId,
          ],
        );
        await client.query(
          `INSERT INTO finance.customer_advance_entries (
             id, advance_id, entry_type, amount, actor_account_id, correlation_id
           ) VALUES ($1,$2,'received',$3,$4,$5)`,
          [randomUUID(), id, normalized.amount, auth.accountId, metadata.correlationId],
        );
        const advance = await this.loadAdvance(client, id);
        await this.sideEffects(
          client,
          'customer_advance',
          id,
          'finance.customer-advance.recorded',
          advance,
          auth,
          metadata,
          idempotencyKey,
        );
        return advance;
      },
    );
  }

  private async loadAccount(
    client: Pick<PoolClient, 'query'>,
    customerPartnerId: string,
  ): Promise<CustomerPaymentAccount> {
    const result = await client.query<AccountRow>(
      `SELECT partner.id AS customer_partner_id, partner.display_name AS customer_name,
         partner.uic, terms.id AS terms_id,
         terms.on_account_enabled AS terms_on_account_enabled,
         terms.credit_limit_bgn::text AS terms_credit_limit_bgn,
         terms.payment_terms_days AS terms_payment_terms_days,
         terms.valid_from::text AS terms_valid_from,
         terms.valid_to::text AS terms_valid_to, terms.status AS terms_status,
         terms.version AS terms_version
       FROM master_data.partners partner
       JOIN master_data.partner_roles role
         ON role.partner_id = partner.id AND role.role = 'customer'
       LEFT JOIN sales.customer_payment_terms terms
         ON terms.customer_partner_id = partner.id
       WHERE partner.id = $1`,
      [customerPartnerId],
    );
    const row = result.rows[0];
    if (!row)
      throw new ApiErrorException(
        'CUSTOMER_ACCOUNT_NOT_FOUND',
        'The selected customer account was not found.',
        HttpStatus.NOT_FOUND,
      );
    const advances = await client.query<AdvanceRow>(
      advanceQuery('advance.customer_partner_id = $1'),
      [customerPartnerId],
    );
    const balance = await client.query<{ outstanding_balance: string }>(
      `SELECT COALESCE(sum(CASE entry.entry_type
         WHEN 'charge' THEN entry.amount ELSE -entry.amount END), 0)::text
         AS outstanding_balance
       FROM finance.customer_account_entries entry
       WHERE entry.customer_partner_id = $1`,
      [customerPartnerId],
    );
    const entries = await client.query<{
      amount: string;
      due_on: string;
      entry_type: 'charge' | 'return_credit';
      id: string;
      occurred_at: string | Date;
      return_number: string | null;
      sale_number: string;
    }>(
      `SELECT entry.id, entry.entry_type, entry.amount::text, entry.due_on::text,
         entry.occurred_at, sale.sale_number, pos_return.return_number
       FROM finance.customer_account_entries entry
       JOIN pos.sales sale ON sale.id = entry.pos_sale_id
       LEFT JOIN pos.returns pos_return ON pos_return.id = entry.pos_return_id
       WHERE entry.customer_partner_id = $1
       ORDER BY entry.occurred_at DESC, entry.id DESC LIMIT 50`,
      [customerPartnerId],
    );
    const businessDate = await this.businessDate(client);
    const outstandingBalance = decimalString(units(balance.rows[0]?.outstanding_balance ?? '0'));
    const termsCurrent =
      row.terms_id &&
      row.terms_status === 'active' &&
      row.terms_on_account_enabled &&
      required(row.terms_valid_from, 'Payment terms start date is missing') <= businessDate &&
      (!row.terms_valid_to || row.terms_valid_to >= businessDate);
    const availableCredit = termsCurrent
      ? decimalString(
          maximum(
            0n,
            units(required(row.terms_credit_limit_bgn, 'Credit limit is missing')) -
              units(outstandingBalance),
          ),
        )
      : '0.0000';
    return {
      advanceBalance: sumDecimals(advances.rows.map((advance) => advance.available_amount)),
      advances: advances.rows.map(mapAdvance),
      availableCredit,
      customerName: row.customer_name,
      customerPartnerId: row.customer_partner_id,
      entries: entries.rows.map((entry) => ({
        amount: entry.amount,
        dueOn: entry.due_on,
        entryType: entry.entry_type,
        id: entry.id,
        occurredAt: iso(entry.occurred_at),
        saleNumber: entry.sale_number,
        ...(entry.return_number ? { returnNumber: entry.return_number } : {}),
      })),
      outstandingBalance,
      ...(row.terms_id
        ? {
            terms: {
              creditLimitBgn: required(row.terms_credit_limit_bgn, 'Credit limit is missing'),
              id: row.terms_id,
              onAccountEnabled: Boolean(row.terms_on_account_enabled),
              paymentTermsDays: required(
                row.terms_payment_terms_days,
                'Payment terms days are missing',
              ),
              status: required(row.terms_status, 'Payment terms status is missing'),
              validFrom: required(row.terms_valid_from, 'Payment terms start date is missing'),
              ...(row.terms_valid_to ? { validTo: row.terms_valid_to } : {}),
              version: required(row.terms_version, 'Payment terms version is missing'),
            },
          }
        : {}),
      ...(row.uic ? { uic: row.uic } : {}),
    };
  }

  private async loadAdvance(client: Pick<PoolClient, 'query'>, id: string) {
    const result = await client.query<AdvanceRow>(advanceQuery('advance.id = $1'), [id]);
    return mapAdvance(required(result.rows[0], 'Customer advance lookup failed'));
  }

  private async requireCustomer(client: PoolClient, id: string) {
    const result = await client.query(
      `SELECT partner.id FROM master_data.partners partner
       JOIN master_data.partner_roles role
         ON role.partner_id = partner.id AND role.role = 'customer'
       WHERE partner.id = $1 AND partner.active FOR KEY SHARE OF partner`,
      [id],
    );
    if (!result.rowCount)
      throw new ApiErrorException(
        'CUSTOMER_NOT_AVAILABLE',
        'Choose an active customer.',
        HttpStatus.CONFLICT,
      );
  }

  private async nextNumber(client: PoolClient) {
    const businessDate = await this.businessDate(client);
    await client.query(
      `INSERT INTO finance.internal_document_sequences (document_type)
       VALUES ('customer_advance') ON CONFLICT (document_type) DO NOTHING`,
    );
    const result = await client.query<{ allocated: string }>(
      `UPDATE finance.internal_document_sequences SET next_value = next_value + 1
       WHERE document_type = 'customer_advance'
       RETURNING (next_value - 1)::text AS allocated`,
    );
    return `ADV-${businessDate.slice(0, 4)}-${required(result.rows[0], 'Sequence failed').allocated.padStart(6, '0')}`;
  }

  private async businessDate(client: Pick<PoolClient, 'query'>) {
    const result = await client.query<{ date: string }>(
      `SELECT (now() AT TIME ZONE $1)::date::text AS date`,
      [this.environment.BUSINESS_TIMEZONE],
    );
    return required(result.rows[0], 'Business date lookup failed').date;
  }

  private async command<T>(
    scope: string,
    key: string | undefined,
    payload: object,
    status: number,
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
        [scope, idempotencyKey, status, result],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error))
        throw new ApiErrorException(
          'CUSTOMER_ACCOUNT_CONFLICT',
          'This customer payment record conflicts with an existing record.',
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

function advanceQuery(where: string) {
  return `SELECT advance.id, advance.advance_number, advance.customer_partner_id,
      advance.amount::text, advance.received_on::text, advance.payment_method,
      advance.payment_reference,
      COALESCE(sum(CASE entry.entry_type
        WHEN 'applied' THEN -entry.amount ELSE entry.amount END), 0)::text
        AS available_amount
    FROM finance.customer_advances advance
    JOIN finance.customer_advance_entries entry ON entry.advance_id = advance.id
    WHERE ${where}
    GROUP BY advance.id
    HAVING COALESCE(sum(CASE entry.entry_type
      WHEN 'applied' THEN -entry.amount ELSE entry.amount END), 0) > 0
    ORDER BY advance.received_on, advance.advance_number, advance.id`;
}

function mapAdvance(row: AdvanceRow): CustomerAdvance {
  return {
    amount: row.amount,
    availableAmount: row.available_amount,
    customerPartnerId: row.customer_partner_id,
    id: row.id,
    number: row.advance_number,
    paymentMethod: row.payment_method,
    ...(row.payment_reference ? { paymentReference: row.payment_reference } : {}),
    receivedOn: row.received_on,
  };
}

function normalizeTerms(input: UpsertCustomerPaymentTermsRequest) {
  const creditLimitBgn = decimal(input.creditLimitBgn, false);
  if (input.onAccountEnabled && units(creditLimitBgn) <= 0n)
    throw new ApiErrorException(
      'CUSTOMER_CREDIT_LIMIT_REQUIRED',
      'Enter a credit limit greater than zero when on-account payment is enabled.',
      HttpStatus.BAD_REQUEST,
    );
  if (input.validTo && input.validTo < input.validFrom)
    throw new ApiErrorException(
      'CUSTOMER_PAYMENT_TERMS_PERIOD_INVALID',
      'The end date cannot be before the start date.',
      HttpStatus.BAD_REQUEST,
    );
  return {
    creditLimitBgn,
    ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
    onAccountEnabled: input.onAccountEnabled,
    paymentTermsDays: input.paymentTermsDays,
    status: input.status,
    validFrom: input.validFrom,
    ...(input.validTo ? { validTo: input.validTo } : {}),
  };
}

function normalizeAdvance(input: CreateCustomerAdvanceRequest) {
  const paymentReference = input.paymentReference?.trim();
  return {
    amount: decimal(input.amount, true),
    customerPartnerId: input.customerPartnerId,
    paymentMethod: input.paymentMethod,
    ...(paymentReference ? { paymentReference } : {}),
    receivedOn: input.receivedOn,
  };
}

function decimal(value: string, positive: boolean) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,4})?$/u.test(normalized))
    throw new ApiErrorException(
      'CUSTOMER_ACCOUNT_AMOUNT_INVALID',
      'Enter an amount with no more than four decimal places.',
      HttpStatus.BAD_REQUEST,
    );
  const result = decimalString(units(normalized));
  if (positive && units(result) <= 0n)
    throw new ApiErrorException(
      'CUSTOMER_ACCOUNT_AMOUNT_REQUIRED',
      'Enter an amount greater than zero.',
      HttpStatus.BAD_REQUEST,
    );
  return result;
}

function units(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(4, '0').slice(0, 4)}`);
}

function decimalString(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 10_000n}.${(absolute % 10_000n)
    .toString()
    .padStart(4, '0')}`;
}

function sumDecimals(values: string[]) {
  return decimalString(values.reduce((total, value) => total + units(value), 0n));
}

function maximum(left: bigint, right: bigint) {
  return left > right ? left : right;
}

function iso(value: string | Date) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
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
     ) VALUES ($1,$2,$3,'processing',now() + interval '24 hours')
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
  if (!row || row.request_hash !== hash || row.status !== 'completed')
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_CONFLICT',
      'This request is already in progress or uses a key from another request.',
      HttpStatus.CONFLICT,
    );
  return row.response_body;
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}
