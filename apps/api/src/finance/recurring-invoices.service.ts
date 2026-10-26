import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hasPermission, type Permission } from '@vista/auth';
import type { AppEnvironment } from '@vista/config';
import type {
  RecurringInvoiceContract,
  RecurringInvoicePage,
  RecurringInvoicePeriod,
  RecurringInvoiceProcessResult,
  RecurringInvoiceProfileInput,
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
import { SalesSubscriptionsService } from '../sales/sales-subscriptions.service.js';
import { FinancialDocumentsService } from './financial-documents.service.js';
import type { RecurringInvoiceQueryDto } from './recurring-invoices.dto.js';

type Context = {
  correlationId: string;
  jobId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};
type Result = 'issued' | 'needs_review' | 'retry' | 'skipped';

@Injectable()
export class RecurringInvoicesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FinancialDocumentsService) private readonly documents: FinancialDocumentsService,
    @Inject(SalesSubscriptionsService) private readonly subscriptions: SalesSubscriptionsService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async list(query: RecurringInvoiceQueryDto): Promise<RecurringInvoicePage> {
    const search = `%${(query.search ?? '').trim().replace(/[\\%_]/gu, '\\$&')}%`;
    const where = `WHERE contract.contract_number ILIKE $1 OR customer.display_name ILIKE $1`;
    const count = await this.database.getPool().query<{ total: number }>(
      `SELECT count(*)::int AS total FROM sales.service_subscription_contracts contract
       JOIN master_data.partners customer ON customer.id = contract.customer_partner_id ${where}`,
      [search],
    );
    const ids = await this.database.getPool().query<{ id: string }>(
      `SELECT contract.id FROM sales.service_subscription_contracts contract
       JOIN master_data.partners customer ON customer.id = contract.customer_partner_id ${where}
       ORDER BY contract.created_at DESC, contract.id LIMIT $2 OFFSET $3`,
      [search, query.pageSize, (query.page - 1) * query.pageSize],
    );
    const totalItems = count.rows[0]!.total;
    return {
      items: await Promise.all(ids.rows.map((row) => this.record(row.id))),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
    };
  }

  async record(id: string, transaction?: PoolClient): Promise<RecurringInvoiceContract> {
    const client = transaction ?? this.database.getPool();
    const row = (
      await client.query<RecurringInvoiceContract>(
        `SELECT contract.id, contract.contract_number AS "number", customer.display_name AS "customerName",
       location.name AS "customerLocationName", contract.active, contract.billing_amount::text AS "billingAmount",
       contract.currency_code AS "currencyCode", contract.billing_frequency_months AS "billingFrequencyMonths",
       contract.next_invoice_date::text AS "nextBillingDate", contract.version AS "contractVersion",
       CASE WHEN profile.contract_id IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
         'enabled',profile.enabled,'legalEntityId',profile.legal_entity_id,'businessLocationId',profile.business_location_id,
         'cashRegisterId',profile.cash_register_id,'operatorId',profile.operator_id,
         'firstBillingDate',profile.first_billing_date::text,'paymentTermsDays',profile.payment_terms_days,
         'vatTreatment',profile.vat_treatment,'vatRate',profile.vat_rate::text,
         'contractVersion',profile.approved_contract_version,'version',profile.version,
         'approvedByName',employee.display_name,'updatedAt',profile.updated_at)) END AS profile
       FROM sales.service_subscription_contracts contract
       JOIN master_data.partners customer ON customer.id = contract.customer_partner_id
       JOIN master_data.customer_locations location ON location.id = contract.customer_location_id
       LEFT JOIN finance.recurring_invoice_profiles profile ON profile.contract_id = contract.id
       LEFT JOIN identity.user_accounts account ON account.id = profile.approved_by
       LEFT JOIN identity.employees employee ON employee.id = account.employee_id WHERE contract.id = $1`,
        [id],
      )
    ).rows[0];
    if (!row)
      throw failure('RECURRING_CONTRACT_NOT_FOUND', 'This subscription was not found.', 404);
    const periods = (
      await client.query<RecurringInvoicePeriod>(
        `SELECT draft.id, draft.billing_date::text AS "billingDate", draft.service_period_start::text AS "servicePeriodStart",
        draft.service_period_end::text AS "servicePeriodEnd", draft.amount::text, draft.currency_code AS "currencyCode",
        CASE WHEN document.status='issued' THEN 'issued' WHEN document.status='draft' THEN 'manual_review'
          ELSE coalesce(run.status,'waiting') END AS status, run.error_code AS "errorCode",
        CASE WHEN document.id IS NULL THEN NULL ELSE jsonb_build_object('id',document.id,
          'number',coalesce(document.official_number,document.draft_number)) END AS document
       FROM sales.subscription_invoice_drafts draft
       LEFT JOIN finance.recurring_invoice_runs run ON run.billing_draft_id=draft.id
       LEFT JOIN finance.financial_documents document ON document.source_subscription_draft_id=draft.id AND document.status<>'cancelled'
       WHERE draft.contract_id=$1 ORDER BY draft.billing_date DESC,draft.id DESC LIMIT 12`,
        [id],
      )
    ).rows;
    const { profile, ...record } = row;
    return {
      ...record,
      ...(profile ? { profile } : {}),
      periods: periods.map(({ document, errorCode, ...period }) => ({
        ...period,
        ...(document ? { document } : {}),
        ...(errorCode ? { errorCode } : {}),
      })),
    };
  }

  async save(
    id: string,
    input: RecurringInvoiceProfileInput,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<RecurringInvoiceContract> {
    return this.command(`finance.recurring.profile:${id}`, key, input, async (client) => {
      const contract = (
        await client.query<{
          version: number;
          customer_partner_id: string;
          active: boolean;
          billing_amount: string;
          valid_from: string;
          valid_to: string | null;
        }>(
          `SELECT version,customer_partner_id,active,billing_amount::text,valid_from::text,valid_to::text
         FROM sales.service_subscription_contracts WHERE id=$1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!contract)
        throw failure('RECURRING_CONTRACT_NOT_FOUND', 'This subscription was not found.', 404);
      const current = await this.record(id, client);
      if (
        contract.version !== input.contractVersion ||
        current.profile?.version !== input.expectedVersion
      )
        throw failure(
          'RECURRING_VERSION_CONFLICT',
          'This subscription or its invoicing settings changed. Refresh and review them again.',
          409,
        );
      const today = this.today();
      if (
        !/^\d{4}-\d{2}-\d{2}$/u.test(input.firstBillingDate) ||
        input.firstBillingDate < contract.valid_from ||
        (contract.valid_to && input.firstBillingDate > contract.valid_to) ||
        (input.firstBillingDate < today &&
          input.firstBillingDate !== current.profile?.firstBillingDate)
      )
        throw failure(
          'RECURRING_START_DATE_INVALID',
          'Start automatic invoicing today or later, within the subscription period. Earlier billing records remain available for manual review.',
          400,
        );
      if (input.enabled && (!contract.active || !/[1-9]/u.test(contract.billing_amount)))
        throw failure(
          'RECURRING_CONTRACT_UNAVAILABLE',
          'Choose an active subscription with a positive charge.',
          400,
        );
      if (input.vatTreatment === 'ica' && (!input.vatRate || Number(input.vatRate) > 100))
        throw failure(
          'RECURRING_VAT_RATE_REQUIRED',
          'Enter the VAT rate for intra-community acquisition.',
          400,
        );
      await this.documents.validateRecurringSetup(client, input, contract.customer_partner_id);
      await client.query(
        `INSERT INTO finance.recurring_invoice_profiles (
        contract_id,enabled,legal_entity_id,business_location_id,cash_register_id,operator_id,
        first_billing_date,payment_terms_days,vat_treatment,vat_rate,approved_contract_version,approved_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(contract_id) DO UPDATE SET enabled=excluded.enabled,legal_entity_id=excluded.legal_entity_id,
        business_location_id=excluded.business_location_id,cash_register_id=excluded.cash_register_id,
        operator_id=excluded.operator_id,first_billing_date=excluded.first_billing_date,
        payment_terms_days=excluded.payment_terms_days,vat_treatment=excluded.vat_treatment,vat_rate=excluded.vat_rate,
        approved_contract_version=excluded.approved_contract_version,approved_by=excluded.approved_by,
        version=finance.recurring_invoice_profiles.version+1,updated_at=now()`,
        [
          id,
          input.enabled,
          input.legalEntityId,
          input.businessLocationId,
          input.cashRegisterId ?? null,
          input.operatorId ?? null,
          input.firstBillingDate,
          input.paymentTermsDays,
          input.vatTreatment,
          input.vatTreatment === 'ica' ? input.vatRate : null,
          contract.version,
          auth.accountId,
        ],
      );
      const result = await this.record(id, client);
      await this.audit.append(
        {
          action: 'finance.recurring-invoices.configured',
          actorAccountId: auth.accountId,
          targetType: 'service_subscription_contract',
          targetId: id,
          correlationId: metadata.correlationId,
          ...(current.profile ? { before: { ...current.profile } } : {}),
          after: { ...result.profile },
        },
        client,
      );
      return result;
    });
  }

  async runNext(
    id: string,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<RecurringInvoiceProcessResult> {
    requireKey(key);
    const scope = `finance.recurring.run:${id}`;
    const payload = { contractId: id, actorId: auth.accountId };
    const replay = (
      await this.database.getPool().query<{
        request_hash: string;
        status: string;
        response_body: RecurringInvoiceProcessResult;
      }>('SELECT request_hash,status,response_body FROM platform.idempotency_keys WHERE scope=$1 AND idempotency_key=$2', [scope, key])
    ).rows[0];
    if (replay) {
      if (
        replay.request_hash !== createHash('sha256').update(JSON.stringify(payload)).digest('hex')
      )
        throw failure(
          'IDEMPOTENCY_KEY_REUSED',
          'This request key has already been used for different details.',
          409,
        );
      if (replay.status === 'completed') return replay.response_body;
    }
    const setup = await this.record(id);
    if (!setup.profile?.enabled)
      throw failure(
        'RECURRING_PROFILE_DISABLED',
        'Enable automatic invoicing for this subscription first.',
        409,
      );
    await this.subscriptions.generateDueInvoiceDrafts({
      correlationId: metadata.correlationId,
      idempotencyKey: `recurring-source:${id}:${this.today()}`,
      jobId: metadata.correlationId,
      payload: { asOf: this.today(), contractId: id },
    });
    return this.command(scope, key, payload, async (client) => {
      const due = await this.due(client, this.today(), id, true, 1);
      const result = emptyResult();
      if (!due[0]) {
        result.skippedCount = 1;
        return result;
      }
      increment(
        result,
        await this.processPeriod(client, due[0].id, due[0].contract_id, metadata.correlationId),
      );
      return result;
    });
  }

  async issueDue(context: Context): Promise<RecurringInvoiceProcessResult> {
    const requested = context.payload['asOf'];
    const date =
      typeof requested === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/u.test(requested) &&
      !Number.isNaN(Date.parse(requested))
        ? requested
        : this.today();
    const asOf = date > this.today() ? this.today() : date;
    const result = emptyResult();
    // Drain every due contract in small batches. Do not retry the same failed or
    // concurrently locked period twice within this job attempt.
    const attempted: string[] = [];
    for (;;) {
      const due = await this.due(this.database.getPool(), asOf, undefined, false, 25, attempted);
      if (!due.length) break;
      for (const period of due) {
        attempted.push(period.id);
        const client = await this.database.getPool().connect();
        try {
          await client.query('BEGIN');
          increment(
            result,
            await this.processPeriod(client, period.id, period.contract_id, context.correlationId),
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
    }
    return result;
  }

  private async due(
    client: Pick<PoolClient, 'query'>,
    asOf: string,
    contractId: string | undefined,
    force: boolean,
    limit: number,
    excluded: string[] = [],
  ) {
    return (
      await client.query<{ id: string; contract_id: string }>(
        `SELECT draft.id,draft.contract_id FROM sales.subscription_invoice_drafts draft
       JOIN sales.service_subscription_contracts contract ON contract.id=draft.contract_id AND contract.active
       JOIN finance.recurring_invoice_profiles profile ON profile.contract_id=contract.id AND profile.enabled
       LEFT JOIN finance.recurring_invoice_runs run ON run.billing_draft_id=draft.id
       WHERE draft.billing_date BETWEEN profile.first_billing_date AND $1::date AND draft.amount>0
         AND ($2::uuid IS NULL OR contract.id=$2)
         AND NOT (draft.id=ANY($5::uuid[]))
         AND (run.billing_draft_id IS NULL OR run.status='retry' OR (run.status<>'issued'
           AND ($3 OR run.profile_version<>profile.version OR run.contract_version<>contract.version)))
       ORDER BY draft.billing_date,draft.id LIMIT $4`,
        [asOf, contractId ?? null, force, limit, excluded],
      )
    ).rows;
  }

  private async processPeriod(
    client: PoolClient,
    draftId: string,
    contractId: string,
    correlationId: string,
  ): Promise<Result> {
    // Match Sales edit/generation lock order. Concurrent runs skip busy contracts.
    const contract = (
      await client.query<{
        version: number;
        valid_from: string;
        valid_to: string | null;
        billing_frequency_months: number;
        customer_partner_id: string;
        customer_location_id: string;
        billing_amount: string;
        currency_code: string;
      }>(
        `SELECT version,customer_partner_id,customer_location_id,billing_amount::text,currency_code,
          valid_from::text,valid_to::text,billing_frequency_months
       FROM sales.service_subscription_contracts WHERE id=$1 AND active FOR UPDATE SKIP LOCKED`,
        [contractId],
      )
    ).rows[0];
    if (!contract) return 'skipped';
    const setup = await this.record(contractId, client);
    const profile = setup.profile;
    if (!profile?.enabled) return 'skipped';
    const period = (
      await client.query<{
        billing_date: string;
        period_matches: boolean;
        amount: string;
        currency_code: string;
        customer_partner_id: string;
        customer_location_id: string;
      }>(
        `SELECT billing_date::text,amount::text,currency_code,customer_partner_id,customer_location_id,
          (service_period_start=billing_date AND service_period_end=(billing_date+make_interval(months=>$3))-interval '1 day') AS period_matches
       FROM sales.subscription_invoice_drafts WHERE id=$1 AND contract_id=$2 FOR UPDATE`,
        [draftId, contractId, contract.billing_frequency_months],
      )
    ).rows[0];
    if (
      !period ||
      period.billing_date < profile.firstBillingDate ||
      period.billing_date > this.today()
    )
      return 'skipped';
    const previous = (
      await client.query<{ status: string; attempt_count: number }>(
        'SELECT status,attempt_count FROM finance.recurring_invoice_runs WHERE billing_draft_id=$1',
        [draftId],
      )
    ).rows[0];
    if (previous?.status === 'issued') return 'skipped';
    const approved = (
      await client.query<{ approved_by: string }>(
        'SELECT approved_by FROM finance.recurring_invoice_profiles WHERE contract_id=$1',
        [contractId],
      )
    ).rows[0]!;
    const permissions = (
      await client.query<Permission>(
        `SELECT DISTINCT permission.module,permission.action
      FROM identity.user_accounts account JOIN identity.employees employee ON employee.id=account.employee_id AND employee.active
      JOIN iam.account_roles role ON role.account_id=account.id JOIN iam.role_permissions selected ON selected.role_id=role.role_id
      JOIN iam.permissions permission ON permission.id=selected.permission_id
      WHERE account.id=$1 AND account.status='active' AND (account.locked_until IS NULL OR account.locked_until<=now())`,
        [approved.approved_by],
      )
    ).rows;
    let status: Result = 'issued';
    let code: string | undefined;
    let documentId: string | undefined;
    await client.query('SAVEPOINT recurring_issue');
    try {
      if (!canIssue(permissions))
        throw failure(
          'RECURRING_ACCESS_CHANGED',
          'The approving account no longer has Finance issuance access.',
          403,
        );
      if (profile.contractVersion !== contract.version)
        throw failure(
          'RECURRING_CONTRACT_CHANGED',
          'Review the changed subscription before issuing more invoices.',
          409,
        );
      if (
        !period.period_matches ||
        period.billing_date < contract.valid_from ||
        (contract.valid_to !== null && period.billing_date > contract.valid_to) ||
        period.customer_partner_id !== contract.customer_partner_id ||
        period.customer_location_id !== contract.customer_location_id ||
        period.currency_code !== contract.currency_code ||
        period.amount !== contract.billing_amount
      )
        throw failure(
          'RECURRING_BILLING_CHANGED',
          'Review this earlier billing record. It differs from the approved subscription.',
          409,
        );
      const existing = (
        await client.query<{ id: string; status: string }>(
          "SELECT id,status FROM finance.financial_documents WHERE source_subscription_draft_id=$1 AND status<>'cancelled'",
          [draftId],
        )
      ).rows[0];
      if (existing?.status === 'issued') documentId = existing.id;
      else {
        if (existing)
          throw failure(
            'FINANCE_RECURRING_MANUAL_DRAFT',
            'Review the existing invoice draft for this period in Financial documents.',
            409,
          );
        const issueDate = this.today();
        const dueDate = (
          await client.query<{ date: string }>('SELECT ($1::date+$2::integer)::text AS date', [
            issueDate,
            profile.paymentTermsDays,
          ])
        ).rows[0]!.date;
        const auth: AuthenticationContext = {
          accountId: approved.approved_by,
          permissions,
          displayName: '',
          email: '',
          employeeId: '',
          sessionId: '',
          isAdministrative: false,
          twoFactorVerified: false,
        };
        const document = await this.documents.create(
          {
            businessLocationId: profile.businessLocationId,
            legalEntityId: profile.legalEntityId,
            ...(profile.cashRegisterId ? { cashRegisterId: profile.cashRegisterId } : {}),
            ...(profile.operatorId ? { operatorId: profile.operatorId } : {}),
            currencyCode: period.currency_code,
            customerPartnerId: period.customer_partner_id,
            documentType: 'invoice',
            dueDate,
            issueDate,
            taxEventDate: period.billing_date,
            exchangeRate: '1',
            rateDate: issueDate,
            rateSource: 'BNB',
            sourceSubscriptionDraftId: draftId,
            lines: [
              {
                description: 'Subscription service',
                quantity: '1',
                unitCode: 'SERVICE',
                unitPrice: period.amount,
                discountPercent: '0',
                vatTreatment: profile.vatTreatment,
                ...(profile.vatRate ? { vatRate: profile.vatRate } : {}),
              },
            ],
          },
          `recurring:${draftId}:v${profile.version}`,
          auth,
          { correlationId },
          { client, issueAutomatically: true },
        );
        documentId = document.id;
      }
      await client.query('RELEASE SAVEPOINT recurring_issue');
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT recurring_issue');
      const payload =
        error instanceof ApiErrorException ? (error.getResponse() as { code?: string }) : undefined;
      code = payload?.code ?? 'RECURRING_PROCESSING_FAILED';
      status =
        error instanceof ApiErrorException && error.getStatus() < 500 ? 'needs_review' : 'retry';
      if (status === 'retry' && (previous?.attempt_count ?? 0) >= 4) status = 'needs_review';
      documentId = undefined;
      await client.query('RELEASE SAVEPOINT recurring_issue');
    }
    await client.query(
      `INSERT INTO finance.recurring_invoice_runs (billing_draft_id,contract_id,profile_version,contract_version,
      status,financial_document_id,attempt_count,error_code) VALUES ($1,$2,$3,$4,$5,$6,1,$7)
      ON CONFLICT(billing_draft_id) DO UPDATE SET profile_version=excluded.profile_version,contract_version=excluded.contract_version,
        status=excluded.status,financial_document_id=excluded.financial_document_id,
        attempt_count=finance.recurring_invoice_runs.attempt_count+1,error_code=excluded.error_code,processed_at=now()`,
      [
        draftId,
        contractId,
        profile.version,
        contract.version,
        status,
        documentId ?? null,
        code ?? null,
      ],
    );
    await this.audit.append(
      {
        action: `finance.recurring-invoice.${status}`,
        actorAccountId: approved.approved_by,
        targetType: 'subscription_invoice_draft',
        targetId: draftId,
        correlationId,
        after: {
          contractId,
          profileVersion: profile.version,
          documentId,
          errorCode: code,
          attempt: (previous?.attempt_count ?? 0) + 1,
        },
      },
      client,
    );
    return status;
  }

  private today() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.environment.BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private async command<T>(
    scope: string,
    key: string | undefined,
    payload: object,
    action: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    requireKey(key);
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO platform.idempotency_keys (scope,idempotency_key,request_hash,status,expires_at)
        VALUES ($1,$2,$3,'processing',now()+interval '24 hours') ON CONFLICT(scope,idempotency_key) DO NOTHING`,
        [scope, key, hash],
      );
      const claim = (
        await client.query<{ request_hash: string; status: string; response_body: T }>(
          'SELECT request_hash,status,response_body FROM platform.idempotency_keys WHERE scope=$1 AND idempotency_key=$2 FOR UPDATE',
          [scope, key],
        )
      ).rows[0]!;
      if (claim.request_hash !== hash)
        throw failure(
          'IDEMPOTENCY_KEY_REUSED',
          'This request key has already been used for different details.',
          409,
        );
      if (claim.status === 'completed') {
        await client.query('COMMIT');
        return claim.response_body;
      }
      const result = await action(client);
      await client.query(
        "UPDATE platform.idempotency_keys SET status='completed',response_status=200,response_body=$3 WHERE scope=$1 AND idempotency_key=$2",
        [scope, key, result],
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
function canIssue(permissions: Permission[]) {
  return ['view', 'create', 'edit'].every((action) =>
    hasPermission(permissions, { module: 'erp.finance', action: action as Permission['action'] }),
  );
}
function emptyResult(): RecurringInvoiceProcessResult {
  return { issuedCount: 0, reviewCount: 0, retryCount: 0, skippedCount: 0 };
}
function increment(result: RecurringInvoiceProcessResult, outcome: Result) {
  result[
    outcome === 'issued'
      ? 'issuedCount'
      : outcome === 'needs_review'
        ? 'reviewCount'
        : outcome === 'retry'
          ? 'retryCount'
          : 'skippedCount'
  ]++;
}
function failure(code: string, message: string, status: number) {
  return new ApiErrorException(code, message, status);
}
function requireKey(key: string | undefined): asserts key is string {
  if (!key || !/^[A-Za-z0-9:._-]{1,180}$/u.test(key))
    throw failure('IDEMPOTENCY_KEY_REQUIRED', 'Provide a valid idempotency key.', 400);
}
