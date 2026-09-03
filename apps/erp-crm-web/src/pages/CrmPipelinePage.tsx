import { Button, InlineAlert, Toast } from '@vista/ui';
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
  PartnerKind,
} from '@vista/contracts';
import {
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { ApiClientError } from '../api/client';
import {
  convertCrmLead,
  createCrmLead,
  createCrmOpportunity,
  getCrmOpportunity,
  getCrmPipelineReferenceData,
  linkCrmOpportunityQuotation,
  listCrmLeads,
  listCrmOpportunities,
  moveCrmOpportunity,
  qualifyCrmLead,
} from '../api/crm-pipeline';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Link } from '../routing/Router';
import { CrmTabs } from './CrmTicketsPage';

const stages: CrmOpportunityStage[] = [
  'new',
  'qualified',
  'quotation_sent',
  'negotiation',
  'won',
  'lost',
];
const leadSources: CrmLeadSource[] = ['telephone', 'referral', 'website', 'trade_exhibition'];
const leadStatuses: CrmLeadStatus[] = ['new', 'qualified', 'converted'];
const stageProbability: Record<CrmOpportunityStage, number> = {
  lost: 0,
  negotiation: 75,
  new: 10,
  qualified: 40,
  quotation_sent: 60,
  won: 100,
};
const emptyReferences: CrmPipelineReferenceData = {
  assignees: [],
  businessTimezone: 'Europe/Sofia',
  customers: [],
  quotations: [],
};
const emptyLeads: CrmLeadPage = {
  items: [],
  page: 1,
  pageSize: 25,
  summary: { converted: 0, new: 0, qualified: 0 },
  total: 0,
  totalPages: 0,
};
const emptyOpportunities: CrmOpportunityPage = {
  items: [],
  page: 1,
  pageSize: 100,
  summary: { openCount: 0, openRevenueBgn: '0', weightedRevenueBgn: '0', wonRevenueBgn: '0' },
  total: 0,
  totalPages: 0,
};

type WorkspaceView = 'leads' | 'pipeline';
type DrawerState =
  | { kind: 'convert'; lead: CrmLead }
  | { kind: 'lead'; lead: CrmLead }
  | { kind: 'new_lead' }
  | { kind: 'new_opportunity' }
  | { kind: 'opportunity'; opportunity: CrmOpportunity };

