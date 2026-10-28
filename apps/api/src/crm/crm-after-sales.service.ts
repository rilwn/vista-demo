import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CreateCrmReferralRequest,
  CreateCrmWarrantyCoverageOfferRequest,
  CreateWarrantyClaimRequest,
  CrmAfterSalesOverview,
  CrmCustomerSurvey,
  CrmPublicSurvey,
  CrmReferral,
  CrmSurveySourceKind,
  CrmSurveySourceReference,
  CrmWarrantyCard,
  CrmWarrantyCardReconciliationResult,
  CrmWarrantyCoverageOffer,
  RecordCrmSurveyResponseRequest,
  SendCrmCustomerSurveyRequest,
  TransitionWarrantyClaimRequest,
  TransitionCrmWarrantyCoverageOfferRequest,
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
import { queueEmailMessage } from '../notifications/notification-email.js';

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

interface WarrantyCoverageOfferRow {
  coverage_starts_on: string;
  created_at: Date | string;
  currency_code: 'EUR';
  customer_name: string;
  customer_partner_id: string;
  device_name: string;
  duration_months: number;
  effective_status: CrmWarrantyCoverageOffer['status'];
  id: string;
  offer_number: string;
  offer_type: CrmWarrantyCoverageOffer['offerType'];
  quoted_amount: string;
  serial_number: string;
  terms: string;
  valid_until: string;
  visit_frequency_months: number | null;
  warranty_card_id: string;
  warranty_ends_on: string;
}

interface WarrantyCardReconciliationCandidate {
  customer_equipment_id: string;
  customer_location_id: string;
  customer_partner_id: string;
  handover_certificate_id: string | null;
  issued_by: string;
  pos_sale_id: string | null;
  warranty_ends_on: string;
  warranty_starts_on: string;
}

interface WarrantyCardReconciliationCountRow {
  eligible_sold_serials: string;
  missing_cards: string;
  registered_sold_serials: string;
}

interface SurveyRow {
  comment: string | null;
  customer_name: string;
  customer_partner_id: string;
  delivery_status: CrmCustomerSurvey['deliveryStatus'] | null;
  recipient_email: string | null;
  id: string;
  responded_at: Date | string | null;
  score: number | null;
  sent_at: Date | string;
  source_kind: CrmSurveySourceKind;
  source_label: string;
  status: CrmCustomerSurvey['status'];
  survey_number: string;
}

interface PublicSurveyRow {
  response_expires_at: Date | string;
  score: number | null;
  source_kind: CrmSurveySourceKind;
  status: CrmCustomerSurvey['status'];
  survey_number: string;
}

