import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  BusinessBranch,
  BusinessLocation,
  BusinessOperator,
  CashRegister,
  CreateBusinessBranchRequest,
  CreateBusinessLocationRequest,
  CreateBusinessOperatorRequest,
  CreateCashRegisterRequest,
  CreateLegalBusinessEntityRequest,
  LegalBusinessEntity,
  OrganizationMember,
  OrganizationTopology,
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

interface EntityRow {
  active: boolean;
  code: string;
  id: string;
  name: string;
  uic: string | null;
  vat_number: string | null;
  version: number;
}

interface BranchRow {
  active: boolean;
  code: string;
  id: string;
  legal_entity_id: string;
  name: string;
  version: number;
}

interface LocationRow {
  active: boolean;
  address_line_1: string;
  address_line_2: string | null;
  branch_id: string;
  city: string;
  code: string;
  country_code: string;
  id: string;
  location_type: string;
  name: string;
  postal_code: string | null;
  version: number;
}

interface OperatorRow {
  account_id: string;
  active: boolean;
  business_location_id: string;
  code: string;
  display_name: string;
  email: string;
  id: string;
  version: number;
}

interface RegisterRow {
  active: boolean;
  business_location_id: string;
  code: string;
  id: string;
  name: string;
  operator_ids: string[];
  version: number;
}

interface ReplayRow {
  request_hash: string;
  response_body: unknown;
  status: 'completed' | 'failed' | 'processing';
}

interface CommandResult<T> {
  event: string;
  payload: T;
  result: T;
  targetId: string;
  targetType: string;
}

