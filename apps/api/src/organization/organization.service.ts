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
  RecordVersionRequest,
  UpdateBusinessBranchRequest,
  UpdateBusinessLocationRequest,
  UpdateBusinessOperatorRequest,
  UpdateCashRegisterRequest,
  UpdateLegalBusinessEntityRequest,
} from '@vista/contracts';
import type { PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { assertBusinessIdentifiers } from '../common/business-identifiers.js';
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
  before?: T;
  changed?: boolean;
  event: string;
  payload: unknown;
  result: T;
  targetId: string;
  targetType: string;
}

type OrganizationRecordKind = 'branch' | 'entity' | 'location' | 'operator' | 'register';
type OrganizationRecord =
  BusinessBranch | BusinessLocation | BusinessOperator | CashRegister | LegalBusinessEntity;

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
         FROM organization.legal_entities ORDER BY upper(code), id`,
      ),
      pool.query<BranchRow>(
        `SELECT id, legal_entity_id, code, name, active, version
         FROM organization.branches ORDER BY upper(code), id`,
      ),
      pool.query<LocationRow>(
        `SELECT id, branch_id, code, name, location_type, address_line_1,
           address_line_2, city, postal_code, country_code, active, version
         FROM organization.business_locations ORDER BY upper(code), id`,
      ),
      pool.query<OperatorRow>(
        `SELECT operator.id, operator.business_location_id, operator.account_id,
           operator.code, operator.active, operator.version,
           employee.display_name, employee.email
         FROM organization.operators operator
         JOIN identity.user_accounts account ON account.id = operator.account_id
         JOIN identity.employees employee ON employee.id = account.employee_id
         ORDER BY upper(operator.code), operator.id`,
      ),
      pool.query<RegisterRow>(
        `SELECT register.id, register.business_location_id, register.code,
           register.name, register.active, register.version,
           COALESCE(array_agg(assignment.operator_id ORDER BY assignment.operator_id)
             FILTER (WHERE assignment.active AND assigned_operator.active), '{}'::uuid[]) AS operator_ids
         FROM organization.cash_registers register
         LEFT JOIN organization.cash_register_operators assignment
           ON assignment.cash_register_id = register.id
         LEFT JOIN organization.operators assigned_operator
           ON assigned_operator.id = assignment.operator_id
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
      vatNumber: optional(input.vatNumber)?.replace(/\s+/gu, '').toUpperCase(),
    };
    assertBusinessIdentifiers({
      ...(normalized.uic ? { uic: normalized.uic } : {}),
      ...(normalized.vatNumber ? { vatNumber: normalized.vatNumber } : {}),
    });
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

  async updateLegalEntity(
    id: string,
    input: UpdateLegalBusinessEntityRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<LegalBusinessEntity> {
    const normalized = {
      code: code(input.code, 'LEGAL_ENTITY_CODE_REQUIRED'),
      name: text(input.name, 'LEGAL_ENTITY_NAME_REQUIRED'),
      uic: optional(input.uic),
      vatNumber: optional(input.vatNumber)?.replace(/\s+/gu, '').toUpperCase(),
    };
    return this.command(
      `organization.legal-entity.update:${id}`,
      key,
      { ...normalized, expectedVersion: input.expectedVersion, id },
      authentication,
      metadata,
      'LEGAL_ENTITY_DUPLICATE',
      'A legal entity with this code or UIC already exists',
      async (client) => {
        const before = mapEntity(await lockEntity(client, id));
        requireVersion(before.version, input.expectedVersion);
        assertBusinessIdentifiers({
          ...(normalized.uic && normalized.uic !== before.uic ? { uic: normalized.uic } : {}),
          ...(normalized.vatNumber && normalized.vatNumber !== before.vatNumber
            ? { vatNumber: normalized.vatNumber }
            : {}),
        });
        const result = await client.query<EntityRow>(
          `UPDATE organization.legal_entities
           SET code = $2, name = $3, uic = $4, vat_number = $5,
             version = version + 1, updated_by = $6, updated_at = now()
           WHERE id = $1
           RETURNING id, code, name, uic, vat_number, active, version`,
          [
            id,
            normalized.code,
            normalized.name,
            normalized.uic ?? null,
            normalized.vatNumber ?? null,
            authentication.accountId,
          ],
        );
        return change(
          'organization.legal_entity.updated',
          'legal_business_entity',
          mapEntity(required(result.rows[0], 'Legal entity update failed')),
          before,
        );
      },
      HttpStatus.OK,
    );
  }

  async updateBranch(
    id: string,
    input: UpdateBusinessBranchRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BusinessBranch> {
    const normalized = {
      code: code(input.code, 'BRANCH_CODE_REQUIRED'),
      name: text(input.name, 'BRANCH_NAME_REQUIRED'),
    };
    return this.command(
      `organization.branch.update:${id}`,
      key,
      { ...normalized, expectedVersion: input.expectedVersion, id },
      authentication,
      metadata,
      'BRANCH_DUPLICATE',
      'A branch with this code already exists in the legal entity',
      async (client) => {
        const before = mapBranch(await lockBranch(client, id));
        requireVersion(before.version, input.expectedVersion);
        const result = await client.query<BranchRow>(
          `UPDATE organization.branches
           SET code = $2, name = $3, version = version + 1,
             updated_by = $4, updated_at = now()
           WHERE id = $1
           RETURNING id, legal_entity_id, code, name, active, version`,
          [id, normalized.code, normalized.name, authentication.accountId],
        );
        return change(
          'organization.branch.updated',
          'business_branch',
          mapBranch(required(result.rows[0], 'Branch update failed')),
          before,
        );
      },
      HttpStatus.OK,
    );
  }

  async updateLocation(
    id: string,
    input: UpdateBusinessLocationRequest,
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
    const normalized = normalizeLocation(input, countryCode);
    return this.command(
      `organization.location.update:${id}`,
      key,
      { ...normalized, expectedVersion: input.expectedVersion, id },
      authentication,
      metadata,
      'BUSINESS_LOCATION_DUPLICATE',
      'A business location with this code already exists',
      async (client) => {
        const before = mapLocation(await lockLocation(client, id));
        requireVersion(before.version, input.expectedVersion);
        const result = await client.query<LocationRow>(
          `UPDATE organization.business_locations
           SET code = $2, name = $3, location_type = $4, address_line_1 = $5,
             address_line_2 = $6, city = $7, postal_code = $8, country_code = $9,
             version = version + 1, updated_by = $10, updated_at = now()
           WHERE id = $1
           RETURNING id, branch_id, code, name, location_type, address_line_1,
             address_line_2, city, postal_code, country_code, active, version`,
          [
            id,
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
        return change(
          'organization.business_location.updated',
          'business_location',
          mapLocation(required(result.rows[0], 'Business location update failed')),
          before,
        );
      },
      HttpStatus.OK,
    );
  }

  async updateOperator(
    id: string,
    input: UpdateBusinessOperatorRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BusinessOperator> {
    const normalized = { code: code(input.code, 'OPERATOR_CODE_REQUIRED') };
    return this.command(
      `organization.operator.update:${id}`,
      key,
      { ...normalized, expectedVersion: input.expectedVersion, id },
      authentication,
      metadata,
      'OPERATOR_DUPLICATE',
      'This operator code already exists at the business location',
      async (client) => {
        const before = mapOperator(await lockOperator(client, id));
        requireVersion(before.version, input.expectedVersion);
        const result = await client.query<OperatorRow>(
          `WITH updated AS (
             UPDATE organization.operators
             SET code = $2, version = version + 1, updated_by = $3, updated_at = now()
             WHERE id = $1
             RETURNING id, business_location_id, account_id, code, active, version
           )
           SELECT updated.*, employee.display_name, employee.email
           FROM updated
           JOIN identity.user_accounts account ON account.id = updated.account_id
           JOIN identity.employees employee ON employee.id = account.employee_id`,
          [id, normalized.code, authentication.accountId],
        );
        return change(
          'organization.operator.updated',
          'business_operator',
          mapOperator(required(result.rows[0], 'Operator update failed')),
          before,
        );
      },
      HttpStatus.OK,
    );
  }

  async updateRegister(
    id: string,
    input: UpdateCashRegisterRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CashRegister> {
    const operatorIds = [...new Set(input.operatorIds ?? [])].sort();
    const normalized = {
      code: code(input.code, 'CASH_REGISTER_CODE_REQUIRED'),
      name: text(input.name, 'CASH_REGISTER_NAME_REQUIRED'),
      operatorIds,
    };
    return this.command(
      `organization.cash-register.update:${id}`,
      key,
      { ...normalized, expectedVersion: input.expectedVersion, id },
      authentication,
      metadata,
      'CASH_REGISTER_DUPLICATE',
      'A cash register with this code already exists at the location',
      async (client) => {
        const before = mapRegister(await lockRegister(client, id));
        requireVersion(before.version, input.expectedVersion);
        if (operatorIds.length) {
          const operators = await client.query<{ id: string }>(
            `SELECT id FROM organization.operators
             WHERE business_location_id = $1 AND active AND id = ANY($2::uuid[])`,
            [before.businessLocationId, operatorIds],
          );
          if (operators.rowCount !== operatorIds.length) {
            throw new ApiErrorException(
              'CASH_REGISTER_OPERATOR_INVALID',
              'Every assigned operator must be active at the same business location',
              HttpStatus.BAD_REQUEST,
            );
          }
        }
        await client.query<RegisterRow>(
          `UPDATE organization.cash_registers
           SET code = $2, name = $3, version = version + 1,
             updated_by = $4, updated_at = now()
           WHERE id = $1
           RETURNING id, business_location_id, code, name, active, version,
             '{}'::uuid[] AS operator_ids`,
          [id, normalized.code, normalized.name, authentication.accountId],
        );
        await client.query(
          `UPDATE organization.cash_register_operators
           SET active = (operator_id = ANY($2::uuid[])),
             assigned_by = $3,
             assigned_at = CASE WHEN operator_id = ANY($2::uuid[]) THEN now() ELSE assigned_at END
           WHERE cash_register_id = $1
             AND active IS DISTINCT FROM (operator_id = ANY($2::uuid[]))`,
          [id, operatorIds, authentication.accountId],
        );
        await client.query(
          `INSERT INTO organization.cash_register_operators AS existing (
             cash_register_id, operator_id, business_location_id, assigned_by
           ) SELECT $1, selected.operator_id, $3, $4
             FROM unnest($2::uuid[]) AS selected(operator_id)
           ON CONFLICT (cash_register_id, operator_id) DO UPDATE
             SET active = true, assigned_by = EXCLUDED.assigned_by, assigned_at = now()
             WHERE existing.active = false`,
          [id, operatorIds, before.businessLocationId, authentication.accountId],
        );
        const after = mapRegister(await loadRegister(client, id));
        return change('organization.cash_register.updated', 'cash_register', after, before);
      },
      HttpStatus.OK,
    );
  }

  setLegalEntityActive(
    id: string,
    active: boolean,
    input: RecordVersionRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<LegalBusinessEntity> {
    return this.setRecordActive(
      'entity',
      id,
      active,
      input,
      key,
      authentication,
      metadata,
    ) as Promise<LegalBusinessEntity>;
  }

  setBranchActive(
    id: string,
    active: boolean,
    input: RecordVersionRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BusinessBranch> {
    return this.setRecordActive(
      'branch',
      id,
      active,
      input,
      key,
      authentication,
      metadata,
    ) as Promise<BusinessBranch>;
  }

  setLocationActive(
    id: string,
    active: boolean,
    input: RecordVersionRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BusinessLocation> {
    return this.setRecordActive(
      'location',
      id,
      active,
      input,
      key,
      authentication,
      metadata,
    ) as Promise<BusinessLocation>;
  }

  setOperatorActive(
    id: string,
    active: boolean,
    input: RecordVersionRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BusinessOperator> {
    return this.setRecordActive(
      'operator',
      id,
      active,
      input,
      key,
      authentication,
      metadata,
    ) as Promise<BusinessOperator>;
  }

  setRegisterActive(
    id: string,
    active: boolean,
    input: RecordVersionRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CashRegister> {
    return this.setRecordActive(
      'register',
      id,
      active,
      input,
      key,
      authentication,
      metadata,
    ) as Promise<CashRegister>;
  }

  private async setRecordActive(
    kind: OrganizationRecordKind,
    id: string,
    active: boolean,
    input: RecordVersionRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<OrganizationRecord> {
    return this.command(
      `organization.${kind}.${active ? 'reactivate' : 'deactivate'}:${id}`,
      key,
      { active, expectedVersion: input.expectedVersion, id },
      authentication,
      metadata,
      'ORGANIZATION_RECORD_DUPLICATE',
      'The business structure record conflicts with an existing record',
      async (client) => {
        const before = await lockOrganizationRecord(client, kind, id);
        requireVersion(before.version, input.expectedVersion);
        if (before.active === active) {
          return {
            ...change(organizationEvent(kind, active), organizationTarget(kind), before),
            changed: false,
          };
        }
        if (active) await requireActiveParent(client, kind, before);
        else await requireNoActiveDependents(client, kind, id);
        const updated = await client.query(
          `UPDATE ${organizationTable(kind)}
           SET active = $2, version = version + 1, updated_by = $3, updated_at = now()
           WHERE id = $1`,
          [id, active, authentication.accountId],
        );
        if (updated.rowCount !== 1) throw organizationNotFound();
        const after = await lockOrganizationRecord(client, kind, id);
        return change(organizationEvent(kind, active), organizationTarget(kind), after, before);
      },
      HttpStatus.OK,
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
    responseStatus = HttpStatus.CREATED,
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
      if (completed.changed !== false) {
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
            after: completed.result as Record<string, unknown>,
            ...(completed.before ? { before: completed.before } : {}),
            correlationId: metadata.correlationId,
            ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
            targetId: completed.targetId,
            targetType: completed.targetType,
            ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          },
          client,
        );
      }
      await client.query(
        `UPDATE platform.idempotency_keys
         SET status = 'completed', response_status = $4, response_body = $3
         WHERE scope = $1 AND idempotency_key = $2`,
        [scope, key, completed.result, responseStatus],
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
  before?: T,
): CommandResult<T> {
  return {
    ...(before ? { before } : {}),
    event,
    payload: before ? { before, after: result } : result,
    result,
    targetId: result.id,
    targetType,
  };
}

async function lockEntity(client: PoolClient, id: string): Promise<EntityRow> {
  return lockedRow(
    await client.query<EntityRow>(
      `SELECT id, code, name, uic, vat_number, active, version
       FROM organization.legal_entities WHERE id = $1 FOR UPDATE`,
      [id],
    ),
    'Legal entity',
  );
}

async function lockBranch(client: PoolClient, id: string): Promise<BranchRow> {
  return lockedRow(
    await client.query<BranchRow>(
      `SELECT id, legal_entity_id, code, name, active, version
       FROM organization.branches WHERE id = $1 FOR UPDATE`,
      [id],
    ),
    'Branch',
  );
}

async function lockLocation(client: PoolClient, id: string): Promise<LocationRow> {
  return lockedRow(
    await client.query<LocationRow>(
      `SELECT id, branch_id, code, name, location_type, address_line_1,
         address_line_2, city, postal_code, country_code, active, version
       FROM organization.business_locations WHERE id = $1 FOR UPDATE`,
      [id],
    ),
    'Business location',
  );
}

async function lockOperator(client: PoolClient, id: string): Promise<OperatorRow> {
  return lockedRow(
    await client.query<OperatorRow>(
      `SELECT operator.id, operator.business_location_id, operator.account_id,
         operator.code, operator.active, operator.version,
         employee.display_name, employee.email
       FROM organization.operators operator
       JOIN identity.user_accounts account ON account.id = operator.account_id
       JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE operator.id = $1 FOR UPDATE OF operator`,
      [id],
    ),
    'Operator',
  );
}

async function loadRegister(client: PoolClient, id: string): Promise<RegisterRow> {
  const result = await client.query<RegisterRow>(
    `SELECT register.id, register.business_location_id, register.code,
       register.name, register.active, register.version,
       COALESCE(array_agg(assignment.operator_id ORDER BY assignment.operator_id)
         FILTER (WHERE assignment.active AND assigned_operator.active), '{}'::uuid[]) AS operator_ids
     FROM organization.cash_registers register
     LEFT JOIN organization.cash_register_operators assignment
       ON assignment.cash_register_id = register.id
     LEFT JOIN organization.operators assigned_operator
       ON assigned_operator.id = assignment.operator_id
     WHERE register.id = $1
     GROUP BY register.id`,
    [id],
  );
  return lockedRow(result, 'Cash register');
}

async function lockRegister(client: PoolClient, id: string): Promise<RegisterRow> {
  const locked = await client.query(
    'SELECT id FROM organization.cash_registers WHERE id = $1 FOR UPDATE',
    [id],
  );
  if (!locked.rowCount) throw organizationNotFound('Cash register');
  return loadRegister(client, id);
}

async function lockOrganizationRecord(
  client: PoolClient,
  kind: OrganizationRecordKind,
  id: string,
): Promise<OrganizationRecord> {
  switch (kind) {
    case 'entity':
      return mapEntity(await lockEntity(client, id));
    case 'branch':
      return mapBranch(await lockBranch(client, id));
    case 'location':
      return mapLocation(await lockLocation(client, id));
    case 'operator':
      return mapOperator(await lockOperator(client, id));
    case 'register':
      return mapRegister(await lockRegister(client, id));
  }
}

function organizationTable(kind: OrganizationRecordKind): string {
  switch (kind) {
    case 'entity':
      return 'organization.legal_entities';
    case 'branch':
      return 'organization.branches';
    case 'location':
      return 'organization.business_locations';
    case 'operator':
      return 'organization.operators';
    case 'register':
      return 'organization.cash_registers';
  }
}

function organizationTarget(kind: OrganizationRecordKind): string {
  return {
    branch: 'business_branch',
    entity: 'legal_business_entity',
    location: 'business_location',
    operator: 'business_operator',
    register: 'cash_register',
  }[kind];
}

function organizationEvent(kind: OrganizationRecordKind, active: boolean): string {
  const resource = {
    branch: 'branch',
    entity: 'legal_entity',
    location: 'business_location',
    operator: 'operator',
    register: 'cash_register',
  }[kind];
  return `organization.${resource}.${active ? 'reactivated' : 'deactivated'}`;
}

async function requireActiveParent(
  client: PoolClient,
  kind: OrganizationRecordKind,
  record: OrganizationRecord,
): Promise<void> {
  if (kind === 'branch')
    await requireActive(
      client,
      'organization.legal_entities',
      (record as BusinessBranch).legalEntityId,
      'LEGAL_ENTITY_NOT_FOUND',
    );
  if (kind === 'location')
    await requireActive(
      client,
      'organization.branches',
      (record as BusinessLocation).branchId,
      'BRANCH_NOT_FOUND',
    );
  if (kind === 'operator' || kind === 'register') {
    const locationId = (record as BusinessOperator | CashRegister).businessLocationId;
    await requireActive(
      client,
      'organization.business_locations',
      locationId,
      'BUSINESS_LOCATION_NOT_FOUND',
    );
  }
  if (kind === 'operator') await requireAccount(client, (record as BusinessOperator).accountId);
}

async function requireNoActiveDependents(
  client: PoolClient,
  kind: OrganizationRecordKind,
  id: string,
): Promise<void> {
  const checks: Partial<
    Record<OrganizationRecordKind, { code: string; message: string; sql: string }>
  > = {
    entity: {
      code: 'LEGAL_ENTITY_HAS_ACTIVE_BRANCHES',
      message: 'Deactivate its active branches before deactivating this legal entity',
      sql: 'SELECT id FROM organization.branches WHERE legal_entity_id = $1 AND active LIMIT 1',
    },
    branch: {
      code: 'BRANCH_HAS_ACTIVE_LOCATIONS',
      message: 'Deactivate its active locations before deactivating this branch',
      sql: 'SELECT id FROM organization.business_locations WHERE branch_id = $1 AND active LIMIT 1',
    },
    location: {
      code: 'BUSINESS_LOCATION_HAS_ACTIVE_RECORDS',
      message:
        'Deactivate its cash registers, operators, and warehouses before deactivating this location',
      sql: `SELECT id FROM organization.cash_registers WHERE business_location_id = $1 AND active
            UNION ALL
            SELECT id FROM organization.operators WHERE business_location_id = $1 AND active
            UNION ALL
            SELECT id FROM master_data.warehouses WHERE business_location_id = $1 AND active
            LIMIT 1`,
    },
    operator: {
      code: 'OPERATOR_HAS_ACTIVE_ASSIGNMENTS',
      message:
        'Remove this operator from cash registers and technician warehouses before deactivating the assignment',
      sql: `SELECT assignment.cash_register_id AS id
            FROM organization.cash_register_operators assignment
            WHERE assignment.operator_id = $1 AND assignment.active
            UNION ALL
            SELECT id FROM master_data.warehouses
            WHERE technician_operator_id = $1 AND active
            UNION ALL
            SELECT id FROM pos.shifts WHERE operator_id = $1 AND status = 'open'
            LIMIT 1`,
    },
    register: {
      code: 'CASH_REGISTER_HAS_OPEN_SHIFT',
      message: 'Close the active cashier shift before deactivating this cash register',
      sql: "SELECT id FROM pos.shifts WHERE cash_register_id = $1 AND status = 'open' LIMIT 1",
    },
  };
  const check = checks[kind];
  if (!check) return;
  const result = await client.query(check.sql, [id]);
  if (result.rowCount) throw new ApiErrorException(check.code, check.message, HttpStatus.CONFLICT);
}

function normalizeLocation(
  input: CreateBusinessLocationRequest | UpdateBusinessLocationRequest,
  countryCode = (optional(input.countryCode) ?? 'BG').toUpperCase(),
) {
  return {
    addressLine1: text(input.addressLine1, 'BUSINESS_LOCATION_ADDRESS_REQUIRED'),
    addressLine2: optional(input.addressLine2),
    city: text(input.city, 'BUSINESS_LOCATION_CITY_REQUIRED'),
    code: code(input.code, 'BUSINESS_LOCATION_CODE_REQUIRED'),
    countryCode,
    locationType: text(input.locationType, 'BUSINESS_LOCATION_TYPE_REQUIRED'),
    name: text(input.name, 'BUSINESS_LOCATION_NAME_REQUIRED'),
    postalCode: optional(input.postalCode),
  };
}

function requireVersion(actual: number, expected: number): void {
  if (actual !== expected)
    throw new ApiErrorException(
      'ORGANIZATION_VERSION_CONFLICT',
      'This record changed after it was opened. Refresh it and try again.',
      HttpStatus.CONFLICT,
    );
}

function lockedRow<T>(result: { rows: T[] }, resource: string): T {
  const row = result.rows[0];
  if (!row) throw organizationNotFound(resource);
  return row;
}

function organizationNotFound(resource = 'Business structure record'): ApiErrorException {
  return new ApiErrorException(
    'ORGANIZATION_RECORD_NOT_FOUND',
    `${resource} was not found`,
    HttpStatus.NOT_FOUND,
  );
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
  const result = await client.query(`SELECT id FROM ${table} WHERE id = $1 AND active FOR SHARE`, [
    id,
  ]);
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
