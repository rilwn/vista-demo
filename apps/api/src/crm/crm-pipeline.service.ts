import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  ConvertCrmLeadRequest,
  CreateCrmLeadRequest,
  CreateCrmOpportunityRequest,
  CrmLead,
  CrmLeadPage,
  CrmLeadSource,
  CrmLeadStatus,
  CrmOpportunity,
  CrmOpportunityPage,
  CrmOpportunityStage,
  CrmPipelineReferenceData,
  LinkCrmOpportunityQuotationRequest,
  MoveCrmOpportunityRequest,
  PartnerKind,
  QualifyCrmLeadRequest,
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
import type { ListCrmLeadsQueryDto, ListCrmOpportunitiesQueryDto } from './crm-pipeline.dto.js';

interface LeadRow {
  contact_name: string;
  converted_at: Date | string | null;
  converted_customer_name: string | null;
  converted_customer_partner_id: string | null;
  created_at: Date | string;
  email: string | null;
  id: string;
  lead_number: string;
  notes: string | null;
  organization_name: string;
  owner_account_id: string;
  owner_name: string;
  qualified_at: Date | string | null;
  source: CrmLeadSource;
  source_details: string | null;
  status: CrmLeadStatus;
  telephone: string | null;
  updated_at: Date | string;
  version: number;
}

interface LeadHistoryRow {
  changed_at: Date | string;
  changed_by_name: string;
  event_type: CrmLead['history'][number]['type'];
  id: string;
  note: string | null;
  status: CrmLeadStatus;
}

interface OpportunityRow {
  closed_at: Date | string | null;
  created_at: Date | string;
  customer_name: string;
  customer_partner_id: string;
  description: string | null;
  estimated_revenue_bgn: string;
  expected_close_on: Date | string | null;
  id: string;
  opportunity_number: string;
  owner_account_id: string;
  owner_name: string;
  probability_percent: number;
  source_lead_id: string | null;
  stage: CrmOpportunityStage;
  title: string;
  updated_at: Date | string;
  version: number;
  weighted_revenue_bgn: string;
}

interface OpportunityHistoryRow {
  changed_at: Date | string;
  changed_by_name: string;
  event_type: CrmOpportunity['history'][number]['type'];
  id: string;
  next_stage: CrmOpportunityStage;
  note: string | null;
  previous_stage: CrmOpportunityStage | null;
  probability_percent: number;
}

interface QuotationRow {
  currency_code: string;
  id: string;
  linked_at: Date | string;
  quotation_number: string;
  status: CrmOpportunity['quotations'][number]['status'];
  total: string;
}

type Queryable = Pool | PoolClient;

