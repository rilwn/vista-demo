import { Button, InlineAlert } from '@vista/ui';
import type {
  CreateCrmTicketRequest,
  CrmSlaPolicyReference,
  CrmTicket,
  CrmTicketChannel,
  CrmTicketPage,
  CrmTicketPriority,
  CrmTicketReferenceData,
  CrmTicketStatus,
  ServiceType,
} from '@vista/contracts';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  createCrmTicket,
  createServiceRequestFromCrmTicket,
  getCrmTicket,
  getCrmTicketReferenceData,
  listCrmTickets,
  recordCrmTicketResponse,
  transitionCrmTicket,
} from '../api/crm-tickets';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Link, useRouter } from '../routing/Router';

const emptyPage: CrmTicketPage = {
  items: [],
  page: 1,
  pageSize: 25,
  summary: { atRisk: 0, breached: 0, open: 0, unassigned: 0 },
  total: 0,
  totalPages: 0,
};

const emptyReferences: CrmTicketReferenceData = {
  assignees: [],
  businessTimezone: 'Europe/Sofia',
  categories: [],
  customers: [],
  equipment: [],
  locations: [],
  slaPolicies: [],
  subscriptions: [],
};

const priorities: CrmTicketPriority[] = ['low', 'normal', 'high', 'urgent'];
const channels: CrmTicketChannel[] = ['telephone', 'email', 'customer_portal', 'on_site', 'chat'];
const statuses: CrmTicketStatus[] = [
  'new',
  'in_progress',
  'waiting_customer',
  'resolved',
  'closed',
  'cancelled',
];