export function CrmPipelinePage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const canCreate = hasPermission('crm', 'create');
  const canEdit = hasPermission('crm', 'edit');
  const [view, setView] = useState<WorkspaceView>('leads');
  const [references, setReferences] = useState(emptyReferences);
  const [leads, setLeads] = useState(emptyLeads);
  const [opportunities, setOpportunities] = useState(emptyOpportunities);
  const [leadPage, setLeadPage] = useState(1);
  const [leadSearchDraft, setLeadSearchDraft] = useState('');
  const [leadSearch, setLeadSearch] = useState('');
  const [leadStatus, setLeadStatus] = useState<CrmLeadStatus | ''>('');
  const [leadSource, setLeadSource] = useState<CrmLeadSource | ''>('');
  const [pipelineSearchDraft, setPipelineSearchDraft] = useState('');
  const [pipelineSearch, setPipelineSearch] = useState('');
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [loadingReferences, setLoadingReferences] = useState(true);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadingOpportunities, setLoadingOpportunities] = useState(true);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingReferences(true);
    getCrmPipelineReferenceData(token)
      .then((result) => {
        if (active) setReferences(result);
      })
      .catch((caught) => {
        if (active) setError(errorText(caught, 'Customer and team details could not be loaded.'));
      })
      .finally(() => {
        if (active) setLoadingReferences(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const loadLeads = useCallback(async () => {
    setLoadingLeads(true);
    try {
      setLeads(
        await listCrmLeads(token, {
          page: leadPage,
          pageSize: 25,
          ...(leadSearch ? { search: leadSearch } : {}),
          ...(leadSource ? { source: leadSource } : {}),
          ...(leadStatus ? { status: leadStatus } : {}),
        }),
      );
      setError(null);
    } catch (caught) {
      setError(errorText(caught, 'Leads could not be loaded.'));
    } finally {
      setLoadingLeads(false);
    }
  }, [leadPage, leadSearch, leadSource, leadStatus, token]);

  const loadOpportunities = useCallback(async () => {
    setLoadingOpportunities(true);
    try {
      setOpportunities(
        await listCrmOpportunities(token, {
          page: 1,
          pageSize: 200,
          ...(pipelineSearch ? { search: pipelineSearch } : {}),
        }),
      );
      setError(null);
    } catch (caught) {
      setError(errorText(caught, 'The sales pipeline could not be loaded.'));
    } finally {
      setLoadingOpportunities(false);
    }
  }, [pipelineSearch, token]);

  useEffect(() => void loadLeads(), [loadLeads]);
  useEffect(() => void loadOpportunities(), [loadOpportunities]);

  async function openOpportunity(id: string) {
    try {
      setDrawer({ kind: 'opportunity', opportunity: await getCrmOpportunity(token, id) });
    } catch (caught) {
      setNotice(errorText(caught, 'The sales opportunity could not be opened.'));
    }
  }

  async function changeStage(opportunity: CrmOpportunity, stage: CrmOpportunityStage) {
    if (!canEdit || stage === opportunity.stage || movingId) return;
    setMovingId(opportunity.id);
    setError(null);
    try {
      const probability =
        stage === 'won' ||
        stage === 'lost' ||
        opportunity.probabilityPercent === 0 ||
        opportunity.probabilityPercent === 100
          ? stageProbability[stage]
          : opportunity.probabilityPercent;
      const saved = await moveCrmOpportunity(token, opportunity.id, crypto.randomUUID(), {
        expectedVersion: opportunity.version,
        probabilityPercent: probability,
        stage,
      });
      setOpportunities((current) => ({
        ...current,
        items: current.items.map((item) => (item.id === saved.id ? saved : item)),
      }));
      setNotice(`${saved.number} moved to ${stageLabel(stage)}.`);
      void loadOpportunities();
    } catch (caught) {
      setError(errorText(caught, 'The opportunity could not be moved.'));
      void loadOpportunities();
    } finally {
      setMovingId(null);
    }
  }

  function saved(message: string) {
    setDrawer(null);
    setNotice(message);
    void Promise.all([loadLeads(), loadOpportunities()]);
    void getCrmPipelineReferenceData(token)
      .then(setReferences)
      .catch(() => undefined);
  }

  return (
    <div className="page-stack crm-pipeline-workspace">
      <header className="page-header crm-pipeline-header">
        <div>
          <p className="page-eyebrow">CRM · Business development</p>
          <h1>Leads &amp; opportunities</h1>
          <p>Turn genuine interest into customers, quotations, and visible sales progress.</p>
        </div>
        {canCreate ? (
          <div className="crm-pipeline-header-actions">
            <Button
              disabled={loadingReferences || !references.customers.length}
              onClick={() => setDrawer({ kind: 'new_opportunity' })}
              variant="secondary"
            >
              New opportunity
            </Button>
            <Button
              disabled={loadingReferences || !references.assignees.length}
              onClick={() => setDrawer({ kind: 'new_lead' })}
            >
              <Icon name="plus" size={16} /> New lead
            </Button>
          </div>
        ) : null}
      </header>

      <CrmTabs />

      {notice ? (
        <Toast onDismiss={() => setNotice(null)} tone="success">
          {notice}
        </Toast>
      ) : null}
      {error ? (
        <InlineAlert tone="error">
          <div className="crm-pipeline-notice">
            <span>{error}</span>
            <button
              onClick={() => void Promise.all([loadLeads(), loadOpportunities()])}
              type="button"
            >
              Try again
            </button>
          </div>
        </InlineAlert>
      ) : null}

      <section className="crm-pipeline-mode" aria-label="Lead and opportunity views">
        <div>
          <button
            aria-pressed={view === 'leads'}
            className={view === 'leads' ? 'is-active' : undefined}
            onClick={() => setView('leads')}
            type="button"
          >
            Lead desk
            <span>{leads.summary.new + leads.summary.qualified}</span>
          </button>
          <button
            aria-pressed={view === 'pipeline'}
            className={view === 'pipeline' ? 'is-active' : undefined}
            onClick={() => setView('pipeline')}
            type="button"
          >
            Sales pipeline
            <span>{opportunities.summary.openCount}</span>
          </button>
        </div>
        <p>
          {view === 'leads'
            ? 'Qualify first, then convert without creating duplicate customer records.'
            : 'Drag an opportunity between stages or open it for a keyboard-friendly move.'}
        </p>
      </section>

      {view === 'leads' ? (
        <LeadDesk
          leads={leads}
          loading={loadingLeads}
          onOpen={(lead) => setDrawer({ kind: 'lead', lead })}
          onPageChange={setLeadPage}
          onSearch={(value) => {
            setLeadPage(1);
            setLeadSearch(value);
          }}
          onSearchDraft={setLeadSearchDraft}
          onSource={(value) => {
            setLeadPage(1);
            setLeadSource(value);
          }}
          onStatus={(value) => {
            setLeadPage(1);
            setLeadStatus(value);
          }}
          searchDraft={leadSearchDraft}
          source={leadSource}
          status={leadStatus}
        />
      ) : (
        <PipelineBoard
          canEdit={canEdit}
          loading={loadingOpportunities}
          movingId={movingId}
          onMove={(opportunity, stage) => void changeStage(opportunity, stage)}
          onOpen={(opportunity) => void openOpportunity(opportunity.id)}
          onSearch={(value) => setPipelineSearch(value)}
          onSearchDraft={setPipelineSearchDraft}
          opportunities={opportunities}
          searchDraft={pipelineSearchDraft}
        />
      )}

      {drawer?.kind === 'new_lead' ? (
        <NewLeadDrawer
          onBack={() => setDrawer(null)}
          onSaved={(lead) => saved(`${lead.number} was added to the lead desk.`)}
          references={references}
          token={token}
        />
      ) : null}
      {drawer?.kind === 'lead' ? (
        <LeadDrawer
          canEdit={canEdit}
          lead={drawer.lead}
          onBack={() => setDrawer(null)}
          onConvert={(lead) => setDrawer({ kind: 'convert', lead })}
          onQualified={(lead) => {
            setDrawer({ kind: 'lead', lead });
            setNotice(`${lead.number} is ready for conversion.`);
            void loadLeads();
          }}
          token={token}
        />
      ) : null}
      {drawer?.kind === 'convert' ? (
        <ConvertLeadDrawer
          lead={drawer.lead}
          onBack={() => setDrawer({ kind: 'lead', lead: drawer.lead })}
          onSaved={(result) =>
            saved(
              result.opportunity
                ? `${result.lead.number} became ${result.customer.name} with opportunity ${result.opportunity.number}.`
                : `${result.lead.number} became customer ${result.customer.name}.`,
            )
          }
          references={references}
          token={token}
        />
      ) : null}
      {drawer?.kind === 'new_opportunity' ? (
        <NewOpportunityDrawer
          onBack={() => setDrawer(null)}
          onSaved={(opportunity) => saved(`${opportunity.number} was added to the pipeline.`)}
          references={references}
          token={token}
        />
      ) : null}
      {drawer?.kind === 'opportunity' ? (
        <OpportunityDrawer
          canEdit={canEdit}
          onBack={() => setDrawer(null)}
          onSaved={(opportunity, message) => {
            setDrawer({ kind: 'opportunity', opportunity });
            setNotice(message);
            void loadOpportunities();
          }}
          opportunity={drawer.opportunity}
          references={references}
          token={token}
        />
      ) : null}
    </div>
  );
}

function LeadDesk({
  leads,
  loading,
  onOpen,
  onPageChange,
  onSearch,
  onSearchDraft,
  onSource,
  onStatus,
  searchDraft,
  source,
  status,
}: {
  leads: CrmLeadPage;
  loading: boolean;
  onOpen: (lead: CrmLead) => void;
  onPageChange: (page: number) => void;
  onSearch: (value: string) => void;
  onSearchDraft: (value: string) => void;
  onSource: (value: CrmLeadSource | '') => void;
  onStatus: (value: CrmLeadStatus | '') => void;
  searchDraft: string;
  source: CrmLeadSource | '';
  status: CrmLeadStatus | '';
}) {
  return (
    <div className="crm-lead-desk">
      <section aria-label="Lead summary" className="crm-pipeline-summary">
        <PipelineMetric label="New leads" value={String(leads.summary.new)} />
        <PipelineMetric label="Qualified" tone="accent" value={String(leads.summary.qualified)} />
        <PipelineMetric label="Converted" value={String(leads.summary.converted)} />
      </section>
      <section className="crm-lead-register">
        <header>
          <div>
            <h2>Lead desk</h2>
            <p>
              {leads.total} {leads.total === 1 ? 'lead' : 'leads'} in this view
            </p>
          </div>
          <form
            className="crm-pipeline-filters"
            onSubmit={(event) => {
              event.preventDefault();
              onSearch(searchDraft.trim());
            }}
          >
            <label className="crm-pipeline-search">
              <span className="sr-only">Search leads</span>
              <Icon name="search" size={15} />
              <input
                onChange={(event) => onSearchDraft(event.target.value)}
                placeholder="Company, contact, email, or number"
                value={searchDraft}
              />
            </label>
            <select
              aria-label="Lead status"
              onChange={(event) => onStatus(event.target.value as CrmLeadStatus | '')}
              value={status}
            >
              <option value="">All statuses</option>
              {leadStatuses.map((item) => (
                <option key={item} value={item}>
                  {leadStatusLabel(item)}
                </option>
              ))}
            </select>
            <select
              aria-label="Lead source"
              onChange={(event) => onSource(event.target.value as CrmLeadSource | '')}
              value={source}
            >
              <option value="">All sources</option>
              {leadSources.map((item) => (
                <option key={item} value={item}>
                  {sourceLabel(item)}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
        </header>
        {loading ? <PipelineState title="Loading leads" /> : null}
        {!loading && !leads.items.length ? (
          <PipelineState title="No leads match this view">
            <p>Change the filters or add the next genuine prospect.</p>
          </PipelineState>
        ) : null}
        {!loading && leads.items.length ? (
          <div className="crm-lead-list">
            {leads.items.map((lead) => (
              <button key={lead.id} onClick={() => onOpen(lead)} type="button">
                <span className={`crm-lead-source is-${lead.source}`} aria-hidden="true">
                  {sourceInitial(lead.source)}
                </span>
                <span className="crm-lead-main">
                  <strong>{lead.organizationName}</strong>
                  <small>
                    {lead.number} · {lead.contactName}
                  </small>
                </span>
                <span className="crm-lead-contact">
                  <strong>{lead.telephone ?? lead.email}</strong>
                  <small>{sourceLabel(lead.source)}</small>
                </span>
                <span className="crm-lead-owner">
                  <strong>{lead.owner.displayName}</strong>
                  <small>Updated {formatDate(lead.updatedAt)}</small>
                </span>
                <span className={`crm-lead-status is-${lead.status}`}>
                  {leadStatusLabel(lead.status)}
                </span>
                <Icon name="arrow" size={15} />
              </button>
            ))}
          </div>
        ) : null}
        {leads.totalPages > 1 ? (
          <footer className="crm-pipeline-pager">
            <Button
              disabled={leads.page <= 1}
              onClick={() => onPageChange(leads.page - 1)}
              variant="secondary"
            >
              Previous
            </Button>
            <span>
              Page {leads.page} of {leads.totalPages}
            </span>
            <Button
              disabled={leads.page >= leads.totalPages}
              onClick={() => onPageChange(leads.page + 1)}
              variant="secondary"
            >
              Next
            </Button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

function PipelineBoard({
  canEdit,
  loading,
  movingId,
  onMove,
  onOpen,
  onSearch,
  onSearchDraft,
  opportunities,
  searchDraft,
}: {
  canEdit: boolean;
  loading: boolean;
  movingId: string | null;
  onMove: (opportunity: CrmOpportunity, stage: CrmOpportunityStage) => void;
  onOpen: (opportunity: CrmOpportunity) => void;
  onSearch: (value: string) => void;
  onSearchDraft: (value: string) => void;
  opportunities: CrmOpportunityPage;
  searchDraft: string;
}) {
  const byStage = Object.fromEntries(
    stages.map((stage) => [stage, opportunities.items.filter((item) => item.stage === stage)]),
  ) as Record<CrmOpportunityStage, CrmOpportunity[]>;
  function drop(event: DragEvent<HTMLElement>, stage: CrmOpportunityStage) {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/vista-opportunity');
    const opportunity = opportunities.items.find((item) => item.id === id);
    if (opportunity) onMove(opportunity, stage);
  }
  return (
    <div className="crm-opportunity-workspace">
      <section aria-label="Sales pipeline summary" className="crm-pipeline-summary is-financial">
        <PipelineMetric
          label="Open opportunities"
          value={String(opportunities.summary.openCount)}
        />
        <PipelineMetric
          label="Open pipeline"
          value={formatBgn(opportunities.summary.openRevenueBgn)}
        />
        <PipelineMetric
          label="Weighted value"
          tone="accent"
          value={formatBgn(opportunities.summary.weightedRevenueBgn)}
        />
        <PipelineMetric
          label="Won value"
          tone="success"
          value={formatBgn(opportunities.summary.wonRevenueBgn)}
        />
      </section>
      <section className="crm-pipeline-board-card">
        <header>
          <div>
            <h2>Sales pipeline</h2>
            <p>
              {opportunities.total} {opportunities.total === 1 ? 'opportunity' : 'opportunities'}{' '}
              shown
            </p>
          </div>
          <form
            className="crm-pipeline-filters"
            onSubmit={(event) => {
              event.preventDefault();
              onSearch(searchDraft.trim());
            }}
          >
            <label className="crm-pipeline-search">
              <span className="sr-only">Search opportunities</span>
              <Icon name="search" size={15} />
              <input
                onChange={(event) => onSearchDraft(event.target.value)}
                placeholder="Opportunity, customer, or number"
                value={searchDraft}
              />
            </label>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
        </header>
        {loading ? <PipelineState title="Loading sales pipeline" /> : null}
        {!loading ? (
          <div className="crm-kanban" aria-label="Opportunity pipeline">
            {stages.map((stage) => {
              const items = byStage[stage];
              const total = sumMoney(items.map((item) => item.estimatedRevenueBgn));
              return (
                <section
                  className={`crm-kanban-column is-${stage}`}
                  key={stage}
                  onDragOver={(event) => {
                    if (canEdit) event.preventDefault();
                  }}
                  onDrop={(event) => drop(event, stage)}
                >
                  <header>
                    <div>
                      <span aria-hidden="true" />
                      <h3>{stageLabel(stage)}</h3>
                    </div>
                    <strong>{items.length}</strong>
                    <p>{formatBgn(total)}</p>
                  </header>
                  <div className="crm-kanban-stack">
                    {!items.length ? <p className="crm-kanban-empty">No opportunities</p> : null}
                    {items.map((opportunity) => (
                      <article
                        aria-busy={movingId === opportunity.id}
                        className="crm-opportunity-card"
                        draggable={canEdit && !movingId}
                        key={opportunity.id}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/vista-opportunity', opportunity.id);
                        }}
                      >
                        <button onClick={() => onOpen(opportunity)} type="button">
                          <span className="crm-opportunity-number">{opportunity.number}</span>
                          <strong>{opportunity.title}</strong>
                          <small>{opportunity.customer.name}</small>
                          <span className="crm-opportunity-value">
                            {formatBgn(opportunity.estimatedRevenueBgn)}
                          </span>
                          <span className="crm-opportunity-progress">
                            <span style={{ width: `${opportunity.probabilityPercent}%` }} />
                          </span>
                          <span className="crm-opportunity-meta">
                            <span>{opportunity.probabilityPercent}%</span>
                            <span>
                              {opportunity.expectedCloseOn
                                ? formatDate(opportunity.expectedCloseOn)
                                : 'No close date'}
                            </span>
                          </span>
                          <span className="crm-opportunity-footer">
                            <span>{initials(opportunity.owner.displayName)}</span>
                            <small>
                              {opportunity.quotations.length
                                ? `${opportunity.quotations.length} quotation${opportunity.quotations.length === 1 ? '' : 's'}`
                                : 'No quotation'}
                            </small>
                            <Icon name="arrow" size={13} />
                          </span>
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function NewLeadDrawer({
  onBack,
  onSaved,
  references,
  token,
}: {
  onBack: () => void;
  onSaved: (lead: CrmLead) => void;
  references: CrmPipelineReferenceData;
  token: string;
}) {
  const [organizationName, setOrganizationName] = useState('');
  const [contactName, setContactName] = useState('');
  const [telephone, setTelephone] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState<CrmLeadSource>('telephone');
  const [sourceDetails, setSourceDetails] = useState('');
  const [ownerAccountId, setOwnerAccountId] = useState(references.assignees[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CreateCrmLeadRequest = {
        contactName,
        ...(email.trim() ? { email } : {}),
        ...(notes.trim() ? { notes } : {}),
        organizationName,
        ownerAccountId,
        source,
        ...(sourceDetails.trim() ? { sourceDetails } : {}),
        ...(telephone.trim() ? { telephone } : {}),
      };
      onSaved(await createCrmLead(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The lead could not be saved.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PipelineDrawer busy={busy} onBack={onBack} subtitle="New business enquiry" title="New lead">
      <form className="crm-timeline-drawer-form" onSubmit={(event) => void submit(event)}>
        <div className="crm-timeline-drawer-scroll">
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          <DrawerSection
            index="1"
            title="Prospect"
            description="Record who is interested and how the team can reach them."
          >
            <Field label="Company or prospect name">
              <input
                maxLength={255}
                onChange={(event) => setOrganizationName(event.target.value)}
                required
                value={organizationName}
              />
            </Field>
            <Field label="Contact person">
              <input
                maxLength={255}
                onChange={(event) => setContactName(event.target.value)}
                required
                value={contactName}
              />
            </Field>
            <div className="crm-timeline-form-grid">
              <Field label="Telephone">
                <input
                  maxLength={100}
                  onChange={(event) => setTelephone(event.target.value)}
                  placeholder="+359 ..."
                  value={telephone}
                />
              </Field>
              <Field label="Email">
                <input
                  maxLength={320}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  value={email}
                />
              </Field>
            </div>
            {!telephone.trim() && !email.trim() ? (
              <p className="crm-field-hint">
                Enter at least one telephone number or email address.
              </p>
            ) : null}
          </DrawerSection>
          <DrawerSection
            index="2"
            title="Enquiry"
            description="Capture where the lead came from and enough context for qualification."
          >
            <div className="crm-timeline-form-grid">
              <Field label="Lead source">
                <select
                  onChange={(event) => setSource(event.target.value as CrmLeadSource)}
                  value={source}
                >
                  {leadSources.map((item) => (
                    <option key={item} value={item}>
                      {sourceLabel(item)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Owner">
                <select
                  onChange={(event) => setOwnerAccountId(event.target.value)}
                  required
                  value={ownerAccountId}
                >
                  {references.assignees.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Source details (optional)">
              <input
                maxLength={500}
                onChange={(event) => setSourceDetails(event.target.value)}
                placeholder="Referral name, website form, or event"
                value={sourceDetails}
              />
            </Field>
            <Field label="Notes (optional)">
              <textarea
                maxLength={4000}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Products, services, timing, or other useful context"
                rows={5}
                value={notes}
              />
            </Field>
          </DrawerSection>
        </div>
        <DrawerActions
          busy={busy}
          disabled={
            !organizationName.trim() ||
            !contactName.trim() ||
            (!telephone.trim() && !email.trim()) ||
            !ownerAccountId
          }
          onBack={onBack}
          submitLabel="Save lead"
        />
      </form>
    </PipelineDrawer>
  );
}

function LeadDrawer({
  canEdit,
  lead,
  onBack,
  onConvert,
  onQualified,
  token,
}: {
  canEdit: boolean;
  lead: CrmLead;
  onBack: () => void;
  onConvert: (lead: CrmLead) => void;
  onQualified: (lead: CrmLead) => void;
  token: string;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function qualify() {
    setBusy(true);
    setError(null);
    try {
      onQualified(
        await qualifyCrmLead(token, lead.id, crypto.randomUUID(), {
          expectedVersion: lead.version,
          ...(note.trim() ? { note } : {}),
        }),
      );
    } catch (caught) {
      setError(errorText(caught, 'The lead could not be qualified.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PipelineDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${lead.number} · ${lead.contactName}`}
      title={lead.organizationName}
    >
      <div className="crm-pipeline-preview">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="crm-lead-preview-hero">
          <span className={`crm-lead-status is-${lead.status}`}>
            {leadStatusLabel(lead.status)}
          </span>
          <h3>{lead.organizationName}</h3>
          <p>
            {sourceLabel(lead.source)} · owned by {lead.owner.displayName}
          </p>
        </section>
        <section className="crm-pipeline-preview-card">
          <header>
            <h3>Lead details</h3>
            <p>Contact and enquiry information</p>
          </header>
          <dl>
            <Detail label="Contact" value={lead.contactName} />
            <Detail label="Telephone" value={lead.telephone ?? 'Not provided'} />
            <Detail label="Email" value={lead.email ?? 'Not provided'} />
            <Detail label="Source details" value={lead.sourceDetails ?? 'Not provided'} />
          </dl>
          {lead.notes ? (
            <div className="crm-preview-note">
              <span>Notes</span>
              <p>{lead.notes}</p>
            </div>
          ) : null}
        </section>
        {canEdit && lead.status === 'new' ? (
          <section className="crm-pipeline-action-card">
            <div>
              <h3>Qualify this lead</h3>
              <p>Confirm there is a real need and a viable next step before customer conversion.</p>
            </div>
            <Field label="Qualification note (optional)">
              <textarea
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                value={note}
              />
            </Field>
            <Button busy={busy} onClick={() => void qualify()}>
              <Icon name="check" size={15} /> Mark as qualified
            </Button>
          </section>
        ) : null}
        {canEdit && lead.status === 'qualified' ? (
          <section className="crm-pipeline-action-card is-conversion">
            <div>
              <h3>Ready for conversion</h3>
              <p>
                Create or select the customer record, then optionally add the first sales
                opportunity.
              </p>
            </div>
            <Button onClick={() => onConvert(lead)}>Convert lead</Button>
          </section>
        ) : null}
        {lead.convertedCustomer ? (
          <section className="crm-pipeline-action-card is-complete">
            <div>
              <h3>Converted to customer</h3>
              <p>{lead.convertedCustomer.name} is ready to use across Sales and CRM.</p>
            </div>
            <Link to="/partners">Open customers</Link>
          </section>
        ) : null}
        <History title="Lead history">
          {[...lead.history].reverse().map((item) => (
            <li key={item.id}>
              <span aria-hidden="true" />
              <div>
                <strong>{leadHistoryLabel(item.type)}</strong>
                {item.note ? <p>{item.note}</p> : null}
                <small>
                  {formatDateTime(item.changedAt)} · {item.changedByName}
                </small>
              </div>
            </li>
          ))}
        </History>
      </div>
    </PipelineDrawer>
  );
}

function ConvertLeadDrawer({
  lead,
  onBack,
  onSaved,
  references,
  token,
}: {
  lead: CrmLead;
  onBack: () => void;
  onSaved: (result: {
    customer: { id: string; name: string };
    lead: CrmLead;
    opportunity?: CrmOpportunity;
  }) => void;
  references: CrmPipelineReferenceData;
  token: string;
}) {
  const [customerMode, setCustomerMode] = useState<'existing' | 'new'>('new');
  const [existingCustomerId, setExistingCustomerId] = useState(references.customers[0]?.id ?? '');
  const [displayName, setDisplayName] = useState(lead.organizationName);
  const [kind, setKind] = useState<PartnerKind>('legal_entity');
  const [uic, setUic] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [createOpportunityFlag, setCreateOpportunityFlag] = useState(true);
  const [title, setTitle] = useState(`${lead.organizationName} sales opportunity`);
  const [description, setDescription] = useState(lead.notes ?? '');
  const [estimatedRevenueBgn, setEstimatedRevenueBgn] = useState('');
  const [probabilityPercent, setProbabilityPercent] = useState(40);
  const [expectedCloseOn, setExpectedCloseOn] = useState(dateAfterDays(30));
  const [ownerAccountId, setOwnerAccountId] = useState(lead.owner.id);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const opportunity = createOpportunityFlag
        ? {
            ...(description.trim() ? { description } : {}),
            estimatedRevenueBgn,
            ...(expectedCloseOn ? { expectedCloseOn } : {}),
            ownerAccountId,
            probabilityPercent,
            title,
          }
        : undefined;
      const input: ConvertCrmLeadRequest = {
        createOpportunity: createOpportunityFlag,
        ...(customerMode === 'existing' ? { existingCustomerPartnerId: existingCustomerId } : {}),
        expectedVersion: lead.version,
        ...(customerMode === 'new'
          ? {
              newCustomer: {
                displayName,
                kind,
                ...(uic.trim() ? { uic } : {}),
                ...(vatNumber.trim() ? { vatNumber } : {}),
              },
            }
          : {}),
        ...(note.trim() ? { note } : {}),
        ...(opportunity ? { opportunity } : {}),
      };
      onSaved(await convertCrmLead(token, lead.id, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The lead could not be converted.'));
    } finally {
      setBusy(false);
    }
  }
  const validCustomer = customerMode === 'new' ? displayName.trim() : existingCustomerId;
  const validOpportunity =
    !createOpportunityFlag || (title.trim() && estimatedRevenueBgn && ownerAccountId);
  return (
    <PipelineDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${lead.number} · qualified lead`}
      title="Convert lead"
    >
      <form className="crm-timeline-drawer-form" onSubmit={(event) => void submit(event)}>
        <div className="crm-timeline-drawer-scroll">
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          <DrawerSection
            index="1"
            title="Customer record"
            description="Use an existing customer when there is a match, or create one shared customer record."
          >
            <div className="crm-choice-cards">
              <label className={customerMode === 'new' ? 'is-selected' : undefined}>
                <input
                  checked={customerMode === 'new'}
                  name="customer-mode"
                  onChange={() => setCustomerMode('new')}
                  type="radio"
                />
                <span>
                  <strong>Create customer</strong>
                  <small>Use the qualified lead details</small>
                </span>
              </label>
              <label className={customerMode === 'existing' ? 'is-selected' : undefined}>
                <input
                  checked={customerMode === 'existing'}
                  name="customer-mode"
                  onChange={() => setCustomerMode('existing')}
                  type="radio"
                />
                <span>
                  <strong>Use existing</strong>
                  <small>Avoid a duplicate customer</small>
                </span>
              </label>
            </div>
            {customerMode === 'existing' ? (
              <Field label="Existing customer">
                <select
                  onChange={(event) => setExistingCustomerId(event.target.value)}
                  required
                  value={existingCustomerId}
                >
                  {references.customers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <>
                <Field label="Customer name">
                  <input
                    maxLength={255}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                    value={displayName}
                  />
                </Field>
                <div className="crm-timeline-form-grid">
                  <Field label="Customer type">
                    <select
                      onChange={(event) => setKind(event.target.value as PartnerKind)}
                      value={kind}
                    >
                      <option value="legal_entity">Company</option>
                      <option value="individual">Individual</option>
                    </select>
                  </Field>
                  <Field label="Company registration number (optional)">
                    <input
                      maxLength={50}
                      onChange={(event) => setUic(event.target.value)}
                      value={uic}
                    />
                  </Field>
                </div>
                <Field label="VAT number (optional)">
                  <input
                    maxLength={50}
                    onChange={(event) => setVatNumber(event.target.value)}
                    value={vatNumber}
                  />
                </Field>
                <p className="crm-field-hint">
                  If the name or registration number already exists, Vista will ask you to choose
                  that customer instead.
                </p>
              </>
            )}
          </DrawerSection>
          <DrawerSection
            index="2"
            title="Sales opportunity"
            description="Add the first opportunity now, or convert only the customer record."
          >
            <label className="crm-switch-row">
              <input
                checked={createOpportunityFlag}
                onChange={(event) => setCreateOpportunityFlag(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>Create a sales opportunity</strong>
                <small>Place this qualified lead in the pipeline</small>
              </span>
            </label>
            {createOpportunityFlag ? (
              <OpportunityFields
                description={description}
                estimatedRevenueBgn={estimatedRevenueBgn}
                expectedCloseOn={expectedCloseOn}
                onDescription={setDescription}
                onEstimatedRevenue={setEstimatedRevenueBgn}
                onExpectedClose={setExpectedCloseOn}
                onOwner={setOwnerAccountId}
                onProbability={setProbabilityPercent}
                onTitle={setTitle}
                ownerAccountId={ownerAccountId}
                probabilityPercent={probabilityPercent}
                references={references}
                title={title}
              />
            ) : null}
          </DrawerSection>
          <DrawerSection
            index="3"
            title="Conversion note"
            description="Keep any final qualification context with the permanent lead history."
          >
            <Field label="Note (optional)">
              <textarea
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                value={note}
              />
            </Field>
          </DrawerSection>
        </div>
        <DrawerActions
          busy={busy}
          disabled={!validCustomer || !validOpportunity}
          onBack={onBack}
          submitLabel="Convert lead"
        />
      </form>
    </PipelineDrawer>
  );
}

function NewOpportunityDrawer({
  onBack,
  onSaved,
  references,
  token,
}: {
  onBack: () => void;
  onSaved: (opportunity: CrmOpportunity) => void;
  references: CrmPipelineReferenceData;
  token: string;
}) {
  const [customerPartnerId, setCustomerPartnerId] = useState(references.customers[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedRevenueBgn, setEstimatedRevenueBgn] = useState('');
  const [probabilityPercent, setProbabilityPercent] = useState(20);
  const [expectedCloseOn, setExpectedCloseOn] = useState(dateAfterDays(30));
  const [ownerAccountId, setOwnerAccountId] = useState(references.assignees[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CreateCrmOpportunityRequest = {
        customerPartnerId,
        ...(description.trim() ? { description } : {}),
        estimatedRevenueBgn,
        ...(expectedCloseOn ? { expectedCloseOn } : {}),
        ownerAccountId,
        probabilityPercent,
        title,
      };
      onSaved(await createCrmOpportunity(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The sales opportunity could not be created.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PipelineDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Existing customer opportunity"
      title="New opportunity"
    >
      <form className="crm-timeline-drawer-form" onSubmit={(event) => void submit(event)}>
        <div className="crm-timeline-drawer-scroll">
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          <DrawerSection
            index="1"
            title="Customer"
            description="Choose the customer this potential sale belongs to."
          >
            <Field label="Customer">
              <select
                onChange={(event) => setCustomerPartnerId(event.target.value)}
                required
                value={customerPartnerId}
              >
                {references.customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          </DrawerSection>
          <DrawerSection
            index="2"
            title="Opportunity"
            description="Set the expected value, confidence, owner, and target date."
          >
            <OpportunityFields
              description={description}
              estimatedRevenueBgn={estimatedRevenueBgn}
              expectedCloseOn={expectedCloseOn}
              onDescription={setDescription}
              onEstimatedRevenue={setEstimatedRevenueBgn}
              onExpectedClose={setExpectedCloseOn}
              onOwner={setOwnerAccountId}
              onProbability={setProbabilityPercent}
              onTitle={setTitle}
              ownerAccountId={ownerAccountId}
              probabilityPercent={probabilityPercent}
              references={references}
              title={title}
            />
          </DrawerSection>
        </div>
        <DrawerActions
          busy={busy}
          disabled={!customerPartnerId || !title.trim() || !estimatedRevenueBgn || !ownerAccountId}
          onBack={onBack}
          submitLabel="Create opportunity"
        />
      </form>
    </PipelineDrawer>
  );
}

function OpportunityFields({
  description,
  estimatedRevenueBgn,
  expectedCloseOn,
  onDescription,
  onEstimatedRevenue,
  onExpectedClose,
  onOwner,
  onProbability,
  onTitle,
  ownerAccountId,
  probabilityPercent,
  references,
  title,
}: {
  description: string;
  estimatedRevenueBgn: string;
  expectedCloseOn: string;
  onDescription: (value: string) => void;
  onEstimatedRevenue: (value: string) => void;
  onExpectedClose: (value: string) => void;
  onOwner: (value: string) => void;
  onProbability: (value: number) => void;
  onTitle: (value: string) => void;
  ownerAccountId: string;
  probabilityPercent: number;
  references: CrmPipelineReferenceData;
  title: string;
}) {
  return (
    <>
      <Field label="Opportunity name">
        <input
          maxLength={255}
          onChange={(event) => onTitle(event.target.value)}
          required
          value={title}
        />
      </Field>
      <Field label="Description (optional)">
        <textarea
          maxLength={4000}
          onChange={(event) => onDescription(event.target.value)}
          rows={4}
          value={description}
        />
      </Field>
      <div className="crm-timeline-form-grid">
        <Field label="Estimated value (BGN)">
          <input
            min="0.01"
            onChange={(event) => onEstimatedRevenue(event.target.value)}
            required
            step="0.01"
            type="number"
            value={estimatedRevenueBgn}
          />
        </Field>
        <Field label="Probability">
          <div className="crm-probability-field">
            <input
              max="99"
              min="1"
              onChange={(event) => onProbability(Number(event.target.value))}
              required
              type="number"
              value={probabilityPercent}
            />
            <span>%</span>
          </div>
        </Field>
      </div>
      <div className="crm-timeline-form-grid">
        <Field label="Expected close date (optional)">
          <input
            onChange={(event) => onExpectedClose(event.target.value)}
            type="date"
            value={expectedCloseOn}
          />
        </Field>
        <Field label="Owner">
          <select onChange={(event) => onOwner(event.target.value)} required value={ownerAccountId}>
            {references.assignees.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </>
  );
}

function OpportunityDrawer({
  canEdit,
  onBack,
  onSaved,
  opportunity,
  references,
  token,
}: {
  canEdit: boolean;
  onBack: () => void;
  onSaved: (opportunity: CrmOpportunity, message: string) => void;
  opportunity: CrmOpportunity;
  references: CrmPipelineReferenceData;
  token: string;
}) {
  const [stage, setStage] = useState<CrmOpportunityStage>(opportunity.stage);
  const [probabilityPercent, setProbabilityPercent] = useState(opportunity.probabilityPercent);
  const [note, setNote] = useState('');
  const availableQuotations = references.quotations.filter(
    (item) =>
      item.customerPartnerId === opportunity.customer.id &&
      !opportunity.quotations.some((linked) => linked.id === item.id),
  );
  const [quotationId, setQuotationId] = useState(availableQuotations[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function chooseStage(value: CrmOpportunityStage) {
    setStage(value);
    if (
      value === 'won' ||
      value === 'lost' ||
      probabilityPercent === 0 ||
      probabilityPercent === 100
    )
      setProbabilityPercent(stageProbability[value]);
  }
  async function move() {
    setBusy(true);
    setError(null);
    try {
      const saved = await moveCrmOpportunity(token, opportunity.id, crypto.randomUUID(), {
        expectedVersion: opportunity.version,
        ...(note.trim() ? { note } : {}),
        probabilityPercent,
        stage,
      });
      onSaved(saved, `${saved.number} moved to ${stageLabel(saved.stage)}.`);
      setNote('');
    } catch (caught) {
      setError(errorText(caught, 'The pipeline stage could not be changed.'));
    } finally {
      setBusy(false);
    }
  }
  async function linkQuotation() {
    setBusy(true);
    setError(null);
    try {
      const saved = await linkCrmOpportunityQuotation(token, opportunity.id, crypto.randomUUID(), {
        expectedVersion: opportunity.version,
        quotationId,
      });
      onSaved(saved, 'The Sales quotation was linked to this opportunity.');
    } catch (caught) {
      setError(errorText(caught, 'The quotation could not be linked.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PipelineDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${opportunity.number} · ${opportunity.customer.name}`}
      title={opportunity.title}
    >
      <div className="crm-pipeline-preview">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className={`crm-opportunity-preview-hero is-${opportunity.stage}`}>
          <div>
            <span>{stageLabel(opportunity.stage)}</span>
            <h3>{formatBgn(opportunity.estimatedRevenueBgn)}</h3>
            <p>
              {opportunity.probabilityPercent}% probability ·{' '}
              {formatBgn(opportunity.weightedRevenueBgn)} weighted
            </p>
          </div>
          <span>{initials(opportunity.owner.displayName)}</span>
        </section>
        <section className="crm-pipeline-preview-card">
          <header>
            <h3>Opportunity details</h3>
            <p>{opportunity.description ?? 'No additional description was added.'}</p>
          </header>
          <dl>
            <Detail label="Customer" value={opportunity.customer.name} />
            <Detail label="Owner" value={opportunity.owner.displayName} />
            <Detail
              label="Expected close"
              value={
                opportunity.expectedCloseOn ? formatDate(opportunity.expectedCloseOn) : 'Not set'
              }
            />
            <Detail label="Created" value={formatDate(opportunity.createdAt)} />
          </dl>
        </section>
        <section className="crm-pipeline-preview-card crm-opportunity-quotations">
          <header>
            <h3>Sales quotations</h3>
            <p>Only quotations issued to {opportunity.customer.name} can be linked.</p>
          </header>
          {opportunity.quotations.length ? (
            <div>
              {opportunity.quotations.map((quotation) => (
                <article key={quotation.id}>
                  <span>
                    <strong>{quotation.number}</strong>
                    <small>
                      {quotation.status.charAt(0).toUpperCase() + quotation.status.slice(1)} ·
                      linked {formatDate(quotation.linkedAt)}
                    </small>
                  </span>
                  <strong>
                    {quotation.currencyCode === 'BGN'
                      ? formatBgn(quotation.total)
                      : `${quotation.currencyCode} ${quotation.total}`}
                  </strong>
                </article>
              ))}
            </div>
          ) : (
            <p className="crm-empty-copy">No Sales quotation is linked yet.</p>
          )}
          {canEdit && availableQuotations.length ? (
            <div className="crm-link-quotation">
              <Field label="Available customer quotation">
                <select
                  onChange={(event) => setQuotationId(event.target.value)}
                  value={quotationId}
                >
                  {availableQuotations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.number} · {item.status} · {item.currencyCode} {item.total}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                busy={busy}
                disabled={!quotationId}
                onClick={() => void linkQuotation()}
                variant="secondary"
              >
                Link quotation
              </Button>
            </div>
          ) : null}
          {canEdit && !availableQuotations.length ? (
            <p className="crm-empty-copy">
              Create the customer quotation in{' '}
              <Link to="/modules/erp.sales/quotations">ERP → Sales</Link>, then return here to link
              it.
            </p>
          ) : null}
        </section>
        {canEdit ? (
          <section className="crm-pipeline-action-card">
            <div>
              <h3>Move through the pipeline</h3>
              <p>Every change records its previous stage, probability, employee, and time.</p>
            </div>
            <div className="crm-timeline-form-grid">
              <Field label="Next stage">
                <select
                  onChange={(event) => chooseStage(event.target.value as CrmOpportunityStage)}
                  value={stage}
                >
                  {stages.map((item) => (
                    <option key={item} value={item}>
                      {stageLabel(item)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Probability">
                <div className="crm-probability-field">
                  <input
                    disabled={stage === 'won' || stage === 'lost'}
                    max="99"
                    min="1"
                    onChange={(event) => setProbabilityPercent(Number(event.target.value))}
                    type="number"
                    value={probabilityPercent}
                  />
                  <span>%</span>
                </div>
              </Field>
            </div>
            <Field label="Progress note (optional)">
              <textarea
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                value={note}
              />
            </Field>
            <Button busy={busy} disabled={stage === opportunity.stage} onClick={() => void move()}>
              Update stage
            </Button>
          </section>
        ) : null}
        <History title="Opportunity history">
          {[...opportunity.history].reverse().map((item) => (
            <li key={item.id}>
              <span aria-hidden="true" />
              <div>
                <strong>{opportunityHistoryLabel(item)}</strong>
                {item.note ? <p>{item.note}</p> : null}
                <small>
                  {formatDateTime(item.changedAt)} · {item.changedByName} ·{' '}
                  {item.probabilityPercent}%
                </small>
              </div>
            </li>
          ))}
        </History>
      </div>
    </PipelineDrawer>
  );
}

function PipelineDrawer({
  busy,
  children,
  onBack,
  subtitle,
  title,
}: {
  busy: boolean;
  children: ReactNode;
  onBack: () => void;
  subtitle: string;
  title: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const onBackRef = useRef(onBack);
  busyRef.current = busy;
  onBackRef.current = onBack;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = ref.current;
    if (!drawer) return;
    const focusable = () =>
      Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    (drawer.querySelector<HTMLElement>('.panel-back-button') ?? drawer).focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        onBackRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        drawer?.focus();
        return;
      }
      const first = elements[0]!;
      const last = elements.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    drawer.addEventListener('keydown', keyboard);
    return () => {
      drawer.removeEventListener('keydown', keyboard);
      previous?.focus();
    };
  }, []);
  return (
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label={`Back from ${title}`}
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className="security-drawer is-wide crm-timeline-drawer crm-pipeline-drawer"
        ref={ref}
        role="dialog"
        tabIndex={-1}
      >
        <header className="panel-drawer-header crm-timeline-drawer-header">
          <button
            aria-label={`Back from ${title}`}
            className="panel-back-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="arrow" size={17} /> Back
          </button>
          <button
            aria-label="Close panel"
            className="panel-close-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="close" />
          </button>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </header>
        <div className="security-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function DrawerSection({
  children,
  description,
  index,
  title,
}: {
  children: ReactNode;
  description: string;
  index: string;
  title: string;
}) {
  return (
    <section className="crm-timeline-form-section">
      <header>
        <span>{index}</span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}
function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="crm-timeline-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function DrawerActions({
  busy,
  disabled,
  onBack,
  submitLabel,
}: {
  busy: boolean;
  disabled?: boolean;
  onBack: () => void;
  submitLabel: string;
}) {
  return (
    <div className="crm-timeline-drawer-actions">
      <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
        Back
      </Button>
      <Button busy={busy} disabled={disabled} type="submit">
        {submitLabel}
      </Button>
    </div>
  );
}
function PipelineMetric({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: 'accent' | 'success';
  value: string;
}) {
  return (
    <article className={tone ? `is-${tone}` : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
function PipelineState({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <div className="crm-pipeline-empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
function History({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="crm-pipeline-preview-card crm-pipeline-history">
      <h3>{title}</h3>
      <ol>{children}</ol>
    </section>
  );
}
function sourceLabel(value: CrmLeadSource): string {
  return {
    referral: 'Referral',
    telephone: 'Telephone',
    trade_exhibition: 'Trade exhibition',
    website: 'Website',
  }[value];
}
function leadStatusLabel(value: CrmLeadStatus): string {
  return { converted: 'Converted', new: 'New', qualified: 'Qualified' }[value];
}
function stageLabel(value: CrmOpportunityStage): string {
  return {
    lost: 'Lost',
    negotiation: 'Negotiation',
    new: 'New',
    qualified: 'Qualified',
    quotation_sent: 'Quotation sent',
    won: 'Won',
  }[value];
}
function leadHistoryLabel(value: CrmLead['history'][number]['type']): string {
  return value === 'created'
    ? 'Lead registered'
    : value === 'qualified'
      ? 'Lead qualified'
      : 'Lead converted';
}
function opportunityHistoryLabel(item: CrmOpportunity['history'][number]): string {
  if (item.type === 'created') return `Added to ${stageLabel(item.nextStage)}`;
  if (item.type === 'quotation_linked') return 'Sales quotation linked';
  return `Moved from ${stageLabel(item.previousStage!)} to ${stageLabel(item.nextStage)}`;
}
function sourceInitial(value: CrmLeadSource): string {
  return { referral: 'R', telephone: 'T', trade_exhibition: 'E', website: 'W' }[value];
}
function initials(value: string): string {
  return value
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
function formatDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
function formatBgn(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/u, '') || '0';
  return `BGN ${new Intl.NumberFormat().format(BigInt(normalizedWhole))}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}
function sumMoney(values: string[]): string {
  const cents = values.reduce((total, value) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return total + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
  }, 0n);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
function dateAfterDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}