@Injectable()
export class CrmPipelineService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async referenceData(): Promise<CrmPipelineReferenceData> {
    const pool = this.database.getPool();
    const [customers, assignees, quotations] = await Promise.all([
      pool.query<{ id: string; name: string }>(
        `SELECT DISTINCT partner.id, partner.display_name AS name
         FROM master_data.partners partner
         JOIN master_data.partner_roles role
           ON role.partner_id = partner.id AND role.role = 'customer'
         WHERE partner.active ORDER BY partner.display_name, partner.id`,
      ),
      pool.query<{ display_name: string; id: string }>(crmAssigneesSql()),
      pool.query<{
        currency_code: string;
        customer_partner_id: string;
        id: string;
        quotation_number: string;
        status: CrmPipelineReferenceData['quotations'][number]['status'];
        total: string;
      }>(
        `SELECT quotation.id, quotation.customer_partner_id,
                quotation.quotation_number, quotation.currency_code,
                quotation.total::text, quotation.status
         FROM sales.quotations quotation
         ORDER BY quotation.created_at DESC, quotation.id DESC LIMIT 500`,
      ),
    ]);
    return {
      assignees: assignees.rows.map((row) => ({ displayName: row.display_name, id: row.id })),
      businessTimezone: this.environment.BUSINESS_TIMEZONE,
      customers: customers.rows,
      quotations: quotations.rows.map((row) => ({
        currencyCode: row.currency_code,
        customerPartnerId: row.customer_partner_id,
        id: row.id,
        number: row.quotation_number,
        status: row.status,
        total: row.total,
      })),
    };
  }

  async listLeads(query: ListCrmLeadsQueryDto): Promise<CrmLeadPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const search = query.search?.trim() ?? '';
    const values = [query.status ?? null, query.source ?? null, search];
    const where = `WHERE ($1::text IS NULL OR lead.status = $1)
      AND ($2::text IS NULL OR lead.source = $2)
      AND ($3 = '' OR lead.lead_number ILIKE '%' || $3 || '%'
        OR lead.organization_name ILIKE '%' || $3 || '%'
        OR lead.contact_name ILIKE '%' || $3 || '%'
        OR coalesce(lead.email, '') ILIKE '%' || $3 || '%'
        OR coalesce(lead.telephone, '') ILIKE '%' || $3 || '%')`;
    const pool = this.database.getPool();
    const [count, rows, summary] = await Promise.all([
      pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM crm.leads lead ${where}`,
        values,
      ),
      pool.query<LeadRow>(
        `${leadQuery()} ${where}
         ORDER BY CASE lead.status WHEN 'qualified' THEN 1 WHEN 'new' THEN 2 ELSE 3 END,
                  lead.updated_at DESC, lead.id DESC LIMIT $4 OFFSET $5`,
        [...values, pageSize, (page - 1) * pageSize],
      ),
      pool.query<{ converted: string; new: string; qualified: string }>(
        `SELECT count(*) FILTER (WHERE status = 'new')::text AS new,
                count(*) FILTER (WHERE status = 'qualified')::text AS qualified,
                count(*) FILTER (WHERE status = 'converted')::text AS converted
         FROM crm.leads`,
      ),
    ]);
    const total = Number(count.rows[0]?.total ?? '0');
    return {
      items: await Promise.all(rows.rows.map((row) => this.mapLead(pool, row))),
      page,
      pageSize,
      summary: {
        converted: Number(summary.rows[0]?.converted ?? '0'),
        new: Number(summary.rows[0]?.new ?? '0'),
        qualified: Number(summary.rows[0]?.qualified ?? '0'),
      },
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  createLead(
    input: CreateCrmLeadRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmLead> {
    const normalized = normalizeLead(input);
    return this.command('crm.lead.create', key, normalized, 201, async (client, commandKey) => {
      await this.requireAssignee(client, normalized.ownerAccountId);
      const id = randomUUID();
      const number = await this.allocateNumber(client, 'lead', 'LEAD');
      await client.query(
        `INSERT INTO crm.leads (
           id, lead_number, organization_name, contact_name, telephone, email,
           source, source_details, notes, owner_account_id, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [
          id,
          number,
          normalized.organizationName,
          normalized.contactName,
          normalized.telephone ?? null,
          normalized.email ?? null,
          normalized.source,
          normalized.sourceDetails ?? null,
          normalized.notes ?? null,
          normalized.ownerAccountId,
          auth.accountId,
        ],
      );
      await client.query(
        `INSERT INTO crm.lead_history (id, lead_id, event_type, status, changed_by)
         VALUES ($1,$2,'created','new',$3)`,
        [randomUUID(), id, auth.accountId],
      );
      const lead = await this.loadLead(client, id);
      await this.sideEffects(
        client,
        'crm_lead',
        id,
        'crm.lead.created',
        lead,
        commandKey,
        auth,
        metadata,
      );
      return lead;
    });
  }

  qualifyLead(
    id: string,
    input: QualifyCrmLeadRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmLead> {
    const normalized = normalizeQualification(input);
    return this.command(
      `crm.lead.qualify:${id}`,
      key,
      normalized,
      200,
      async (client, commandKey) => {
        const before = await this.lockLead(client, id);
        requireVersion(before.version, normalized.expectedVersion, 'CRM_LEAD_VERSION_CONFLICT');
        if (before.status !== 'new')
          throw conflict('CRM_LEAD_NOT_NEW', 'Only a new lead can be qualified.');
        await client.query(
          `UPDATE crm.leads SET status = 'qualified', qualified_at = now(), updated_by = $2,
             updated_at = now(), version = version + 1 WHERE id = $1`,
          [id, auth.accountId],
        );
        await client.query(
          `INSERT INTO crm.lead_history (id, lead_id, event_type, status, note, changed_by)
           VALUES ($1,$2,'qualified','qualified',$3,$4)`,
          [randomUUID(), id, normalized.note ?? null, auth.accountId],
        );
        const lead = await this.loadLead(client, id);
        await this.sideEffects(
          client,
          'crm_lead',
          id,
          'crm.lead.qualified',
          lead,
          commandKey,
          auth,
          metadata,
          leadBase(before),
        );
        return lead;
      },
    );
  }

  convertLead(
    id: string,
    input: ConvertCrmLeadRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<{
    customer: { id: string; name: string };
    lead: CrmLead;
    opportunity?: CrmOpportunity;
  }> {
    const normalized = normalizeConversion(input);
    return this.command(
      `crm.lead.convert:${id}`,
      key,
      normalized,
      200,
      async (client, commandKey) => {
        const before = await this.lockLead(client, id);
        requireVersion(before.version, normalized.expectedVersion, 'CRM_LEAD_VERSION_CONFLICT');
        if (before.status !== 'qualified')
          throw conflict('CRM_LEAD_NOT_QUALIFIED', 'Qualify this lead before converting it.');

        const customer = normalized.existingCustomerPartnerId
          ? await this.useExistingCustomer(client, normalized.existingCustomerPartnerId, auth)
          : await this.createCustomerFromLead(
              client,
              before,
              normalized.newCustomer!,
              auth,
              metadata,
            );

        let opportunity: CrmOpportunity | undefined;
        if (normalized.createOpportunity) {
          const opportunityId = await this.insertOpportunity(
            client,
            customer.id,
            normalized.opportunity!,
            'qualified',
            id,
            auth.accountId,
          );
          opportunity = await this.loadOpportunity(client, opportunityId);
        }

        await client.query(
          `UPDATE crm.leads SET status = 'converted', converted_at = now(),
             converted_customer_partner_id = $2, updated_by = $3, updated_at = now(),
             version = version + 1 WHERE id = $1`,
          [id, customer.id, auth.accountId],
        );
        await client.query(
          `INSERT INTO crm.lead_history (id, lead_id, event_type, status, note, changed_by)
           VALUES ($1,$2,'converted','converted',$3,$4)`,
          [randomUUID(), id, normalized.note ?? null, auth.accountId],
        );
        const lead = await this.loadLead(client, id);
        await this.sideEffects(
          client,
          'crm_lead',
          id,
          'crm.lead.converted',
          { customer, lead, ...(opportunity ? { opportunity } : {}) },
          commandKey,
          auth,
          metadata,
          leadBase(before),
        );
        if (opportunity)
          await this.sideEffects(
            client,
            'crm_opportunity',
            opportunity.id,
            'crm.opportunity.created',
            opportunity,
            commandKey,
            auth,
            metadata,
          );
        return { customer, lead, ...(opportunity ? { opportunity } : {}) };
      },
    );
  }

  async listOpportunities(query: ListCrmOpportunitiesQueryDto): Promise<CrmOpportunityPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const search = query.search?.trim() ?? '';
    const values = [query.stage ?? null, search];
    const where = `WHERE ($1::text IS NULL OR opportunity.stage = $1)
      AND ($2 = '' OR opportunity.opportunity_number ILIKE '%' || $2 || '%'
        OR opportunity.title ILIKE '%' || $2 || '%'
        OR partner.display_name ILIKE '%' || $2 || '%')`;
    const pool = this.database.getPool();
    const [count, rows, summary] = await Promise.all([
      pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM crm.opportunities opportunity
         JOIN master_data.partners partner ON partner.id = opportunity.customer_partner_id ${where}`,
        values,
      ),
      pool.query<OpportunityRow>(
        `${opportunityQuery()} ${where}
         ORDER BY opportunity.stage, opportunity.expected_close_on NULLS LAST,
                  opportunity.updated_at DESC, opportunity.id DESC LIMIT $3 OFFSET $4`,
        [...values, pageSize, (page - 1) * pageSize],
      ),
      pool.query<{
        open_count: string;
        open_revenue_bgn: string;
        weighted_revenue_bgn: string;
        won_revenue_bgn: string;
      }>(
        `SELECT count(*) FILTER (WHERE stage NOT IN ('won','lost'))::text AS open_count,
                coalesce(sum(estimated_revenue_bgn) FILTER (
                  WHERE stage NOT IN ('won','lost')), 0)::text AS open_revenue_bgn,
                coalesce(sum(round(estimated_revenue_bgn * probability_percent / 100.0, 2))
                  FILTER (WHERE stage NOT IN ('won','lost')), 0)::text AS weighted_revenue_bgn,
                coalesce(sum(estimated_revenue_bgn) FILTER (WHERE stage = 'won'), 0)::text
                  AS won_revenue_bgn
         FROM crm.opportunities`,
      ),
    ]);
    const total = Number(count.rows[0]?.total ?? '0');
    return {
      items: await Promise.all(rows.rows.map((row) => this.mapOpportunity(pool, row))),
      page,
      pageSize,
      summary: {
        openCount: Number(summary.rows[0]?.open_count ?? '0'),
        openRevenueBgn: summary.rows[0]?.open_revenue_bgn ?? '0',
        weightedRevenueBgn: summary.rows[0]?.weighted_revenue_bgn ?? '0',
        wonRevenueBgn: summary.rows[0]?.won_revenue_bgn ?? '0',
      },
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  getOpportunity(id: string): Promise<CrmOpportunity> {
    return this.loadOpportunity(this.database.getPool(), id);
  }

  createOpportunity(
    input: CreateCrmOpportunityRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmOpportunity> {
    const normalized = normalizeOpportunity(input);
    return this.command(
      'crm.opportunity.create',
      key,
      normalized,
      201,
      async (client, commandKey) => {
        await this.requireCustomer(client, normalized.customerPartnerId);
        const id = await this.insertOpportunity(
          client,
          normalized.customerPartnerId,
          normalized,
          'new',
          null,
          auth.accountId,
        );
        const opportunity = await this.loadOpportunity(client, id);
        await this.sideEffects(
          client,
          'crm_opportunity',
          id,
          'crm.opportunity.created',
          opportunity,
          commandKey,
          auth,
          metadata,
        );
        return opportunity;
      },
    );
  }

  moveOpportunity(
    id: string,
    input: MoveCrmOpportunityRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmOpportunity> {
    const normalized = normalizeMove(input);
    return this.command(
      `crm.opportunity.stage:${id}`,
      key,
      normalized,
      200,
      async (client, commandKey) => {
        const before = await this.lockOpportunity(client, id);
        requireVersion(
          before.version,
          normalized.expectedVersion,
          'CRM_OPPORTUNITY_VERSION_CONFLICT',
        );
        if (before.stage === normalized.stage)
          throw conflict('CRM_OPPORTUNITY_STAGE_UNCHANGED', 'Choose a different pipeline stage.');
        const closedAt = ['won', 'lost'].includes(normalized.stage)
          ? new Date().toISOString()
          : null;
        await client.query(
          `UPDATE crm.opportunities SET stage = $2, probability_percent = $3, closed_at = $4,
             updated_by = $5, updated_at = now(), version = version + 1 WHERE id = $1`,
          [id, normalized.stage, normalized.probabilityPercent, closedAt, auth.accountId],
        );
        await client.query(
          `INSERT INTO crm.opportunity_history (
             id, opportunity_id, event_type, previous_stage, next_stage,
             probability_percent, note, changed_by
           ) VALUES ($1,$2,'stage_changed',$3,$4,$5,$6,$7)`,
          [
            randomUUID(),
            id,
            before.stage,
            normalized.stage,
            normalized.probabilityPercent,
            normalized.note ?? null,
            auth.accountId,
          ],
        );
        const opportunity = await this.loadOpportunity(client, id);
        await this.sideEffects(
          client,
          'crm_opportunity',
          id,
          'crm.opportunity.stage_changed',
          opportunity,
          commandKey,
          auth,
          metadata,
          opportunityBase(before),
        );
        return opportunity;
      },
    );
  }

  linkQuotation(
    id: string,
    input: LinkCrmOpportunityQuotationRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmOpportunity> {
    const normalized = {
      expectedVersion: input.expectedVersion,
      quotationId: input.quotationId.trim(),
    };
    return this.command(
      `crm.opportunity.quotation:${id}`,
      key,
      normalized,
      200,
      async (client, commandKey) => {
        const before = await this.lockOpportunity(client, id);
        requireVersion(
          before.version,
          normalized.expectedVersion,
          'CRM_OPPORTUNITY_VERSION_CONFLICT',
        );
        const quotation = await client.query<{
          customer_partner_id: string;
          quotation_number: string;
        }>(`SELECT customer_partner_id, quotation_number FROM sales.quotations WHERE id = $1`, [
          normalized.quotationId,
        ]);
        const selected = quotation.rows[0];
        if (!selected)
          throw badRequest('CRM_OPPORTUNITY_QUOTATION_INVALID', 'Choose an available quotation.');
        if (selected.customer_partner_id !== before.customer_partner_id)
          throw badRequest(
            'CRM_OPPORTUNITY_QUOTATION_CUSTOMER_MISMATCH',
            'Choose a quotation issued to this opportunity customer.',
          );
        const existing = await client.query<{ opportunity_id: string }>(
          'SELECT opportunity_id FROM crm.opportunity_quotation_links WHERE quotation_id = $1',
          [normalized.quotationId],
        );
        if (existing.rows[0])
          throw conflict(
            'CRM_OPPORTUNITY_QUOTATION_ALREADY_LINKED',
            'This quotation is already linked to an opportunity.',
          );
        await client.query(
          `INSERT INTO crm.opportunity_quotation_links (
             opportunity_id, quotation_id, linked_by
           ) VALUES ($1,$2,$3)`,
          [id, normalized.quotationId, auth.accountId],
        );
        await client.query(
          `UPDATE crm.opportunities SET updated_by = $2, updated_at = now(),
             version = version + 1 WHERE id = $1`,
          [id, auth.accountId],
        );
        await client.query(
          `INSERT INTO crm.opportunity_history (
             id, opportunity_id, event_type, next_stage, probability_percent, note, changed_by
           ) VALUES ($1,$2,'quotation_linked',$3,$4,$5,$6)`,
          [
            randomUUID(),
            id,
            before.stage,
            before.probability_percent,
            `Linked quotation ${selected.quotation_number}.`,
            auth.accountId,
          ],
        );
        const opportunity = await this.loadOpportunity(client, id);
        await this.sideEffects(
          client,
          'crm_opportunity',
          id,
          'crm.opportunity.quotation_linked',
          opportunity,
          commandKey,
          auth,
          metadata,
          opportunityBase(before),
        );
        return opportunity;
      },
    );
  }

  private async insertOpportunity(
    client: PoolClient,
    customerPartnerId: string,
    input: NormalizedOpportunity,
    stage: 'new' | 'qualified',
    sourceLeadId: string | null,
    actorId: string,
  ): Promise<string> {
    await this.requireCustomer(client, customerPartnerId);
    await this.requireAssignee(client, input.ownerAccountId);
    const id = randomUUID();
    const number = await this.allocateNumber(client, 'opportunity', 'OPP');
    await client.query(
      `INSERT INTO crm.opportunities (
         id, opportunity_number, customer_partner_id, source_lead_id, title, description,
         estimated_revenue_bgn, probability_percent, stage, expected_close_on,
         owner_account_id, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
      [
        id,
        number,
        customerPartnerId,
        sourceLeadId,
        input.title,
        input.description ?? null,
        input.estimatedRevenueBgn,
        input.probabilityPercent,
        stage,
        input.expectedCloseOn ?? null,
        input.ownerAccountId,
        actorId,
      ],
    );
    await client.query(
      `INSERT INTO crm.opportunity_history (
         id, opportunity_id, event_type, next_stage, probability_percent, changed_by
       ) VALUES ($1,$2,'created',$3,$4,$5)`,
      [randomUUID(), id, stage, input.probabilityPercent, actorId],
    );
    return id;
  }

  private async useExistingCustomer(
    client: PoolClient,
    partnerId: string,
    auth: AuthenticationContext,
  ): Promise<{ id: string; name: string }> {
    const partner = await client.query<{ display_name: string; id: string }>(
      'SELECT id, display_name FROM master_data.partners WHERE id = $1 AND active',
      [partnerId],
    );
    const row = partner.rows[0];
    if (!row)
      throw badRequest('CRM_LEAD_CUSTOMER_INVALID', 'Choose an active customer or partner.');
    await client.query(
      `INSERT INTO master_data.partner_roles (partner_id, role, assigned_by)
       VALUES ($1,'customer',$2) ON CONFLICT DO NOTHING`,
      [partnerId, auth.accountId],
    );
    return { id: row.id, name: row.display_name };
  }

  private async createCustomerFromLead(
    client: PoolClient,
    lead: LeadRow,
    input: { displayName: string; kind: PartnerKind; uic?: string; vatNumber?: string },
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<{ id: string; name: string }> {
    const duplicate = await client.query<{ display_name: string; id: string }>(
      `SELECT id, display_name FROM master_data.partners
       WHERE ($1::text IS NOT NULL AND uic IS NOT NULL AND upper(btrim(uic)) = upper(btrim($1)))
          OR normalized_name = lower(regexp_replace(btrim($2), '[[:space:]]+', ' ', 'g'))
       ORDER BY active DESC, created_at LIMIT 1`,
      [input.uic ?? null, input.displayName],
    );
    if (duplicate.rows[0])
      throw conflict(
        'CRM_LEAD_CUSTOMER_DUPLICATE',
        `A matching partner already exists: ${duplicate.rows[0].display_name}. Choose that customer instead.`,
      );
    const id = randomUUID();
    await client.query(
      `INSERT INTO master_data.partners (
         id, kind, display_name, uic, vat_number, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
      [
        id,
        input.kind,
        input.displayName,
        input.uic ?? null,
        input.vatNumber ?? null,
        auth.accountId,
      ],
    );
    await client.query(
      `INSERT INTO master_data.partner_roles (partner_id, role, assigned_by)
       VALUES ($1,'customer',$2)`,
      [id, auth.accountId],
    );
    await client.query(
      `INSERT INTO master_data.partner_contacts (
         id, partner_id, display_name, telephone, email, contact_role
       ) VALUES ($1,$2,$3,$4,$5,'lead contact')`,
      [randomUUID(), id, lead.contact_name, lead.telephone, lead.email],
    );
    const customer = { id, name: input.displayName };
    await client.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1,'partner',$2,'master_data.partner.created_from_lead',1,$3,$4,$5)`,
      [
        randomUUID(),
        id,
        metadata.correlationId,
        `master_data.partner.created_from_lead:${lead.id}`,
        { customer, sourceLeadId: lead.id },
      ],
    );
    await this.audit.append(
      {
        action: 'master_data.partner.created_from_lead',
        actorAccountId: auth.accountId,
        after: { customer, sourceLeadId: lead.id },
        correlationId: metadata.correlationId,
        ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
        targetId: id,
        targetType: 'partner',
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
      client,
    );
    return customer;
  }

  private async requireCustomer(queryable: Queryable, id: string) {
    const customer = await queryable.query(
      `SELECT partner.id FROM master_data.partners partner
       JOIN master_data.partner_roles role
         ON role.partner_id = partner.id AND role.role = 'customer'
       WHERE partner.id = $1 AND partner.active`,
      [id],
    );
    if (!customer.rowCount)
      throw badRequest('CRM_OPPORTUNITY_CUSTOMER_INVALID', 'Choose an active customer.');
  }

  private async requireAssignee(queryable: Queryable, id: string) {
    const assignee = await queryable.query(`${crmAssigneesSql()} AND account.id = $1`, [id]);
    if (!assignee.rowCount)
      throw badRequest('CRM_PIPELINE_OWNER_INVALID', 'Choose an active CRM team member.');
  }

  private async allocateNumber(
    client: PoolClient,
    documentType: 'lead' | 'opportunity',
    prefix: 'LEAD' | 'OPP',
  ): Promise<string> {
    await client.query(
      `INSERT INTO crm.internal_document_sequences (document_type)
       VALUES ($1) ON CONFLICT DO NOTHING`,
      [documentType],
    );
    const allocated = await client.query<{ allocated: string }>(
      `UPDATE crm.internal_document_sequences
       SET next_value = next_value + 1, updated_at = now()
       WHERE document_type = $1 RETURNING (next_value - 1)::text AS allocated`,
      [documentType],
    );
    const sequence = allocated.rows[0]?.allocated;
    if (!sequence) throw new Error(`Could not allocate ${documentType} number`);
    const year = new Intl.DateTimeFormat('en', {
      timeZone: this.environment.BUSINESS_TIMEZONE,
      year: 'numeric',
    }).format(new Date());
    return `${prefix}-${year}-${sequence.padStart(6, '0')}`;
  }

  private async loadLead(queryable: Queryable, id: string): Promise<CrmLead> {
    const result = await queryable.query<LeadRow>(`${leadQuery()} WHERE lead.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw notFound('CRM_LEAD_NOT_FOUND', 'The lead was not found.');
    return this.mapLead(queryable, row);
  }

  private async lockLead(client: PoolClient, id: string): Promise<LeadRow> {
    const result = await client.query<LeadRow>(
      `${leadQuery()} WHERE lead.id = $1 FOR UPDATE OF lead`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('CRM_LEAD_NOT_FOUND', 'The lead was not found.');
    return row;
  }

  private async mapLead(queryable: Queryable, row: LeadRow): Promise<CrmLead> {
    const history = await queryable.query<LeadHistoryRow>(
      `SELECT history.id, history.event_type, history.status, history.note,
              history.changed_at, employee.display_name AS changed_by_name
       FROM crm.lead_history history
       JOIN identity.user_accounts account ON account.id = history.changed_by
       JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE history.lead_id = $1 ORDER BY history.changed_at, history.id`,
      [row.id],
    );
    return {
      contactName: row.contact_name,
      ...(row.converted_at ? { convertedAt: iso(row.converted_at) } : {}),
      ...(row.converted_customer_partner_id && row.converted_customer_name
        ? {
            convertedCustomer: {
              id: row.converted_customer_partner_id,
              name: row.converted_customer_name,
            },
          }
        : {}),
      createdAt: iso(row.created_at),
      ...(row.email ? { email: row.email } : {}),
      history: history.rows.map((entry) => ({
        changedAt: iso(entry.changed_at),
        changedByName: entry.changed_by_name,
        id: entry.id,
        ...(entry.note ? { note: entry.note } : {}),
        status: entry.status,
        type: entry.event_type,
      })),
      id: row.id,
      number: row.lead_number,
      ...(row.notes ? { notes: row.notes } : {}),
      organizationName: row.organization_name,
      owner: { displayName: row.owner_name, id: row.owner_account_id },
      ...(row.qualified_at ? { qualifiedAt: iso(row.qualified_at) } : {}),
      source: row.source,
      ...(row.source_details ? { sourceDetails: row.source_details } : {}),
      status: row.status,
      ...(row.telephone ? { telephone: row.telephone } : {}),
      updatedAt: iso(row.updated_at),
      version: row.version,
    };
  }

  private async loadOpportunity(queryable: Queryable, id: string): Promise<CrmOpportunity> {
    const result = await queryable.query<OpportunityRow>(
      `${opportunityQuery()} WHERE opportunity.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('CRM_OPPORTUNITY_NOT_FOUND', 'The sales opportunity was not found.');
    return this.mapOpportunity(queryable, row);
  }

  private async lockOpportunity(client: PoolClient, id: string): Promise<OpportunityRow> {
    const result = await client.query<OpportunityRow>(
      `${opportunityQuery()} WHERE opportunity.id = $1 FOR UPDATE OF opportunity`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('CRM_OPPORTUNITY_NOT_FOUND', 'The sales opportunity was not found.');
    return row;
  }

  private async mapOpportunity(queryable: Queryable, row: OpportunityRow): Promise<CrmOpportunity> {
    const [history, quotations] = await Promise.all([
      queryable.query<OpportunityHistoryRow>(
        `SELECT history.id, history.event_type, history.previous_stage, history.next_stage,
                history.probability_percent, history.note, history.changed_at,
                employee.display_name AS changed_by_name
         FROM crm.opportunity_history history
         JOIN identity.user_accounts account ON account.id = history.changed_by
         JOIN identity.employees employee ON employee.id = account.employee_id
         WHERE history.opportunity_id = $1 ORDER BY history.changed_at, history.id`,
        [row.id],
      ),
      queryable.query<QuotationRow>(
        `SELECT quotation.id, quotation.quotation_number, quotation.currency_code,
                quotation.total::text, quotation.status, link.linked_at
         FROM crm.opportunity_quotation_links link
         JOIN sales.quotations quotation ON quotation.id = link.quotation_id
         WHERE link.opportunity_id = $1 ORDER BY link.linked_at DESC, quotation.id`,
        [row.id],
      ),
    ]);
    return {
      ...(row.closed_at ? { closedAt: iso(row.closed_at) } : {}),
      createdAt: iso(row.created_at),
      customer: { id: row.customer_partner_id, name: row.customer_name },
      ...(row.description ? { description: row.description } : {}),
      estimatedRevenueBgn: row.estimated_revenue_bgn,
      ...(row.expected_close_on ? { expectedCloseOn: dateOnly(row.expected_close_on) } : {}),
      history: history.rows.map((entry) => ({
        changedAt: iso(entry.changed_at),
        changedByName: entry.changed_by_name,
        id: entry.id,
        nextStage: entry.next_stage,
        ...(entry.note ? { note: entry.note } : {}),
        ...(entry.previous_stage ? { previousStage: entry.previous_stage } : {}),
        probabilityPercent: entry.probability_percent,
        type: entry.event_type,
      })),
      id: row.id,
      number: row.opportunity_number,
      owner: { displayName: row.owner_name, id: row.owner_account_id },
      probabilityPercent: row.probability_percent,
      quotations: quotations.rows.map((quotation) => ({
        currencyCode: quotation.currency_code,
        id: quotation.id,
        linkedAt: iso(quotation.linked_at),
        number: quotation.quotation_number,
        status: quotation.status,
        total: quotation.total,
      })),
      ...(row.source_lead_id ? { sourceLeadId: row.source_lead_id } : {}),
      stage: row.stage,
      title: row.title,
      updatedAt: iso(row.updated_at),
      version: row.version,
      weightedRevenueBgn: row.weighted_revenue_bgn,
    };
  }

  private async sideEffects(
    client: PoolClient,
    targetType: 'crm_lead' | 'crm_opportunity',
    targetId: string,
    eventType: string,
    after: unknown,
    commandKey: string,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    before?: Record<string, unknown>,
  ) {
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
        `${eventType}:${commandKey}`,
        after,
      ],
    );
    await this.audit.append(
      {
        action: eventType,
        actorAccountId: auth.accountId,
        after: after as Record<string, unknown>,
        ...(before ? { before } : {}),
        correlationId: metadata.correlationId,
        ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
        targetId,
        targetType,
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
      client,
    );
  }

  private async command<T>(
    scope: string,
    key: string | undefined,
    payload: object,
    responseStatus: number,
    action: (client: PoolClient, commandKey: string) => Promise<T>,
  ): Promise<T> {
    const commandKey = validKey(key);
    const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claim(client, scope, commandKey, requestHash);
      if (replay !== undefined) {
        await client.query('COMMIT');
        return replay as T;
      }
      const result = await action(client, commandKey);
      await client.query(
        `UPDATE platform.idempotency_keys SET status = 'completed', response_status = $3,
           response_body = $4 WHERE scope = $1 AND idempotency_key = $2`,
        [scope, commandKey, responseStatus, result],
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

type NormalizedOpportunity = ReturnType<typeof normalizeOpportunityBase>;

function leadQuery(): string {
  return `SELECT lead.id, lead.lead_number, lead.organization_name, lead.contact_name,
    lead.telephone, lead.email, lead.source, lead.source_details, lead.notes, lead.status,
    lead.owner_account_id, lead.qualified_at, lead.converted_at,
    lead.converted_customer_partner_id, lead.version, lead.created_at, lead.updated_at,
    owner_employee.display_name AS owner_name,
    converted_customer.display_name AS converted_customer_name
  FROM crm.leads lead
  JOIN identity.user_accounts owner_account ON owner_account.id = lead.owner_account_id
  JOIN identity.employees owner_employee ON owner_employee.id = owner_account.employee_id
  LEFT JOIN master_data.partners converted_customer
    ON converted_customer.id = lead.converted_customer_partner_id`;
}

function opportunityQuery(): string {
  return `SELECT opportunity.id, opportunity.opportunity_number,
    opportunity.customer_partner_id, opportunity.source_lead_id, opportunity.title,
    opportunity.description, opportunity.estimated_revenue_bgn::text,
    opportunity.probability_percent, opportunity.stage, opportunity.expected_close_on,
    opportunity.owner_account_id, opportunity.closed_at, opportunity.version,
    opportunity.created_at, opportunity.updated_at, partner.display_name AS customer_name,
    employee.display_name AS owner_name,
    round(opportunity.estimated_revenue_bgn * opportunity.probability_percent / 100.0, 2)::text
      AS weighted_revenue_bgn
  FROM crm.opportunities opportunity
  JOIN master_data.partners partner ON partner.id = opportunity.customer_partner_id
  JOIN identity.user_accounts owner ON owner.id = opportunity.owner_account_id
  JOIN identity.employees employee ON employee.id = owner.employee_id`;
}

function crmAssigneesSql(): string {
  return `SELECT DISTINCT account.id, employee.display_name
    FROM identity.user_accounts account
    JOIN identity.employees employee ON employee.id = account.employee_id
    JOIN iam.account_roles assignment ON assignment.account_id = account.id
    JOIN iam.role_permissions role_permission ON role_permission.role_id = assignment.role_id
    JOIN iam.permissions permission ON permission.id = role_permission.permission_id
    WHERE account.status = 'active' AND permission.module IN ('crm', '*')
      AND permission.action IN ('edit', '*')`;
}

function normalizeLead(input: CreateCrmLeadRequest) {
  const telephone = optionalText(input.telephone, 100);
  const email = optionalText(input.email, 320)?.toLowerCase();
  if (!telephone && !email)
    throw badRequest(
      'CRM_LEAD_CONTACT_REQUIRED',
      'Enter a telephone number or email address for this lead.',
    );
  return {
    contactName: requiredText(input.contactName, 255),
    ...(email ? { email } : {}),
    ...(optionalText(input.notes, 4000) ? { notes: optionalText(input.notes, 4000)! } : {}),
    organizationName: requiredText(input.organizationName, 255),
    ownerAccountId: input.ownerAccountId.trim(),
    source: input.source,
    ...(optionalText(input.sourceDetails, 500)
      ? { sourceDetails: optionalText(input.sourceDetails, 500)! }
      : {}),
    ...(telephone ? { telephone } : {}),
  };
}

function normalizeQualification(input: QualifyCrmLeadRequest) {
  return {
    expectedVersion: validVersion(input.expectedVersion),
    ...(optionalText(input.note, 2000) ? { note: optionalText(input.note, 2000)! } : {}),
  };
}

function normalizeConversion(input: ConvertCrmLeadRequest) {
  const hasExisting = Boolean(input.existingCustomerPartnerId?.trim());
  const hasNew = Boolean(input.newCustomer);
  if (hasExisting === hasNew)
    throw badRequest(
      'CRM_LEAD_CUSTOMER_CHOICE_INVALID',
      'Choose one existing customer or create one new customer.',
    );
  if (input.createOpportunity !== Boolean(input.opportunity))
    throw badRequest(
      'CRM_LEAD_OPPORTUNITY_CHOICE_INVALID',
      input.createOpportunity
        ? 'Enter the sales opportunity details.'
        : 'Remove the opportunity details or choose to create it.',
    );
  const newCustomer = input.newCustomer
    ? {
        displayName: requiredText(input.newCustomer.displayName, 255),
        kind: input.newCustomer.kind,
        ...(optionalText(input.newCustomer.uic, 50)
          ? { uic: optionalText(input.newCustomer.uic, 50)! }
          : {}),
        ...(optionalText(input.newCustomer.vatNumber, 50)
          ? { vatNumber: optionalText(input.newCustomer.vatNumber, 50)! }
          : {}),
      }
    : undefined;
  return {
    createOpportunity: input.createOpportunity,
    ...(input.existingCustomerPartnerId?.trim()
      ? { existingCustomerPartnerId: input.existingCustomerPartnerId.trim() }
      : {}),
    expectedVersion: validVersion(input.expectedVersion),
    ...(newCustomer ? { newCustomer } : {}),
    ...(optionalText(input.note, 2000) ? { note: optionalText(input.note, 2000)! } : {}),
    ...(input.opportunity ? { opportunity: normalizeOpportunityBase(input.opportunity) } : {}),
  };
}

function normalizeOpportunity(input: CreateCrmOpportunityRequest) {
  return {
    ...normalizeOpportunityBase(input),
    customerPartnerId: input.customerPartnerId.trim(),
  };
}

function normalizeOpportunityBase(input: {
  description?: string;
  estimatedRevenueBgn: string;
  expectedCloseOn?: string;
  ownerAccountId: string;
  probabilityPercent: number;
  title: string;
}) {
  if (
    !Number.isInteger(input.probabilityPercent) ||
    input.probabilityPercent < 1 ||
    input.probabilityPercent > 99
  )
    throw badRequest(
      'CRM_OPPORTUNITY_PROBABILITY_INVALID',
      'Enter a probability between 1 and 99 percent.',
    );
  return {
    ...(optionalText(input.description, 4000)
      ? { description: optionalText(input.description, 4000)! }
      : {}),
    estimatedRevenueBgn: positiveMoney(input.estimatedRevenueBgn),
    ...(input.expectedCloseOn ? { expectedCloseOn: validDate(input.expectedCloseOn) } : {}),
    ownerAccountId: input.ownerAccountId.trim(),
    probabilityPercent: input.probabilityPercent,
    title: requiredText(input.title, 255),
  };
}

function normalizeMove(input: MoveCrmOpportunityRequest) {
  const terminalProbability = input.stage === 'won' ? 100 : input.stage === 'lost' ? 0 : null;
  if (
    (terminalProbability !== null && input.probabilityPercent !== terminalProbability) ||
    (terminalProbability === null &&
      (!Number.isInteger(input.probabilityPercent) ||
        input.probabilityPercent < 1 ||
        input.probabilityPercent > 99))
  )
    throw badRequest(
      'CRM_OPPORTUNITY_STAGE_PROBABILITY_INVALID',
      input.stage === 'won'
        ? 'A won opportunity must have 100% probability.'
        : input.stage === 'lost'
          ? 'A lost opportunity must have 0% probability.'
          : 'An open opportunity must have a probability between 1% and 99%.',
    );
  return {
    expectedVersion: validVersion(input.expectedVersion),
    ...(optionalText(input.note, 2000) ? { note: optionalText(input.note, 2000)! } : {}),
    probabilityPercent: input.probabilityPercent,
    stage: input.stage,
  };
}

function positiveMoney(value: string): string {
  const match = /^(\d{1,16})(?:\.(\d{1,2}))?$/u.exec(value.trim());
  if (!match?.[1])
    throw badRequest(
      'CRM_OPPORTUNITY_REVENUE_INVALID',
      'Enter an estimated value greater than zero with up to two decimal places.',
    );
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const cents = BigInt(match[1]) * 100n + BigInt(fraction || '0');
  if (cents <= 0n)
    throw badRequest('CRM_OPPORTUNITY_REVENUE_INVALID', 'Enter a value greater than zero.');
  return `${BigInt(match[1]).toString()}.${fraction}`;
}

function validDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value))
    throw badRequest('CRM_OPPORTUNITY_CLOSE_DATE_INVALID', 'Enter a valid expected close date.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw badRequest('CRM_OPPORTUNITY_CLOSE_DATE_INVALID', 'Enter a valid expected close date.');
  return value;
}

function requiredText(value: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max)
    throw badRequest('CRM_PIPELINE_TEXT_INVALID', `Enter between 1 and ${max} characters.`);
  return normalized;
}

function optionalText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > max)
    throw badRequest('CRM_PIPELINE_TEXT_INVALID', `Enter no more than ${max} characters.`);
  return normalized;
}

function validVersion(value: number): number {
  if (!Number.isInteger(value) || value < 1)
    throw badRequest('CRM_PIPELINE_VERSION_INVALID', 'Refresh this record before continuing.');
  return value;
}

function requireVersion(actual: number, expected: number, code: string) {
  if (actual !== expected)
    throw conflict(code, 'This record changed. Refresh it before continuing.');
}

function leadBase(row: LeadRow): Record<string, unknown> {
  return { id: row.id, status: row.status, version: row.version };
}

function opportunityBase(row: OpportunityRow): Record<string, unknown> {
  return {
    id: row.id,
    probabilityPercent: row.probability_percent,
    stage: row.stage,
    version: row.version,
  };
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function validKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 255)
    throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'An idempotency key is required.');
  return key;
}

async function claim(
  client: PoolClient,
  scope: string,
  key: string,
  hash: string,
): Promise<unknown> {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (
       scope, idempotency_key, request_hash, status, expires_at
     ) VALUES ($1,$2,$3,'processing',now() + INTERVAL '24 hours')
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, hash],
  );
  if (inserted.rowCount) return undefined;
  const existing = await client.query<{
    request_hash: string;
    response_body: unknown;
    status: string;
  }>(
    `SELECT request_hash, response_body, status FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== hash)
    throw conflict(
      'IDEMPOTENCY_KEY_REUSED',
      'This request key was already used for another change.',
    );
  if (row.status === 'completed') return row.response_body;
  throw conflict('IDEMPOTENCY_REQUEST_IN_PROGRESS', 'This change is already being processed.');
}

function badRequest(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.BAD_REQUEST);
}

function conflict(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.CONFLICT);
}

function notFound(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.NOT_FOUND);
}
