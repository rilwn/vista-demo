import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CreateProductRequest,
  CreateUnitRequest,
  ProductSummary,
  Unit,
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

type UnitRow = Unit;
interface ProductRow {
  active: boolean;
  barcodes: ProductSummary['barcodes'];
  category_id: string;
  created_at: Date | string;
  id: string;
  name: string;
  product_code: string;
  tracking_mode: ProductSummary['trackingMode'];
  unit_id: string;
  updated_at: Date | string;
  version: number;
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}
  async units(): Promise<Unit[]> {
    const r = await this.db
      .getPool()
      .query<UnitRow>(
        `SELECT id, code, name, active, version FROM master_data.units WHERE active = true ORDER BY code`,
      );
    return r.rows;
  }
  async products(): Promise<ProductSummary[]> {
    const r = await this.db
      .getPool()
      .query<ProductRow>(
        `SELECT p.id,p.product_code,p.name,p.category_id,p.unit_id,p.active,p.version,p.created_at,p.updated_at,c.tracking_mode,(SELECT coalesce(json_agg(json_build_object('id',b.id,'barcode',b.barcode,'barcodeType',b.barcode_type,'active',b.active) ORDER BY b.barcode),'[]') FROM master_data.product_barcodes b WHERE b.product_id=p.id AND b.active) barcodes FROM master_data.products p JOIN master_data.product_categories c ON c.id=p.category_id WHERE p.active ORDER BY p.name,p.id`,
      );
    return r.rows.map((row) => ({
      active: row.active,
      barcodes: row.barcodes,
      categoryId: row.category_id,
      createdAt: new Date(row.created_at).toISOString(),
      id: row.id,
      name: row.name,
      productCode: row.product_code,
      trackingMode: row.tracking_mode,
      unitId: row.unit_id,
      updatedAt: new Date(row.updated_at).toISOString(),
      version: row.version,
    }));
  }
  async createUnit(
    input: CreateUnitRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    meta: RequestSecurityMetadata,
  ): Promise<Unit> {
    const normalized = { code: input.code.trim().toUpperCase(), name: input.name.trim() };
    if (!normalized.code || !normalized.name)
      throw new ApiErrorException(
        'UNIT_FIELDS_REQUIRED',
        'Unit code and name are required',
        HttpStatus.BAD_REQUEST,
      );
    return this.command(key, 'unit', normalized, auth, meta, async (client) => {
      const r = await client.query<UnitRow>(
        `INSERT INTO master_data.units(code,name,created_by,updated_by) VALUES($1,$2,$3,$3) RETURNING id,code,name,active,version`,
        [normalized.code, normalized.name, auth.accountId],
      );
      return r.rows[0] as Unit;
    });
  }
  async createProduct(
    input: CreateProductRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    meta: RequestSecurityMetadata,
  ): Promise<ProductSummary> {
    const normalized = { ...input, name: input.name.trim(), productCode: input.productCode.trim() };
    if (!normalized.name || !normalized.productCode)
      throw new ApiErrorException(
        'PRODUCT_FIELDS_REQUIRED',
        'Product code and name are required',
        HttpStatus.BAD_REQUEST,
      );
    return this.command(key, 'product', normalized, auth, meta, async (client) => {
      const category = await client.query<{ tracking_mode: ProductSummary['trackingMode'] }>(
        `SELECT tracking_mode FROM master_data.product_categories WHERE id=$1 AND active`,
        [input.categoryId],
      );
      if (!category.rowCount)
        throw new ApiErrorException(
          'PRODUCT_CATEGORY_NOT_FOUND',
          'The product category was not found',
          HttpStatus.NOT_FOUND,
        );
      const unit = await client.query<{ id: string }>(
        `SELECT id FROM master_data.units WHERE id=$1 AND active`,
        [input.unitId],
      );
      if (!unit.rowCount)
        throw new ApiErrorException(
          'PRODUCT_UNIT_NOT_FOUND',
          'The product unit was not found',
          HttpStatus.NOT_FOUND,
        );
      const tracking = category.rows[0];
      if (!tracking) throw new Error('Product category query did not return a row');
      const r = await client.query<ProductRow>(
        `INSERT INTO master_data.products(product_code,name,category_id,unit_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5) RETURNING id,product_code,name,category_id,unit_id,active,version,created_at,updated_at`,
        [normalized.productCode, normalized.name, input.categoryId, input.unitId, auth.accountId],
      );
      const row = r.rows[0];
      if (!row) throw new Error('Product insert did not return a row');
      for (const barcode of input.barcodes ?? [])
        await client.query(
          `INSERT INTO master_data.product_barcodes(product_id,barcode,barcode_type,created_by) VALUES($1,$2,$3,$4)`,
          [row.id, barcode.barcode.trim(), barcode.barcodeType ?? 'other', auth.accountId],
        );
      return {
        active: row.active,
        barcodes: (input.barcodes ?? []).map((b, i) => ({
          active: true,
          barcode: b.barcode.trim(),
          barcodeType: b.barcodeType ?? 'other',
          id: `pending-${i}`,
        })),
        categoryId: row.category_id,
        createdAt: new Date(row.created_at).toISOString(),
        id: row.id,
        name: row.name,
        productCode: row.product_code,
        trackingMode: tracking.tracking_mode,
        unitId: row.unit_id,
        updatedAt: new Date(row.updated_at).toISOString(),
        version: row.version,
      };
    });
  }
  private async command<T>(
    key: string | undefined,
    kind: string,
    input: object,
    auth: AuthenticationContext,
    meta: RequestSecurityMetadata,
    insert: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (!key)
      throw new ApiErrorException(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Provide an Idempotency-Key',
        HttpStatus.BAD_REQUEST,
      );
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await insert(client);
      await this.audit.append(
        {
          action: `master_data.${kind}.created`,
          actorAccountId: auth.accountId,
          after: { ...((result as object) ?? {}) },
          correlationId: meta.correlationId,
          targetId:
            'id' in (result as object) ? String((result as { id: unknown }).id) : randomUUID(),
          targetType: kind,
        },
        client,
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
