import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CreateCustomerEquipmentRequest,
  CreateCustomerLocationRequest,
  CustomerEquipment,
  CustomerLocation,
  CustomerLocationProfile,
  PartnerContact,
  RecordVersionRequest,
  UpdateCustomerEquipmentRequest,
  UpdateCustomerLocationRequest,
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

interface LocationRow {
  active: boolean;
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  contact_active: boolean | null;
  contact_display_name: string | null;
  contact_email: string | null;
  contact_id: string | null;
  contact_job_title: string | null;
  contact_role: string | null;
  contact_telephone: string | null;
  country_code: string;
  id: string;
  location_type: string;
  name: string;
  partner_id: string;
  postal_code: string | null;
  version: number;
}

interface EquipmentRow {
  active: boolean;
  customer_location_id: string;
  device_name: string;
  id: string;
  product_id: string | null;
  purchase_date: string;
  serial_number: string;
  serialized_item_id: string | null;
  status: CustomerEquipment['status'];
  version: number;
  warranty_end_date: string | null;
  warranty_start_date: string;
}

interface IdempotencyRow {
  request_hash: string;
  response_body: unknown;
  status: 'completed' | 'failed' | 'processing';
}

interface NormalizedLocationInput {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  countryCode: string;
  locationType: string;
  name: string;
  postalCode?: string;
  responsibleContactId?: string;
}

interface NormalizedEquipmentInput {
  deviceName: string;
  productId?: string;
  purchaseDate: string;
  serialNumber: string;
  status: CustomerEquipment['status'];
  warrantyEndsOn?: string;
  warrantyStartsOn: string;
}

const locationSelect = `
  SELECT location.id, location.partner_id, location.name, location.location_type,
    location.address_line_1, location.address_line_2, location.city,
    location.postal_code, location.country_code, location.active, location.version,
    contact.id AS contact_id, contact.display_name AS contact_display_name,
    contact.job_title AS contact_job_title, contact.telephone AS contact_telephone,
    contact.email AS contact_email, contact.contact_role, contact.active AS contact_active
  FROM master_data.customer_locations location
  LEFT JOIN master_data.partner_contacts contact ON contact.id = location.responsible_contact_id`;

