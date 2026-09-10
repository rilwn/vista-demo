import { Button, InlineAlert, Toast } from '@vista/ui';
import type {
  CreateCrmReferralRequest,
  CrmAfterSalesOverview,
  CrmCustomerSurvey,
  CrmReferral,
  CrmWarrantyCard,
  CrmWarrantyOfferStatus,
  ManagedFile,
  TransitionWarrantyClaimRequest,
  WarrantyClaim,
} from '@vista/contracts';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';

import {
  createCrmReferral,
  createCrmWarrantyClaim,
  getCrmAfterSalesOverview,
  recordCrmSurveyResponse,
  sendCrmSurvey,
  transitionCrmWarrantyClaim,
  updateCrmWarrantyOffer,
} from '../api/crm-after-sales';
import { ApiClientError } from '../api/client';
import { downloadManagedFile, uploadManagedFile } from '../api/files';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Link } from '../routing/Router';
import { CrmTabs } from './CrmTicketsPage';

type CareTab = 'warranties' | 'feedback' | 'referrals';
type Drawer =
  | { card: CrmWarrantyCard; type: 'card' }
  | { card?: CrmWarrantyCard; type: 'new_claim' }
  | { claim: WarrantyClaim; type: 'claim' }
  | { type: 'new_survey' }
  | { survey: CrmCustomerSurvey; type: 'survey' }
  | { type: 'new_referral' };

