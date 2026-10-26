import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  FinancialBrandingAsset,
  FinancialBrandingSettings,
  FinancialDocumentBranding,
  SaveFinancialBrandingRequest,
} from '@vista/contracts';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';
import { FilesService } from '../files/files.service.js';
import { validateBrandingImage } from '../files/branding-image.js';

@Injectable()
export class FinancialBrandingService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async settings(id: string, transaction?: PoolClient): Promise<FinancialBrandingSettings> {
    const client = transaction ?? this.database.getPool();
    const entity = (
      await client.query<{ name: string }>(
        'SELECT name FROM organization.legal_entities WHERE id=$1',
        [id],
      )
    ).rows[0];
    if (!entity)
      throw error('FINANCE_BRANDING_ENTITY_NOT_FOUND', 'The issuing company was not found.', 404);
    return {
      legalEntityId: id,
      legalEntityName: entity.name,
      ...(await this.snapshot(client, id, false)),
    };
  }

  async snapshot(
    client: Pick<PoolClient, 'query'>,
    id: string,
    requireAvailable = true,
  ): Promise<FinancialDocumentBranding> {
    const profile = (
      await client.query<{
        version: number;
        logo_file_id: string | null;
        signature_file_id: string | null;
        signatory_name: string | null;
      }>(
        'SELECT version,logo_file_id,signature_file_id,signatory_name FROM finance.document_branding WHERE legal_entity_id=$1',
        [id],
      )
    ).rows[0];
    if (!profile) return { version: 0 };
    return {
      version: profile.version,
      ...(profile.logo_file_id
        ? { logo: await this.asset(client, profile.logo_file_id, id, requireAvailable) }
        : {}),
      ...(profile.signature_file_id
        ? {
            signature: await this.asset(client, profile.signature_file_id, id, requireAvailable),
            signatoryName: profile.signatory_name!,
          }
        : {}),
    };
  }

  async assets(branding: FinancialDocumentBranding | undefined, auth: AuthenticationContext) {
    const load = async (asset: FinancialBrandingAsset) => {
      const content = await this.files.content(asset.id, auth);
      if (createHash('sha256').update(content.buffer).digest('hex') !== asset.checksumSha256)
        throw error(
          'FINANCE_BRANDING_INTEGRITY_FAILED',
          'The saved document image could not be verified.',
          503,
        );
      await validateBrandingImage(content.buffer, content.mediaType);
      return content.buffer;
    };
    return {
      ...(branding?.logo ? { logo: await load(branding.logo) } : {}),
      ...(branding?.signature ? { signature: await load(branding.signature) } : {}),
    };
  }

  async save(
    id: string,
    input: SaveFinancialBrandingRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinancialBrandingSettings> {
    if (!key || !/^[A-Za-z0-9:._-]{1,180}$/u.test(key))
      throw error('IDEMPOTENCY_KEY_REQUIRED', 'Provide a valid idempotency key.', 400);
    const scope = `finance.document-branding:${id}`;
    const hash = createHash('sha256')
      .update(JSON.stringify({ ...input, actor: auth.accountId }))
      .digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO platform.idempotency_keys (scope,idempotency_key,request_hash,status,expires_at) VALUES ($1,$2,$3,'processing',now()+interval '24 hours') ON CONFLICT DO NOTHING`,
        [scope, key, hash],
      );
      const claim = (
        await client.query<{
          request_hash: string;
          status: string;
          response_body: FinancialBrandingSettings;
        }>(
          'SELECT request_hash,status,response_body FROM platform.idempotency_keys WHERE scope=$1 AND idempotency_key=$2 FOR UPDATE',
          [scope, key],
        )
      ).rows[0]!;
      if (claim.request_hash !== hash)
        throw error(
          'IDEMPOTENCY_KEY_REUSED',
          'This request key was used for different settings.',
          409,
        );
      if (claim.status === 'completed') {
        await client.query('COMMIT');
        return claim.response_body;
      }
      // Lock the entity as well, including the first save when there is no profile row.
      const entity = (
        await client.query<{ id: string }>(
          'SELECT id FROM organization.legal_entities WHERE id=$1 AND active FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (!entity)
        throw error('FINANCE_BRANDING_ENTITY_NOT_FOUND', 'Choose an active issuing company.', 404);
      const before = await this.settings(id, client);
      if (before.version !== input.expectedVersion)
        throw error(
          'FINANCE_BRANDING_VERSION_CONFLICT',
          'These settings changed. Reopen them and review the latest version.',
          409,
        );
      const name = input.signatoryName?.trim();
      if (input.signatureFileId && (!name || !input.signatureConfirmed))
        throw error(
          'FINANCE_SIGNATURE_CONFIRMATION_REQUIRED',
          'Enter the signature name and confirm that this image is authorized.',
          400,
        );
      for (const fileId of [input.logoFileId, input.signatureFileId]) {
        if (!fileId) continue;
        await this.asset(client, fileId, id);
        const content = await this.files.content(fileId, auth);
        await validateBrandingImage(content.buffer, content.mediaType);
      }
      await client.query(
        `INSERT INTO finance.document_branding (legal_entity_id,logo_file_id,signature_file_id,signatory_name,updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(legal_entity_id) DO UPDATE SET logo_file_id=excluded.logo_file_id,signature_file_id=excluded.signature_file_id,signatory_name=excluded.signatory_name,updated_by=excluded.updated_by,updated_at=now(),version=finance.document_branding.version+1`,
        [
          id,
          input.logoFileId ?? null,
          input.signatureFileId ?? null,
          input.signatureFileId ? name : null,
          auth.accountId,
        ],
      );
      const after = await this.settings(id, client);
      await this.audit.append(
        {
          action: 'finance.document-branding.updated',
          actorAccountId: auth.accountId,
          targetType: 'legal_entity',
          targetId: id,
          correlationId: metadata.correlationId,
          before: { ...before },
          after: { ...after },
        },
        client,
      );
      await client.query(
        `INSERT INTO integration.outbox_events (id,aggregate_type,aggregate_id,event_type,event_version,correlation_id,idempotency_key,payload) VALUES ($1,'legal_entity',$2,'finance.document-branding.updated',1,$3,$4,$5)`,
        [randomUUID(), id, metadata.correlationId, `${scope}:${key}`, after],
      );
      await client.query(
        "UPDATE platform.idempotency_keys SET status='completed',response_status=200,response_body=$3 WHERE scope=$1 AND idempotency_key=$2",
        [scope, key, after],
      );
      await client.query('COMMIT');
      return after;
    } catch (cause) {
      await client.query('ROLLBACK');
      throw cause;
    } finally {
      client.release();
    }
  }

  private async asset(
    client: Pick<PoolClient, 'query'>,
    id: string,
    legalEntityId: string,
    requireAvailable = true,
  ): Promise<FinancialBrandingAsset> {
    const file = (
      await client.query<FinancialBrandingAsset>(
        `SELECT id,original_name AS "fileName",media_type AS "mediaType",checksum_sha256 AS "checksumSha256",byte_size::int AS "byteSize" FROM files.objects WHERE id=$1 AND parent_type='financial_branding' AND parent_id=$2 AND (NOT $3::boolean OR status='available') AND media_type IN ('image/png','image/jpeg') AND byte_size<=524288`,
        [id, legalEntityId, requireAvailable],
      )
    ).rows[0];
    if (!file)
      throw error(
        'FINANCE_BRANDING_FILE_INVALID',
        'Choose an available PNG or JPEG uploaded for this issuing company.',
        400,
      );
    return file;
  }
}
function error(code: string, message: string, status: number) {
  return new ApiErrorException(code, message, status);
}
