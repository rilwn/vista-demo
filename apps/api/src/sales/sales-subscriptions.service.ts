import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CreateServiceSubscriptionRequest,
  GenerateSubscriptionInvoiceDraftsResult,
  SalesSubscriptionReferenceData,
  ServiceSubscriptionContract,
  SubscriptionInvoiceDraft,
  UpdateServiceSubscriptionRequest,
} from '@vista/contracts';
import type { PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';

interface ContractRow {
  active: boolean;
  billing_amount: string;
  billing_frequency_months: number;
  contract_number: string;
  created_at: string;
  currency_code: string;
  customer_location_id: string;
  customer_location_name: string;
  customer_name: string;
  customer_partner_id: string;
  id: string;
  next_invoice_date: string;
  updated_at: string;
  valid_from: string;
  valid_to: string | null;
  version: number;
  visit_frequency_months: number;
}

interface JobContext {
  correlationId: string;
  idempotencyKey: string;
  jobId: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class SalesSubscriptionsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async referenceData(): Promise<SalesSubscriptionReferenceData> {
    const [customers, locations, equipment] = await Promise.all([
      this.database.getPool().query<{ id: string; name: string }>(
        `SELECT DISTINCT partner.id, partner.display_name AS name
         FROM master_data.partners partner
         JOIN master_data.partner_roles role ON role.partner_id = partner.id
         WHERE partner.active AND role.role = 'customer'
         ORDER BY partner.display_name, partner.id`,
      ),
      this.database.getPool().query<{
        customer_partner_id: string;
        id: string;
        name: string;
      }>(
        `SELECT location.id, location.partner_id AS customer_partner_id, location.name
         FROM master_data.customer_locations location
         JOIN master_data.partners partner ON partner.id = location.partner_id
         WHERE location.active AND partner.active
         ORDER BY location.name, location.id`,
      ),
      this.database.getPool().query<{
        customer_location_id: string;
        device_name: string;
        id: string;
        serial_number: string;
      }>(
        `SELECT equipment.id, equipment.customer_location_id, equipment.device_name,
                equipment.serial_number
         FROM master_data.customer_equipment equipment
         JOIN master_data.customer_locations location
           ON location.id = equipment.customer_location_id
         WHERE equipment.active AND equipment.status <> 'retired' AND location.active
         ORDER BY equipment.device_name, equipment.serial_number, equipment.id`,
      ),
    ]);
    return {
      customers: customers.rows,
      equipment: equipment.rows.map((row) => ({
        customerLocationId: row.customer_location_id,
        deviceName: row.device_name,
        id: row.id,
        serialNumber: row.serial_number,
      })),
      locations: locations.rows.map((row) => ({
        customerPartnerId: row.customer_partner_id,
        id: row.id,
        name: row.name,
      })),
    };
  }

  async contracts(): Promise<ServiceSubscriptionContract[]> {
    const result = await this.database.getPool().query<ContractRow>(`${contractQuery()}
      ORDER BY contract.created_at DESC, contract.id DESC`);
    return Promise.all(result.rows.map((row) => this.mapContract(this.database.getPool(), row)));
  }

  async contract(id: string): Promise<ServiceSubscriptionContract> {
    const result = await this.database
      .getPool()
      .query<ContractRow>(`${contractQuery()} WHERE contract.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw contractNotFound();
    return this.mapContract(this.database.getPool(), row);
  }

  async create(
    input: CreateServiceSubscriptionRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ServiceSubscriptionContract> {
    const normalized = normalizeContract(input);
    return this.command(
      'sales.subscription.create',
      key,
      normalized,
      201,
      async (client, commandKey) => {
        await this.requireReferences(client, normalized);
        const id = randomUUID();
        const number = await nextNumber(client, 'service_contract', 'SC');
        await client.query(
          `INSERT INTO sales.service_subscription_contracts (
           id, contract_number, customer_partner_id, customer_location_id, valid_from,
           valid_to, visit_frequency_months, billing_frequency_months, next_invoice_date,
           currency_code, billing_amount, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
          [
            id,
            number,
            normalized.customerPartnerId,
            normalized.customerLocationId,
            normalized.validFrom,
            normalized.validTo ?? null,
            normalized.visitFrequencyMonths,
            normalized.billingFrequencyMonths,
            normalized.nextInvoiceDate,
            normalized.currencyCode,
            normalized.billingAmount,
            auth.accountId,
          ],
        );
        await this.replaceDetails(client, id, normalized);
        const contract = await this.loadContract(client, id);
        await this.sideEffects(
          client,
          'service_subscription_contract',
          id,
          'sales.subscription.created',
          contract,
          auth,
          metadata,
          commandKey,
        );
        return contract;
      },
    );
  }

  async update(
    id: string,
    input: UpdateServiceSubscriptionRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ServiceSubscriptionContract> {
    const normalized = {
      ...normalizeContract(input),
      active: input.active,
      expectedVersion: input.expectedVersion,
    };
    return this.command(
      `sales.subscription.update:${id}`,
      key,
      normalized,
      200,
      async (client, commandKey) => {
        await this.requireReferences(client, normalized);
        const before = await this.loadContract(client, id);
        const updated = await client.query(
          `UPDATE sales.service_subscription_contracts SET
           customer_partner_id = $2, customer_location_id = $3, valid_from = $4,
           valid_to = $5, visit_frequency_months = $6, billing_frequency_months = $7,
           next_invoice_date = $8, currency_code = $9, billing_amount = $10,
           active = $11, version = version + 1, updated_by = $12, updated_at = now()
         WHERE id = $1 AND version = $13 RETURNING id`,
          [
            id,
            normalized.customerPartnerId,
            normalized.customerLocationId,
            normalized.validFrom,
            normalized.validTo ?? null,
            normalized.visitFrequencyMonths,
            normalized.billingFrequencyMonths,
            normalized.nextInvoiceDate,
            normalized.currencyCode,
            normalized.billingAmount,
            normalized.active,
            auth.accountId,
            normalized.expectedVersion,
          ],
        );
        if (!updated.rowCount) throw staleContract();
        await this.replaceDetails(client, id, normalized);
        const contract = await this.loadContract(client, id);
        await this.sideEffects(
          client,
          'service_subscription_contract',
          id,
          'sales.subscription.updated',
          contract,
          auth,
          metadata,
          commandKey,
          before,
        );
        return contract;
      },
    );
  }

  async generateDueInvoiceDrafts(
    context: JobContext,
  ): Promise<GenerateSubscriptionInvoiceDraftsResult> {
    const suppliedDate = context.payload['asOf'];
    const asOf =
      typeof suppliedDate === 'string'
        ? normalizeDate(suppliedDate)
        : new Date().toISOString().slice(0, 10);
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const due = await client.query<{
        billing_amount: string;
        billing_frequency_months: number;
        currency_code: string;
        customer_location_id: string;
        customer_partner_id: string;
        id: string;
        next_invoice_date: string;
        valid_to: string | null;
      }>(
        `SELECT id, customer_partner_id, customer_location_id, next_invoice_date::text,
                valid_to::text, billing_frequency_months, currency_code, billing_amount::text
         FROM sales.service_subscription_contracts
         WHERE active AND next_invoice_date <= $1
           AND (valid_to IS NULL OR next_invoice_date <= valid_to)
         ORDER BY next_invoice_date, id FOR UPDATE SKIP LOCKED`,
        [asOf],
      );
      const draftIds: string[] = [];
      for (const contract of due.rows) {
        let billingDate = contract.next_invoice_date;
        let generatedForContract = 0;
        while (billingDate <= asOf && (!contract.valid_to || billingDate <= contract.valid_to)) {
          if (generatedForContract >= 120)
            throw new Error('Recurring billing catch-up exceeded the safe per-contract limit');
          const nextDateResult = await client.query<{ next_date: string }>(
            `SELECT ($1::date + make_interval(months => $2))::date::text AS next_date`,
            [billingDate, contract.billing_frequency_months],
          );
          const nextDate = required(
            nextDateResult.rows[0],
            'Billing date calculation failed',
          ).next_date;
          const draftId = randomUUID();
          const number = await nextNumber(client, 'subscription_invoice_draft', 'SUB-DRAFT');
          const inserted = await client.query(
            `INSERT INTO sales.subscription_invoice_drafts (
               id, draft_number, contract_id, customer_partner_id, customer_location_id,
               billing_date, service_period_start, service_period_end, currency_code,
               amount, source_job_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7::date - 1, $8, $9, $10)
             ON CONFLICT (contract_id, billing_date) DO NOTHING RETURNING id`,
            [
              draftId,
              number,
              contract.id,
              contract.customer_partner_id,
              contract.customer_location_id,
              billingDate,
              nextDate,
              contract.currency_code,
              contract.billing_amount,
              context.jobId,
            ],
          );
          if (inserted.rowCount) {
            draftIds.push(draftId);
            const eventPayload = {
              amount: contract.billing_amount,
              billingDate,
              contractId: contract.id,
              currencyCode: contract.currency_code,
              draftId,
              number,
              servicePeriodEnd: await previousDate(client, nextDate),
              servicePeriodStart: billingDate,
              status: 'draft',
            };
            await client.query(
              `INSERT INTO integration.outbox_events (
                 id, aggregate_type, aggregate_id, event_type, event_version,
                 correlation_id, idempotency_key, payload
               ) VALUES ($1, 'subscription_invoice_draft', $2,
                 'sales.subscription-invoice-draft.generated', 1, $3, $4, $5)`,
              [
                randomUUID(),
                draftId,
                context.correlationId,
                `sales.subscription-invoice-draft.generated:${contract.id}:${billingDate}`,
                eventPayload,
              ],
            );
            await this.audit.append(
              {
                action: 'sales.subscription-invoice-draft.generated',
                after: eventPayload,
                correlationId: context.correlationId,
                metadata: { jobId: context.jobId },
                targetId: draftId,
                targetType: 'subscription_invoice_draft',
              },
              client,
            );
          }
          billingDate = nextDate;
          generatedForContract += 1;
        }
        await client.query(
          `UPDATE sales.service_subscription_contracts
           SET next_invoice_date = $2, updated_at = now()
           WHERE id = $1`,
          [contract.id, billingDate],
        );
      }
      await client.query('COMMIT');
      return { asOf, draftIds, generatedCount: draftIds.length };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async requireReferences(client: PoolClient, input: ReturnType<typeof normalizeContract>) {
    const location = await client.query(
      `SELECT location.id FROM master_data.customer_locations location
       JOIN master_data.partners partner ON partner.id = location.partner_id
       JOIN master_data.partner_roles role ON role.partner_id = partner.id
       WHERE location.id = $1 AND location.partner_id = $2 AND location.active
         AND partner.active AND role.role = 'customer'
       FOR KEY SHARE OF location, partner`,
      [input.customerLocationId, input.customerPartnerId],
    );
    if (!location.rowCount)
      throw new ApiErrorException(
        'SALES_SUBSCRIPTION_LOCATION_NOT_FOUND',
        'The selected customer location was not found or is inactive',
        HttpStatus.NOT_FOUND,
      );
    const equipment = await client.query<{ id: string }>(
      `SELECT id FROM master_data.customer_equipment
       WHERE id = ANY($1::uuid[]) AND customer_location_id = $2
         AND active AND status <> 'retired' FOR KEY SHARE`,
      [input.equipmentIds, input.customerLocationId],
    );
    if (equipment.rowCount !== input.equipmentIds.length)
      throw new ApiErrorException(
        'SALES_SUBSCRIPTION_EQUIPMENT_NOT_FOUND',
        'Every selected device must be active at the chosen customer location',
        HttpStatus.NOT_FOUND,
      );
  }

  private async replaceDetails(
    client: PoolClient,
    id: string,
    input: ReturnType<typeof normalizeContract>,
  ) {
    await client.query('DELETE FROM sales.service_subscription_devices WHERE contract_id = $1', [
      id,
    ]);
    await client.query('DELETE FROM sales.service_subscription_services WHERE contract_id = $1', [
      id,
    ]);
    for (const equipmentId of input.equipmentIds)
      await client.query(
        `INSERT INTO sales.service_subscription_devices (
           contract_id, customer_equipment_id, customer_location_id
         ) VALUES ($1, $2, $3)`,
        [id, equipmentId, input.customerLocationId],
      );
    for (const [index, description] of input.includedServices.entries())
      await client.query(
        `INSERT INTO sales.service_subscription_services (
           id, contract_id, position, description
         ) VALUES ($1, $2, $3, $4)`,
        [randomUUID(), id, index + 1, description],
      );
  }

  private async loadContract(client: PoolClient, id: string) {
    const result = await client.query<ContractRow>(`${contractQuery()} WHERE contract.id = $1`, [
      id,
    ]);
    const row = result.rows[0];
    if (!row) throw contractNotFound();
    return this.mapContract(client, row);
  }

  private async mapContract(
    client: Pick<PoolClient, 'query'>,
    row: ContractRow,
  ): Promise<ServiceSubscriptionContract> {
    const equipment = await client.query<{
      device_name: string;
      id: string;
      serial_number: string;
    }>(
      `SELECT equipment.id, equipment.device_name, equipment.serial_number
         FROM sales.service_subscription_devices selected
         JOIN master_data.customer_equipment equipment
           ON equipment.id = selected.customer_equipment_id
         WHERE selected.contract_id = $1 ORDER BY equipment.device_name, equipment.id`,
      [row.id],
    );
    const services = await client.query<{ description: string }>(
      `SELECT description FROM sales.service_subscription_services
         WHERE contract_id = $1 ORDER BY position`,
      [row.id],
    );
    const drafts = await client.query<{
      amount: string;
      billing_date: string;
      currency_code: string;
      draft_number: string;
      generated_at: string;
      id: string;
      service_period_end: string;
      service_period_start: string;
      status: 'draft';
    }>(
      `SELECT id, draft_number, billing_date::text, service_period_start::text,
                service_period_end::text, currency_code, amount::text, status,
                generated_at::text
         FROM sales.subscription_invoice_drafts WHERE contract_id = $1
         ORDER BY billing_date DESC, id DESC`,
      [row.id],
    );
    return {
      active: row.active,
      billingAmount: row.billing_amount,
      billingFrequencyMonths: row.billing_frequency_months,
      createdAt: asIso(row.created_at),
      currencyCode: row.currency_code,
      customerLocationId: row.customer_location_id,
      customerLocationName: row.customer_location_name,
      customerName: row.customer_name,
      customerPartnerId: row.customer_partner_id,
      equipment: equipment.rows.map((item) => ({
        deviceName: item.device_name,
        id: item.id,
        serialNumber: item.serial_number,
      })),
      id: row.id,
      includedServices: services.rows.map((item) => item.description),
      invoiceDrafts: drafts.rows.map(mapDraft),
      nextInvoiceDate: row.next_invoice_date,
      number: row.contract_number,
      updatedAt: asIso(row.updated_at),
      validFrom: row.valid_from,
      ...(row.valid_to ? { validTo: row.valid_to } : {}),
      version: row.version,
      visitFrequencyMonths: row.visit_frequency_months,
    };
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
          'SALES_SUBSCRIPTION_CONFLICT',
          'This subscription conflicts with an existing record',
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
}

function contractQuery() {
  return `SELECT contract.id, contract.contract_number, contract.customer_partner_id,
                 customer.display_name AS customer_name, contract.customer_location_id,
                 location.name AS customer_location_name, contract.valid_from::text,
                 contract.valid_to::text, contract.visit_frequency_months,
                 contract.billing_frequency_months, contract.next_invoice_date::text,
                 contract.currency_code, contract.billing_amount::text, contract.active,
                 contract.version, contract.created_at::text, contract.updated_at::text
          FROM sales.service_subscription_contracts contract
          JOIN master_data.partners customer ON customer.id = contract.customer_partner_id
          JOIN master_data.customer_locations location ON location.id = contract.customer_location_id`;
}

function normalizeContract(input: CreateServiceSubscriptionRequest) {
  const validFrom = normalizeDate(input.validFrom);
  const validTo = input.validTo ? normalizeDate(input.validTo) : undefined;
  const nextInvoiceDate = normalizeDate(input.nextInvoiceDate);
  if (validTo && validTo < validFrom)
    throw new ApiErrorException(
      'SALES_SUBSCRIPTION_PERIOD_INVALID',
      'The contract end date cannot be before its start date',
      HttpStatus.BAD_REQUEST,
    );
  if (nextInvoiceDate < validFrom || (validTo && nextInvoiceDate > validTo))
    throw new ApiErrorException(
      'SALES_SUBSCRIPTION_BILLING_DATE_INVALID',
      'The next invoice date must fall within the contract period',
      HttpStatus.BAD_REQUEST,
    );
  const equipmentIds = [...new Set(input.equipmentIds)].sort();
  if (!equipmentIds.length || equipmentIds.length !== input.equipmentIds.length)
    throw new ApiErrorException(
      'SALES_SUBSCRIPTION_EQUIPMENT_INVALID',
      'Choose at least one device and do not select the same device twice',
      HttpStatus.BAD_REQUEST,
    );
  const includedServices = input.includedServices.map((item) => item.trim()).filter(Boolean);
  if (!includedServices.length || new Set(includedServices).size !== includedServices.length)
    throw new ApiErrorException(
      'SALES_SUBSCRIPTION_SERVICES_INVALID',
      'Add at least one distinct included service',
      HttpStatus.BAD_REQUEST,
    );
  return {
    billingAmount: normalizeDecimal(input.billingAmount),
    billingFrequencyMonths: input.billingFrequencyMonths,
    currencyCode: normalizeCurrency(input.currencyCode),
    customerLocationId: input.customerLocationId,
    customerPartnerId: input.customerPartnerId,
    equipmentIds,
    includedServices,
    nextInvoiceDate,
    validFrom,
    ...(validTo ? { validTo } : {}),
    visitFrequencyMonths: input.visitFrequencyMonths,
  };
}

function mapDraft(row: {
  amount: string;
  billing_date: string;
  currency_code: string;
  draft_number: string;
  generated_at: string;
  id: string;
  service_period_end: string;
  service_period_start: string;
  status: 'draft';
}): SubscriptionInvoiceDraft {
  return {
    amount: row.amount,
    billingDate: row.billing_date,
    currencyCode: row.currency_code,
    generatedAt: asIso(row.generated_at),
    id: row.id,
    number: row.draft_number,
    servicePeriodEnd: row.service_period_end,
    servicePeriodStart: row.service_period_start,
    status: row.status,
  };
}

async function nextNumber(client: PoolClient, type: string, prefix: string) {
  await client.query(
    `INSERT INTO sales.internal_document_sequences (document_type)
     VALUES ($1) ON CONFLICT (document_type) DO NOTHING`,
    [type],
  );
  const result = await client.query<{ allocated: string }>(
    `UPDATE sales.internal_document_sequences SET next_value = next_value + 1
     WHERE document_type = $1 RETURNING (next_value - 1)::text AS allocated`,
    [type],
  );
  const allocated = required(result.rows[0], 'Sequence allocation failed').allocated;
  return `${prefix}-${new Date().getUTCFullYear()}-${allocated.padStart(6, '0')}`;
}

async function previousDate(client: PoolClient, value: string) {
  const result = await client.query<{ date: string }>(`SELECT ($1::date - 1)::date::text AS date`, [
    value,
  ]);
  return required(result.rows[0], 'Date calculation failed').date;
}

function normalizeDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw new ApiErrorException(
      'SALES_SUBSCRIPTION_DATE_INVALID',
      'Enter a valid date',
      HttpStatus.BAD_REQUEST,
    );
  return value;
}

function normalizeCurrency(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(normalized))
    throw new ApiErrorException(
      'SALES_CURRENCY_INVALID',
      'Currency must use a three-letter code',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function normalizeDecimal(value: string) {
  if (!/^\d+(\.\d{1,4})?$/u.test(value))
    throw new ApiErrorException(
      'SALES_SUBSCRIPTION_AMOUNT_INVALID',
      'Amount must be a non-negative number with no more than four decimal places',
      HttpStatus.BAD_REQUEST,
    );
  const [whole = '0', fraction = ''] = value.split('.');
  return `${BigInt(whole).toString()}.${fraction.padEnd(4, '0')}`;
}

function validKey(value: string | undefined) {
  const key = value?.trim();
  if (!key || key.length > 200)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required',
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
      'The idempotency key was already used for another request',
      HttpStatus.CONFLICT,
    );
  return row.response_body;
}

function contractNotFound() {
  return new ApiErrorException(
    'SALES_SUBSCRIPTION_NOT_FOUND',
    'The service subscription was not found',
    HttpStatus.NOT_FOUND,
  );
}

function staleContract() {
  return new ApiErrorException(
    'SALES_SUBSCRIPTION_VERSION_CONFLICT',
    'The service subscription changed after it was opened. Refresh and try again.',
    HttpStatus.CONFLICT,
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
