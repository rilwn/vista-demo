import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CreateCrmReferralRequest,
  CreateWarrantyClaimRequest,
  CrmAfterSalesOverview,
  CrmCustomerSurvey,
  CrmReferral,
  CrmSurveySourceKind,
  CrmSurveySourceReference,
  CrmWarrantyCard,
  RecordCrmSurveyResponseRequest,
  SendCrmCustomerSurveyRequest,
  TransitionWarrantyClaimRequest,
  UpdateCrmWarrantyOfferRequest,
  WarrantyClaim,
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
import { ServiceCareService } from '../service/service-care.service.js';

type Queryable = Pool | PoolClient;

interface WarrantyCardRow {
  card_number: string;
  claim_count: string;
  customer_equipment_id: string;
  customer_location_id: string;
  customer_location_name: string;
  customer_name: string;
  customer_partner_id: string;
  device_name: string;
  handover_number: string | null;
  id: string;
  issued_at: Date | string;
  offer_status: CrmWarrantyCard['offerStatus'];
  remaining_days: number;
  serial_number: string;
  warranty_ends_on: string;
  warranty_starts_on: string;
}

interface SurveyRow {
  comment: string | null;
  customer_name: string;
  customer_partner_id: string;
  id: string;
  responded_at: Date | string | null;
  score: number | null;
  sent_at: Date | string;
  source_kind: CrmSurveySourceKind;
  source_label: string;
  status: CrmCustomerSurvey['status'];
  survey_number: string;
}

interface ReferralRow {
  contact_name: string;
  created_at: Date | string;
  email: string | null;
  id: string;
  lead_id: string;
  lead_number: string;
  notes: string | null;
  organization_name: string;
  referral_number: string;
  referring_customer_name: string;
  referring_customer_partner_id: string;
  telephone: string | null;
}

