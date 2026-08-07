import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CreatePartnerAddressRequest,
  CreatePartnerBankAccountRequest,
  CreatePartnerContactRequest,
  CreatePartnerRequest,
  PartnerAddress,
  PartnerBankAccount,
  PartnerContact,
  PartnerDuplicateCandidate,
  PartnerDuplicateResponse,
  PartnerKind,
  PartnerPage,
  PartnerProfile,
  PartnerRole,
  PartnerSummary,
} from '@vista/contracts';
import type { Pool, PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import type { PartnerDuplicateQueryDto, PartnerListQueryDto } from './partners.dto.js';

interface PartnerRow {
  active: boolean;
  company_representative: string | null;
  created_at: Date | string;
  display_name: string;
  id: string;
  kind: PartnerKind;
  normalized_name: string;
  roles: PartnerRole[];
  uic: string | null;
  updated_at: Date | string;
  vat_number: string | null;
  version: number;
}

interface CountRow {
  total: string;
}

interface PartnerAddressRow {
  active: boolean;
  address_line_1: string;
  address_line_2: string | null;
  address_type: PartnerAddress['type'];
  city: string;
  country_code: string;
  id: string;
  postal_code: string | null;
}

interface PartnerContactRow {
  active: boolean;
  contact_role: string | null;
  display_name: string;
  email: string | null;
  id: string;
  job_title: string | null;
  telephone: string | null;
}

interface PartnerBankAccountRow {
  active: boolean;
  bank_name: string | null;
  bic: string | null;
  currency_code: string;
  iban: string;
  id: string;
}

interface IdempotencyRow {
  request_hash: string;
  response_body: unknown;
  status: 'completed' | 'failed' | 'processing';
}

interface NormalizedPartnerInput {
  companyRepresentative?: string;
  displayName: string;
  kind: PartnerKind;
  roles: PartnerRole[];
  uic?: string;
  vatNumber?: string;
}

interface NormalizedAddressInput {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  countryCode: string;
  postalCode?: string;
  type: PartnerAddress['type'];
}

interface NormalizedContactInput {
  contactRole?: string;
  displayName: string;
  email?: string;
  jobTitle?: string;
  telephone?: string;
}

interface NormalizedBankAccountInput {
  bankName?: string;
  bic?: string;
  currencyCode: string;
  iban: string;
}

const partnerSelect = `
  SELECT
    partner.id,
    partner.kind,
    partner.display_name,
    partner.normalized_name,
    partner.uic,
    partner.vat_number,
    partner.company_representative,
    partner.active,
    partner.version,
    partner.created_at,
    partner.updated_at,
    COALESCE(
      (
        SELECT array_agg(partner_role.role ORDER BY partner_role.role)
        FROM master_data.partner_roles partner_role
        WHERE partner_role.partner_id = partner.id
      ),
      '{}'::text[]
    ) AS roles
  FROM master_data.partners partner`;

@Injectable()
export class PartnersService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(query: PartnerListQueryDto): Promise<PartnerPage> {
    const pool = this.database.getPool();
    const page = Number(query.page);
    const pageSize = Number(query.pageSize);
    const search = normalizeOptionalText(query.search);
    const searchPattern = search ? `%${escapeLike(search)}%` : null;
    const parameters = [query.kind ?? null, query.role ?? null, searchPattern];
    const where = `
      WHERE ($1::text IS NULL OR partner.kind = $1)
        AND (
          $2::text IS NULL OR EXISTS (
            SELECT 1
            FROM master_data.partner_roles filter_role
            WHERE filter_role.partner_id = partner.id
              AND filter_role.role = $2
          )
        )
        AND (
          $3::text IS NULL
          OR partner.display_name ILIKE $3 ESCAPE E'\\\\'
          OR partner.uic ILIKE $3 ESCAPE E'\\\\'
          OR partner.vat_number ILIKE $3 ESCAPE E'\\\\'
        )`;
    const sortBy = query.sortBy ?? 'displayName';
    const orderColumn = {
      createdAt: 'partner.created_at',
      displayName: 'partner.normalized_name',
      updatedAt: 'partner.updated_at',
    }[sortBy];
    const direction = query.direction === 'desc' ? 'DESC' : 'ASC';
    const offset = (page - 1) * pageSize;

    const [countResult, rowsResult] = await Promise.all([
      pool.query<CountRow>(
        `SELECT count(*)::text AS total FROM master_data.partners partner ${where}`,
        parameters,
      ),
      pool.query<PartnerRow>(
        `${partnerSelect}
         ${where}
         ORDER BY ${orderColumn} ${direction}, partner.id ${direction}
         LIMIT $4 OFFSET $5`,
        [...parameters, pageSize, offset],
      ),
    ]);
    const total = Number(countResult.rows[0]?.total ?? 0);
    return {
      items: rowsResult.rows.map(mapPartner),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  async get(id: string): Promise<PartnerSummary> {
    const partner = await findPartner(this.database.getPool(), id);
    if (!partner) {
      throw new ApiErrorException(
        'PARTNER_NOT_FOUND',
        'The partner record was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return mapPartner(partner);
  }

  async getProfile(id: string): Promise<PartnerProfile> {
    const pool = this.database.getPool();
    const [partner, addresses, contacts, bankAccounts] = await Promise.all([
      findPartner(pool, id),
      pool.query<PartnerAddressRow>(
        `SELECT id, address_type, address_line_1, address_line_2, city,
                postal_code, country_code, active
         FROM master_data.partner_addresses
         WHERE partner_id = $1 AND active = true
         ORDER BY address_type, city, address_line_1, id`,
        [id],
      ),
      pool.query<PartnerContactRow>(
        `SELECT id, display_name, job_title, telephone, email, contact_role, active
         FROM master_data.partner_contacts
         WHERE partner_id = $1 AND active = true
         ORDER BY display_name, id`,
        [id],
      ),
      pool.query<PartnerBankAccountRow>(
        `SELECT id, iban, bic, bank_name, currency_code, active
         FROM master_data.partner_bank_accounts
         WHERE partner_id = $1 AND active = true
         ORDER BY currency_code, iban, id`,
        [id],
      ),
    ]);
    if (!partner) {
      throw partnerNotFoundError();
    }
    return {
      addresses: addresses.rows.map(mapAddress),
      bankAccounts: bankAccounts.rows.map(mapBankAccount),
      contacts: contacts.rows.map(mapContact),
      partner: mapPartner(partner),
    };
  }

  async createAddress(
    partnerId: string,
    input: CreatePartnerAddressRequest,
    idempotencyKey: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PartnerAddress> {
    const normalized = normalizeAddressInput(input);
    return this.createProfileChild(
      partnerId,
      'address',
      normalized,
      idempotencyKey,
      authentication,
      metadata,
      isPartnerAddress,
      async (client) => {
        const result = await client.query<PartnerAddressRow>(
          `INSERT INTO master_data.partner_addresses (
             partner_id, address_type, address_line_1, address_line_2, city,
             postal_code, country_code
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, address_type, address_line_1, address_line_2, city,
                     postal_code, country_code, active`,
          [
            partnerId,
            normalized.type,
            normalized.addressLine1,
            normalized.addressLine2 ?? null,
            normalized.city,
            normalized.postalCode ?? null,
            normalized.countryCode,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error('Partner address insert did not return a row');
        return mapAddress(row);
      },
    );
  }

  async createContact(
    partnerId: string,
    input: CreatePartnerContactRequest,
    idempotencyKey: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PartnerContact> {
    const normalized = normalizeContactInput(input);
    return this.createProfileChild(
      partnerId,
      'contact',
      normalized,
      idempotencyKey,
      authentication,
      metadata,
      isPartnerContact,
      async (client) => {
        const result = await client.query<PartnerContactRow>(
          `INSERT INTO master_data.partner_contacts (
             partner_id, display_name, job_title, telephone, email, contact_role
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, display_name, job_title, telephone, email, contact_role, active`,
          [
            partnerId,
            normalized.displayName,
            normalized.jobTitle ?? null,
            normalized.telephone ?? null,
            normalized.email ?? null,
            normalized.contactRole ?? null,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error('Partner contact insert did not return a row');
        return mapContact(row);
      },
    );
  }

  async createBankAccount(
    partnerId: string,
    input: CreatePartnerBankAccountRequest,
    idempotencyKey: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PartnerBankAccount> {
    const normalized = normalizeBankAccountInput(input);
    return this.createProfileChild(
      partnerId,
      'bank_account',
      normalized,
      idempotencyKey,
      authentication,
      metadata,
      isPartnerBankAccount,
      async (client) => {
        const result = await client.query<PartnerBankAccountRow>(
          `INSERT INTO master_data.partner_bank_accounts (
             partner_id, iban, bic, bank_name, currency_code
           ) VALUES ($1, $2, $3, $4, $5)
           RETURNING id, iban, bic, bank_name, currency_code, active`,
          [
            partnerId,
            normalized.iban,
            normalized.bic ?? null,
            normalized.bankName ?? null,
            normalized.currencyCode,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error('Partner bank-account insert did not return a row');
        return mapBankAccount(row);
      },
    );
  }

  async findDuplicates(query: PartnerDuplicateQueryDto): Promise<PartnerDuplicateResponse> {
    const normalizedName = normalizeOptionalName(query.name);
    const uic = normalizeOptionalIdentifier(query.uic);
    if (!normalizedName && !uic) {
      throw new ApiErrorException(
        'DUPLICATE_CHECK_INPUT_REQUIRED',
        'A company name or UIC is required for duplicate detection',
        HttpStatus.BAD_REQUEST,
      );
    }
    const rows = await findDuplicateRows(this.database.getPool(), normalizedName, uic);
    return { candidates: rows.map((row) => mapDuplicate(row, normalizedName, uic)) };
  }

  async create(
    input: CreatePartnerRequest,
    idempotencyKey: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PartnerSummary> {
    const key = validateIdempotencyKey(idempotencyKey);
    const normalized = normalizePartnerInput(input);
    const requestHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claimIdempotency(
        client,
        'master-data.partners.create',
        key,
        requestHash,
        this.environment.IDEMPOTENCY_TTL_SECONDS,
        isPartnerSummary,
      );
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }

      const duplicateName =
        normalized.kind === 'legal_entity' ? normalizedName(normalized.displayName) : undefined;
      const lockKeys = [
        ...(duplicateName ? [`partner:name:${duplicateName}`] : []),
        ...(normalized.uic ? [`partner:uic:${normalized.uic}`] : []),
      ].sort();
      for (const lockKey of lockKeys) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
      }

      const duplicates = await findDuplicateRows(client, duplicateName, normalized.uic);
      if (duplicates.length > 0) {
        throw duplicateCandidateError(duplicates, duplicateName, normalized.uic);
      }

      const inserted = await client.query<PartnerRow>(
        `INSERT INTO master_data.partners (
           kind, display_name, uic, vat_number, company_representative,
           created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING
           id, kind, display_name, normalized_name, uic, vat_number,
           company_representative, active, version, created_at, updated_at,
           '{}'::text[] AS roles`,
        [
          normalized.kind,
          normalized.displayName,
          normalized.uic ?? null,
          normalized.vatNumber ?? null,
          normalized.companyRepresentative ?? null,
          authentication.accountId,
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('Partner insert did not return a row');

      await client.query(
        `INSERT INTO master_data.partner_roles (partner_id, role, assigned_by)
         SELECT $1, role, $3
         FROM unnest($2::text[]) AS role`,
        [row.id, normalized.roles, authentication.accountId],
      );
      row.roles = normalized.roles;
      const partner = mapPartner(row);

      await client.query(
        `INSERT INTO integration.outbox_events (
           id, aggregate_type, aggregate_id, event_type, event_version,
           correlation_id, idempotency_key, payload
         ) VALUES ($1, 'partner', $2, 'master_data.partner.created', 1, $3, $4, $5)`,
        [randomUUID(), partner.id, metadata.correlationId, `partner.created:${key}`, partner],
      );
      await this.audit.append(
        {
          action: 'master_data.partner.created',
          actorAccountId: authentication.accountId,
          after: partnerAuditData(partner),
          correlationId: metadata.correlationId,
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          targetId: partner.id,
          targetType: 'partner',
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await completeIdempotency(client, 'master-data.partners.create', key, partner);
      await client.query('COMMIT');
      return partner;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueUicViolation(error)) {
        throw new ApiErrorException(
          'PARTNER_DUPLICATE_CANDIDATE',
          'A partner with this UIC already exists',
          HttpStatus.CONFLICT,
          [{ field: 'uic', message: 'A partner with this UIC already exists' }],
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async createProfileChild<T extends { id: string }>(
    partnerId: string,
    kind: 'address' | 'bank_account' | 'contact',
    normalizedInput: object,
    idempotencyKey: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    isResponse: (value: unknown) => value is T,
    insert: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const key = validateIdempotencyKey(idempotencyKey);
    const requestHash = createHash('sha256').update(JSON.stringify(normalizedInput)).digest('hex');
    const scope = `master-data.partners.${kind}.create:${partnerId}`;
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claimIdempotency(
        client,
        scope,
        key,
        requestHash,
        this.environment.IDEMPOTENCY_TTL_SECONDS,
        isResponse,
      );
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }
      if (!(await findPartner(client, partnerId))) {
        throw partnerNotFoundError();
      }

      const record = await insert(client);
      await client.query(
        `UPDATE master_data.partners
         SET updated_at = now(), updated_by = $2, version = version + 1
         WHERE id = $1`,
        [partnerId, authentication.accountId],
      );
      const eventType = `master_data.partner.${kind}.created`;
      await client.query(
        `INSERT INTO integration.outbox_events (
           id, aggregate_type, aggregate_id, event_type, event_version,
           correlation_id, idempotency_key, payload
         ) VALUES ($1, 'partner', $2, $3, 1, $4, $5, $6)`,
        [
          randomUUID(),
          partnerId,
          eventType,
          metadata.correlationId,
          `partner.${kind}.created:${partnerId}:${key}`,
          { partnerId, record },
        ],
      );
      await this.audit.append(
        {
          action: eventType,
          actorAccountId: authentication.accountId,
          after: { partnerId, record },
          correlationId: metadata.correlationId,
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          targetId: record.id,
          targetType: `partner_${kind}`,
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await completeIdempotency(client, scope, key, record);
      await client.query('COMMIT');
      return record;
    } catch (error) {
      await client.query('ROLLBACK');
      if (kind === 'bank_account' && isUniqueBankAccountViolation(error)) {
        throw new ApiErrorException(
          'BANK_ACCOUNT_DUPLICATE',
          'This bank account already belongs to a partner record',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

async function claimIdempotency<T>(
  client: PoolClient,
  scope: string,
  key: string,
  requestHash: string,
  ttlSeconds: number,
  isResponse: (value: unknown) => value is T,
): Promise<T | undefined> {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (
       scope, idempotency_key, request_hash, status, expires_at
     ) VALUES ($1, $2, $3, 'processing', now() + ($4 * interval '1 second'))
     ON CONFLICT DO NOTHING
     RETURNING idempotency_key`,
    [scope, key, requestHash, ttlSeconds],
  );
  if (inserted.rowCount === 1) return undefined;

  const existing = await client.query<IdempotencyRow>(
    `SELECT request_hash, status, response_body
     FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2
     FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== requestHash) {
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_CONFLICT',
      'The idempotency key was already used for a different request',
      HttpStatus.CONFLICT,
    );
  }
  if (row.status === 'completed' && isResponse(row.response_body)) {
    return row.response_body;
  }
  throw new ApiErrorException(
    'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    'The original request is still being processed',
    HttpStatus.CONFLICT,
  );
}

async function completeIdempotency(
  client: PoolClient,
  scope: string,
  key: string,
  response: unknown,
): Promise<void> {
  await client.query(
    `UPDATE platform.idempotency_keys
     SET status = 'completed', response_status = 201, response_body = $3
     WHERE scope = $1 AND idempotency_key = $2`,
    [scope, key, response],
  );
}

async function findPartner(client: Pool | PoolClient, id: string): Promise<PartnerRow | undefined> {
  const result = await client.query<PartnerRow>(`${partnerSelect} WHERE partner.id = $1`, [id]);
  return result.rows[0];
}

async function findDuplicateRows(
  client: Pool | PoolClient,
  name: string | undefined,
  uic: string | undefined,
): Promise<PartnerRow[]> {
  if (!name && !uic) return [];
  const result = await client.query<PartnerRow>(
    `${partnerSelect}
     WHERE ($1::text IS NOT NULL AND partner.kind = 'legal_entity' AND partner.normalized_name = $1)
        OR ($2::text IS NOT NULL AND upper(btrim(partner.uic)) = $2)
     ORDER BY partner.normalized_name, partner.id
     LIMIT 20`,
    [name ?? null, uic ?? null],
  );
  return result.rows;
}

function mapPartner(row: PartnerRow): PartnerSummary {
  return {
    active: row.active,
    ...(row.company_representative ? { companyRepresentative: row.company_representative } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    displayName: row.display_name,
    id: row.id,
    kind: row.kind,
    roles: row.roles,
    ...(row.uic ? { uic: row.uic } : {}),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.vat_number ? { vatNumber: row.vat_number } : {}),
    version: row.version,
  };
}

function mapAddress(row: PartnerAddressRow): PartnerAddress {
  return {
    active: row.active,
    addressLine1: row.address_line_1,
    ...(row.address_line_2 ? { addressLine2: row.address_line_2 } : {}),
    city: row.city,
    countryCode: row.country_code,
    id: row.id,
    ...(row.postal_code ? { postalCode: row.postal_code } : {}),
    type: row.address_type,
  };
}

function mapContact(row: PartnerContactRow): PartnerContact {
  return {
    active: row.active,
    ...(row.contact_role ? { contactRole: row.contact_role } : {}),
    displayName: row.display_name,
    ...(row.email ? { email: row.email } : {}),
    id: row.id,
    ...(row.job_title ? { jobTitle: row.job_title } : {}),
    ...(row.telephone ? { telephone: row.telephone } : {}),
  };
}

function mapBankAccount(row: PartnerBankAccountRow): PartnerBankAccount {
  return {
    active: row.active,
    ...(row.bank_name ? { bankName: row.bank_name } : {}),
    ...(row.bic ? { bic: row.bic } : {}),
    currencyCode: row.currency_code,
    iban: row.iban,
    id: row.id,
  };
}

function mapDuplicate(
  row: PartnerRow,
  name: string | undefined,
  uic: string | undefined,
): PartnerDuplicateCandidate {
  const matchedBy: Array<'name' | 'uic'> = [];
  if (name && row.kind === 'legal_entity' && row.normalized_name === name) matchedBy.push('name');
  if (uic && row.uic?.trim().toUpperCase() === uic) matchedBy.push('uic');
  return {
    displayName: row.display_name,
    id: row.id,
    kind: row.kind,
    matchedBy,
    roles: row.roles,
    ...(row.uic ? { uic: row.uic } : {}),
  };
}

function duplicateCandidateError(
  rows: PartnerRow[],
  name: string | undefined,
  uic: string | undefined,
): ApiErrorException {
  const candidates = rows.map((row) => mapDuplicate(row, name, uic));
  return new ApiErrorException(
    'PARTNER_DUPLICATE_CANDIDATE',
    'A possible duplicate partner already exists',
    HttpStatus.CONFLICT,
    candidates.slice(0, 5).map((candidate) => ({
      field: candidate.matchedBy.includes('uic') ? 'uic' : 'displayName',
      message: `${candidate.displayName} (${candidate.id})`,
    })),
  );
}

function normalizePartnerInput(input: CreatePartnerRequest): NormalizedPartnerInput {
  const displayName = normalizeDisplayName(input.displayName);
  const roles = [...new Set(input.roles)].sort();
  const companyRepresentative = normalizeOptionalText(input.companyRepresentative);
  const uic = normalizeOptionalIdentifier(input.uic);
  const vatNumber = normalizeOptionalIdentifier(input.vatNumber);
  if (roles.length === 0) {
    throw new ApiErrorException(
      'PARTNER_ROLE_REQUIRED',
      'At least one partner role is required',
      HttpStatus.BAD_REQUEST,
    );
  }
  return {
    ...(companyRepresentative ? { companyRepresentative } : {}),
    displayName,
    kind: input.kind,
    roles,
    ...(uic ? { uic } : {}),
    ...(vatNumber ? { vatNumber } : {}),
  };
}

function normalizeAddressInput(input: CreatePartnerAddressRequest): NormalizedAddressInput {
  const addressLine1 = normalizeRequiredText(input.addressLine1, 'PARTNER_ADDRESS_LINE_REQUIRED');
  const city = normalizeRequiredText(input.city, 'PARTNER_ADDRESS_CITY_REQUIRED');
  const countryCode = (normalizeOptionalText(input.countryCode) ?? 'BG').toUpperCase();
  const addressLine2 = normalizeOptionalText(input.addressLine2);
  const postalCode = normalizeOptionalText(input.postalCode);
  if (!/^[A-Z]{2}$/u.test(countryCode)) {
    throw new ApiErrorException(
      'PARTNER_ADDRESS_COUNTRY_INVALID',
      'The country code must use two letters',
      HttpStatus.BAD_REQUEST,
    );
  }
  return {
    addressLine1,
    ...(addressLine2 ? { addressLine2 } : {}),
    city,
    countryCode,
    ...(postalCode ? { postalCode } : {}),
    type: input.type,
  };
}

function normalizeContactInput(input: CreatePartnerContactRequest): NormalizedContactInput {
  const telephone = normalizeOptionalText(input.telephone);
  const email = normalizeOptionalText(input.email)?.toLowerCase();
  const contactRole = normalizeOptionalText(input.contactRole);
  const jobTitle = normalizeOptionalText(input.jobTitle);
  if (!telephone && !email) {
    throw new ApiErrorException(
      'PARTNER_CONTACT_CHANNEL_REQUIRED',
      'A telephone number or email address is required',
      HttpStatus.BAD_REQUEST,
    );
  }
  return {
    ...(contactRole ? { contactRole } : {}),
    displayName: normalizeRequiredText(input.displayName, 'PARTNER_CONTACT_NAME_REQUIRED'),
    ...(email ? { email } : {}),
    ...(jobTitle ? { jobTitle } : {}),
    ...(telephone ? { telephone } : {}),
  };
}

function normalizeBankAccountInput(
  input: CreatePartnerBankAccountRequest,
): NormalizedBankAccountInput {
  const iban = input.iban.replace(/\s+/gu, '').toUpperCase();
  if (!isValidIban(iban)) {
    throw new ApiErrorException(
      'PARTNER_BANK_IBAN_INVALID',
      'The IBAN is not valid',
      HttpStatus.BAD_REQUEST,
    );
  }
  const bic = normalizeOptionalText(input.bic)?.replace(/\s+/gu, '').toUpperCase();
  const bankName = normalizeOptionalText(input.bankName);
  if (bic && !/^[A-Z0-9]{8}(?:[A-Z0-9]{3})?$/u.test(bic)) {
    throw new ApiErrorException(
      'PARTNER_BANK_BIC_INVALID',
      'The BIC must contain 8 or 11 letters and digits',
      HttpStatus.BAD_REQUEST,
    );
  }
  const currencyCode = (normalizeOptionalText(input.currencyCode) ?? 'BGN').toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currencyCode)) {
    throw new ApiErrorException(
      'PARTNER_BANK_CURRENCY_INVALID',
      'The currency code must use three letters',
      HttpStatus.BAD_REQUEST,
    );
  }
  return {
    ...(bankName ? { bankName } : {}),
    ...(bic ? { bic } : {}),
    currencyCode,
    iban,
  };
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized) {
    throw new ApiErrorException(
      'PARTNER_NAME_REQUIRED',
      'The partner name is required',
      HttpStatus.BAD_REQUEST,
    );
  }
  return normalized;
}

function normalizeRequiredText(value: string, code: string): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new ApiErrorException(code, 'This field is required', HttpStatus.BAD_REQUEST);
  }
  return normalized;
}

function normalizedName(value: string): string {
  return normalizeDisplayName(value).toLocaleLowerCase('en-US');
}

function normalizeOptionalName(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalText(value);
  return normalized ? normalizedName(normalized) : undefined;
}

function normalizeOptionalIdentifier(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalText(value);
  return normalized?.toUpperCase();
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');
  return normalized || undefined;
}

function validateIdempotencyKey(value: string | undefined): string {
  if (!value) {
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'The Idempotency-Key header is required',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(value)) {
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_INVALID',
      'The Idempotency-Key header has an invalid format',
      HttpStatus.BAD_REQUEST,
    );
  }
  return value;
}

function partnerAuditData(partner: PartnerSummary): Record<string, unknown> {
  return {
    active: partner.active,
    displayName: partner.displayName,
    kind: partner.kind,
    roles: partner.roles,
    uic: partner.uic ?? null,
    vatNumber: partner.vatNumber ?? null,
    version: partner.version,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function isUniqueUicViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'partners_uic_unique'
  );
}

function isUniqueBankAccountViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'partner_bank_accounts_iban_unique'
  );
}

function partnerNotFoundError(): ApiErrorException {
  return new ApiErrorException(
    'PARTNER_NOT_FOUND',
    'The partner record was not found',
    HttpStatus.NOT_FOUND,
  );
}

function isPartnerAddress(value: unknown): value is PartnerAddress {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'addressLine1' in value &&
    typeof value.addressLine1 === 'string' &&
    'type' in value &&
    typeof value.type === 'string'
  );
}

function isPartnerContact(value: unknown): value is PartnerContact {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'displayName' in value &&
    typeof value.displayName === 'string'
  );
}

function isPartnerBankAccount(value: unknown): value is PartnerBankAccount {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'iban' in value &&
    typeof value.iban === 'string'
  );
}

function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/u.test(iban)) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const encoded = /[A-Z]/u.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of encoded) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

function isPartnerSummary(value: unknown): value is PartnerSummary {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'displayName' in value &&
    typeof value.displayName === 'string' &&
    'roles' in value &&
    Array.isArray(value.roles)
  );
}