@Injectable()
export class OrganizationService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async topology(): Promise<OrganizationTopology> {
    const pool = this.database.getPool();
    const [entities, branches, locations, operators, registers] = await Promise.all([
      pool.query<EntityRow>(
        `SELECT id, code, name, uic, vat_number, active, version
         FROM organization.legal_entities WHERE active ORDER BY upper(code), id`,
      ),
      pool.query<BranchRow>(
        `SELECT id, legal_entity_id, code, name, active, version
         FROM organization.branches WHERE active ORDER BY upper(code), id`,
      ),
      pool.query<LocationRow>(
        `SELECT id, branch_id, code, name, location_type, address_line_1,
           address_line_2, city, postal_code, country_code, active, version
         FROM organization.business_locations WHERE active ORDER BY upper(code), id`,
      ),
      pool.query<OperatorRow>(
        `SELECT operator.id, operator.business_location_id, operator.account_id,
           operator.code, operator.active, operator.version,
           employee.display_name, employee.email
         FROM organization.operators operator
         JOIN identity.user_accounts account ON account.id = operator.account_id
         JOIN identity.employees employee ON employee.id = account.employee_id
         WHERE operator.active ORDER BY upper(operator.code), operator.id`,
      ),
      pool.query<RegisterRow>(
        `SELECT register.id, register.business_location_id, register.code,
           register.name, register.active, register.version,
           COALESCE(array_agg(assignment.operator_id ORDER BY assignment.operator_id)
             FILTER (WHERE assignment.active), '{}'::uuid[]) AS operator_ids
         FROM organization.cash_registers register
         LEFT JOIN organization.cash_register_operators assignment
           ON assignment.cash_register_id = register.id
         WHERE register.active
         GROUP BY register.id
         ORDER BY upper(register.code), register.id`,
      ),
    ]);
    return {
      branches: branches.rows.map(mapBranch),
      cashRegisters: registers.rows.map(mapRegister),
      legalEntities: entities.rows.map(mapEntity),
      locations: locations.rows.map(mapLocation),
      operators: operators.rows.map(mapOperator),
    };
  }

  async members(): Promise<OrganizationMember[]> {
    const result = await this.database.getPool().query<{
      account_id: string;
      display_name: string;
      email: string;
    }>(
      `SELECT account.id AS account_id, employee.display_name, employee.email
       FROM identity.user_accounts account
       JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE account.status = 'active' AND employee.active
       ORDER BY employee.display_name, account.id`,
    );
    return result.rows.map((row) => ({
      accountId: row.account_id,
      displayName: row.display_name,
      email: row.email,
    }));
  }

  async createLegalEntity(
    input: CreateLegalBusinessEntityRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<LegalBusinessEntity> {
    const normalized = {
      code: code(input.code, 'LEGAL_ENTITY_CODE_REQUIRED'),
      name: text(input.name, 'LEGAL_ENTITY_NAME_REQUIRED'),
      uic: optional(input.uic),
      vatNumber: optional(input.vatNumber)?.toUpperCase(),
    };
    return this.command(
      'organization.legal-entity.create',
      key,
      normalized,
      authentication,
      metadata,
      'LEGAL_ENTITY_DUPLICATE',
      'A legal entity with this code or UIC already exists',
      async (client) => {
        const inserted = await client.query<EntityRow>(
          `INSERT INTO organization.legal_entities (
             code, name, uic, vat_number, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $5)
           RETURNING id, code, name, uic, vat_number, active, version`,
          [
            normalized.code,
            normalized.name,
            normalized.uic ?? null,
            normalized.vatNumber ?? null,
            authentication.accountId,
          ],
        );
        const result = mapEntity(required(inserted.rows[0], 'Legal entity insert failed'));
        return change('organization.legal_entity.created', 'legal_business_entity', result);
      },
    );
  }

  async createBranch(
    legalEntityId: string,
    input: CreateBusinessBranchRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BusinessBranch> {
    const normalized = {
      code: code(input.code, 'BRANCH_CODE_REQUIRED'),
      legalEntityId,
      name: text(input.name, 'BRANCH_NAME_REQUIRED'),
    };
    return this.command(
      `organization.branch.create:${legalEntityId}`,
      key,
      normalized,
      authentication,
      metadata,
      'BRANCH_DUPLICATE',
      'A branch with this code already exists in the legal entity',
      async (client) => {
        await requireActive(
          client,
          'organization.legal_entities',
          legalEntityId,
          'LEGAL_ENTITY_NOT_FOUND',
        );
        const inserted = await client.query<BranchRow>(
          `INSERT INTO organization.branches (
             legal_entity_id, code, name, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $4)
           RETURNING id, legal_entity_id, code, name, active, version`,
          [legalEntityId, normalized.code, normalized.name, authentication.accountId],
        );
        await touch(client, 'organization.legal_entities', legalEntityId, authentication.accountId);
        const result = mapBranch(required(inserted.rows[0], 'Branch insert failed'));
        return change('organization.branch.created', 'business_branch', result);
      },
    );
  }

  async createLocation(
    branchId: string,
    input: CreateBusinessLocationRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BusinessLocation> {
    const countryCode = (optional(input.countryCode) ?? 'BG').toUpperCase();
    if (!/^[A-Z]{2}$/u.test(countryCode)) {
      throw new ApiErrorException(
        'BUSINESS_LOCATION_COUNTRY_INVALID',
        'The country code must use two letters',
        HttpStatus.BAD_REQUEST,
      );
    }
    const normalized = {
      addressLine1: text(input.addressLine1, 'BUSINESS_LOCATION_ADDRESS_REQUIRED'),
      addressLine2: optional(input.addressLine2),
      branchId,
      city: text(input.city, 'BUSINESS_LOCATION_CITY_REQUIRED'),
      code: code(input.code, 'BUSINESS_LOCATION_CODE_REQUIRED'),
      countryCode,
      locationType: text(input.locationType, 'BUSINESS_LOCATION_TYPE_REQUIRED'),
      name: text(input.name, 'BUSINESS_LOCATION_NAME_REQUIRED'),
      postalCode: optional(input.postalCode),
    };
    return this.command(
      `organization.location.create:${branchId}`,
      key,
      normalized,
      authentication,
      metadata,
      'BUSINESS_LOCATION_DUPLICATE',
      'A business location with this code already exists',
      async (client) => {
        await requireActive(client, 'organization.branches', branchId, 'BRANCH_NOT_FOUND');
        const inserted = await client.query<LocationRow>(
          `INSERT INTO organization.business_locations (
             branch_id, code, name, location_type, address_line_1, address_line_2,
             city, postal_code, country_code, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
           RETURNING id, branch_id, code, name, location_type, address_line_1,
             address_line_2, city, postal_code, country_code, active, version`,
          [
            branchId,
            normalized.code,
            normalized.name,
            normalized.locationType,
            normalized.addressLine1,
            normalized.addressLine2 ?? null,
            normalized.city,
            normalized.postalCode ?? null,
            normalized.countryCode,
            authentication.accountId,
          ],
        );
        await touch(client, 'organization.branches', branchId, authentication.accountId);
        const result = mapLocation(required(inserted.rows[0], 'Business location insert failed'));
        return change('organization.business_location.created', 'business_location', result);
      },
    );
  }

  async createOperator(
    locationId: string,
    input: CreateBusinessOperatorRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BusinessOperator> {
    const normalized = {
      accountId: input.accountId,
      code: code(input.code, 'OPERATOR_CODE_REQUIRED'),
      locationId,
    };
    return this.command(
      `organization.operator.create:${locationId}`,
      key,
      normalized,
      authentication,
      metadata,
      'OPERATOR_DUPLICATE',
      'This account or operator code is already assigned to the location',
      async (client) => {
        await requireActive(
          client,
          'organization.business_locations',
          locationId,
          'BUSINESS_LOCATION_NOT_FOUND',
        );
        await requireAccount(client, input.accountId);
        const inserted = await client.query<OperatorRow>(
          `WITH created AS (
             INSERT INTO organization.operators (
               business_location_id, account_id, code, created_by, updated_by
             ) VALUES ($1, $2, $3, $4, $4)
             RETURNING id, business_location_id, account_id, code, active, version
           )
           SELECT created.*, employee.display_name, employee.email
           FROM created
           JOIN identity.user_accounts account ON account.id = created.account_id
           JOIN identity.employees employee ON employee.id = account.employee_id`,
          [locationId, input.accountId, normalized.code, authentication.accountId],
        );
        await touch(
          client,
          'organization.business_locations',
          locationId,
          authentication.accountId,
        );
        const result = mapOperator(required(inserted.rows[0], 'Operator insert failed'));
        return change('organization.operator.created', 'business_operator', result);
      },
    );
  }

  async createRegister(
    locationId: string,
    input: CreateCashRegisterRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CashRegister> {
    const operatorIds = [...new Set(input.operatorIds ?? [])].sort();
    const normalized = {
      code: code(input.code, 'CASH_REGISTER_CODE_REQUIRED'),
      locationId,
      name: text(input.name, 'CASH_REGISTER_NAME_REQUIRED'),
      operatorIds,
    };
    return this.command(
      `organization.cash-register.create:${locationId}`,
      key,
      normalized,
      authentication,
      metadata,
      'CASH_REGISTER_DUPLICATE',
      'A cash register with this code already exists at the location',
      async (client) => {
        await requireActive(
          client,
          'organization.business_locations',
          locationId,
          'BUSINESS_LOCATION_NOT_FOUND',
        );
        if (operatorIds.length) {
          const operators = await client.query<{ id: string }>(
            `SELECT id FROM organization.operators
             WHERE business_location_id = $1 AND active AND id = ANY($2::uuid[])`,
            [locationId, operatorIds],
          );
          if (operators.rowCount !== operatorIds.length) {
            throw new ApiErrorException(
              'CASH_REGISTER_OPERATOR_INVALID',
              'Every assigned operator must be active at the same business location',
              HttpStatus.BAD_REQUEST,
            );
          }
        }
        const inserted = await client.query<Omit<RegisterRow, 'operator_ids'>>(
          `INSERT INTO organization.cash_registers (
             business_location_id, code, name, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $4)
           RETURNING id, business_location_id, code, name, active, version`,
          [locationId, normalized.code, normalized.name, authentication.accountId],
        );
        const row = required(inserted.rows[0], 'Cash register insert failed');
        if (operatorIds.length) {
          await client.query(
            `INSERT INTO organization.cash_register_operators (
               cash_register_id, operator_id, business_location_id, assigned_by
             ) SELECT $1, unnest($2::uuid[]), $3, $4`,
            [row.id, operatorIds, locationId, authentication.accountId],
          );
        }
        await touch(
          client,
          'organization.business_locations',
          locationId,
          authentication.accountId,
        );
        const result = mapRegister({ ...row, operator_ids: operatorIds });
        return change('organization.cash_register.created', 'cash_register', result);
      },
    );
  }

  private async command<T>(
    scope: string,
    keyValue: string | undefined,
    input: object,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    duplicateCode: string,
    duplicateMessage: string,
    work: (client: PoolClient) => Promise<CommandResult<T>>,
  ): Promise<T> {
    const key = validKey(keyValue);
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query(
        `INSERT INTO platform.idempotency_keys (
           scope, idempotency_key, request_hash, status, expires_at
         ) VALUES ($1, $2, $3, 'processing', now() + ($4 * interval '1 second'))
         ON CONFLICT DO NOTHING RETURNING idempotency_key`,
        [scope, key, hash, this.environment.IDEMPOTENCY_TTL_SECONDS],
      );
      if (claimed.rowCount !== 1) {
        const existing = await client.query<ReplayRow>(
          `SELECT request_hash, status, response_body
           FROM platform.idempotency_keys
           WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
          [scope, key],
        );
        const replay = existing.rows[0];
        if (!replay || replay.request_hash !== hash || replay.status !== 'completed') {
          throw new ApiErrorException(
            'IDEMPOTENCY_KEY_CONFLICT',
            'The idempotency key was already used for a different or incomplete request',
            HttpStatus.CONFLICT,
          );
        }
        await client.query('COMMIT');
        return replay.response_body as T;
      }
      const completed = await work(client);
      await client.query(
        `INSERT INTO integration.outbox_events (
           id, aggregate_type, aggregate_id, event_type, event_version,
           correlation_id, idempotency_key, payload
         ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
        [
          randomUUID(),
          completed.targetType,
          completed.targetId,
          completed.event,
          metadata.correlationId,
          `${completed.event}:${key}`,
          completed.payload,
        ],
      );
      await this.audit.append(
        {
          action: completed.event,
          actorAccountId: authentication.accountId,
          after: completed.payload as Record<string, unknown>,
          correlationId: metadata.correlationId,
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          targetId: completed.targetId,
          targetType: completed.targetType,
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await client.query(
        `UPDATE platform.idempotency_keys
         SET status = 'completed', response_status = 201, response_body = $3
         WHERE scope = $1 AND idempotency_key = $2`,
        [scope, key, completed.result],
      );
      await client.query('COMMIT');
      return completed.result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (databaseCode(error) === '23505') {
        throw new ApiErrorException(duplicateCode, duplicateMessage, HttpStatus.CONFLICT);
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapEntity(row: EntityRow): LegalBusinessEntity {
  return {
    active: row.active,
    code: row.code,
    id: row.id,
    name: row.name,
    ...(row.uic ? { uic: row.uic } : {}),
    ...(row.vat_number ? { vatNumber: row.vat_number } : {}),
    version: row.version,
  };
}

function mapBranch(row: BranchRow): BusinessBranch {
  return {
    active: row.active,
    code: row.code,
    id: row.id,
    legalEntityId: row.legal_entity_id,
    name: row.name,
    version: row.version,
  };
}

function mapLocation(row: LocationRow): BusinessLocation {
  return {
    active: row.active,
    addressLine1: row.address_line_1,
    ...(row.address_line_2 ? { addressLine2: row.address_line_2 } : {}),
    branchId: row.branch_id,
    city: row.city,
    code: row.code,
    countryCode: row.country_code,
    id: row.id,
    locationType: row.location_type,
    name: row.name,
    ...(row.postal_code ? { postalCode: row.postal_code } : {}),
    version: row.version,
  };
}

function mapOperator(row: OperatorRow): BusinessOperator {
  return {
    accountId: row.account_id,
    active: row.active,
    businessLocationId: row.business_location_id,
    code: row.code,
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    version: row.version,
  };
}

function mapRegister(row: RegisterRow): CashRegister {
  return {
    active: row.active,
    businessLocationId: row.business_location_id,
    code: row.code,
    id: row.id,
    name: row.name,
    operatorIds: row.operator_ids,
    version: row.version,
  };
}

function change<T extends { id: string }>(
  event: string,
  targetType: string,
  result: T,
): CommandResult<T> {
  return { event, payload: result, result, targetId: result.id, targetType };
}

async function requireActive(
  client: PoolClient,
  table: string,
  id: string,
  codeValue: string,
): Promise<void> {
  const allowed = new Set([
    'organization.legal_entities',
    'organization.branches',
    'organization.business_locations',
  ]);
  if (!allowed.has(table)) throw new Error('Unexpected organization table');
  const result = await client.query(`SELECT id FROM ${table} WHERE id = $1 AND active`, [id]);
  if (!result.rows[0]) {
    throw new ApiErrorException(
      codeValue,
      'The active parent record was not found',
      HttpStatus.NOT_FOUND,
    );
  }
}

async function requireAccount(client: PoolClient, accountId: string): Promise<void> {
  const result = await client.query(
    `SELECT account.id
     FROM identity.user_accounts account
     JOIN identity.employees employee ON employee.id = account.employee_id
     WHERE account.id = $1 AND account.status = 'active' AND employee.active`,
    [accountId],
  );
  if (!result.rows[0]) {
    throw new ApiErrorException(
      'ORGANIZATION_MEMBER_NOT_FOUND',
      'The active employee account was not found',
      HttpStatus.BAD_REQUEST,
    );
  }
}

async function touch(client: PoolClient, table: string, id: string, accountId: string) {
  const allowed = new Set([
    'organization.legal_entities',
    'organization.branches',
    'organization.business_locations',
  ]);
  if (!allowed.has(table)) throw new Error('Unexpected organization table');
  await client.query(
    `UPDATE ${table}
     SET version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1`,
    [id, accountId],
  );
}

function text(value: string, errorCode: string): string {
  const normalized = optional(value);
  if (!normalized) {
    throw new ApiErrorException(errorCode, 'This field is required', HttpStatus.BAD_REQUEST);
  }
  return normalized;
}

function code(value: string, errorCode: string): string {
  return text(value, errorCode).toUpperCase();
}

function optional(value: string | undefined): string | undefined {
  return value?.trim().replace(/\s+/gu, ' ') || undefined;
}

function validKey(value: string | undefined): string {
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

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}