@Injectable()
export class CrmAfterSalesService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ServiceCareService) private readonly care: ServiceCareService,
  ) {}

  async overview(auth: AuthenticationContext): Promise<CrmAfterSalesOverview> {
    const pool = this.database.getPool();
    const [cards, serviceCare, surveys, referrals, customers, assignees, sources] =
      await Promise.all([
        pool.query<WarrantyCardRow>(warrantyCardsSql(this.environment.BUSINESS_TIMEZONE)),
        this.care.overviewForCrm(auth),
        pool.query<SurveyRow>(surveysSql()),
        pool.query<ReferralRow>(referralsSql()),
        pool.query<{ id: string; name: string }>(customersSql()),
        pool.query<{ display_name: string; id: string }>(assigneesSql()),
        this.surveySources(pool),
      ]);
    const mappedSurveys = surveys.rows.map(mapSurvey);
    return {
      assignees: assignees.rows.map((row) => ({ displayName: row.display_name, id: row.id })),
      businessTimezone: this.environment.BUSINESS_TIMEZONE,
      claims: serviceCare.claims,
      customers: customers.rows,
      nps: npsSummary(mappedSurveys, this.environment.BUSINESS_TIMEZONE),
      referrals: referrals.rows.map(mapReferral),
      surveySources: sources,
      surveys: mappedSurveys,
      warrantyCards: cards.rows.map(mapWarrantyCard),
    };
  }

  createClaim(
    input: CreateWarrantyClaimRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<WarrantyClaim> {
    return this.care.createClaim(input, key, auth, metadata);
  }

  transitionClaim(
    id: string,
    input: TransitionWarrantyClaimRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<WarrantyClaim> {
    return this.care.transitionClaim(id, input, key, auth, metadata);
  }

  async updateWarrantyOffer(
    id: string,
    input: UpdateCrmWarrantyOfferRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmWarrantyCard> {
    const normalized = { offerStatus: input.offerStatus };
    if (!['not_offered', 'offered', 'interested', 'declined'].includes(normalized.offerStatus))
      throw badRequest('CRM_WARRANTY_OFFER_INVALID', 'Choose a valid follow-up status.');
    return this.command(
      `crm.warranty-card.offer:${id}`,
      key,
      normalized,
      200,
      async (client, commandKey) => {
        const before = await this.loadWarrantyCard(client, id, true);
        await client.query(
          `UPDATE crm.warranty_cards SET offer_status = $2, updated_at = now() WHERE id = $1`,
          [id, normalized.offerStatus],
        );
        const after = await this.loadWarrantyCard(client, id);
        await this.sideEffects(
          client,
          'crm_warranty_card',
          id,
          'crm.warranty-card.offer-updated',
          after,
          commandKey,
          auth,
          metadata,
          before,
        );
        return after;
      },
    );
  }

  async sendSurvey(
    input: SendCrmCustomerSurveyRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmCustomerSurvey> {
    const normalized = { sourceId: input.sourceId, sourceKind: input.sourceKind };
    if (!['delivery', 'service'].includes(normalized.sourceKind))
      throw badRequest('CRM_SURVEY_SOURCE_INVALID', 'Choose a completed delivery or Service job.');
    return this.command(
      'crm.customer-survey.send',
      key,
      normalized,
      201,
      async (client, commandKey) => {
        const source = await this.requireSurveySource(
          client,
          normalized.sourceKind,
          normalized.sourceId,
        );
        const id = randomUUID();
        const number = await this.allocateNumber(client, 'survey', 'SUR');
        try {
          await client.query(
            `INSERT INTO crm.customer_surveys (
             id, survey_number, customer_partner_id, customer_location_id, source_kind,
             handover_certificate_id, service_work_order_id, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
            [
              id,
              number,
              source.customerPartnerId,
              source.customerLocationId,
              normalized.sourceKind,
              normalized.sourceKind === 'delivery' ? normalized.sourceId : null,
              normalized.sourceKind === 'service' ? normalized.sourceId : null,
              auth.accountId,
            ],
          );
        } catch (error) {
          if (isUniqueViolation(error))
            throw new ApiErrorException(
              'CRM_SURVEY_ALREADY_SENT',
              'A survey has already been sent for this work.',
              HttpStatus.CONFLICT,
            );
          throw error;
        }
        const survey = await this.loadSurvey(client, id);
        await this.sideEffects(
          client,
          'crm_customer_survey',
          id,
          'crm.customer-survey.sent',
          survey,
          commandKey,
          auth,
          metadata,
        );
        return survey;
      },
    );
  }

  async recordSurveyResponse(
    id: string,
    input: RecordCrmSurveyResponseRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmCustomerSurvey> {
    const comment = input.comment?.trim();
    if (!Number.isInteger(input.score) || input.score < 0 || input.score > 10)
      throw badRequest('CRM_SURVEY_SCORE_INVALID', 'Choose a score from 0 to 10.');
    if (comment && comment.length > 2000)
      throw badRequest('CRM_SURVEY_COMMENT_INVALID', 'Keep the feedback within 2,000 characters.');
    const normalized = { ...(comment ? { comment } : {}), score: input.score };
    return this.command(
      `crm.customer-survey.respond:${id}`,
      key,
      normalized,
      200,
      async (client, commandKey) => {
        const before = await this.loadSurvey(client, id, true);
        if (before.status === 'responded')
          throw new ApiErrorException(
            'CRM_SURVEY_ALREADY_RESPONDED',
            'This survey response has already been recorded.',
            HttpStatus.CONFLICT,
          );
        await client.query(
          `UPDATE crm.customer_surveys
           SET status = 'responded', score = $2, comment = $3, responded_at = now(),
               updated_by = $4, updated_at = now()
           WHERE id = $1`,
          [id, normalized.score, normalized.comment ?? null, auth.accountId],
        );
        const after = await this.loadSurvey(client, id);
        await this.sideEffects(
          client,
          'crm_customer_survey',
          id,
          'crm.customer-survey.response-recorded',
          after,
          commandKey,
          auth,
          metadata,
          before,
        );
        return after;
      },
    );
  }

  async createReferral(
    input: CreateCrmReferralRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmReferral> {
    const normalized = normalizeReferral(input);
    return this.command('crm.referral.create', key, normalized, 201, async (client, commandKey) => {
      const customer = await client.query<{ display_name: string }>(
        `SELECT partner.display_name FROM master_data.partners partner
         JOIN master_data.partner_roles role
           ON role.partner_id = partner.id AND role.role = 'customer'
         WHERE partner.id = $1 AND partner.active FOR KEY SHARE OF partner`,
        [normalized.referringCustomerPartnerId],
      );
      const customerName = customer.rows[0]?.display_name;
      if (!customerName)
        throw badRequest('CRM_REFERRAL_CUSTOMER_INVALID', 'Choose an active customer.');
      const owner = await client.query(`${assigneesSql()} AND account.id = $1`, [
        normalized.ownerAccountId,
      ]);
      if (!owner.rowCount)
        throw badRequest('CRM_REFERRAL_OWNER_INVALID', 'Choose an active CRM team member.');

      const leadId = randomUUID();
      const leadNumber = await this.allocateNumber(client, 'lead', 'LEAD');
      await client.query(
        `INSERT INTO crm.leads (
           id, lead_number, organization_name, contact_name, telephone, email, source,
           source_details, notes, owner_account_id, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,'referral',$7,$8,$9,$10,$10)`,
        [
          leadId,
          leadNumber,
          normalized.organizationName,
          normalized.contactName,
          normalized.telephone ?? null,
          normalized.email ?? null,
          `Referred by ${customerName}`,
          normalized.notes ?? null,
          normalized.ownerAccountId,
          auth.accountId,
        ],
      );
      await client.query(
        `INSERT INTO crm.lead_history (
           id, lead_id, event_type, status, note, changed_by
         ) VALUES ($1,$2,'created','new',$3,$4)`,
        [randomUUID(), leadId, `Customer referral from ${customerName}`, auth.accountId],
      );
      const id = randomUUID();
      const number = await this.allocateNumber(client, 'referral', 'REF');
      await client.query(
        `INSERT INTO crm.referrals (
           id, referral_number, referring_customer_partner_id, organization_name,
           contact_name, telephone, email, notes, lead_id, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          number,
          normalized.referringCustomerPartnerId,
          normalized.organizationName,
          normalized.contactName,
          normalized.telephone ?? null,
          normalized.email ?? null,
          normalized.notes ?? null,
          leadId,
          auth.accountId,
        ],
      );
      const referral = await this.loadReferral(client, id);
      await this.sideEffects(
        client,
        'crm_referral',
        id,
        'crm.referral.registered',
        referral,
        commandKey,
        auth,
        metadata,
      );
      await this.sideEffects(
        client,
        'crm_lead',
        leadId,
        'crm.lead.created-from-referral',
        { leadId, leadNumber, referralId: id, referralNumber: number },
        `${commandKey}:lead`,
        auth,
        metadata,
      );
      return referral;
    });
  }

  private async surveySources(queryable: Queryable): Promise<CrmSurveySourceReference[]> {
    const result = await queryable.query<{
      customer_location_id: string;
      customer_name: string;
      customer_partner_id: string;
      id: string;
      label: string;
      source_kind: CrmSurveySourceKind;
    }>(
      `SELECT certificate.id, certificate.customer_partner_id,
              certificate.customer_location_id, partner.display_name AS customer_name,
              'delivery'::text AS source_kind,
              certificate.certificate_number || ' · accepted delivery' AS label
       FROM sales.handover_certificates certificate
       JOIN master_data.partners partner ON partner.id = certificate.customer_partner_id
       LEFT JOIN crm.customer_surveys survey ON survey.handover_certificate_id = certificate.id
       WHERE certificate.status = 'accepted' AND certificate.customer_location_id IS NOT NULL
         AND survey.id IS NULL
       UNION ALL
       SELECT work_order.id, request.customer_partner_id, request.customer_location_id,
              partner.display_name AS customer_name, 'service'::text AS source_kind,
              work_order.work_order_number || ' · completed Service job' AS label
       FROM service.work_orders work_order
       JOIN service.requests request ON request.id = work_order.service_request_id
       JOIN master_data.partners partner ON partner.id = request.customer_partner_id
       LEFT JOIN crm.customer_surveys survey ON survey.service_work_order_id = work_order.id
       WHERE work_order.status = 'completed' AND survey.id IS NULL
       ORDER BY customer_name, label`,
    );
    return result.rows.map((row) => ({
      customerLocationId: row.customer_location_id,
      customerName: row.customer_name,
      customerPartnerId: row.customer_partner_id,
      id: row.id,
      label: row.label,
      sourceKind: row.source_kind,
    }));
  }

  private async requireSurveySource(
    queryable: Queryable,
    kind: CrmSurveySourceKind,
    id: string,
  ): Promise<CrmSurveySourceReference> {
    const sources = await this.surveySources(queryable);
    const source = sources.find((item) => item.sourceKind === kind && item.id === id);
    if (!source)
      throw badRequest(
        'CRM_SURVEY_SOURCE_UNAVAILABLE',
        'Choose completed work that has not already received a survey.',
      );
    return source;
  }

  private async loadWarrantyCard(
    queryable: Queryable,
    id: string,
    lock = false,
  ): Promise<CrmWarrantyCard> {
    if (lock) {
      const locked = await queryable.query(
        'SELECT id FROM crm.warranty_cards WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!locked.rowCount)
        throw new ApiErrorException(
          'CRM_WARRANTY_CARD_NOT_FOUND',
          'The warranty card was not found.',
          HttpStatus.NOT_FOUND,
        );
    }
    const result = await queryable.query<WarrantyCardRow>(
      warrantyCardsSql(this.environment.BUSINESS_TIMEZONE, 'WHERE card.id = $1'),
      [id],
    );
    const row = result.rows[0];
    if (!row)
      throw new ApiErrorException(
        'CRM_WARRANTY_CARD_NOT_FOUND',
        'The warranty card was not found.',
        HttpStatus.NOT_FOUND,
      );
    return mapWarrantyCard(row);
  }

  private async loadSurvey(
    queryable: Queryable,
    id: string,
    lock = false,
  ): Promise<CrmCustomerSurvey> {
    const result = await queryable.query<SurveyRow>(
      `${surveysSql('WHERE survey.id = $1')}${lock ? ' FOR UPDATE OF survey' : ''}`,
      [id],
    );
    const row = result.rows[0];
    if (!row)
      throw new ApiErrorException(
        'CRM_SURVEY_NOT_FOUND',
        'The customer survey was not found.',
        HttpStatus.NOT_FOUND,
      );
    return mapSurvey(row);
  }

  private async loadReferral(queryable: Queryable, id: string): Promise<CrmReferral> {
    const result = await queryable.query<ReferralRow>(`${referralsSql('WHERE referral.id = $1')}`, [
      id,
    ]);
    const row = result.rows[0];
    if (!row)
      throw new ApiErrorException(
        'CRM_REFERRAL_NOT_FOUND',
        'The referral was not found.',
        HttpStatus.NOT_FOUND,
      );
    return mapReferral(row);
  }

  private async allocateNumber(client: PoolClient, type: string, prefix: string) {
    await client.query(
      `INSERT INTO crm.internal_document_sequences (document_type)
       VALUES ($1) ON CONFLICT DO NOTHING`,
      [type],
    );
    const result = await client.query<{ allocated: string }>(
      `UPDATE crm.internal_document_sequences
       SET next_value = next_value + 1, updated_at = now()
       WHERE document_type = $1 RETURNING (next_value - 1)::text AS allocated`,
      [type],
    );
    const allocated = result.rows[0]?.allocated;
    if (!allocated) throw new Error(`Could not allocate ${type} number`);
    const year = new Intl.DateTimeFormat('en', {
      timeZone: this.environment.BUSINESS_TIMEZONE,
      year: 'numeric',
    }).format(new Date());
    return `${prefix}-${year}-${allocated.padStart(6, '0')}`;
  }

  private async sideEffects(
    client: PoolClient,
    targetType: string,
    targetId: string,
    eventType: string,
    after: unknown,
    commandKey: string,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    before?: unknown,
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

  private async command<T>(
    scope: string,
    key: string | undefined,
    payload: object,
    responseStatus: number,
    action: (client: PoolClient, commandKey: string) => Promise<T>,
  ): Promise<T> {
    const commandKey = validKey(key);
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claim(client, scope, commandKey, hash);
      if (replay !== undefined) {
        await client.query('COMMIT');
        return replay as T;
      }
      const result = await action(client, commandKey);
      await client.query(
        `UPDATE platform.idempotency_keys
         SET status = 'completed', response_status = $3, response_body = $4
         WHERE scope = $1 AND idempotency_key = $2`,
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

function warrantyCardsSql(timezone: string, where = '') {
  return `SELECT card.id, card.card_number, card.customer_partner_id,
    card.customer_equipment_id,
    card.customer_location_id, partner.display_name AS customer_name,
    location.name AS customer_location_name, equipment.device_name,
    equipment.serial_number, card.warranty_starts_on::text,
    card.warranty_ends_on::text, card.offer_status, card.issued_at,
    (card.warranty_ends_on - (now() AT TIME ZONE '${timezone.replaceAll("'", "''")}')::date)::integer
      AS remaining_days,
    handover.certificate_number AS handover_number,
    count(claim.id)::text AS claim_count
  FROM crm.warranty_cards card
  JOIN master_data.partners partner ON partner.id = card.customer_partner_id
  JOIN master_data.customer_locations location ON location.id = card.customer_location_id
  JOIN master_data.customer_equipment equipment ON equipment.id = card.customer_equipment_id
  LEFT JOIN sales.handover_certificates handover ON handover.id = card.handover_certificate_id
  LEFT JOIN service.warranty_claims claim ON claim.customer_equipment_id = equipment.id
  ${where}
  GROUP BY card.id, partner.display_name, location.name, equipment.device_name,
           equipment.serial_number, handover.certificate_number
  ORDER BY card.warranty_ends_on, partner.display_name, card.id`;
}

function surveysSql(where = '') {
  return `SELECT survey.id, survey.survey_number, survey.customer_partner_id,
    partner.display_name AS customer_name, survey.source_kind, survey.status,
    survey.score, survey.comment, survey.sent_at, survey.responded_at,
    CASE WHEN survey.source_kind = 'delivery' THEN handover.certificate_number
         ELSE work_order.work_order_number END AS source_label
  FROM crm.customer_surveys survey
  JOIN master_data.partners partner ON partner.id = survey.customer_partner_id
  LEFT JOIN sales.handover_certificates handover ON handover.id = survey.handover_certificate_id
  LEFT JOIN service.work_orders work_order ON work_order.id = survey.service_work_order_id
  ${where}
  ORDER BY survey.sent_at DESC, survey.id DESC`;
}

function referralsSql(where = '') {
  return `SELECT referral.id, referral.referral_number,
    referral.referring_customer_partner_id,
    customer.display_name AS referring_customer_name, referral.organization_name,
    referral.contact_name, referral.telephone, referral.email, referral.notes,
    referral.lead_id, lead.lead_number, referral.created_at
  FROM crm.referrals referral
  JOIN master_data.partners customer ON customer.id = referral.referring_customer_partner_id
  JOIN crm.leads lead ON lead.id = referral.lead_id
  ${where}
  ORDER BY referral.created_at DESC, referral.id DESC`;
}

function customersSql() {
  return `SELECT DISTINCT partner.id, partner.display_name AS name
  FROM master_data.partners partner
  JOIN master_data.partner_roles role
    ON role.partner_id = partner.id AND role.role = 'customer'
  WHERE partner.active ORDER BY partner.display_name, partner.id`;
}

function assigneesSql() {
  return `SELECT DISTINCT account.id, employee.display_name
  FROM identity.user_accounts account
  JOIN identity.employees employee ON employee.id = account.employee_id
  JOIN iam.account_roles assignment ON assignment.account_id = account.id
  JOIN iam.role_permissions role_permission ON role_permission.role_id = assignment.role_id
  JOIN iam.permissions permission ON permission.id = role_permission.permission_id
  WHERE account.status = 'active' AND employee.active
    AND permission.module IN ('crm', '*')
    AND permission.action IN ('view', 'create', 'edit', 'approve', '*')`;
}

function mapWarrantyCard(row: WarrantyCardRow): CrmWarrantyCard {
  return {
    claimCount: Number(row.claim_count),
    customerEquipmentId: row.customer_equipment_id,
    customerLocationId: row.customer_location_id,
    customerLocationName: row.customer_location_name,
    customerName: row.customer_name,
    customerPartnerId: row.customer_partner_id,
    deviceName: row.device_name,
    ...(row.handover_number ? { handoverNumber: row.handover_number } : {}),
    id: row.id,
    issuedAt: iso(row.issued_at),
    number: row.card_number,
    offerStatus: row.offer_status,
    remainingDays: row.remaining_days,
    serialNumber: row.serial_number,
    status: row.remaining_days >= 0 ? 'active' : 'expired',
    warrantyEndsOn: row.warranty_ends_on,
    warrantyStartsOn: row.warranty_starts_on,
  };
}

function mapSurvey(row: SurveyRow): CrmCustomerSurvey {
  return {
    ...(row.comment ? { comment: row.comment } : {}),
    customerName: row.customer_name,
    customerPartnerId: row.customer_partner_id,
    id: row.id,
    number: row.survey_number,
    ...(row.responded_at ? { respondedAt: iso(row.responded_at) } : {}),
    ...(row.score === null ? {} : { score: row.score }),
    sentAt: iso(row.sent_at),
    sourceKind: row.source_kind,
    sourceLabel: row.source_label,
    status: row.status,
  };
}

function mapReferral(row: ReferralRow): CrmReferral {
  return {
    contactName: row.contact_name,
    createdAt: iso(row.created_at),
    ...(row.email ? { email: row.email } : {}),
    id: row.id,
    leadId: row.lead_id,
    leadNumber: row.lead_number,
    ...(row.notes ? { notes: row.notes } : {}),
    number: row.referral_number,
    organizationName: row.organization_name,
    referringCustomerName: row.referring_customer_name,
    referringCustomerPartnerId: row.referring_customer_partner_id,
    ...(row.telephone ? { telephone: row.telephone } : {}),
  };
}

function npsSummary(surveys: CrmCustomerSurvey[], timezone: string): CrmAfterSalesOverview['nps'] {
  const completed = surveys.filter(
    (survey): survey is CrmCustomerSurvey & { respondedAt: string; score: number } =>
      survey.status === 'responded' && survey.score !== undefined && Boolean(survey.respondedAt),
  );
  const promoters = completed.filter((survey) => survey.score >= 9).length;
  const passives = completed.filter((survey) => survey.score >= 7 && survey.score <= 8).length;
  const detractors = completed.filter((survey) => survey.score <= 6).length;
  const grouped = new Map<string, number[]>();
  const formatter = new Intl.DateTimeFormat('en', {
    month: 'short',
    timeZone: timezone,
    year: 'numeric',
  });
  for (const survey of completed) {
    const label = formatter.format(new Date(survey.respondedAt));
    grouped.set(label, [...(grouped.get(label) ?? []), survey.score]);
  }
  return {
    detractors,
    passives,
    promoters,
    responses: completed.length,
    ...(completed.length
      ? { score: Math.round(((promoters - detractors) / completed.length) * 100) }
      : {}),
    trend: [...grouped.entries()].map(([label, scores]) => ({
      label,
      responses: scores.length,
      score: Math.round(
        ((scores.filter((score) => score >= 9).length -
          scores.filter((score) => score <= 6).length) /
          scores.length) *
          100,
      ),
    })),
  };
}

function normalizeReferral(input: CreateCrmReferralRequest) {
  const organizationName = clean(input.organizationName, 255);
  const contactName = clean(input.contactName, 255);
  const telephone = input.telephone?.trim();
  const email = input.email?.trim().toLowerCase();
  const notes = input.notes?.trim();
  if (!telephone && !email)
    throw badRequest('CRM_REFERRAL_CONTACT_REQUIRED', 'Enter a telephone number or email address.');
  if (telephone && telephone.length > 100)
    throw badRequest('CRM_REFERRAL_TELEPHONE_INVALID', 'Enter a valid telephone number.');
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 320))
    throw badRequest('CRM_REFERRAL_EMAIL_INVALID', 'Enter a valid email address.');
  if (notes && notes.length > 4000)
    throw badRequest('CRM_REFERRAL_NOTES_INVALID', 'Keep the note within 4,000 characters.');
  return {
    contactName,
    ...(email ? { email } : {}),
    ...(notes ? { notes } : {}),
    organizationName,
    ownerAccountId: input.ownerAccountId,
    referringCustomerPartnerId: input.referringCustomerPartnerId,
    ...(telephone ? { telephone } : {}),
  };
}

function clean(value: string, max: number) {
  const result = value.trim().replace(/\s+/gu, ' ');
  if (!result || result.length > max)
    throw badRequest('CRM_REFERRAL_TEXT_INVALID', 'Complete the required referral details.');
  return result;
}

async function claim(client: PoolClient, scope: string, key: string, hash: string) {
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
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REUSED',
      'This request key was already used for different information.',
      HttpStatus.CONFLICT,
    );
  if (row.status === 'completed') return row.response_body;
  throw new ApiErrorException(
    'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    'This request is already being processed.',
    HttpStatus.CONFLICT,
  );
}

function validKey(value: string | undefined) {
  if (!value || value.length > 255)
    throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
  return value;
}

function badRequest(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.BAD_REQUEST);
}

function iso(value: Date | string) {
  return new Date(value).toISOString();
}

function isUniqueViolation(error: unknown): error is { code: '23505' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