@Injectable()
export class CustomerAssetsService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(partnerId: string): Promise<CustomerLocationProfile[]> {
    const pool = this.database.getPool();
    await requireCustomerPartner(pool, partnerId, false);
    const [locations, equipment] = await Promise.all([
      pool.query<LocationRow>(
        `${locationSelect}
         WHERE location.partner_id = $1
         ORDER BY location.normalized_name, location.id`,
        [partnerId],
      ),
      pool.query<EquipmentRow>(
        `SELECT equipment.id, equipment.customer_location_id, equipment.product_id,
           equipment.serialized_item_id, equipment.device_name, equipment.serial_number,
           equipment.purchase_date::text AS purchase_date,
           equipment.warranty_start_date::text AS warranty_start_date,
           equipment.warranty_end_date::text AS warranty_end_date,
           equipment.status, equipment.active, equipment.version
         FROM master_data.customer_equipment equipment
         JOIN master_data.customer_locations location
           ON location.id = equipment.customer_location_id
         WHERE location.partner_id = $1
         ORDER BY equipment.device_name, upper(equipment.serial_number), equipment.id`,
        [partnerId],
      ),
    ]);
    const equipmentByLocation = new Map<string, CustomerEquipment[]>();
    for (const row of equipment.rows) {
      const current = equipmentByLocation.get(row.customer_location_id) ?? [];
      current.push(mapEquipment(row));
      equipmentByLocation.set(row.customer_location_id, current);
    }
    return locations.rows.map((row) => ({
      equipment: equipmentByLocation.get(row.id) ?? [],
      location: mapLocation(row),
    }));
  }

  async createLocation(
    partnerId: string,
    input: CreateCustomerLocationRequest,
    idempotencyKey: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CustomerLocation> {
    const normalized = normalizeLocation(input);
    const key = validateIdempotencyKey(idempotencyKey);
    const scope = `master-data.customer-locations.create:${partnerId}`;
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claimIdempotency(
        client,
        scope,
        key,
        requestHash(normalized),
        this.environment.IDEMPOTENCY_TTL_SECONDS,
        isCustomerLocation,
      );
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }
      await requireCustomerPartner(client, partnerId);
      if (normalized.responsibleContactId) {
        await requirePartnerContact(client, partnerId, normalized.responsibleContactId);
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `customer-location:${partnerId}:${normalized.name.toLocaleLowerCase('en-US')}`,
      ]);
      const inserted = await client.query<LocationRow>(
        `INSERT INTO master_data.customer_locations (
           partner_id, name, location_type, address_line_1, address_line_2, city,
           postal_code, country_code, responsible_contact_id, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING id, partner_id, name, location_type, address_line_1, address_line_2,
           city, postal_code, country_code, active, version,
           NULL::uuid AS contact_id, NULL::text AS contact_display_name,
           NULL::text AS contact_job_title, NULL::text AS contact_telephone,
           NULL::text AS contact_email, NULL::text AS contact_role,
           NULL::boolean AS contact_active`,
        [
          partnerId,
          normalized.name,
          normalized.locationType,
          normalized.addressLine1,
          normalized.addressLine2 ?? null,
          normalized.city,
          normalized.postalCode ?? null,
          normalized.countryCode,
          normalized.responsibleContactId ?? null,
          authentication.accountId,
        ],
      );
      const row = required(inserted.rows[0], 'Customer location insert failed');
      if (normalized.responsibleContactId) {
        const contact = await contactById(client, normalized.responsibleContactId);
        applyContact(row, required(contact, 'Responsible contact disappeared'));
      }
      const location = mapLocation(row);
      await touchPartner(client, partnerId, authentication.accountId);
      await recordChange(
        client,
        this.audit,
        authentication,
        metadata,
        key,
        'master_data.customer_location.created',
        'customer_location',
        location.id,
        { partnerId, location },
      );
      await completeIdempotency(client, scope, key, location);
      await client.query('COMMIT');
      return location;
    } catch (error) {
      await client.query('ROLLBACK');
      if (constraint(error) === 'customer_locations_partner_name_unique') {
        throw new ApiErrorException(
          'CUSTOMER_LOCATION_DUPLICATE',
          'A location with this name already exists for the customer',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async createEquipment(
    partnerId: string,
    locationId: string,
    input: CreateCustomerEquipmentRequest,
    idempotencyKey: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CustomerEquipment> {
    const normalized = normalizeEquipment(input);
    const key = validateIdempotencyKey(idempotencyKey);
    const scope = `master-data.customer-equipment.create:${locationId}`;
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claimIdempotency(
        client,
        scope,
        key,
        requestHash(normalized),
        this.environment.IDEMPOTENCY_TTL_SECONDS,
        isCustomerEquipment,
      );
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }
      await requireCustomerPartner(client, partnerId);
      await requireCustomerLocation(client, partnerId, locationId);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `customer-equipment:${normalized.serialNumber.toUpperCase()}`,
      ]);
      if (normalized.productId) await requireProduct(client, normalized.productId);
      const inventoryItem = await client.query<{ id: string; product_id: string }>(
        `SELECT id, product_id FROM inventory.serialized_items
         WHERE upper(serial_number) = upper($1)`,
        [normalized.serialNumber],
      );
      const serializedItem = inventoryItem.rows[0];
      if (
        serializedItem &&
        normalized.productId &&
        serializedItem.product_id !== normalized.productId
      ) {
        throw new ApiErrorException(
          'CUSTOMER_EQUIPMENT_PRODUCT_MISMATCH',
          'The serial number belongs to a different catalog product',
          HttpStatus.CONFLICT,
        );
      }
      const productId = normalized.productId ?? serializedItem?.product_id;
      const inserted = await client.query<EquipmentRow>(
        `INSERT INTO master_data.customer_equipment (
           customer_location_id, product_id, serialized_item_id, device_name,
           serial_number, purchase_date, warranty_start_date, warranty_end_date,
           status, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING id, customer_location_id, product_id, serialized_item_id,
           device_name, serial_number, purchase_date::text AS purchase_date,
           warranty_start_date::text AS warranty_start_date,
           warranty_end_date::text AS warranty_end_date, status, active, version`,
        [
          locationId,
          productId ?? null,
          serializedItem?.id ?? null,
          normalized.deviceName,
          normalized.serialNumber,
          normalized.purchaseDate,
          normalized.warrantyStartsOn,
          normalized.warrantyEndsOn ?? null,
          normalized.status,
          authentication.accountId,
        ],
      );
      const equipment = mapEquipment(
        required(inserted.rows[0], 'Customer equipment insert failed'),
      );
      await client.query(
        `UPDATE master_data.customer_locations
         SET version = version + 1, updated_at = now(), updated_by = $2
         WHERE id = $1`,
        [locationId, authentication.accountId],
      );
      await touchPartner(client, partnerId, authentication.accountId);
      await recordChange(
        client,
        this.audit,
        authentication,
        metadata,
        key,
        'master_data.customer_equipment.created',
        'customer_equipment',
        equipment.id,
        { equipment, partnerId },
      );
      await completeIdempotency(client, scope, key, equipment);
      await client.query('COMMIT');
      return equipment;
    } catch (error) {
      await client.query('ROLLBACK');
      if (
        [
          'customer_equipment_active_serial_item_unique',
          'customer_equipment_active_serial_number_unique',
          'customer_equipment_serial_unique',
        ].includes(constraint(error) ?? '')
      ) {
        throw new ApiErrorException(
          'CUSTOMER_EQUIPMENT_SERIAL_DUPLICATE',
          'This serial number is already registered to customer equipment',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateLocation(
    partnerId: string,
    locationId: string,
    input: UpdateCustomerLocationRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CustomerLocation> {
    const normalized = normalizeLocation(input);
    return this.assetCommand(
      `master-data.customer-locations.update:${locationId}`,
      key,
      { ...normalized, expectedVersion: input.expectedVersion, locationId, partnerId },
      isCustomerLocation,
      async (client, idempotencyKey) => {
        await requireCustomerPartner(client, partnerId);
        const before = await lockLocation(client, partnerId, locationId);
        requireVersion(before.version, input.expectedVersion, 'CUSTOMER_LOCATION_VERSION_CONFLICT');
        if (normalized.responsibleContactId)
          await requirePartnerContact(client, partnerId, normalized.responsibleContactId);
        await client.query(
          `UPDATE master_data.customer_locations SET name = $3, location_type = $4,
             address_line_1 = $5, address_line_2 = $6, city = $7, postal_code = $8,
             country_code = $9, responsible_contact_id = $10, version = version + 1,
             updated_by = $11, updated_at = now() WHERE id = $1 AND partner_id = $2`,
          [
            locationId,
            partnerId,
            normalized.name,
            normalized.locationType,
            normalized.addressLine1,
            normalized.addressLine2 ?? null,
            normalized.city,
            normalized.postalCode ?? null,
            normalized.countryCode,
            normalized.responsibleContactId ?? null,
            authentication.accountId,
          ],
        );
        const after = await locationById(client, partnerId, locationId);
        await touchPartner(client, partnerId, authentication.accountId);
        await recordChange(
          client,
          this.audit,
          authentication,
          metadata,
          idempotencyKey,
          'master_data.customer_location.updated',
          'customer_location',
          locationId,
          { after, before, partnerId },
        );
        return after;
      },
    );
  }

  async setLocationActive(
    partnerId: string,
    locationId: string,
    active: boolean,
    input: RecordVersionRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CustomerLocation> {
    return this.assetCommand(
      `master-data.customer-locations.${active ? 'reactivate' : 'deactivate'}:${locationId}`,
      key,
      { active, expectedVersion: input.expectedVersion, locationId, partnerId },
      isCustomerLocation,
      async (client, idempotencyKey) => {
        await requireCustomerPartner(client, partnerId);
        const before = await lockLocation(client, partnerId, locationId);
        requireVersion(before.version, input.expectedVersion, 'CUSTOMER_LOCATION_VERSION_CONFLICT');
        if (!active) {
          const equipment = await client.query(
            'SELECT id FROM master_data.customer_equipment WHERE customer_location_id = $1 AND active LIMIT 1',
            [locationId],
          );
          if (equipment.rowCount)
            throw new ApiErrorException(
              'CUSTOMER_LOCATION_HAS_ACTIVE_EQUIPMENT',
              'Deactivate installed equipment before deactivating this location',
              HttpStatus.CONFLICT,
            );
        }
        if (before.active === active) return before;
        await client.query(
          `UPDATE master_data.customer_locations SET active = $2, version = version + 1,
             updated_by = $3, updated_at = now() WHERE id = $1`,
          [locationId, active, authentication.accountId],
        );
        const after = await locationById(client, partnerId, locationId);
        await touchPartner(client, partnerId, authentication.accountId);
        await recordChange(
          client,
          this.audit,
          authentication,
          metadata,
          idempotencyKey,
          `master_data.customer_location.${active ? 'reactivated' : 'deactivated'}`,
          'customer_location',
          locationId,
          { after, before, partnerId },
        );
        return after;
      },
    );
  }

  async updateEquipment(
    partnerId: string,
    locationId: string,
    equipmentId: string,
    input: UpdateCustomerEquipmentRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CustomerEquipment> {
    const normalized = normalizeEquipmentMaintenance(input);
    return this.assetCommand(
      `master-data.customer-equipment.update:${equipmentId}`,
      key,
      { ...normalized, equipmentId, expectedVersion: input.expectedVersion, locationId, partnerId },
      isCustomerEquipment,
      async (client, idempotencyKey) => {
        await requireCustomerPartner(client, partnerId);
        await requireCustomerLocation(client, partnerId, locationId);
        const before = await lockEquipment(client, locationId, equipmentId);
        requireVersion(
          before.version,
          input.expectedVersion,
          'CUSTOMER_EQUIPMENT_VERSION_CONFLICT',
        );
        await client.query(
          `UPDATE master_data.customer_equipment SET device_name = $3, purchase_date = $4,
             warranty_start_date = $5, warranty_end_date = $6, status = $7,
             version = version + 1, updated_by = $8, updated_at = now()
           WHERE id = $1 AND customer_location_id = $2`,
          [
            equipmentId,
            locationId,
            normalized.deviceName,
            normalized.purchaseDate,
            normalized.warrantyStartsOn,
            normalized.warrantyEndsOn ?? null,
            normalized.status,
            authentication.accountId,
          ],
        );
        const after = await equipmentById(client, locationId, equipmentId);
        await touchLocationAndPartner(client, locationId, partnerId, authentication.accountId);
        await recordChange(
          client,
          this.audit,
          authentication,
          metadata,
          idempotencyKey,
          'master_data.customer_equipment.updated',
          'customer_equipment',
          equipmentId,
          { after, before, partnerId },
        );
        return after;
      },
    );
  }

  async setEquipmentActive(
    partnerId: string,
    locationId: string,
    equipmentId: string,
    active: boolean,
    input: RecordVersionRequest,
    key: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CustomerEquipment> {
    return this.assetCommand(
      `master-data.customer-equipment.${active ? 'reactivate' : 'deactivate'}:${equipmentId}`,
      key,
      { active, equipmentId, expectedVersion: input.expectedVersion, locationId, partnerId },
      isCustomerEquipment,
      async (client, idempotencyKey) => {
        await requireCustomerPartner(client, partnerId);
        await requireCustomerLocation(client, partnerId, locationId);
        const before = await lockEquipment(client, locationId, equipmentId);
        requireVersion(
          before.version,
          input.expectedVersion,
          'CUSTOMER_EQUIPMENT_VERSION_CONFLICT',
        );
        if (before.active === active) return mapEquipment(before);
        await client.query(
          `UPDATE master_data.customer_equipment SET active = $2, version = version + 1,
             updated_by = $3, updated_at = now() WHERE id = $1`,
          [equipmentId, active, authentication.accountId],
        );
        const after = await equipmentById(client, locationId, equipmentId);
        await touchLocationAndPartner(client, locationId, partnerId, authentication.accountId);
        await recordChange(
          client,
          this.audit,
          authentication,
          metadata,
          idempotencyKey,
          `master_data.customer_equipment.${active ? 'reactivated' : 'deactivated'}`,
          'customer_equipment',
          equipmentId,
          { after, before: mapEquipment(before), partnerId },
        );
        return after;
      },
    );
  }

  private async assetCommand<T>(
    scope: string,
    keyValue: string | undefined,
    payload: object,
    guard: (value: unknown) => value is T,
    action: (client: PoolClient, key: string) => Promise<T>,
  ): Promise<T> {
    const key = validateIdempotencyKey(keyValue);
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claimIdempotency(
        client,
        scope,
        key,
        requestHash(payload),
        this.environment.IDEMPOTENCY_TTL_SECONDS,
        guard,
      );
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }
      const result = await action(client, key);
      await completeIdempotency(client, scope, key, result, 200);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (constraint(error) === 'customer_locations_partner_name_unique')
        throw new ApiErrorException(
          'CUSTOMER_LOCATION_DUPLICATE',
          'A location with this name already exists for the customer',
          HttpStatus.CONFLICT,
        );
      throw error;
    } finally {
      client.release();
    }
  }
}

async function lockLocation(
  client: PoolClient,
  partnerId: string,
  locationId: string,
): Promise<CustomerLocation> {
  const locked = await client.query(
    'SELECT id FROM master_data.customer_locations WHERE id = $1 AND partner_id = $2 FOR UPDATE',
    [locationId, partnerId],
  );
  if (!locked.rowCount)
    throw new ApiErrorException(
      'CUSTOMER_LOCATION_NOT_FOUND',
      'The customer location was not found',
      HttpStatus.NOT_FOUND,
    );
  return locationById(client, partnerId, locationId);
}

async function locationById(
  client: PoolClient,
  partnerId: string,
  locationId: string,
): Promise<CustomerLocation> {
  const result = await client.query<LocationRow>(
    `${locationSelect} WHERE location.id = $1 AND location.partner_id = $2`,
    [locationId, partnerId],
  );
  return mapLocation(required(result.rows[0], 'Customer location disappeared'));
}

async function lockEquipment(
  client: PoolClient,
  locationId: string,
  equipmentId: string,
): Promise<EquipmentRow> {
  const result = await client.query<EquipmentRow>(
    `SELECT id, customer_location_id, product_id, serialized_item_id, device_name,
       serial_number, purchase_date::text AS purchase_date,
       warranty_start_date::text AS warranty_start_date,
       warranty_end_date::text AS warranty_end_date, status, active, version
     FROM master_data.customer_equipment
     WHERE id = $1 AND customer_location_id = $2 FOR UPDATE`,
    [equipmentId, locationId],
  );
  if (!result.rowCount)
    throw new ApiErrorException(
      'CUSTOMER_EQUIPMENT_NOT_FOUND',
      'The installed equipment was not found',
      HttpStatus.NOT_FOUND,
    );
  return required(result.rows[0], 'Locked equipment disappeared');
}

async function equipmentById(
  client: PoolClient,
  locationId: string,
  equipmentId: string,
): Promise<CustomerEquipment> {
  return mapEquipment(await lockEquipment(client, locationId, equipmentId));
}

async function touchLocationAndPartner(
  client: PoolClient,
  locationId: string,
  partnerId: string,
  accountId: string,
): Promise<void> {
  await client.query(
    `UPDATE master_data.customer_locations SET version = version + 1,
       updated_by = $2, updated_at = now() WHERE id = $1`,
    [locationId, accountId],
  );
  await touchPartner(client, partnerId, accountId);
}

async function requireCustomerPartner(
  client: Pool | PoolClient,
  partnerId: string,
  activeOnly = true,
): Promise<void> {
  const result = await client.query(
    `SELECT partner.id
     FROM master_data.partners partner
     JOIN master_data.partner_roles role ON role.partner_id = partner.id AND role.role = 'customer'
     WHERE partner.id = $1 AND (NOT $2::boolean OR partner.active)`,
    [partnerId, activeOnly],
  );
  if (!result.rows[0]) {
    throw new ApiErrorException(
      'CUSTOMER_NOT_FOUND',
      activeOnly ? 'The active customer record was not found' : 'The customer record was not found',
      HttpStatus.NOT_FOUND,
    );
  }
}

async function requirePartnerContact(
  client: PoolClient,
  partnerId: string,
  contactId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT id FROM master_data.partner_contacts
     WHERE id = $1 AND partner_id = $2 AND active`,
    [contactId, partnerId],
  );
  if (!result.rows[0]) {
    throw new ApiErrorException(
      'RESPONSIBLE_CONTACT_NOT_FOUND',
      'The responsible contact does not belong to this customer',
      HttpStatus.BAD_REQUEST,
    );
  }
}

async function requireCustomerLocation(
  client: PoolClient,
  partnerId: string,
  locationId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT id FROM master_data.customer_locations
     WHERE id = $1 AND partner_id = $2 AND active FOR UPDATE`,
    [locationId, partnerId],
  );
  if (!result.rows[0]) {
    throw new ApiErrorException(
      'CUSTOMER_LOCATION_NOT_FOUND',
      'The customer location was not found',
      HttpStatus.NOT_FOUND,
    );
  }
}

async function requireProduct(client: PoolClient, productId: string): Promise<void> {
  const result = await client.query(
    'SELECT id FROM master_data.products WHERE id = $1 AND active',
    [productId],
  );
  if (!result.rows[0]) {
    throw new ApiErrorException(
      'PRODUCT_NOT_FOUND',
      'The active catalog product was not found',
      HttpStatus.BAD_REQUEST,
    );
  }
}

async function touchPartner(client: PoolClient, partnerId: string, accountId: string) {
  await client.query(
    `UPDATE master_data.partners
     SET version = version + 1, updated_at = now(), updated_by = $2
     WHERE id = $1`,
    [partnerId, accountId],
  );
}

async function recordChange(
  client: PoolClient,
  audit: AuditService,
  authentication: AuthenticationContext,
  metadata: RequestSecurityMetadata,
  key: string,
  eventType: string,
  targetType: string,
  targetId: string,
  payload: Record<string, unknown>,
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
      `${eventType}:${key}`,
      payload,
    ],
  );
  await audit.append(
    {
      action: eventType,
      actorAccountId: authentication.accountId,
      after: payload,
      correlationId: metadata.correlationId,
      ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
      targetId,
      targetType,
      ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
    },
    client,
  );
}

async function contactById(client: PoolClient, id: string): Promise<PartnerContact | undefined> {
  const result = await client.query<{
    active: boolean;
    contact_role: string | null;
    display_name: string;
    email: string | null;
    id: string;
    job_title: string | null;
    telephone: string | null;
  }>(
    `SELECT id, display_name, job_title, telephone, email, contact_role, active
     FROM master_data.partner_contacts WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapContactRow(row) : undefined;
}

function applyContact(row: LocationRow, contact: PartnerContact) {
  row.contact_id = contact.id;
  row.contact_display_name = contact.displayName;
  row.contact_job_title = contact.jobTitle ?? null;
  row.contact_telephone = contact.telephone ?? null;
  row.contact_email = contact.email ?? null;
  row.contact_role = contact.contactRole ?? null;
  row.contact_active = contact.active;
}

function mapLocation(row: LocationRow): CustomerLocation {
  return {
    active: row.active,
    addressLine1: row.address_line_1,
    ...(row.address_line_2 ? { addressLine2: row.address_line_2 } : {}),
    city: row.city,
    countryCode: row.country_code,
    id: row.id,
    locationType: row.location_type,
    name: row.name,
    partnerId: row.partner_id,
    ...(row.postal_code ? { postalCode: row.postal_code } : {}),
    ...(row.contact_id && row.contact_display_name
      ? {
          responsibleContact: {
            active: row.contact_active ?? true,
            ...(row.contact_role ? { contactRole: row.contact_role } : {}),
            displayName: row.contact_display_name,
            ...(row.contact_email ? { email: row.contact_email } : {}),
            id: row.contact_id,
            ...(row.contact_job_title ? { jobTitle: row.contact_job_title } : {}),
            ...(row.contact_telephone ? { telephone: row.contact_telephone } : {}),
          },
        }
      : {}),
    version: row.version,
  };
}

function mapEquipment(row: EquipmentRow): CustomerEquipment {
  return {
    active: row.active,
    customerLocationId: row.customer_location_id,
    deviceName: row.device_name,
    id: row.id,
    ...(row.product_id ? { productId: row.product_id } : {}),
    purchaseDate: dateOnly(row.purchase_date),
    serialNumber: row.serial_number,
    ...(row.serialized_item_id ? { serializedItemId: row.serialized_item_id } : {}),
    status: row.status,
    version: row.version,
    ...(row.warranty_end_date ? { warrantyEndsOn: dateOnly(row.warranty_end_date) } : {}),
    warrantyStartsOn: dateOnly(row.warranty_start_date),
  };
}

function mapContactRow(row: {
  active: boolean;
  contact_role: string | null;
  display_name: string;
  email: string | null;
  id: string;
  job_title: string | null;
  telephone: string | null;
}): PartnerContact {
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

function normalizeLocation(input: CreateCustomerLocationRequest): NormalizedLocationInput {
  const countryCode = (optional(input.countryCode) ?? 'BG').toUpperCase();
  if (!/^[A-Z]{2}$/u.test(countryCode)) {
    throw new ApiErrorException(
      'CUSTOMER_LOCATION_COUNTRY_INVALID',
      'The country code must use two letters',
      HttpStatus.BAD_REQUEST,
    );
  }
  const addressLine2 = optional(input.addressLine2);
  const postalCode = optional(input.postalCode);
  return {
    addressLine1: requiredText(input.addressLine1, 'CUSTOMER_LOCATION_ADDRESS_REQUIRED'),
    ...(addressLine2 ? { addressLine2 } : {}),
    city: requiredText(input.city, 'CUSTOMER_LOCATION_CITY_REQUIRED'),
    countryCode,
    locationType: requiredText(input.locationType, 'CUSTOMER_LOCATION_TYPE_REQUIRED'),
    name: requiredText(input.name, 'CUSTOMER_LOCATION_NAME_REQUIRED'),
    ...(postalCode ? { postalCode } : {}),
    ...(input.responsibleContactId ? { responsibleContactId: input.responsibleContactId } : {}),
  };
}

function normalizeEquipment(input: CreateCustomerEquipmentRequest): NormalizedEquipmentInput {
  const purchaseDate = normalizedDate(
    input.purchaseDate,
    'CUSTOMER_EQUIPMENT_PURCHASE_DATE_INVALID',
  );
  const warrantyStartsOn = normalizedDate(
    input.warrantyStartsOn ?? purchaseDate,
    'CUSTOMER_EQUIPMENT_WARRANTY_START_INVALID',
  );
  const warrantyEndsOn = input.warrantyEndsOn
    ? normalizedDate(input.warrantyEndsOn, 'CUSTOMER_EQUIPMENT_WARRANTY_END_INVALID')
    : undefined;
  if (warrantyEndsOn && warrantyEndsOn < warrantyStartsOn) {
    throw new ApiErrorException(
      'CUSTOMER_EQUIPMENT_WARRANTY_PERIOD_INVALID',
      'Warranty end date cannot be before its start date',
      HttpStatus.BAD_REQUEST,
    );
  }
  return {
    deviceName: requiredText(input.deviceName, 'CUSTOMER_EQUIPMENT_NAME_REQUIRED'),
    ...(input.productId ? { productId: input.productId } : {}),
    purchaseDate,
    serialNumber: requiredText(input.serialNumber, 'CUSTOMER_EQUIPMENT_SERIAL_REQUIRED'),
    status: input.status ?? 'active',
    ...(warrantyEndsOn ? { warrantyEndsOn } : {}),
    warrantyStartsOn,
  };
}

function normalizeEquipmentMaintenance(
  input: UpdateCustomerEquipmentRequest,
): Omit<NormalizedEquipmentInput, 'productId' | 'serialNumber'> {
  const purchaseDate = normalizedDate(
    input.purchaseDate,
    'CUSTOMER_EQUIPMENT_PURCHASE_DATE_INVALID',
  );
  const warrantyStartsOn = normalizedDate(
    input.warrantyStartsOn,
    'CUSTOMER_EQUIPMENT_WARRANTY_START_INVALID',
  );
  const warrantyEndsOn = input.warrantyEndsOn
    ? normalizedDate(input.warrantyEndsOn, 'CUSTOMER_EQUIPMENT_WARRANTY_END_INVALID')
    : undefined;
  if (warrantyEndsOn && warrantyEndsOn < warrantyStartsOn)
    throw new ApiErrorException(
      'CUSTOMER_EQUIPMENT_WARRANTY_PERIOD_INVALID',
      'Warranty end date cannot be before its start date',
      HttpStatus.BAD_REQUEST,
    );
  return {
    deviceName: requiredText(input.deviceName, 'CUSTOMER_EQUIPMENT_NAME_REQUIRED'),
    purchaseDate,
    status: input.status,
    ...(warrantyEndsOn ? { warrantyEndsOn } : {}),
    warrantyStartsOn,
  };
}

function normalizedDate(value: string, code: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ApiErrorException(code, 'A valid calendar date is required', HttpStatus.BAD_REQUEST);
  }
  return value;
}

function requiredText(value: string, code: string): string {
  const result = optional(value);
  if (!result) throw new ApiErrorException(code, 'This field is required', HttpStatus.BAD_REQUEST);
  return result;
}

function optional(value: string | undefined) {
  return value?.trim().replace(/\s+/gu, ' ') || undefined;
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function requestHash(input: object) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function validateIdempotencyKey(value: string | undefined): string {
  if (!value)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'The Idempotency-Key header is required',
      HttpStatus.BAD_REQUEST,
    );
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(value))
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_INVALID',
      'The Idempotency-Key header has an invalid format',
      HttpStatus.BAD_REQUEST,
    );
  return value;
}

async function claimIdempotency<T>(
  client: PoolClient,
  scope: string,
  key: string,
  hash: string,
  ttlSeconds: number,
  guard: (value: unknown) => value is T,
): Promise<T | undefined> {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (
       scope, idempotency_key, request_hash, status, expires_at
     ) VALUES ($1, $2, $3, 'processing', now() + ($4 * interval '1 second'))
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, hash, ttlSeconds],
  );
  if (inserted.rowCount === 1) return undefined;
  const existing = await client.query<IdempotencyRow>(
    `SELECT request_hash, status, response_body
     FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== hash)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_CONFLICT',
      'The idempotency key was already used for a different request',
      HttpStatus.CONFLICT,
    );
  if (row.status === 'completed' && guard(row.response_body)) return row.response_body;
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
  body: unknown,
  responseStatus = 201,
) {
  await client.query(
    `UPDATE platform.idempotency_keys
     SET status = 'completed', response_status = $4, response_body = $3
     WHERE scope = $1 AND idempotency_key = $2`,
    [scope, key, body, responseStatus],
  );
}

function isCustomerLocation(value: unknown): value is CustomerLocation {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'partnerId' in value &&
    typeof value.partnerId === 'string' &&
    'name' in value &&
    typeof value.name === 'string',
  );
}

function isCustomerEquipment(value: unknown): value is CustomerEquipment {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'serialNumber' in value &&
    typeof value.serialNumber === 'string' &&
    'customerLocationId' in value &&
    typeof value.customerLocationId === 'string',
  );
}

function constraint(error: unknown): string | undefined {
  return typeof error === 'object' && error && 'constraint' in error
    ? String(error.constraint)
    : undefined;
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function requireVersion(actual: number, expected: number, code: string): void {
  if (actual !== expected)
    throw new ApiErrorException(
      code,
      'The record changed after it was loaded. Refresh and try again.',
      HttpStatus.CONFLICT,
    );
}