interface SurveySourceRow {
  customer_location_id: string;
  customer_name: string;
  customer_partner_id: string;
  recipient_emails: string[];
  id: string;
  label: string;
  source_kind: CrmSurveySourceKind;
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
    const [
      cards,
      serviceCare,
      surveys,
      referrals,
      customers,
      assignees,
      sources,
      reconciliation,
      coverageOffers,
    ] = await Promise.all([
      pool.query<WarrantyCardRow>(warrantyCardsSql(this.environment.BUSINESS_TIMEZONE)),
      this.care.overviewForCrm(auth),
      pool.query<SurveyRow>(surveysSql()),
      pool.query<ReferralRow>(referralsSql()),
      pool.query<{ id: string; name: string }>(customersSql()),
      pool.query<{ display_name: string; id: string }>(assigneesSql()),
      this.surveySources(pool),
      pool.query<WarrantyCardReconciliationCountRow>(warrantyCardReconciliationCountsSql()),
      pool.query<WarrantyCoverageOfferRow>(
        warrantyCoverageOffersSql(this.environment.BUSINESS_TIMEZONE),
      ),
    ]);
    const mappedSurveys = surveys.rows.map(mapSurvey);
    const reconciliationCounts = reconciliation.rows[0];
    return {
      assignees: assignees.rows.map((row) => ({ displayName: row.display_name, id: row.id })),
      businessTimezone: this.environment.BUSINESS_TIMEZONE,
      claims: serviceCare.claims,
      customers: customers.rows,
      coverageOffers: coverageOffers.rows.map(mapWarrantyCoverageOffer),
      nps: npsSummary(mappedSurveys, this.environment.BUSINESS_TIMEZONE),
      referrals: referrals.rows.map(mapReferral),
      surveySources: sources,
      surveys: mappedSurveys,
      warrantyCardReconciliation: {
        eligibleSoldSerials: Number(reconciliationCounts?.eligible_sold_serials ?? 0),
        missingCards: Number(reconciliationCounts?.missing_cards ?? 0),
        registeredSoldSerials: Number(reconciliationCounts?.registered_sold_serials ?? 0),
      },
      warrantyCards: cards.rows.map(mapWarrantyCard),
    };
  }

  reconcileWarrantyCards(
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmWarrantyCardReconciliationResult> {
    return this.command(
      'crm.warranty-cards.reconcile',
      key,
      {},
      HttpStatus.OK,
      async (client, commandKey) => {
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtextextended('crm.warranty-cards.reconcile', 0))`,
        );
        const candidates =
          await client.query<WarrantyCardReconciliationCandidate>(missingWarrantyCardsSql());
        let cardsCreated = 0;
        for (const candidate of candidates.rows) {
          const id = randomUUID();
          const number = await this.allocateNumber(client, 'warranty_card', 'WCR');
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO crm.warranty_cards (
               id, card_number, customer_partner_id, customer_location_id,
               customer_equipment_id, handover_certificate_id, pos_sale_id,
               warranty_starts_on, warranty_ends_on, issued_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (customer_equipment_id) DO NOTHING
             RETURNING id`,
            [
              id,
              number,
              candidate.customer_partner_id,
              candidate.customer_location_id,
              candidate.customer_equipment_id,
              candidate.handover_certificate_id,
              candidate.pos_sale_id,
              candidate.warranty_starts_on,
              candidate.warranty_ends_on,
              candidate.issued_by,
            ],
          );
          if (!inserted.rowCount) continue;
          const card = await this.loadWarrantyCard(client, id);
          await this.sideEffects(
            client,
            'crm_warranty_card',
            id,
            'crm.warranty-card.issued',
            card,
            commandKey,
            auth,
            metadata,
          );
          cardsCreated += 1;
        }
        return { cardsCreated };
      },
    );
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

  createWarrantyCoverageOffer(
    warrantyCardId: string,
    input: CreateCrmWarrantyCoverageOfferRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmWarrantyCoverageOffer> {
    const normalized = normalizeWarrantyCoverageOffer(input);
    return this.command(
      `crm.warranty-coverage-offer.create:${warrantyCardId}`,
      key,
      normalized,
      HttpStatus.CREATED,
      async (client, commandKey) => {
        const card = await this.loadWarrantyCard(client, warrantyCardId, true);
        if (card.status !== 'active')
          throw new ApiErrorException(
            'CRM_WARRANTY_OFFER_COVERAGE_EXPIRED',
            'A coverage offer can only be prepared while the current warranty is active.',
            HttpStatus.CONFLICT,
          );
        const today = await client.query<{ business_date: string }>(
          `SELECT (now() AT TIME ZONE $1)::date::text AS business_date`,
          [this.environment.BUSINESS_TIMEZONE],
        );
        const businessDate = today.rows[0]?.business_date;
        if (
          !businessDate ||
          normalized.validUntil < businessDate ||
          normalized.coverageStartsOn < businessDate
        )
          throw badRequest(
            'CRM_WARRANTY_OFFER_DATE_INVALID',
            'Use a current or future coverage start date and an offer expiry date that has not passed.',
          );
        if (
          normalized.offerType === 'extended_warranty' &&
          normalized.coverageStartsOn <= card.warrantyEndsOn
        )
          throw badRequest(
            'CRM_WARRANTY_OFFER_START_INVALID',
            'Extended coverage must start after the current warranty ends.',
          );

        const id = randomUUID();
        const number = await this.allocateNumber(client, 'warranty_coverage_offer', 'WOF');
        await client.query(
          `INSERT INTO crm.warranty_coverage_offers (
             id, offer_number, warranty_card_id, customer_partner_id,
             customer_equipment_id, customer_name, device_name, serial_number,
             current_warranty_ends_on, offer_type, coverage_starts_on,
             duration_months, visit_frequency_months, quoted_amount, terms,
             valid_until, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
          [
            id,
            number,
            card.id,
            card.customerPartnerId,
            card.customerEquipmentId,
            card.customerName,
            card.deviceName,
            card.serialNumber,
            card.warrantyEndsOn,
            normalized.offerType,
            normalized.coverageStartsOn,
            normalized.durationMonths,
            normalized.visitFrequencyMonths ?? null,
            normalized.quotedAmount,
            normalized.terms,
            normalized.validUntil,
            auth.accountId,
          ],
        );
        const offer = await this.loadWarrantyCoverageOffer(client, id);
        await this.sideEffects(
          client,
          'crm_warranty_coverage_offer',
          id,
          'crm.warranty-coverage-offer.created',
          offer,
          commandKey,
          auth,
          metadata,
        );
        return offer;
      },
    );
  }

  transitionWarrantyCoverageOffer(
    id: string,
    input: TransitionCrmWarrantyCoverageOfferRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmWarrantyCoverageOffer> {
    const normalized = { nextStatus: input.nextStatus };
    return this.command(
      `crm.warranty-coverage-offer.transition:${id}`,
      key,
      normalized,
      HttpStatus.OK,
      async (client, commandKey) => {
        const before = await this.loadWarrantyCoverageOffer(client, id, true);
        if (before.status === 'expired')
          throw new ApiErrorException(
            'CRM_WARRANTY_OFFER_EXPIRED',
            'This offer has expired and can no longer be updated.',
            HttpStatus.CONFLICT,
          );
        if (before.status === normalized.nextStatus) return before;
        const allowed =
          (before.status === 'draft' && normalized.nextStatus === 'offered') ||
          (before.status === 'offered' &&
            (normalized.nextStatus === 'accepted' || normalized.nextStatus === 'declined'));
        if (!allowed)
          throw new ApiErrorException(
            'CRM_WARRANTY_OFFER_TRANSITION_INVALID',
            'Record the offer as shared before recording the customer’s decision.',
            HttpStatus.CONFLICT,
          );
        await client.query(
          `UPDATE crm.warranty_coverage_offers
           SET status = $2, updated_by = $3, updated_at = now() WHERE id = $1`,
          [id, normalized.nextStatus, auth.accountId],
        );
        const after = await this.loadWarrantyCoverageOffer(client, id);
        await this.sideEffects(
          client,
          'crm_warranty_coverage_offer',
          id,
          'crm.warranty-coverage-offer.status-changed',
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
    const normalized = {
      recipientEmail: input.recipientEmail.trim().toLowerCase(),
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
    };
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
        if (!source.recipientEmails.includes(normalized.recipientEmail))
          throw badRequest(
            'CRM_SURVEY_RECIPIENT_INVALID',
            'Choose an active email address listed for this customer.',
          );
        const id = randomUUID();
        const number = await this.allocateNumber(client, 'survey', 'SUR');
        const responseToken = randomBytes(32).toString('base64url');
        const tokenHash = createHash('sha256').update(responseToken).digest('hex');
        const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        const responseUrl = `${this.operationsBaseUrl()}/survey/${responseToken}?lang=bg`;
        const notification = await queueEmailMessage(client, {
          idempotencyKey: `crm.customer-survey:${id}`,
          recipient: normalized.recipientEmail,
          subject: 'Vista Service | Моля, споделете мнението си',
          text: customerSurveyEmail(responseUrl, expiresAt),
        });
        try {
          await client.query(
            `INSERT INTO crm.customer_surveys (
             id, survey_number, customer_partner_id, customer_location_id, source_kind,
             handover_certificate_id, service_work_order_id, response_token_hash,
             response_expires_at, recipient_email, email_notification_id, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
            [
              id,
              number,
              source.customerPartnerId,
              source.customerLocationId,
              normalized.sourceKind,
              normalized.sourceKind === 'delivery' ? normalized.sourceId : null,
              normalized.sourceKind === 'service' ? normalized.sourceId : null,
              tokenHash,
              expiresAt,
              normalized.recipientEmail,
              notification.id,
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
    validateSurveyResponse(input.score, comment);
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

  async publicSurvey(token: string): Promise<CrmPublicSurvey> {
    const tokenHash = surveyTokenHash(token);
    const result = await this.database.getPool().query<PublicSurveyRow>(
      `SELECT survey.survey_number, survey.source_kind, survey.status,
              survey.score, survey.response_expires_at
       FROM crm.customer_surveys survey
       WHERE survey.response_token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row)
      throw new ApiErrorException(
        'CRM_SURVEY_LINK_INVALID',
        'This survey link is not valid.',
        HttpStatus.NOT_FOUND,
      );
    return mapPublicSurvey(row);
  }

  async submitPublicSurvey(
    token: string,
    input: RecordCrmSurveyResponseRequest,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmPublicSurvey> {
    const tokenHash = surveyTokenHash(token);
    const comment = input.comment?.trim();
    validateSurveyResponse(input.score, comment);
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<PublicSurveyRow & { id: string }>(
        `SELECT survey.id, survey.survey_number, survey.source_kind, survey.status,
                survey.score, survey.response_expires_at
         FROM crm.customer_surveys survey
         WHERE survey.response_token_hash = $1
         FOR UPDATE`,
        [tokenHash],
      );
      const survey = result.rows[0];
      if (!survey)
        throw new ApiErrorException(
          'CRM_SURVEY_LINK_INVALID',
          'This survey link is not valid.',
          HttpStatus.NOT_FOUND,
        );
      if (survey.status === 'responded') {
        await client.query('COMMIT');
        return mapPublicSurvey(survey);
      }
      if (new Date(survey.response_expires_at).getTime() <= Date.now())
        throw new ApiErrorException(
          'CRM_SURVEY_LINK_EXPIRED',
          'This survey link has expired.',
          HttpStatus.GONE,
        );

      await client.query(
        `UPDATE crm.customer_surveys
         SET status = 'responded', score = $2, comment = $3,
             responded_at = now(), updated_at = now()
         WHERE id = $1`,
        [survey.id, input.score, comment || null],
      );
      const after = {
        number: survey.survey_number,
        score: input.score,
        sourceKind: survey.source_kind,
        status: 'responded',
      };
      await client.query(
        `INSERT INTO integration.outbox_events (
           id, aggregate_type, aggregate_id, event_type, event_version,
           correlation_id, idempotency_key, payload
         ) VALUES ($1,'crm_customer_survey',$2,'crm.customer-survey.response-recorded',1,$3,$4,$5)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          randomUUID(),
          survey.id,
          metadata.correlationId,
          `crm.customer-survey.public-response:${survey.id}`,
          after,
        ],
      );
      await this.audit.append(
        {
          action: 'crm.customer-survey.public-response-recorded',
          after: { score: input.score, status: 'responded' },
          before: { status: 'awaiting_response' },
          correlationId: metadata.correlationId,
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          targetId: survey.id,
          targetType: 'crm_customer_survey',
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          metadata: { responseChannel: 'public_email_link' },
        },
        client,
      );
      await client.query('COMMIT');
      return {
        expiresAt: iso(survey.response_expires_at),
        number: survey.survey_number,
        score: input.score,
        sourceKind: survey.source_kind,
        status: 'responded',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private operationsBaseUrl(): string {
    const origins = this.environment.CORS_ORIGINS;
    const operationsOrigin = origins.find((origin) => {
      const { hostname, port } = new URL(origin);
      return (
        hostname.startsWith('vista-ops.') || hostname.includes('operations') || port === '5173'
      );
    });
    return (operationsOrigin ?? origins[0] ?? 'http://localhost:5173').replace(/\/$/u, '');
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
    const result = await queryable.query<SurveySourceRow>(
      `SELECT certificate.id, certificate.customer_partner_id,
              certificate.customer_location_id, partner.display_name AS customer_name,
              'delivery'::text AS source_kind,
              certificate.certificate_number || ' · accepted delivery' AS label,
              emails.recipient_emails
       FROM sales.handover_certificates certificate
       JOIN master_data.partners partner ON partner.id = certificate.customer_partner_id
       CROSS JOIN LATERAL (
         SELECT COALESCE(array_agg(contact.email ORDER BY contact.email), ARRAY[]::text[])
           AS recipient_emails
         FROM (
           SELECT DISTINCT lower(btrim(email)) AS email
           FROM master_data.partner_contacts
           WHERE partner_id = certificate.customer_partner_id AND active
             AND email IS NOT NULL AND btrim(email) <> ''
         ) contact
       ) emails
       LEFT JOIN crm.customer_surveys survey ON survey.handover_certificate_id = certificate.id
       WHERE certificate.status = 'accepted' AND certificate.customer_location_id IS NOT NULL
         AND survey.id IS NULL
       UNION ALL
       SELECT work_order.id, request.customer_partner_id, request.customer_location_id,
              partner.display_name AS customer_name, 'service'::text AS source_kind,
              work_order.work_order_number || ' · completed Service job' AS label,
              emails.recipient_emails
       FROM service.work_orders work_order
       JOIN service.requests request ON request.id = work_order.service_request_id
       JOIN master_data.partners partner ON partner.id = request.customer_partner_id
       CROSS JOIN LATERAL (
         SELECT COALESCE(array_agg(contact.email ORDER BY contact.email), ARRAY[]::text[])
           AS recipient_emails
         FROM (
           SELECT DISTINCT lower(btrim(email)) AS email
           FROM master_data.partner_contacts
           WHERE partner_id = request.customer_partner_id AND active
             AND email IS NOT NULL AND btrim(email) <> ''
         ) contact
       ) emails
       LEFT JOIN crm.customer_surveys survey ON survey.service_work_order_id = work_order.id
       WHERE work_order.status = 'completed' AND request.customer_location_id IS NOT NULL
         AND survey.id IS NULL
       ORDER BY customer_name, label`,
    );
    return result.rows.map((row) => ({
      customerLocationId: row.customer_location_id,
      customerName: row.customer_name,
      customerPartnerId: row.customer_partner_id,
      id: row.id,
      label: row.label,
      recipientEmails: row.recipient_emails,
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
    if (!source) {
      const sourceColumn =
        kind === 'delivery' ? 'handover_certificate_id' : 'service_work_order_id';
      const existingSurvey = await queryable.query<{ id: string }>(
        `SELECT id FROM crm.customer_surveys WHERE ${sourceColumn} = $1 LIMIT 1`,
        [id],
      );
      if (existingSurvey.rowCount)
        throw new ApiErrorException(
          'CRM_SURVEY_ALREADY_SENT',
          'A survey has already been recorded for this work.',
          HttpStatus.CONFLICT,
        );
      throw badRequest(
        'CRM_SURVEY_SOURCE_UNAVAILABLE',
        'Choose completed work that has not already received a survey.',
      );
    }
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

  private async loadWarrantyCoverageOffer(
    queryable: Queryable,
    id: string,
    lock = false,
  ): Promise<CrmWarrantyCoverageOffer> {
    if (lock) {
      const locked = await queryable.query(
        'SELECT id FROM crm.warranty_coverage_offers WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!locked.rowCount)
        throw new ApiErrorException(
          'CRM_WARRANTY_COVERAGE_OFFER_NOT_FOUND',
          'The coverage offer was not found.',
          HttpStatus.NOT_FOUND,
        );
    }
    const result = await queryable.query<WarrantyCoverageOfferRow>(
      warrantyCoverageOffersSql(this.environment.BUSINESS_TIMEZONE, 'WHERE offer.id = $1'),
      [id],
    );
    const row = result.rows[0];
    if (!row)
      throw new ApiErrorException(
        'CRM_WARRANTY_COVERAGE_OFFER_NOT_FOUND',
        'The coverage offer was not found.',
        HttpStatus.NOT_FOUND,
      );
    return mapWarrantyCoverageOffer(row);
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

function warrantyCoverageOffersSql(timezone: string, where = '') {
  const safeTimezone = timezone.replaceAll("'", "''");
  return `SELECT offer.id, offer.offer_number, offer.warranty_card_id,
    offer.customer_partner_id, offer.customer_name, offer.device_name,
    offer.serial_number, offer.current_warranty_ends_on::text AS warranty_ends_on,
    offer.offer_type, offer.coverage_starts_on::text, offer.duration_months,
    offer.visit_frequency_months, offer.quoted_amount::text, offer.currency_code,
    offer.terms, offer.valid_until::text, offer.created_at,
    CASE
      WHEN offer.status IN ('draft', 'offered')
        AND offer.valid_until < (now() AT TIME ZONE '${safeTimezone}')::date
        THEN 'expired'
      ELSE offer.status
    END AS effective_status
  FROM crm.warranty_coverage_offers offer
  ${where}
  ORDER BY offer.created_at DESC, offer.id DESC`;
}

function warrantyCardReconciliationCountsSql() {
  return `${eligibleWarrantyCardsCte()}
  SELECT count(*)::text AS eligible_sold_serials,
         count(card.id)::text AS registered_sold_serials,
         count(*) FILTER (WHERE card.id IS NULL)::text AS missing_cards
  FROM eligible_warranties eligible
  LEFT JOIN crm.warranty_cards card
    ON card.customer_equipment_id = eligible.customer_equipment_id`;
}

function missingWarrantyCardsSql() {
  return `${eligibleWarrantyCardsCte()}
  SELECT eligible.customer_equipment_id, eligible.customer_location_id,
         eligible.customer_partner_id, eligible.handover_certificate_id,
         eligible.issued_by, eligible.pos_sale_id,
         eligible.warranty_ends_on, eligible.warranty_starts_on
  FROM eligible_warranties eligible
  WHERE NOT EXISTS (
    SELECT 1 FROM crm.warranty_cards card
    WHERE card.customer_equipment_id = eligible.customer_equipment_id
  )
  ORDER BY eligible.customer_equipment_id
  LIMIT 100`;
}

function eligibleWarrantyCardsCte() {
  return `WITH source_candidates AS (
    SELECT equipment.id AS customer_equipment_id,
           sale.customer_partner_id, sale.completed_by AS issued_by,
           sale.id AS pos_sale_id, NULL::uuid AS handover_certificate_id,
           0 AS source_priority, sale.id AS source_id
    FROM master_data.customer_equipment equipment
    JOIN pos.sales sale ON sale.id = equipment.source_pos_sale_id
    WHERE sale.status = 'completed' AND sale.customer_partner_id IS NOT NULL
    UNION ALL
    SELECT equipment.id AS customer_equipment_id,
           certificate.customer_partner_id, certificate.prepared_by AS issued_by,
           NULL::uuid AS pos_sale_id, certificate.id AS handover_certificate_id,
           1 AS source_priority, certificate.id AS source_id
    FROM sales.handover_certificates certificate
    JOIN sales.handover_certificate_lines line
      ON line.certificate_id = certificate.id
    CROSS JOIN LATERAL unnest(line.serial_numbers) selected(serial_number)
    JOIN master_data.customer_equipment equipment
      ON upper(equipment.serial_number) = upper(selected.serial_number)
     AND (equipment.product_id IS NULL OR equipment.product_id = line.product_id)
    WHERE certificate.status = 'accepted'
  ), eligible_warranties AS (
    SELECT DISTINCT ON (equipment.id)
           equipment.id AS customer_equipment_id,
           equipment.customer_location_id, location.partner_id AS customer_partner_id,
           source.handover_certificate_id, source.issued_by, source.pos_sale_id,
           equipment.warranty_start_date::text AS warranty_starts_on,
           equipment.warranty_end_date::text AS warranty_ends_on
    FROM source_candidates source
    JOIN master_data.customer_equipment equipment
      ON equipment.id = source.customer_equipment_id
    JOIN master_data.customer_locations location
      ON location.id = equipment.customer_location_id
     AND location.partner_id = source.customer_partner_id
    WHERE equipment.warranty_end_date IS NOT NULL
    ORDER BY equipment.id, source.source_priority, source.source_id
  )`;
}

function surveysSql(where = '') {
  return `SELECT survey.id, survey.survey_number, survey.customer_partner_id,
    partner.display_name AS customer_name, survey.source_kind, survey.status,
    survey.score, survey.comment, survey.sent_at, survey.responded_at,
    survey.recipient_email,
    notification.status AS delivery_status,
    CASE WHEN survey.source_kind = 'delivery' THEN handover.certificate_number
         ELSE work_order.work_order_number END AS source_label
  FROM crm.customer_surveys survey
  JOIN master_data.partners partner ON partner.id = survey.customer_partner_id
  LEFT JOIN notifications.messages notification ON notification.id = survey.email_notification_id
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

function mapWarrantyCoverageOffer(row: WarrantyCoverageOfferRow): CrmWarrantyCoverageOffer {
  return {
    coverageStartsOn: row.coverage_starts_on,
    createdAt: iso(row.created_at),
    currencyCode: row.currency_code,
    customerName: row.customer_name,
    customerPartnerId: row.customer_partner_id,
    deviceName: row.device_name,
    durationMonths: Number(row.duration_months),
    id: row.id,
    number: row.offer_number,
    offerType: row.offer_type,
    quotedAmount: row.quoted_amount,
    serialNumber: row.serial_number,
    status: row.effective_status,
    terms: row.terms,
    validUntil: row.valid_until,
    ...(row.visit_frequency_months === null
      ? {}
      : { visitFrequencyMonths: Number(row.visit_frequency_months) }),
    warrantyCardId: row.warranty_card_id,
    warrantyEndsOn: row.warranty_ends_on,
  };
}

function mapSurvey(row: SurveyRow): CrmCustomerSurvey {
  return {
    ...(row.comment ? { comment: row.comment } : {}),
    customerName: row.customer_name,
    customerPartnerId: row.customer_partner_id,
    ...(row.delivery_status ? { deliveryStatus: row.delivery_status } : {}),
    ...(row.recipient_email ? { recipientEmail: row.recipient_email } : {}),
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

function mapPublicSurvey(row: PublicSurveyRow): CrmPublicSurvey {
  const expiresAt = iso(row.response_expires_at);
  const status =
    row.status === 'responded'
      ? 'responded'
      : new Date(expiresAt).getTime() <= Date.now()
        ? 'expired'
        : 'awaiting_response';
  return {
    expiresAt,
    number: row.survey_number,
    ...(row.score === null ? {} : { score: row.score }),
    sourceKind: row.source_kind,
    status,
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

function normalizeWarrantyCoverageOffer(input: CreateCrmWarrantyCoverageOfferRequest) {
  const terms = input.terms.trim();
  if (!['extended_warranty', 'service_plan'].includes(input.offerType))
    throw badRequest('CRM_WARRANTY_OFFER_TYPE_INVALID', 'Choose an offer type.');
  if (
    !Number.isInteger(input.durationMonths) ||
    input.durationMonths < 1 ||
    input.durationMonths > 120
  )
    throw badRequest(
      'CRM_WARRANTY_OFFER_DURATION_INVALID',
      'Choose a duration from 1 to 120 months.',
    );
  if (
    !/^\d{1,12}\.\d{2}$/u.test(input.quotedAmount) ||
    BigInt(input.quotedAmount.replace('.', '')) <= 0n
  )
    throw badRequest(
      'CRM_WARRANTY_OFFER_AMOUNT_INVALID',
      'Enter a EUR amount greater than zero, to two decimal places.',
    );
  if (!isDateOnly(input.coverageStartsOn) || !isDateOnly(input.validUntil))
    throw badRequest(
      'CRM_WARRANTY_OFFER_DATE_INVALID',
      'Enter valid coverage and offer expiry dates.',
    );
  if (terms.length < 10 || terms.length > 2000)
    throw badRequest(
      'CRM_WARRANTY_OFFER_TERMS_INVALID',
      'Describe the offer in 10 to 2,000 characters.',
    );
  if (
    input.offerType === 'service_plan' &&
    (!Number.isInteger(input.visitFrequencyMonths) ||
      (input.visitFrequencyMonths ?? 0) < 1 ||
      (input.visitFrequencyMonths ?? 0) > input.durationMonths)
  )
    throw badRequest(
      'CRM_WARRANTY_OFFER_FREQUENCY_INVALID',
      'For a Service plan, choose a visit frequency within the plan duration.',
    );
  if (input.offerType === 'extended_warranty' && input.visitFrequencyMonths !== undefined)
    throw badRequest(
      'CRM_WARRANTY_OFFER_FREQUENCY_INVALID',
      'Visit frequency applies only to a Service plan offer.',
    );
  return {
    coverageStartsOn: input.coverageStartsOn,
    durationMonths: input.durationMonths,
    offerType: input.offerType,
    quotedAmount: input.quotedAmount,
    terms,
    validUntil: input.validUntil,
    ...(input.visitFrequencyMonths === undefined
      ? {}
      : { visitFrequencyMonths: input.visitFrequencyMonths }),
  };
}

function isDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
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

function surveyTokenHash(token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token))
    throw new ApiErrorException(
      'CRM_SURVEY_LINK_INVALID',
      'This survey link is not valid.',
      HttpStatus.NOT_FOUND,
    );
  return createHash('sha256').update(token).digest('hex');
}

function validateSurveyResponse(score: number, comment?: string): void {
  if (!Number.isInteger(score) || score < 0 || score > 10)
    throw badRequest('CRM_SURVEY_SCORE_INVALID', 'Choose a score from 0 to 10.');
  if (comment && comment.length > 2000)
    throw badRequest('CRM_SURVEY_COMMENT_INVALID', 'Keep the feedback within 2,000 characters.');
}

function customerSurveyEmail(responseUrl: string, expiresAt: Date): string {
  const expiry = new Intl.DateTimeFormat('bg-BG', {
    dateStyle: 'long',
    timeZone: 'Europe/Sofia',
  }).format(expiresAt);
  return [
    'Здравейте,',
    '',
    'Моля, отделете минута, за да оцените обслужването на Vista Service.',
    'Каква е вероятността да препоръчате Vista Service? Оценката е от 0 до 10.',
    responseUrl,
    `Линкът е активен до ${expiry}.`,
    '',
    'Hello,',
    '',
    'Please take a minute to rate your experience with Vista Service.',
    'How likely are you to recommend Vista Service? Choose a score from 0 to 10.',
    'The survey page can be switched to English or Bulgarian.',
    `This link is available until ${expiry}.`,
    '',
    'Vista Service',
  ].join('\n');
}

function iso(value: Date | string) {
  return new Date(value).toISOString();
}

function isUniqueViolation(error: unknown): error is { code: '23505' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