export function CrmTicketsPage() {
  const { hasPermission, session } = useAuth();
  const { location } = useRouter();
  const openedFromNavigation = useRef(false);
  const token = session?.sessionToken ?? '';
  const canCreate = hasPermission('crm', 'create');
  const canEdit = hasPermission('crm', 'edit');
  const canCreateService = hasPermission('erp.service', 'create');
  const [references, setReferences] = useState(emptyReferences);
  const [page, setPage] = useState(emptyPage);
  const [pageNumber, setPageNumber] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CrmTicketStatus | ''>('');
  const [priority, setPriority] = useState<CrmTicketPriority | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<CrmTicket | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextReferences, nextPage] = await Promise.all([
        getCrmTicketReferenceData(token),
        listCrmTickets(token, {
          page: pageNumber,
          pageSize: 25,
          ...(priority ? { priority } : {}),
          ...(search ? { search } : {}),
          ...(status ? { status } : {}),
        }),
      ]);
      setReferences(nextReferences);
      setPage(nextPage);
      setError(null);
    } catch (caught) {
      setError(errorText(caught, 'Tickets could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [pageNumber, priority, search, status, token]);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (openedFromNavigation.current) return;
    const ticketId = navigationTicketId(location.state);
    if (!ticketId) return;
    openedFromNavigation.current = true;
    void openTicket(ticketId);
  });

  async function openTicket(id: string) {
    try {
      setSelected(await getCrmTicket(token, id));
    } catch (caught) {
      setNotice(errorText(caught, 'The ticket could not be opened.'));
    }
  }

  function saved(ticket: CrmTicket, message: string) {
    setSelected(ticket);
    setNotice(message);
    void load();
  }

  return (
    <div className="page-stack crm-ticket-workspace">
      <header className="page-header crm-ticket-header">
        <div>
          <p className="page-eyebrow">CRM · Customer service</p>
          <h1>Tickets &amp; SLA</h1>
          <p>Keep customer issues, response commitments, and Service work connected.</p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" size={17} /> New ticket
          </Button>
        ) : null}
      </header>

      <CrmTabs />

      {notice ? (
        <InlineAlert tone="success">
          <div className="crm-ticket-notice">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} type="button">
              Close
            </button>
          </div>
        </InlineAlert>
      ) : null}
      {error ? (
        <InlineAlert tone="error">
          <div className="crm-ticket-notice">
            <span>{error}</span>
            <button onClick={() => void load()} type="button">
              Try again
            </button>
          </div>
        </InlineAlert>
      ) : null}

      <section aria-label="Ticket summary" className="crm-ticket-summary">
        <Metric label="Open tickets" value={page.summary.open} />
        <Metric label="Near deadline" tone="warning" value={page.summary.atRisk} />
        <Metric label="Past deadline" tone="danger" value={page.summary.breached} />
        <Metric label="Unassigned" value={page.summary.unassigned} />
      </section>

      <section className="crm-ticket-register">
        <header className="crm-ticket-register-header">
          <div>
            <h2>Customer issues</h2>
            <p>
              {page.total} {page.total === 1 ? 'ticket' : 'tickets'} in this view
            </p>
          </div>
          <form
            className="crm-ticket-filters"
            onSubmit={(event) => {
              event.preventDefault();
              setPageNumber(1);
              setSearch(searchDraft.trim());
            }}
          >
            <label className="crm-ticket-search">
              <span className="sr-only">Search tickets</span>
              <Icon name="search" size={16} />
              <input
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Number, customer, or subject"
                value={searchDraft}
              />
            </label>
            <select
              aria-label="Ticket status"
              onChange={(event) => {
                setPageNumber(1);
                setStatus(event.target.value as CrmTicketStatus | '');
              }}
              value={status}
            >
              <option value="">All statuses</option>
              {statuses.map((item) => (
                <option key={item} value={item}>
                  {statusLabel(item)}
                </option>
              ))}
            </select>
            <select
              aria-label="Ticket priority"
              onChange={(event) => {
                setPageNumber(1);
                setPriority(event.target.value as CrmTicketPriority | '');
              }}
              value={priority}
            >
              <option value="">All priorities</option>
              {priorities.map((item) => (
                <option key={item} value={item}>
                  {priorityLabel(item)}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
        </header>

        {loading ? <RegisterState title="Loading tickets" /> : null}
        {!loading && !page.items.length ? (
          <RegisterState title="No tickets match this view">
            <p>Change the filters or create a customer ticket.</p>
          </RegisterState>
        ) : null}
        {!loading && page.items.length ? (
          <div className="crm-ticket-list">
            {page.items.map((ticket) => (
              <button
                className="crm-ticket-row"
                key={ticket.id}
                onClick={() => void openTicket(ticket.id)}
                type="button"
              >
                <span className={`crm-priority-mark is-${ticket.priority}`} aria-hidden="true" />
                <span className="crm-ticket-row-main">
                  <span>
                    <strong>{ticket.subject}</strong>
                    <small>
                      {ticket.number} · {ticket.customerName}
                    </small>
                  </span>
                  <span className="crm-ticket-row-tags">
                    <TicketStatus value={ticket.status} />
                    <SlaState value={ticket.resolutionState} />
                  </span>
                </span>
                <span className="crm-ticket-row-meta">
                  <strong>{ticket.assignedTo?.displayName ?? 'Unassigned'}</strong>
                  <small>
                    Resolve by {formatDateTime(ticket.resolutionDueAt, references.businessTimezone)}
                  </small>
                </span>
                <Icon name="arrow" size={16} />
              </button>
            ))}
          </div>
        ) : null}
        <Pager page={page} onPageChange={setPageNumber} />
      </section>

      {creating ? (
        <NewTicketDrawer
          onBack={() => setCreating(false)}
          onSaved={(ticket) => {
            setCreating(false);
            saved(ticket, `${ticket.number} was created.`);
          }}
          references={references}
          token={token}
        />
      ) : null}
      {selected ? (
        <TicketDrawer
          canCreateService={canCreateService}
          canEdit={canEdit}
          onBack={() => setSelected(null)}
          onSaved={saved}
          references={references}
          ticket={selected}
          token={token}
        />
      ) : null}
    </div>
  );
}

export function CrmTabs() {
  const items = [
    ['/modules/crm/locations-equipment', 'Locations & equipment'],
    ['/modules/crm/timeline', 'Timeline'],
    ['/modules/crm/leads', 'Leads & pipeline'],
    ['/modules/crm/tickets', 'Tickets'],
    ['/modules/crm/customer-care', 'Customer care'],
    ['/modules/crm/analytics', 'Analytics'],
  ] as const;
  return (
    <nav aria-label="CRM sections" className="workflow-tabs crm-tabs">
      {items.map(([to, label]) => (
        <Link
          className={({ isActive }) => (isActive ? 'is-active' : undefined)}
          end
          key={to}
          to={to}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

function NewTicketDrawer({
  onBack,
  onSaved,
  references,
  token,
}: {
  onBack: () => void;
  onSaved: (ticket: CrmTicket) => void;
  references: CrmTicketReferenceData;
  token: string;
}) {
  const [customerPartnerId, setCustomerPartnerId] = useState(references.customers[0]?.id ?? '');
  const [customerLocationId, setCustomerLocationId] = useState('');
  const [customerEquipmentId, setCustomerEquipmentId] = useState('');
  const [serviceSubscriptionContractId, setServiceSubscriptionContractId] = useState('');
  const [categoryId, setCategoryId] = useState(references.categories[0]?.id ?? '');
  const [priority, setPriority] = useState<CrmTicketPriority>('normal');
  const [channel, setChannel] = useState<CrmTicketChannel>('telephone');
  const [assignedToAccountId, setAssignedToAccountId] = useState('');
  const [slaPolicyId, setSlaPolicyId] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locations = references.locations.filter(
    (item) => item.customerPartnerId === customerPartnerId,
  );
  const equipment = references.equipment.filter(
    (item) =>
      item.active &&
      item.customerPartnerId === customerPartnerId &&
      item.customerLocationId === customerLocationId,
  );
  const subscriptions = references.subscriptions.filter(
    (item) =>
      item.customerPartnerId === customerPartnerId &&
      item.customerLocationId === customerLocationId &&
      item.customerEquipmentIds.includes(customerEquipmentId),
  );
  const policies = applicablePolicies(
    references.slaPolicies,
    customerPartnerId,
    serviceSubscriptionContractId,
    priority,
  );

  useEffect(() => {
    if (!policies.some((item) => item.id === slaPolicyId)) setSlaPolicyId(policies[0]?.id ?? '');
  }, [policies, slaPolicyId]);

  function changeCustomer(value: string) {
    setCustomerPartnerId(value);
    setCustomerLocationId('');
    setCustomerEquipmentId('');
    setServiceSubscriptionContractId('');
  }

  function changeLocation(value: string) {
    setCustomerLocationId(value);
    setCustomerEquipmentId('');
    setServiceSubscriptionContractId('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CreateCrmTicketRequest = {
        ...(assignedToAccountId ? { assignedToAccountId } : {}),
        categoryId,
        channel,
        ...(customerEquipmentId ? { customerEquipmentId } : {}),
        ...(customerLocationId ? { customerLocationId } : {}),
        customerPartnerId,
        description,
        priority,
        ...(serviceSubscriptionContractId ? { serviceSubscriptionContractId } : {}),
        slaPolicyId,
        subject,
      };
      onSaved(await createCrmTicket(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The ticket could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CrmDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Customer issue and response commitment"
      title="New ticket"
    >
      <form className="crm-ticket-form" onSubmit={(event) => void submit(event)}>
        <div className="crm-ticket-form-scroll">
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          <DrawerSection
            index="1"
            title="Customer"
            description="A location and device are optional until Service work is needed."
          >
            <TicketField label="Customer">
              <select
                onChange={(event) => changeCustomer(event.target.value)}
                required
                value={customerPartnerId}
              >
                {references.customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </TicketField>
            <div className="crm-ticket-form-grid">
              <TicketField label="Location (optional)">
                <select
                  onChange={(event) => changeLocation(event.target.value)}
                  value={customerLocationId}
                >
                  <option value="">Not selected</option>
                  {locations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </TicketField>
              <TicketField label="Device (optional)">
                <select
                  disabled={!customerLocationId}
                  onChange={(event) => {
                    setCustomerEquipmentId(event.target.value);
                    setServiceSubscriptionContractId('');
                  }}
                  value={customerEquipmentId}
                >
                  <option value="">Not selected</option>
                  {equipment.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.deviceName} · {item.serialNumber}
                    </option>
                  ))}
                </select>
              </TicketField>
            </div>
            {subscriptions.length ? (
              <TicketField label="Service subscription (optional)">
                <select
                  onChange={(event) => setServiceSubscriptionContractId(event.target.value)}
                  value={serviceSubscriptionContractId}
                >
                  <option value="">No contract selected</option>
                  {subscriptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.number}
                    </option>
                  ))}
                </select>
              </TicketField>
            ) : null}
          </DrawerSection>

          <DrawerSection
            index="2"
            title="Ticket details"
            description="Describe the issue in the customer’s language."
          >
            <div className="crm-ticket-form-grid">
              <TicketField label="Channel">
                <select
                  onChange={(event) => setChannel(event.target.value as CrmTicketChannel)}
                  value={channel}
                >
                  {channels.map((item) => (
                    <option key={item} value={item}>
                      {channelLabel(item)}
                    </option>
                  ))}
                </select>
              </TicketField>
              <TicketField label="Category">
                <select
                  onChange={(event) => setCategoryId(event.target.value)}
                  required
                  value={categoryId}
                >
                  {references.categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </TicketField>
            </div>
            <TicketField label="Subject">
              <input
                maxLength={255}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Short description of the customer’s issue"
                required
                value={subject}
              />
            </TicketField>
            <TicketField label="Details">
              <textarea
                maxLength={4000}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What happened, when it started, and what the customer needs"
                required
                rows={5}
                value={description}
              />
            </TicketField>
          </DrawerSection>

          <DrawerSection
            index="3"
            title="Ownership & SLA"
            description="The ticket keeps the response and resolution times selected here."
          >
            <div className="crm-ticket-form-grid">
              <TicketField label="Priority">
                <select
                  onChange={(event) => setPriority(event.target.value as CrmTicketPriority)}
                  value={priority}
                >
                  {priorities.map((item) => (
                    <option key={item} value={item}>
                      {priorityLabel(item)}
                    </option>
                  ))}
                </select>
              </TicketField>
              <TicketField label="Assigned to">
                <select
                  onChange={(event) => setAssignedToAccountId(event.target.value)}
                  value={assignedToAccountId}
                >
                  <option value="">Leave unassigned</option>
                  {references.assignees.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </TicketField>
            </div>
            <TicketField label="SLA rule">
              <select
                onChange={(event) => setSlaPolicyId(event.target.value)}
                required
                value={slaPolicyId}
              >
                {policies.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · respond {duration(item.responseMinutes)} · resolve{' '}
                    {duration(item.resolutionMinutes)}
                  </option>
                ))}
              </select>
            </TicketField>
            {!policies.length ? (
              <InlineAlert tone="warning">
                No active SLA rule applies to this priority. Ask a CRM administrator to configure
                one.
              </InlineAlert>
            ) : null}
          </DrawerSection>
        </div>
        <DrawerActions
          busy={busy}
          disabled={!customerPartnerId || !categoryId || !slaPolicyId}
          onBack={onBack}
          submitLabel="Create ticket"
        />
      </form>
    </CrmDrawer>
  );
}

function TicketDrawer({
  canCreateService,
  canEdit,
  onBack,
  onSaved,
  references,
  ticket,
  token,
}: {
  canCreateService: boolean;
  canEdit: boolean;
  onBack: () => void;
  onSaved: (ticket: CrmTicket, message: string) => void;
  references: CrmTicketReferenceData;
  ticket: CrmTicket;
  token: string;
}) {
  const { navigate } = useRouter();
  const [mode, setMode] = useState<'details' | 'respond' | 'status' | 'service'>('details');
  const [note, setNote] = useState('');
  const [nextStatus, setNextStatus] = useState<CrmTicketStatus | ''>('');
  const [serviceType, setServiceType] = useState<ServiceType>('out_of_warranty');
  const [subscriptionContractId, setSubscriptionContractId] = useState(
    ticket.serviceSubscriptionContractId ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transitions = allowedTransitions[ticket.status];
  const subscriptions = references.subscriptions.filter(
    (item) =>
      item.customerPartnerId === ticket.customerPartnerId &&
      item.customerLocationId === ticket.customerLocationId &&
      (!ticket.customerEquipmentId ||
        item.customerEquipmentIds.includes(ticket.customerEquipmentId)),
  );

  async function respond(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await recordCrmTicketResponse(token, ticket.id, crypto.randomUUID(), {
        expectedVersion: ticket.version,
        note,
      });
      setMode('details');
      setNote('');
      onSaved(saved, `First response recorded for ${saved.number}.`);
    } catch (caught) {
      setError(errorText(caught, 'The response could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  async function transition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nextStatus) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await transitionCrmTicket(token, ticket.id, crypto.randomUUID(), {
        expectedVersion: ticket.version,
        note,
        status: nextStatus,
      });
      setMode('details');
      setNote('');
      setNextStatus('');
      onSaved(saved, `${saved.number} is now ${statusLabel(saved.status).toLowerCase()}.`);
    } catch (caught) {
      setError(errorText(caught, 'The ticket status could not be updated.'));
    } finally {
      setBusy(false);
    }
  }

  async function linkService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await createServiceRequestFromCrmTicket(token, ticket.id, crypto.randomUUID(), {
        expectedVersion: ticket.version,
        serviceType,
        ...(serviceType === 'subscription' ? { subscriptionContractId } : {}),
      });
      setMode('details');
      onSaved(
        saved,
        `${saved.serviceLink?.serviceRequestNumber ?? 'The Service request'} was created and linked.`,
      );
    } catch (caught) {
      setError(errorText(caught, 'The Service request could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CrmDrawer busy={busy} onBack={onBack} subtitle={ticket.customerName} title={ticket.number}>
      <div className="crm-ticket-preview">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="crm-ticket-preview-hero">
          <div>
            <div className="crm-ticket-preview-badges">
              <TicketStatus value={ticket.status} />
              <span className={`crm-priority-pill is-${ticket.priority}`}>
                {priorityLabel(ticket.priority)}
              </span>
            </div>
            <h3>{ticket.subject}</h3>
            <p>
              {ticket.category.name} · {channelLabel(ticket.channel)}
            </p>
          </div>
          {canEdit &&
          !ticket.respondedAt &&
          !['resolved', 'closed', 'cancelled'].includes(ticket.status) ? (
            <Button onClick={() => setMode('respond')}>Record response</Button>
          ) : null}
        </section>

        {mode === 'respond' ? (
          <ActionForm
            description="Record the first meaningful reply given to the customer."
            onCancel={() => setMode('details')}
            onSubmit={(event) => void respond(event)}
            submitLabel="Save response"
            title="Customer response"
            busy={busy}
          >
            <TicketField label="Response note">
              <textarea
                onChange={(event) => setNote(event.target.value)}
                required
                rows={4}
                value={note}
              />
            </TicketField>
          </ActionForm>
        ) : null}

        <section className="crm-ticket-sla-card">
          <header>
            <div>
              <span>SLA</span>
              <h3>{ticket.slaPolicy.name}</h3>
            </div>
            <SlaState value={ticket.resolutionState} />
          </header>
          <div className="crm-ticket-sla-grid">
            <SlaTimer
              label="First response"
              {...(ticket.respondedAt ? { completedAt: ticket.respondedAt } : {})}
              dueAt={ticket.responseDueAt}
              state={ticket.responseState}
              timezone={references.businessTimezone}
            />
            <SlaTimer
              label="Resolution"
              {...(ticket.resolvedAt ? { completedAt: ticket.resolvedAt } : {})}
              dueAt={ticket.resolutionDueAt}
              state={ticket.resolutionState}
              timezone={references.businessTimezone}
            />
          </div>
        </section>

        <section className="crm-ticket-preview-section">
          <header>
            <div>
              <h3>Customer issue</h3>
              <p>Recorded {formatDateTime(ticket.createdAt, references.businessTimezone)}</p>
            </div>
          </header>
          <p className="crm-ticket-description">{ticket.description}</p>
          <dl className="crm-ticket-facts">
            <div>
              <dt>Customer</dt>
              <dd>{ticket.customerName}</dd>
            </div>
            <div>
              <dt>Assigned to</dt>
              <dd>{ticket.assignedTo?.displayName ?? 'Unassigned'}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{ticket.locationName ?? 'Not selected'}</dd>
            </div>
            <div>
              <dt>Device</dt>
              <dd>{ticket.equipmentName ?? 'Not selected'}</dd>
            </div>
          </dl>
        </section>

        <section className="crm-ticket-preview-section crm-ticket-service-link">
          <header>
            <div>
              <h3>ERP Service work</h3>
              <p>One linked request keeps both teams on the same customer issue.</p>
            </div>
            {ticket.serviceLink ? (
              <Button
                onClick={() =>
                  navigate('/modules/erp.service/requests', {
                    state: { serviceRequestId: ticket.serviceLink?.serviceRequestId },
                  })
                }
                variant="secondary"
              >
                Open Service
              </Button>
            ) : canCreateService ? (
              <Button
                disabled={!ticket.customerLocationId || !ticket.customerEquipmentId}
                onClick={() => setMode('service')}
                variant="secondary"
              >
                Create Service request
              </Button>
            ) : null}
          </header>
          {ticket.serviceLink ? (
            <div className="crm-ticket-linked-record">
              <Icon name="check" size={17} />
              <span>
                <strong>{ticket.serviceLink.serviceRequestNumber}</strong>
                <small>Linked to this ticket</small>
              </span>
            </div>
          ) : !ticket.customerLocationId || !ticket.customerEquipmentId ? (
            <p className="crm-ticket-hint">
              Add a location and device when the issue needs a technician visit.
            </p>
          ) : (
            <p className="crm-ticket-hint">No Service request has been created.</p>
          )}
        </section>

        {mode === 'service' ? (
          <ActionForm
            description="The request will reuse this customer, location, device, priority, and issue."
            onCancel={() => setMode('details')}
            onSubmit={(event) => void linkService(event)}
            submitLabel="Create & link"
            title="Create Service request"
            busy={busy}
          >
            <TicketField label="Service type">
              <select
                onChange={(event) => setServiceType(event.target.value as ServiceType)}
                value={serviceType}
              >
                <option value="warranty">Warranty</option>
                <option value="out_of_warranty">Out of warranty</option>
                <option value="subscription">Service subscription</option>
              </select>
            </TicketField>
            {serviceType === 'subscription' ? (
              <TicketField label="Service subscription">
                <select
                  onChange={(event) => setSubscriptionContractId(event.target.value)}
                  required
                  value={subscriptionContractId}
                >
                  <option value="">Choose contract</option>
                  {subscriptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.number}
                    </option>
                  ))}
                </select>
              </TicketField>
            ) : null}
          </ActionForm>
        ) : null}

        {canEdit && transitions.length ? (
          <section className="crm-ticket-preview-section">
            <header>
              <div>
                <h3>Ticket status</h3>
                <p>Move the issue forward with a short customer-facing note.</p>
              </div>
              {mode !== 'status' ? (
                <Button onClick={() => setMode('status')} variant="quiet">
                  Update status
                </Button>
              ) : null}
            </header>
            {mode === 'status' ? (
              <ActionForm
                busy={busy}
                description="The change and note are retained in the timeline."
                onCancel={() => setMode('details')}
                onSubmit={(event) => void transition(event)}
                submitLabel="Update ticket"
                title="Next status"
              >
                <TicketField label="Status">
                  <select
                    onChange={(event) => setNextStatus(event.target.value as CrmTicketStatus)}
                    required
                    value={nextStatus}
                  >
                    <option value="">Choose status</option>
                    {transitions.map((item) => (
                      <option key={item} value={item}>
                        {statusLabel(item)}
                      </option>
                    ))}
                  </select>
                </TicketField>
                <TicketField label="Note">
                  <textarea
                    onChange={(event) => setNote(event.target.value)}
                    required
                    rows={3}
                    value={note}
                  />
                </TicketField>
              </ActionForm>
            ) : null}
          </section>
        ) : null}

        <section className="crm-ticket-preview-section crm-ticket-timeline">
          <header>
            <div>
              <h3>Timeline</h3>
              <p>
                {ticket.history.length} recorded {ticket.history.length === 1 ? 'event' : 'events'}
              </p>
            </div>
          </header>
          <ol>
            {[...ticket.history].reverse().map((item) => (
              <li key={item.id}>
                <span aria-hidden="true" />
                <div>
                  <strong>{historyLabel(item.type, item.status)}</strong>
                  <p>{item.note}</p>
                  <small>
                    {formatDateTime(item.changedAt, references.businessTimezone)}
                    {item.changedByName ? ` · ${item.changedByName}` : ''}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </CrmDrawer>
  );
}

function CrmDrawer({
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
  const drawerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const drawerElement = drawerRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!drawerElement) return;
    const drawer: HTMLElement = drawerElement;
    const focusable = () =>
      Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    (drawer.querySelector<HTMLElement>('.panel-back-button') ?? drawer).focus();
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        drawer.focus();
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
    drawer.addEventListener('keydown', trapFocus);
    return () => {
      drawer.removeEventListener('keydown', trapFocus);
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
        className="security-drawer is-wide crm-ticket-drawer"
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="panel-drawer-header crm-ticket-drawer-header">
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
    <section className="crm-ticket-form-section">
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
function TicketField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="crm-ticket-field">
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
    <div className="crm-ticket-drawer-actions">
      <Button busy={busy} disabled={disabled} type="submit">
        {submitLabel}
      </Button>
      <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
        Back
      </Button>
    </div>
  );
}
function ActionForm({
  busy,
  children,
  description,
  onCancel,
  onSubmit,
  submitLabel,
  title,
}: {
  busy: boolean;
  children: ReactNode;
  description: string;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  title: string;
}) {
  return (
    <form className="crm-ticket-action-form" onSubmit={onSubmit}>
      <header>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      {children}
      <div>
        <Button busy={busy} type="submit">
          {submitLabel}
        </Button>
        <Button disabled={busy} onClick={onCancel} type="button" variant="secondary">
          Cancel
        </Button>
      </div>
    </form>
  );
}
function Metric({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: 'danger' | 'warning';
  value: number;
}) {
  return (
    <div className={tone ? `is-${tone}` : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function RegisterState({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <div className="crm-ticket-register-state">
      <Icon name="customers" size={24} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
function Pager({
  onPageChange,
  page,
}: {
  onPageChange: (page: number) => void;
  page: CrmTicketPage;
}) {
  if (page.totalPages < 2) return null;
  return (
    <nav aria-label="Ticket pages" className="crm-ticket-pager">
      <Button
        disabled={page.page <= 1}
        onClick={() => onPageChange(page.page - 1)}
        variant="secondary"
      >
        Previous
      </Button>
      <span>
        Page {page.page} of {page.totalPages}
      </span>
      <Button
        disabled={page.page >= page.totalPages}
        onClick={() => onPageChange(page.page + 1)}
        variant="secondary"
      >
        Next
      </Button>
    </nav>
  );
}
function TicketStatus({ value }: { value: CrmTicketStatus }) {
  return <span className={`crm-ticket-status is-${value}`}>{statusLabel(value)}</span>;
}
function SlaState({ value }: { value: CrmTicket['resolutionState'] }) {
  return <span className={`crm-sla-state is-${value}`}>{slaLabel(value)}</span>;
}
function SlaTimer({
  completedAt,
  dueAt,
  label,
  state,
  timezone,
}: {
  completedAt?: string;
  dueAt: string;
  label: string;
  state: CrmTicket['responseState'];
  timezone: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>
        {completedAt
          ? `Completed ${formatDateTime(completedAt, timezone)}`
          : formatDateTime(dueAt, timezone)}
      </strong>
      <small className={`is-${state}`}>{slaLabel(state)}</small>
    </div>
  );
}

const allowedTransitions: Record<CrmTicketStatus, CrmTicketStatus[]> = {
  cancelled: [],
  closed: [],
  in_progress: ['waiting_customer', 'resolved', 'cancelled'],
  new: ['in_progress', 'waiting_customer', 'resolved', 'cancelled'],
  resolved: ['in_progress', 'closed'],
  waiting_customer: ['in_progress', 'resolved', 'cancelled'],
};
function applicablePolicies(
  policies: CrmSlaPolicyReference[],
  customerId: string,
  contractId: string,
  priority: CrmTicketPriority,
) {
  return policies.filter(
    (item) =>
      (!item.customerPartnerId || item.customerPartnerId === customerId) &&
      (!item.serviceSubscriptionContractId || item.serviceSubscriptionContractId === contractId) &&
      (!item.priority || item.priority === priority),
  );
}
function priorityLabel(value: CrmTicketPriority) {
  return ({ high: 'High', low: 'Low', normal: 'Normal', urgent: 'Urgent' } as const)[value];
}
function channelLabel(value: CrmTicketChannel) {
  return (
    {
      chat: 'Chat',
      customer_portal: 'Customer portal',
      email: 'Email',
      on_site: 'On-site visit',
      telephone: 'Telephone',
    } as const
  )[value];
}
function statusLabel(value: CrmTicketStatus) {
  return (
    {
      cancelled: 'Cancelled',
      closed: 'Closed',
      in_progress: 'In progress',
      new: 'New',
      resolved: 'Resolved',
      waiting_customer: 'Waiting for customer',
    } as const
  )[value];
}
function slaLabel(value: CrmTicket['responseState']) {
  return (
    {
      at_risk: 'Near deadline',
      breached: 'Past deadline',
      met: 'Completed on time',
      on_track: 'On track',
    } as const
  )[value];
}
function historyLabel(type: CrmTicket['history'][number]['type'], status: CrmTicketStatus) {
  if (type === 'created') return 'Ticket created';
  if (type === 'response') return 'Customer response recorded';
  if (type === 'service_link') return 'Service request linked';
  return `Status changed to ${statusLabel(status).toLowerCase()}`;
}
function duration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 1440 === 0) return `${minutes / 1440} d`;
  return `${minutes / 60} h`;
}
function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}
function errorText(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : fallback;
}
function navigationTicketId(value: unknown): string | undefined {
  return value &&
    typeof value === 'object' &&
    'ticketId' in value &&
    typeof value.ticketId === 'string'
    ? value.ticketId
    : undefined;
}