export function CrmAfterSalesPage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const canCreate = hasPermission('crm', 'create');
  const canEdit = hasPermission('crm', 'edit');
  const [overview, setOverview] = useState<CrmAfterSalesOverview | null>(null);
  const [tab, setTab] = useState<CareTab>('warranties');
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getCrmAfterSalesOverview(token)
      .then((result) => {
        if (!active) return;
        setOverview(result);
        setError(null);
      })
      .catch(
        (caught) => active && setError(errorText(caught, 'Customer care could not be loaded.')),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [revision, token]);

  function refresh(message?: string) {
    if (message) setNotice(message);
    setDrawer(null);
    setRevision((current) => current + 1);
  }

  const action =
    tab === 'warranties'
      ? { label: 'New warranty claim', open: () => setDrawer({ type: 'new_claim' }) }
      : tab === 'feedback'
        ? { label: 'Send survey', open: () => setDrawer({ type: 'new_survey' }) }
        : { label: 'Record referral', open: () => setDrawer({ type: 'new_referral' }) };

  return (
    <div className="page-stack crm-care-workspace">
      <header className="page-header crm-care-header">
        <div>
          <p className="page-eyebrow">CRM · After-sales</p>
          <h1>Customer care</h1>
          <p>Keep product coverage, customer feedback, and referrals connected to their source.</p>
        </div>
        {canCreate ? (
          <Button onClick={action.open}>
            <Icon name="plus" size={17} /> {action.label}
          </Button>
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
          <div className="crm-care-notice">
            <span>{error}</span>
            <button onClick={() => setRevision((current) => current + 1)} type="button">
              Try again
            </button>
          </div>
        </InlineAlert>
      ) : null}

      <nav aria-label="Customer care views" className="crm-care-view-tabs" role="tablist">
        {(
          [
            ['warranties', 'Warranties'],
            ['feedback', 'Feedback & NPS'],
            ['referrals', 'Referrals'],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={tab === value}
            className={tab === value ? 'is-active' : undefined}
            key={value}
            onClick={() => setTab(value)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {loading && !overview ? <CareState title="Loading customer care" /> : null}
      {!loading && overview && tab === 'warranties' ? (
        <WarrantyView overview={overview} onOpen={setDrawer} />
      ) : null}
      {!loading && overview && tab === 'feedback' ? (
        <FeedbackView overview={overview} onOpen={setDrawer} />
      ) : null}
      {!loading && overview && tab === 'referrals' ? <ReferralView overview={overview} /> : null}

      {drawer?.type === 'card' ? (
        <WarrantyCardDrawer
          canEdit={canEdit}
          card={drawer.card}
          claims={overview?.claims ?? []}
          onBack={() => setDrawer(null)}
          onClaim={(card) => setDrawer({ card, type: 'new_claim' })}
          onSaved={(card) => refresh(`${card.number} was updated.`)}
          token={token}
          timezone={overview?.businessTimezone ?? 'Europe/Sofia'}
        />
      ) : null}
      {drawer?.type === 'new_claim' && overview ? (
        <NewClaimDrawer
          {...(drawer.card ? { card: drawer.card } : {})}
          cards={overview.warrantyCards}
          onBack={() => setDrawer(null)}
          onSaved={(claim) => refresh(`${claim.number} was created.`)}
          token={token}
        />
      ) : null}
      {drawer?.type === 'claim' ? (
        <ClaimDrawer
          canEdit={canEdit}
          claim={drawer.claim}
          onBack={() => setDrawer(null)}
          onChanged={(claim) => {
            setDrawer({ claim, type: 'claim' });
            setRevision((current) => current + 1);
          }}
          token={token}
          timezone={overview?.businessTimezone ?? 'Europe/Sofia'}
        />
      ) : null}
      {drawer?.type === 'new_survey' && overview ? (
        <NewSurveyDrawer
          onBack={() => setDrawer(null)}
          onSaved={(survey) => refresh(`${survey.number} was sent.`)}
          sources={overview.surveySources}
          token={token}
        />
      ) : null}
      {drawer?.type === 'survey' ? (
        <SurveyDrawer
          canEdit={canEdit}
          onBack={() => setDrawer(null)}
          onSaved={(survey) => refresh(`${survey.number} response was recorded.`)}
          survey={drawer.survey}
          token={token}
          timezone={overview?.businessTimezone ?? 'Europe/Sofia'}
        />
      ) : null}
      {drawer?.type === 'new_referral' && overview ? (
        <NewReferralDrawer
          assignees={overview.assignees}
          customers={overview.customers}
          onBack={() => setDrawer(null)}
          onSaved={(referral) =>
            refresh(`${referral.number} and ${referral.leadNumber} were created.`)
          }
          token={token}
        />
      ) : null}
    </div>
  );
}

function WarrantyView({
  overview,
  onOpen,
}: {
  overview: CrmAfterSalesOverview;
  onOpen: (drawer: Drawer) => void;
}) {
  const [search, setSearch] = useState('');
  const normalized = search.trim().toLowerCase();
  const cards = overview.warrantyCards.filter(
    (card) =>
      !normalized ||
      [card.number, card.customerName, card.deviceName, card.serialNumber].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
  );
  const active = overview.warrantyCards.filter((card) => card.status === 'active').length;
  const expiring = overview.warrantyCards.filter(
    (card) => card.remainingDays >= 0 && card.remainingDays <= 60,
  ).length;
  const openClaims = overview.claims.filter((claim) => claim.status !== 'closed').length;
  return (
    <div className="crm-care-view">
      <section aria-label="Warranty summary" className="crm-care-summary">
        <Metric label="Warranty cards" value={overview.warrantyCards.length} />
        <Metric label="Active coverage" value={active} />
        <Metric
          label="Ending within 60 days"
          {...(expiring ? { tone: 'warning' as const } : {})}
          value={expiring}
        />
        <Metric
          label="Open claims"
          {...(openClaims ? { tone: 'warning' as const } : {})}
          value={openClaims}
        />
      </section>
      <section className="crm-care-register">
        <header className="crm-care-register-head">
          <div>
            <h2>Warranty register</h2>
            <p>Coverage follows the sold device and serial number.</p>
          </div>
          <label className="crm-care-search">
            <Icon name="search" size={16} />
            <input
              aria-label="Search warranty cards"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Card, customer, device, or serial"
              value={search}
            />
          </label>
        </header>
        {!cards.length ? (
          <CareEmpty title="No warranty cards match this search." />
        ) : (
          <div className="crm-care-card-list">
            {cards.map((card) => (
              <button key={card.id} onClick={() => onOpen({ card, type: 'card' })} type="button">
                <span className="crm-care-record-icon">
                  <Icon name="shield" size={18} />
                </span>
                <span>
                  <strong>{card.number}</strong>
                  <small>
                    {card.customerName} · {card.customerLocationName}
                  </small>
                </span>
                <span>
                  <strong>{card.deviceName}</strong>
                  <small>{card.serialNumber}</small>
                </span>
                <span>
                  <strong>{formatDate(card.warrantyEndsOn, overview.businessTimezone)}</strong>
                  <small>{coverageText(card)}</small>
                </span>
                <Status value={card.status} />
                <Icon name="arrow" size={16} />
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="crm-care-register">
        <header className="crm-care-register-head">
          <div>
            <h2>Warranty claims</h2>
            <p>Service decisions, evidence, and history remain on one shared claim.</p>
          </div>
          <span className="crm-care-count">{overview.claims.length}</span>
        </header>
        {!overview.claims.length ? (
          <CareEmpty title="No warranty claims have been recorded." />
        ) : (
          <div className="crm-care-claim-grid">
            {overview.claims.map((claim) => (
              <button key={claim.id} onClick={() => onOpen({ claim, type: 'claim' })} type="button">
                <div>
                  <strong>{claim.number}</strong>
                  <Status value={claim.status} />
                </div>
                <h3>{claim.deviceName}</h3>
                <p>
                  {claim.customerName} · {claim.serialNumber}
                </p>
                <small>
                  {claim.attachments.length} supporting{' '}
                  {claim.attachments.length === 1 ? 'file' : 'files'} · updated{' '}
                  {formatDateTime(claim.updatedAt, overview.businessTimezone)}
                </small>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FeedbackView({
  overview,
  onOpen,
}: {
  overview: CrmAfterSalesOverview;
  onOpen: (drawer: Drawer) => void;
}) {
  return (
    <div className="crm-care-view">
      <section className="crm-nps-panel">
        <div className="crm-nps-score">
          <span>Net Promoter Score</span>
          <strong>{overview.nps.score ?? '—'}</strong>
          <small>
            {overview.nps.responses} recorded{' '}
            {overview.nps.responses === 1 ? 'response' : 'responses'}
          </small>
        </div>
        <div className="crm-nps-breakdown">
          <NpsPart label="Promoters" tone="positive" value={overview.nps.promoters} />
          <NpsPart label="Passives" tone="neutral" value={overview.nps.passives} />
          <NpsPart label="Detractors" tone="negative" value={overview.nps.detractors} />
        </div>
        <div className="crm-nps-trend">
          <span>NPS trend</span>
          {!overview.nps.trend.length ? (
            <p>Responses will build the trend.</p>
          ) : (
            overview.nps.trend.map((point) => (
              <div key={point.label}>
                <span>{point.label}</span>
                <i>
                  <b style={{ width: `${Math.max(4, (point.score + 100) / 2)}%` }} />
                </i>
                <strong>{point.score}</strong>
              </div>
            ))
          )}
        </div>
      </section>
      <section className="crm-care-register">
        <header className="crm-care-register-head">
          <div>
            <h2>Customer surveys</h2>
            <p>Send one NPS survey after a completed delivery or Service job.</p>
          </div>
          <span className="crm-care-count">{overview.surveys.length}</span>
        </header>
        {!overview.surveys.length ? (
          <CareEmpty title="No customer surveys have been sent." />
        ) : (
          <div className="crm-care-survey-list">
            {overview.surveys.map((survey) => (
              <button
                key={survey.id}
                onClick={() => onOpen({ survey, type: 'survey' })}
                type="button"
              >
                <span>
                  <strong>{survey.number}</strong>
                  <small>{survey.customerName}</small>
                </span>
                <span>
                  <strong>{survey.sourceLabel}</strong>
                  <small>
                    {survey.sourceKind === 'service' ? 'After Service' : 'After delivery'}
                  </small>
                </span>
                <span className="crm-survey-score">
                  {survey.score ?? '—'}
                  <small>{survey.score === undefined ? 'Awaiting response' : 'NPS score'}</small>
                </span>
                <Status value={survey.status} />
                <Icon name="arrow" size={16} />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ReferralView({ overview }: { overview: CrmAfterSalesOverview }) {
  return (
    <div className="crm-care-view">
      <section aria-label="Referral summary" className="crm-care-summary is-three">
        <Metric label="Registered referrals" value={overview.referrals.length} />
        <Metric label="Prospect leads created" value={overview.referrals.length} />
        <Metric
          label="Referring customers"
          value={new Set(overview.referrals.map((item) => item.referringCustomerPartnerId)).size}
        />
      </section>
      <section className="crm-care-register">
        <header className="crm-care-register-head">
          <div>
            <h2>Referral register</h2>
            <p>
              Every referred prospect becomes a traceable lead without duplicating the customer
              record.
            </p>
          </div>
          <span className="crm-care-count">{overview.referrals.length}</span>
        </header>
        {!overview.referrals.length ? (
          <CareEmpty title="No customer referrals have been recorded." />
        ) : (
          <div className="crm-care-referral-grid">
            {overview.referrals.map((referral) => (
              <article key={referral.id}>
                <div>
                  <span className="crm-care-record-icon">
                    <Icon name="customers" size={18} />
                  </span>
                  <span>
                    <strong>{referral.organizationName}</strong>
                    <small>{referral.number}</small>
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Referred by</dt>
                    <dd>{referral.referringCustomerName}</dd>
                  </div>
                  <div>
                    <dt>Contact</dt>
                    <dd>{referral.contactName}</dd>
                  </div>
                  <div>
                    <dt>Lead</dt>
                    <dd>
                      <Link to="/modules/crm/leads">{referral.leadNumber}</Link>
                    </dd>
                  </div>
                </dl>
                <p>{referral.email ?? referral.telephone}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function WarrantyCardDrawer({
  canEdit,
  card,
  claims,
  onBack,
  onClaim,
  onSaved,
  token,
  timezone,
}: {
  canEdit: boolean;
  card: CrmWarrantyCard;
  claims: WarrantyClaim[];
  onBack: () => void;
  onClaim: (card: CrmWarrantyCard) => void;
  onSaved: (card: CrmWarrantyCard) => void;
  token: string;
  timezone: string;
}) {
  const [offerStatus, setOfferStatus] = useState(card.offerStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const related = claims.filter((claim) => claim.customerEquipmentId === card.customerEquipmentId);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await updateCrmWarrantyOffer(token, card.id, crypto.randomUUID(), { offerStatus }));
    } catch (caught) {
      setError(errorText(caught, 'The follow-up status could not be saved.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <CareDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${card.customerName} · ${card.serialNumber}`}
      title={card.number}
    >
      <div className="crm-care-drawer-content">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="crm-care-card-hero">
          <span>
            <Icon name="shield" size={24} />
          </span>
          <div>
            <small>Warranty card</small>
            <h3>{card.deviceName}</h3>
            <p>{card.customerLocationName}</p>
          </div>
          <Status value={card.status} />
        </section>
        <section className="crm-care-facts">
          <div>
            <span>Coverage starts</span>
            <strong>{formatDate(card.warrantyStartsOn, timezone)}</strong>
          </div>
          <div>
            <span>Coverage ends</span>
            <strong>{formatDate(card.warrantyEndsOn, timezone)}</strong>
          </div>
          <div>
            <span>Time remaining</span>
            <strong>{coverageText(card)}</strong>
          </div>
          <div>
            <span>Sales handover</span>
            <strong>{card.handoverNumber ?? 'Earlier registered sale'}</strong>
          </div>
        </section>
        <section className="crm-care-panel">
          <header>
            <div>
              <h3>Customer follow-up</h3>
              <p>Record whether extended coverage or a Service plan has been discussed.</p>
            </div>
          </header>
          <label className="crm-care-field">
            <span>Follow-up status</span>
            <select
              disabled={!canEdit}
              onChange={(event) => setOfferStatus(event.target.value as CrmWarrantyOfferStatus)}
              value={offerStatus}
            >
              <option value="not_offered">Not discussed</option>
              <option value="offered">Offer presented</option>
              <option value="interested">Customer interested</option>
              <option value="declined">Customer declined</option>
            </select>
          </label>
          {canEdit ? (
            <div className="crm-care-inline-actions">
              <Button
                busy={busy}
                disabled={offerStatus === card.offerStatus}
                onClick={() => void save()}
              >
                Save status
              </Button>
              <Link
                className="vista-button vista-button--secondary"
                to="/modules/erp.sales/subscriptions"
              >
                Open Service plans
              </Link>
            </div>
          ) : null}
        </section>
        <section className="crm-care-panel">
          <header>
            <div>
              <h3>Warranty claims</h3>
              <p>
                {related.length
                  ? `${related.length} linked claim${related.length === 1 ? '' : 's'}.`
                  : 'No claim has been recorded for this device.'}
              </p>
            </div>
            {canEdit ? (
              <Button onClick={() => onClaim(card)} variant="secondary">
                <Icon name="plus" size={15} /> New claim
              </Button>
            ) : null}
          </header>
        </section>
      </div>
    </CareDrawer>
  );
}

function NewClaimDrawer({
  card,
  cards,
  onBack,
  onSaved,
  token,
}: {
  card?: CrmWarrantyCard;
  cards: CrmWarrantyCard[];
  onBack: () => void;
  onSaved: (claim: WarrantyClaim) => void;
  token: string;
}) {
  const [cardId, setCardId] = useState(card?.id ?? cards[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = cards.find((item) => item.id === cardId);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await createCrmWarrantyClaim(token, crypto.randomUUID(), {
          customerEquipmentId: selected.customerEquipmentId,
          customerLocationId: selected.customerLocationId,
          customerPartnerId: selected.customerPartnerId,
          description: description.trim(),
        }),
      );
    } catch (caught) {
      setError(errorText(caught, 'The warranty claim could not be created.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <CareDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Registered customer equipment"
      title="New warranty claim"
    >
      <form className="crm-care-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <FormSection index="1" title="Device">
          <label className="crm-care-field">
            <span>Warranty card and device</span>
            <select onChange={(event) => setCardId(event.target.value)} required value={cardId}>
              <option value="">Choose a device</option>
              {cards.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.deviceName} · {item.serialNumber} · {item.customerName}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <div className="crm-care-selection">
              <Icon name="shield" size={18} />
              <span>
                <strong>{selected.number}</strong>
                <small>
                  {formatDate(selected.warrantyEndsOn, 'Europe/Sofia')} · {coverageText(selected)}
                </small>
              </span>
              <Status value={selected.status} />
            </div>
          ) : null}
        </FormSection>
        <FormSection index="2" title="Reported issue">
          <label className="crm-care-field">
            <span>Description</span>
            <textarea
              maxLength={4000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe the fault, when it appeared, and any checks already made."
              required
              rows={7}
              value={description}
            />
          </label>
        </FormSection>
        <DrawerActions
          busy={busy}
          disabled={!selected || !description.trim()}
          onBack={onBack}
          submit="Create claim"
        />
      </form>
    </CareDrawer>
  );
}

function ClaimDrawer({
  canEdit,
  claim,
  onBack,
  onChanged,
  token,
  timezone,
}: {
  canEdit: boolean;
  claim: WarrantyClaim;
  onBack: () => void;
  onChanged: (claim: WarrantyClaim) => void;
  token: string;
  timezone: string;
}) {
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileAttempt = useRef<{ file: File; key: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function transition(nextStatus: TransitionWarrantyClaimRequest['nextStatus']) {
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await transitionCrmWarrantyClaim(token, claim.id, crypto.randomUUID(), {
          expectedVersion: claim.version,
          nextStatus,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      );
      setNote('');
    } catch (caught) {
      setError(errorText(caught, 'The claim status could not be changed.'));
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!file) return;
    if (fileAttempt.current?.file !== file)
      fileAttempt.current = { file, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadManagedFile(
        token,
        'warranty_claim',
        claim.id,
        fileAttempt.current.key,
        file,
      );
      onChanged({
        ...claim,
        attachments: [...claim.attachments.filter((item) => item.id !== uploaded.id), uploaded],
      });
      setFile(null);
      fileAttempt.current = null;
      if (fileInput.current) fileInput.current.value = '';
    } catch (caught) {
      setError(errorText(caught, 'The supporting file could not be uploaded.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <CareDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${claim.customerName} · ${claim.serialNumber}`}
      title={claim.number}
    >
      <div className="crm-care-drawer-content">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="crm-care-card-hero">
          <span>
            <Icon name="service" size={24} />
          </span>
          <div>
            <small>Warranty claim</small>
            <h3>{claim.deviceName}</h3>
            <p>{claim.customerLocationName}</p>
          </div>
          <Status value={claim.status} />
        </section>
        <section className="crm-care-panel">
          <header>
            <div>
              <h3>Reported issue</h3>
              <p>Received {formatDateTime(claim.receivedAt, timezone)}</p>
            </div>
          </header>
          <p>{claim.description}</p>
          {claim.decisionNote ? (
            <blockquote>
              <strong>Decision</strong>
              {claim.decisionNote}
            </blockquote>
          ) : null}
        </section>
        <section className="crm-care-panel">
          <header>
            <div>
              <h3>Supporting files</h3>
              <p>Photos and documents stay with this claim.</p>
            </div>
            <span className="crm-care-count">{claim.attachments.length}</span>
          </header>
          <div className="crm-care-files">
            {claim.attachments.map((item) => (
              <ClaimFile file={item} key={item.id} token={token} />
            ))}
            {canEdit && claim.status !== 'closed' ? (
              <div className="crm-care-upload">
                <input
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  aria-label="Supporting file"
                  disabled={busy}
                  ref={fileInput}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  type="file"
                />
                <Button
                  busy={busy}
                  disabled={!file}
                  onClick={() => void upload()}
                  variant="secondary"
                >
                  Upload file
                </Button>
              </div>
            ) : null}
          </div>
        </section>
        <section className="crm-care-panel">
          <header>
            <div>
              <h3>Claim history</h3>
              <p>Every decision is recorded.</p>
            </div>
          </header>
          <ol className="crm-care-history">
            {claim.history.map((entry) => (
              <li key={entry.id}>
                <span />
                <div>
                  <strong>{statusLabel(entry.nextStatus)}</strong>
                  {entry.note ? <p>{entry.note}</p> : null}
                  <small>
                    {formatDateTime(entry.changedAt, timezone)}
                    {entry.changedByName ? ` · ${entry.changedByName}` : ''}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </section>
        {canEdit && claim.status !== 'closed' ? (
          <section className="crm-care-panel">
            <header>
              <div>
                <h3>Next step</h3>
                <p>Move the claim through review and record the decision.</p>
              </div>
            </header>
            {claim.status === 'under_review' ? (
              <label className="crm-care-field">
                <span>Decision note</span>
                <textarea
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Record the findings and decision reason."
                  required
                  rows={4}
                  value={note}
                />
              </label>
            ) : null}
            <div className="crm-care-inline-actions">
              {claim.status === 'received' ? (
                <Button onClick={() => void transition('under_review')}>Start review</Button>
              ) : null}
              {claim.status === 'under_review' ? (
                <>
                  <Button disabled={!note.trim()} onClick={() => void transition('approved')}>
                    Approve claim
                  </Button>
                  <Button
                    disabled={!note.trim()}
                    onClick={() => void transition('rejected')}
                    variant="secondary"
                  >
                    Reject claim
                  </Button>
                </>
              ) : null}
              {claim.status === 'approved' || claim.status === 'rejected' ? (
                <Button onClick={() => void transition('closed')}>Close claim</Button>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </CareDrawer>
  );
}

function NewSurveyDrawer({
  onBack,
  onSaved,
  sources,
  token,
}: {
  onBack: () => void;
  onSaved: (survey: CrmCustomerSurvey) => void;
  sources: CrmAfterSalesOverview['surveySources'];
  token: string;
}) {
  const [sourceKey, setSourceKey] = useState(
    sources[0] ? `${sources[0].sourceKind}:${sources[0].id}` : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = sources.find((item) => `${item.sourceKind}:${item.id}` === sourceKey);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await sendCrmSurvey(token, crypto.randomUUID(), {
          sourceId: selected.id,
          sourceKind: selected.sourceKind,
        }),
      );
    } catch (caught) {
      setError(errorText(caught, 'The survey could not be sent.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <CareDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Completed customer work"
      title="Send customer survey"
    >
      <form className="crm-care-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <FormSection index="1" title="Choose completed work">
          {!sources.length ? (
            <CareEmpty title="Every completed delivery and Service job already has a survey." />
          ) : (
            <label className="crm-care-field">
              <span>Delivery or Service job</span>
              <select
                onChange={(event) => setSourceKey(event.target.value)}
                required
                value={sourceKey}
              >
                {sources.map((item) => (
                  <option
                    key={`${item.sourceKind}:${item.id}`}
                    value={`${item.sourceKind}:${item.id}`}
                  >
                    {item.customerName} · {item.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected ? (
            <div className="crm-care-selection">
              <Icon name={selected.sourceKind === 'service' ? 'service' : 'logistics'} size={18} />
              <span>
                <strong>{selected.customerName}</strong>
                <small>
                  {selected.sourceKind === 'service'
                    ? 'Post-Service survey'
                    : 'Post-delivery survey'}
                </small>
              </span>
            </div>
          ) : null}
        </FormSection>
        <FormSection index="2" title="Survey question">
          <div className="crm-survey-question">
            <strong>How likely are you to recommend Vista Service?</strong>
            <span>0 — Not at all likely</span>
            <span>10 — Extremely likely</span>
          </div>
        </FormSection>
        <DrawerActions busy={busy} disabled={!selected} onBack={onBack} submit="Send survey" />
      </form>
    </CareDrawer>
  );
}

function SurveyDrawer({
  canEdit,
  onBack,
  onSaved,
  survey,
  token,
  timezone,
}: {
  canEdit: boolean;
  onBack: () => void;
  onSaved: (survey: CrmCustomerSurvey) => void;
  survey: CrmCustomerSurvey;
  token: string;
  timezone: string;
}) {
  const [score, setScore] = useState<number | null>(survey.score ?? null);
  const [comment, setComment] = useState(survey.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (score === null) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await recordCrmSurveyResponse(token, survey.id, crypto.randomUUID(), {
          score,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      );
    } catch (caught) {
      setError(errorText(caught, 'The survey response could not be saved.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <CareDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${survey.customerName} · ${survey.sourceLabel}`}
      title={survey.number}
    >
      <div className="crm-care-drawer-content">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="crm-care-card-hero">
          <span>
            <Icon name="chart" size={24} />
          </span>
          <div>
            <small>{survey.sourceKind === 'service' ? 'After Service' : 'After delivery'}</small>
            <h3>{survey.customerName}</h3>
            <p>Sent {formatDateTime(survey.sentAt, timezone)}</p>
          </div>
          <Status value={survey.status} />
        </section>
        {survey.status === 'responded' ? (
          <section className="crm-survey-result">
            <span>Customer score</span>
            <strong>{survey.score}</strong>
            <small>{npsGroup(survey.score ?? 0)}</small>
            {survey.comment ? <p>{survey.comment}</p> : null}
          </section>
        ) : canEdit ? (
          <form className="crm-care-form is-embedded" onSubmit={(event) => void submit(event)}>
            <FormSection index="1" title="Record customer response">
              <fieldset className="crm-score-picker">
                <legend>Recommendation score</legend>
                {Array.from({ length: 11 }, (_, value) => (
                  <label className={score === value ? 'is-selected' : undefined} key={value}>
                    <input
                      checked={score === value}
                      name="nps-score"
                      onChange={() => setScore(value)}
                      type="radio"
                      value={value}
                    />
                    <span>{value}</span>
                  </label>
                ))}
              </fieldset>
              <label className="crm-care-field">
                <span>Customer comment (optional)</span>
                <textarea
                  maxLength={2000}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Record the customer’s words or key feedback."
                  rows={5}
                  value={comment}
                />
              </label>
            </FormSection>
            <DrawerActions
              busy={busy}
              disabled={score === null}
              onBack={onBack}
              submit="Save response"
            />
          </form>
        ) : (
          <CareEmpty title="This survey is awaiting a customer response." />
        )}
      </div>
    </CareDrawer>
  );
}

function NewReferralDrawer({
  assignees,
  customers,
  onBack,
  onSaved,
  token,
}: {
  assignees: CrmAfterSalesOverview['assignees'];
  customers: CrmAfterSalesOverview['customers'];
  onBack: () => void;
  onSaved: (referral: CrmReferral) => void;
  token: string;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '');
  const [ownerId, setOwnerId] = useState(assignees[0]?.id ?? '');
  const [organizationName, setOrganizationName] = useState('');
  const [contactName, setContactName] = useState('');
  const [telephone, setTelephone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: CreateCrmReferralRequest = {
      contactName: contactName.trim(),
      organizationName: organizationName.trim(),
      ownerAccountId: ownerId,
      referringCustomerPartnerId: customerId,
      ...(telephone.trim() ? { telephone: telephone.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      onSaved(await createCrmReferral(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The referral could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <CareDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Customer-referred prospect"
      title="Record referral"
    >
      <form className="crm-care-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <FormSection index="1" title="Referral source">
          <label className="crm-care-field">
            <span>Referring customer</span>
            <select
              onChange={(event) => setCustomerId(event.target.value)}
              required
              value={customerId}
            >
              {customers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="crm-care-field">
            <span>Lead owner</span>
            <select onChange={(event) => setOwnerId(event.target.value)} required value={ownerId}>
              {assignees.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
        </FormSection>
        <FormSection index="2" title="Prospect">
          <div className="crm-care-form-grid">
            <label className="crm-care-field">
              <span>Organization</span>
              <input
                maxLength={255}
                onChange={(event) => setOrganizationName(event.target.value)}
                required
                value={organizationName}
              />
            </label>
            <label className="crm-care-field">
              <span>Contact person</span>
              <input
                maxLength={255}
                onChange={(event) => setContactName(event.target.value)}
                required
                value={contactName}
              />
            </label>
            <label className="crm-care-field">
              <span>Telephone</span>
              <input
                maxLength={100}
                onChange={(event) => setTelephone(event.target.value)}
                value={telephone}
              />
            </label>
            <label className="crm-care-field">
              <span>Email</span>
              <input
                maxLength={320}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
            </label>
          </div>
          <label className="crm-care-field">
            <span>Context (optional)</span>
            <textarea
              maxLength={4000}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What is the prospect interested in?"
              rows={5}
              value={notes}
            />
          </label>
        </FormSection>
        <div className="crm-care-form-note">
          <Icon name="check" size={17} />
          <span>
            <strong>A new referral lead will be created automatically.</strong>
            <small>
              The prospect will appear in Leads & pipeline with this customer as its referral
              source.
            </small>
          </span>
        </div>
        <DrawerActions
          busy={busy}
          disabled={
            !customerId ||
            !ownerId ||
            !organizationName.trim() ||
            !contactName.trim() ||
            (!telephone.trim() && !email.trim())
          }
          onBack={onBack}
          submit="Record referral"
        />
      </form>
    </CareDrawer>
  );
}

function CareDrawer({
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
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.panel-back-button')?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onBack();
    }
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [busy, onBack]);
  return (
    <div className="security-drawer-layer">
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
        className="security-drawer is-wide crm-care-drawer"
        ref={ref}
        role="dialog"
      >
        <header className="panel-drawer-header crm-care-drawer-head">
          <button className="panel-back-button" disabled={busy} onClick={onBack} type="button">
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
        <div className="security-drawer-body crm-care-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function FormSection({
  children,
  index,
  title,
}: {
  children: ReactNode;
  index: string;
  title: string;
}) {
  return (
    <section className="crm-care-form-section">
      <header>
        <span>{index}</span>
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  );
}
function DrawerActions({
  busy,
  disabled,
  onBack,
  submit,
}: {
  busy: boolean;
  disabled?: boolean;
  onBack: () => void;
  submit: string;
}) {
  return (
    <div className="crm-care-drawer-actions">
      <Button busy={busy} disabled={disabled} type="submit">
        {submit}
      </Button>
      <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
        Back
      </Button>
    </div>
  );
}
function Metric({ label, tone, value }: { label: string; tone?: 'warning'; value: number }) {
  return (
    <div className={tone ? `is-${tone}` : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function NpsPart({ label, tone, value }: { label: string; tone: string; value: number }) {
  return (
    <div className={`is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function CareState({ title }: { title: string }) {
  return (
    <section className="crm-care-state">
      <span className="spinner" />
      <h2>{title}</h2>
    </section>
  );
}
function CareEmpty({ title }: { title: string }) {
  return (
    <div className="crm-care-empty">
      <Icon name="activity" size={20} />
      <p>{title}</p>
    </div>
  );
}
function Status({ value }: { value: string }) {
  return <span className={`crm-care-status is-${value}`}>{statusLabel(value)}</span>;
}
function ClaimFile({ file, token }: { file: ManagedFile; token: string }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const downloaded = await downloadManagedFile(token, file);
      const url = URL.createObjectURL(downloaded.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = downloaded.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="crm-care-file">
      <Icon name="finance" size={17} />
      <span>
        <strong>{file.originalName}</strong>
        <small>
          {formatBytes(file.byteSize)} · version {file.version}
        </small>
      </span>
      <Button busy={busy} onClick={() => void download()} variant="quiet">
        Download
      </Button>
    </div>
  );
}
function coverageText(card: CrmWarrantyCard) {
  if (card.remainingDays < 0) return `Ended ${Math.abs(card.remainingDays)} days ago`;
  if (card.remainingDays === 0) return 'Ends today';
  return `${card.remainingDays} days remaining`;
}
function npsGroup(score: number) {
  return score >= 9 ? 'Promoter' : score >= 7 ? 'Passive' : 'Detractor';
}
function statusLabel(value: string) {
  return (
    (
      {
        active: 'Active',
        approved: 'Approved',
        awaiting_response: 'Awaiting response',
        closed: 'Closed',
        expired: 'Expired',
        received: 'Received',
        rejected: 'Rejected',
        responded: 'Responded',
        under_review: 'Under review',
      } as Record<string, string>
    )[value] ?? value.replaceAll('_', ' ')
  );
}
function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: timezone }).format(
    new Date(`${value}T12:00:00Z`),
  );
}
function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}
function formatBytes(value: number) {
  return value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;
}
function errorText(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : fallback;
}
