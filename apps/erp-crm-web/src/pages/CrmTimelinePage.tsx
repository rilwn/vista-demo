import { Button, InlineAlert, Toast } from '@vista/ui';
import type {
  CreateCrmInteractionRequest,
  CreateCrmTaskRequest,
  CrmInteraction,
  CrmInteractionType,
  CrmTask,
  CrmTaskPriority,
  CrmTimelineItem,
  CrmTimelinePage as TimelinePage,
  CrmTimelineReferenceData,
} from '@vista/contracts';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  createCrmInteraction,
  createCrmTask,
  getCrmTimelineReferenceData,
  listCrmTimeline,
  transitionCrmTask,
} from '../api/crm-timeline';
import { uploadManagedFile } from '../api/files';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { CrmTabs } from './CrmTicketsPage';
import { ManagedFilesPanel } from './PartnerDocumentsPanel';

const emptyReferences: CrmTimelineReferenceData = {
  assignees: [],
  businessTimezone: 'Europe/Sofia',
  contacts: [],
  customers: [],
  locations: [],
};

const emptyPage: TimelinePage = {
  items: [],
  openTasks: [],
  page: 1,
  pageSize: 25,
  summary: { interactions: 0, openTasks: 0, overdueTasks: 0 },
  total: 0,
  totalPages: 0,
};

const interactionTypes: CrmInteractionType[] = [
  'incoming_call',
  'outgoing_call',
  'email',
  'chat',
  'on_site_visit',
];
const taskPriorities: CrmTaskPriority[] = ['low', 'normal', 'high', 'urgent'];

type DrawerState =
  | { kind: 'interaction'; value: CrmInteraction }
  | { kind: 'new_interaction' }
  | { kind: 'new_task' }
  | { kind: 'task'; value: CrmTask };

export function CrmTimelinePage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const canCreate = hasPermission('crm', 'create');
  const canEdit = hasPermission('crm', 'edit');
  const [references, setReferences] = useState(emptyReferences);
  const [page, setPage] = useState(emptyPage);
  const [customerPartnerId, setCustomerPartnerId] = useState('');
  const [customerLocationId, setCustomerLocationId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getCrmTimelineReferenceData(token)
      .then((result) => {
        if (!active) return;
        setReferences(result);
        setCustomerPartnerId((current) => current || result.customers[0]?.id || '');
        setError(null);
      })
      .catch((caught) => {
        if (active) setError(errorText(caught, 'Customer timeline details could not be loaded.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const load = useCallback(async () => {
    if (!customerPartnerId) return;
    setLoading(true);
    try {
      setPage(
        await listCrmTimeline(token, {
          customerPartnerId,
          ...(customerLocationId ? { customerLocationId } : {}),
          ...(dateFrom ? { dateFrom: startOfDay(dateFrom) } : {}),
          ...(dateTo ? { dateTo: endOfDay(dateTo) } : {}),
          page: pageNumber,
          pageSize: 25,
        }),
      );
      setError(null);
    } catch (caught) {
      setError(errorText(caught, 'The customer timeline could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [customerLocationId, customerPartnerId, dateFrom, dateTo, pageNumber, token]);

  useEffect(() => void load(), [load]);

  const locations = references.locations.filter(
    (item) => item.customerPartnerId === customerPartnerId,
  );
  const selectedCustomer = references.customers.find((item) => item.id === customerPartnerId);

  function saved(message: string) {
    setDrawer(null);
    setNotice(message);
    setPageNumber(1);
    void load();
  }

  return (
    <div className="page-stack crm-timeline-workspace">
      <header className="page-header crm-timeline-header">
        <div>
          <p className="page-eyebrow">CRM · Customer relationships</p>
          <h1>Interactions &amp; tasks</h1>
          <p>See every customer conversation, visit, follow-up, and reminder in one place.</p>
        </div>
        {canCreate ? (
          <div className="crm-timeline-header-actions">
            <Button
              disabled={loading || !customerPartnerId}
              onClick={() => setDrawer({ kind: 'new_task' })}
              variant="secondary"
            >
              New task
            </Button>
            <Button
              disabled={loading || !customerPartnerId}
              onClick={() => setDrawer({ kind: 'new_interaction' })}
            >
              <Icon name="plus" size={16} /> Log interaction
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
          <div className="crm-timeline-notice">
            <span>{error}</span>
            <button onClick={() => void load()} type="button">
              Try again
            </button>
          </div>
        </InlineAlert>
      ) : null}

      <section className="crm-timeline-context" aria-label="Timeline filters">
        <label>
          <span>Customer</span>
          <select
            onChange={(event) => {
              setCustomerPartnerId(event.target.value);
              setCustomerLocationId('');
              setPageNumber(1);
            }}
            value={customerPartnerId}
          >
            {references.customers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Location</span>
          <select
            onChange={(event) => {
              setCustomerLocationId(event.target.value);
              setPageNumber(1);
            }}
            value={customerLocationId}
          >
            <option value="">All customer locations</option>
            {locations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>From</span>
          <input
            max={dateTo || undefined}
            onChange={(event) => {
              setDateFrom(event.target.value);
              setPageNumber(1);
            }}
            type="date"
            value={dateFrom}
          />
        </label>
        <label>
          <span>To</span>
          <input
            min={dateFrom || undefined}
            onChange={(event) => {
              setDateTo(event.target.value);
              setPageNumber(1);
            }}
            type="date"
            value={dateTo}
          />
        </label>
        <button
          disabled={!dateFrom && !dateTo}
          onClick={() => {
            setDateFrom('');
            setDateTo('');
            setPageNumber(1);
          }}
          type="button"
        >
          Clear dates
        </button>
      </section>

      <section aria-label="Customer activity summary" className="crm-timeline-summary">
        <SummaryMetric label="Interactions" value={page.summary.interactions} />
        <SummaryMetric label="Open tasks" value={page.summary.openTasks} />
        <SummaryMetric
          label="Overdue tasks"
          {...(page.summary.overdueTasks ? { tone: 'danger' as const } : {})}
          value={page.summary.overdueTasks}
        />
      </section>

      {!customerPartnerId && !loading ? (
        <section className="crm-timeline-empty">
          <h2>No customer is available</h2>
          <p>Add a customer in the partner registry before recording CRM activity.</p>
        </section>
      ) : (
        <div className="crm-timeline-layout">
          <section className="crm-timeline-feed" aria-label="Customer timeline">
            <header>
              <div>
                <p className="page-eyebrow">Customer history</p>
                <h2>{selectedCustomer?.name ?? 'Customer timeline'}</h2>
                <p>{page.total} recorded activities in this view</p>
              </div>
            </header>
            {loading ? <TimelineState title="Loading customer history…" /> : null}
            {!loading && !page.items.length ? (
              <TimelineState title="No activity recorded yet">
                <p>Log a call, email, chat, or visit, or create the first follow-up task.</p>
              </TimelineState>
            ) : null}
            {!loading && page.items.length ? (
              <ol className="crm-timeline-list">
                {page.items.map((item) => (
                  <TimelineRecord
                    item={item}
                    key={`${item.kind}:${item.kind === 'interaction' ? item.interaction.id : item.taskEvent.id}`}
                    onOpen={() =>
                      setDrawer(
                        item.kind === 'interaction'
                          ? { kind: 'interaction', value: item.interaction }
                          : { kind: 'task', value: item.task },
                      )
                    }
                    timezone={references.businessTimezone}
                  />
                ))}
              </ol>
            ) : null}
            {page.totalPages > 1 ? (
              <footer className="crm-timeline-pager">
                <Button
                  disabled={page.page <= 1}
                  onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
                  variant="secondary"
                >
                  Previous
                </Button>
                <span>
                  Page {page.page} of {page.totalPages}
                </span>
                <Button
                  disabled={page.page >= page.totalPages}
                  onClick={() => setPageNumber((value) => value + 1)}
                  variant="secondary"
                >
                  Next
                </Button>
              </footer>
            ) : null}
          </section>

          <aside className="crm-open-task-list" aria-label="Open customer tasks">
            <header>
              <div>
                <p className="page-eyebrow">Follow-up</p>
                <h2>Open tasks</h2>
              </div>
              <span>{page.openTasks.length}</span>
            </header>
            {!page.openTasks.length ? (
              <p className="crm-open-task-empty">There are no open tasks for this customer.</p>
            ) : (
              page.openTasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => setDrawer({ kind: 'task', value: task })}
                  type="button"
                >
                  <span className={`crm-task-priority is-${task.priority}`} aria-hidden="true" />
                  <span>
                    <strong>{task.title}</strong>
                    <small>{task.assignedTo.displayName}</small>
                    <time className={new Date(task.dueAt) < new Date() ? 'is-overdue' : ''}>
                      Due {formatDateTime(task.dueAt, references.businessTimezone)}
                    </time>
                  </span>
                  <Icon name="arrow" size={14} />
                </button>
              ))
            )}
          </aside>
        </div>
      )}

      {drawer?.kind === 'new_interaction' ? (
        <NewInteractionDrawer
          canAttach={canEdit}
          customerPartnerId={customerPartnerId}
          onBack={() => setDrawer(null)}
          onSaved={(interaction, uploadWarning) => {
            if (uploadWarning) {
              setDrawer({ kind: 'interaction', value: interaction });
              setNotice(uploadWarning);
              void load();
            } else saved('The interaction was added to the customer timeline.');
          }}
          references={references}
          token={token}
        />
      ) : null}
      {drawer?.kind === 'new_task' ? (
        <NewTaskDrawer
          customerPartnerId={customerPartnerId}
          onBack={() => setDrawer(null)}
          onSaved={() => saved('The follow-up task was created.')}
          references={references}
          token={token}
        />
      ) : null}
      {drawer?.kind === 'interaction' ? (
        <InteractionDrawer
          canEdit={canEdit}
          interaction={drawer.value}
          onBack={() => setDrawer(null)}
          timezone={references.businessTimezone}
          token={token}
        />
      ) : null}
      {drawer?.kind === 'task' ? (
        <TaskDrawer
          canEdit={canEdit}
          onBack={() => setDrawer(null)}
          onSaved={(task, message) => {
            setDrawer({ kind: 'task', value: task });
            setNotice(message);
            void load();
          }}
          task={drawer.value}
          timezone={references.businessTimezone}
          token={token}
        />
      ) : null}
    </div>
  );
}

function NewInteractionDrawer({
  canAttach,
  customerPartnerId,
  onBack,
  onSaved,
  references,
  token,
}: {
  canAttach: boolean;
  customerPartnerId: string;
  onBack: () => void;
  onSaved: (interaction: CrmInteraction, uploadWarning?: string) => void;
  references: CrmTimelineReferenceData;
  token: string;
}) {
  const [customerId, setCustomerId] = useState(
    customerPartnerId || references.customers[0]?.id || '',
  );
  const [locationId, setLocationId] = useState('');
  const [contactId, setContactId] = useState('');
  const [interactionType, setInteractionType] = useState<CrmInteractionType>('incoming_call');
  const [occurredAt, setOccurredAt] = useState(localDateTime(new Date()));
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locations = references.locations.filter((item) => item.customerPartnerId === customerId);
  const contacts = references.contacts.filter((item) => item.customerPartnerId === customerId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CreateCrmInteractionRequest = {
        ...(contactId ? { contactPersonId: contactId } : {}),
        ...(locationId ? { customerLocationId: locationId } : {}),
        customerPartnerId: customerId,
        interactionType,
        notes,
        occurredAt: new Date(occurredAt).toISOString(),
        subject,
      };
      const interaction = await createCrmInteraction(token, crypto.randomUUID(), input);
      if (attachment) {
        try {
          await uploadManagedFile(
            token,
            'crm_interaction',
            interaction.id,
            crypto.randomUUID(),
            attachment,
          );
        } catch (caught) {
          onSaved(
            interaction,
            errorText(
              caught,
              'The interaction was saved, but the attachment needs to be added again.',
            ),
          );
          return;
        }
      }
      onSaved(interaction);
    } catch (caught) {
      setError(errorText(caught, 'The interaction could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TimelineDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Customer communication record"
      title="Log interaction"
    >
      <form className="crm-timeline-drawer-form" onSubmit={(event) => void submit(event)}>
        <div className="crm-timeline-drawer-scroll">
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          <DrawerSection
            index="1"
            title="Customer"
            description="Keep the activity on the correct customer and location history."
          >
            <TimelineField label="Customer">
              <select
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  setLocationId('');
                  setContactId('');
                }}
                required
                value={customerId}
              >
                {references.customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </TimelineField>
            <div className="crm-timeline-form-grid">
              <TimelineField label="Location (optional)">
                <select onChange={(event) => setLocationId(event.target.value)} value={locationId}>
                  <option value="">Customer account</option>
                  {locations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </TimelineField>
              <TimelineField label="Contact (optional)">
                <select onChange={(event) => setContactId(event.target.value)} value={contactId}>
                  <option value="">No contact selected</option>
                  {contacts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </TimelineField>
            </div>
          </DrawerSection>
          <DrawerSection
            index="2"
            title="Interaction"
            description="Record what happened in clear language for the next colleague."
          >
            <div className="crm-timeline-form-grid">
              <TimelineField label="Type">
                <select
                  onChange={(event) => setInteractionType(event.target.value as CrmInteractionType)}
                  value={interactionType}
                >
                  {interactionTypes.map((item) => (
                    <option key={item} value={item}>
                      {interactionLabel(item)}
                    </option>
                  ))}
                </select>
              </TimelineField>
              <TimelineField label="Date and time">
                <input
                  max={localDateTime(new Date())}
                  onChange={(event) => setOccurredAt(event.target.value)}
                  required
                  type="datetime-local"
                  value={occurredAt}
                />
              </TimelineField>
            </div>
            <TimelineField label="Subject">
              <input
                maxLength={255}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Reason for the conversation"
                required
                value={subject}
              />
            </TimelineField>
            <TimelineField label="Notes">
              <textarea
                maxLength={4000}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Outcome, commitments, and useful context"
                required
                rows={6}
                value={notes}
              />
            </TimelineField>
          </DrawerSection>
          {canAttach ? (
            <DrawerSection
              index="3"
              title="Attachment"
              description="An optional report, quotation, photograph, or other supporting file."
            >
              <TimelineField label="PDF or image (optional)">
                <input
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </TimelineField>
            </DrawerSection>
          ) : null}
        </div>
        <DrawerActions
          busy={busy}
          disabled={!customerId || !subject.trim() || !notes.trim()}
          onBack={onBack}
          submitLabel="Save interaction"
        />
      </form>
    </TimelineDrawer>
  );
}

function NewTaskDrawer({
  customerPartnerId,
  onBack,
  onSaved,
  references,
  token,
}: {
  customerPartnerId: string;
  onBack: () => void;
  onSaved: (task: CrmTask) => void;
  references: CrmTimelineReferenceData;
  token: string;
}) {
  const [customerId, setCustomerId] = useState(
    customerPartnerId || references.customers[0]?.id || '',
  );
  const [locationId, setLocationId] = useState('');
  const [assignedTo, setAssignedTo] = useState(references.assignees[0]?.id ?? '');
  const [priority, setPriority] = useState<CrmTaskPriority>('normal');
  const [dueAt, setDueAt] = useState(localDateTime(new Date(Date.now() + 24 * 60 * 60_000)));
  const [reminderAt, setReminderAt] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locations = references.locations.filter((item) => item.customerPartnerId === customerId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CreateCrmTaskRequest = {
        assignedToAccountId: assignedTo,
        ...(locationId ? { customerLocationId: locationId } : {}),
        customerPartnerId: customerId,
        dueAt: new Date(dueAt).toISOString(),
        ...(notes.trim() ? { notes } : {}),
        priority,
        ...(reminderAt ? { reminderAt: new Date(reminderAt).toISOString() } : {}),
        title,
      };
      onSaved(await createCrmTask(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The task could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TimelineDrawer busy={busy} onBack={onBack} subtitle="Customer follow-up" title="New task">
      <form className="crm-timeline-drawer-form" onSubmit={(event) => void submit(event)}>
        <div className="crm-timeline-drawer-scroll">
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          <DrawerSection
            index="1"
            title="Customer"
            description="Choose where this follow-up belongs."
          >
            <TimelineField label="Customer">
              <select
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  setLocationId('');
                }}
                required
                value={customerId}
              >
                {references.customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </TimelineField>
            <TimelineField label="Location (optional)">
              <select onChange={(event) => setLocationId(event.target.value)} value={locationId}>
                <option value="">Customer account</option>
                {locations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </TimelineField>
          </DrawerSection>
          <DrawerSection
            index="2"
            title="Follow-up"
            description="Assign clear ownership and a realistic due time."
          >
            <TimelineField label="Task">
              <input
                maxLength={255}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What needs to happen next"
                required
                value={title}
              />
            </TimelineField>
            <TimelineField label="Notes (optional)">
              <textarea
                maxLength={4000}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Useful instructions or customer context"
                rows={4}
                value={notes}
              />
            </TimelineField>
            <div className="crm-timeline-form-grid">
              <TimelineField label="Assigned to">
                <select
                  onChange={(event) => setAssignedTo(event.target.value)}
                  required
                  value={assignedTo}
                >
                  {references.assignees.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </TimelineField>
              <TimelineField label="Priority">
                <select
                  onChange={(event) => setPriority(event.target.value as CrmTaskPriority)}
                  value={priority}
                >
                  {taskPriorities.map((item) => (
                    <option key={item} value={item}>
                      {priorityLabel(item)}
                    </option>
                  ))}
                </select>
              </TimelineField>
            </div>
            <div className="crm-timeline-form-grid">
              <TimelineField label="Due date and time">
                <input
                  min={localDateTime(new Date())}
                  onChange={(event) => setDueAt(event.target.value)}
                  required
                  type="datetime-local"
                  value={dueAt}
                />
              </TimelineField>
              <TimelineField label="Reminder (optional)">
                <input
                  max={dueAt}
                  min={localDateTime(new Date())}
                  onChange={(event) => setReminderAt(event.target.value)}
                  type="datetime-local"
                  value={reminderAt}
                />
              </TimelineField>
            </div>
            {!references.assignees.length ? (
              <InlineAlert tone="warning">
                No active CRM team member is available for assignment.
              </InlineAlert>
            ) : null}
          </DrawerSection>
        </div>
        <DrawerActions
          busy={busy}
          disabled={!customerId || !assignedTo || !title.trim() || !dueAt}
          onBack={onBack}
          submitLabel="Create task"
        />
      </form>
    </TimelineDrawer>
  );
}

function InteractionDrawer({
  canEdit,
  interaction,
  onBack,
  timezone,
  token,
}: {
  canEdit: boolean;
  interaction: CrmInteraction;
  onBack: () => void;
  timezone: string;
  token: string;
}) {
  return (
    <TimelineDrawer
      busy={false}
      onBack={onBack}
      subtitle={interaction.customerName}
      title="Interaction details"
    >
      <div className="crm-timeline-preview">
        <section className="crm-timeline-preview-hero">
          <span>{interactionLabel(interaction.interactionType)}</span>
          <h3>{interaction.subject}</h3>
          <p>{formatDateTime(interaction.occurredAt, timezone)}</p>
        </section>
        <section className="crm-timeline-preview-card">
          <h3>Conversation notes</h3>
          <p>{interaction.notes}</p>
          <dl>
            <div>
              <dt>Customer</dt>
              <dd>{interaction.customerName}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{interaction.locationName ?? 'Customer account'}</dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>{interaction.contactName ?? 'Not selected'}</dd>
            </div>
            <div>
              <dt>Recorded by</dt>
              <dd>{interaction.createdByName}</dd>
            </div>
          </dl>
        </section>
        <ManagedFilesPanel
          canEdit={canEdit}
          copy={interactionFileCopy}
          parentId={interaction.id}
          parentType="crm_interaction"
          token={token}
        />
      </div>
    </TimelineDrawer>
  );
}

function TaskDrawer({
  canEdit,
  onBack,
  onSaved,
  task,
  timezone,
  token,
}: {
  canEdit: boolean;
  onBack: () => void;
  onSaved: (task: CrmTask, message: string) => void;
  task: CrmTask;
  timezone: string;
  token: string;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function close(status: 'cancelled' | 'completed') {
    setBusy(true);
    setError(null);
    try {
      const saved = await transitionCrmTask(token, task.id, crypto.randomUUID(), {
        expectedVersion: task.version,
        ...(note.trim() ? { note } : {}),
        status,
      });
      onSaved(
        saved,
        status === 'completed' ? 'The task was completed.' : 'The task was cancelled.',
      );
      setNote('');
    } catch (caught) {
      setError(errorText(caught, 'The task could not be updated.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <TimelineDrawer busy={busy} onBack={onBack} subtitle={task.customerName} title="Task details">
      <div className="crm-timeline-preview">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="crm-task-preview-hero">
          <div>
            <span className={`crm-task-status is-${task.status}`}>
              {taskStatusLabel(task.status)}
            </span>
            <h3>{task.title}</h3>
            <p>Due {formatDateTime(task.dueAt, timezone)}</p>
          </div>
          <span className={`crm-task-priority-pill is-${task.priority}`}>
            {priorityLabel(task.priority)}
          </span>
        </section>
        <section className="crm-timeline-preview-card">
          <h3>Follow-up details</h3>
          <p>{task.notes ?? 'No additional notes were added.'}</p>
          <dl>
            <div>
              <dt>Assigned to</dt>
              <dd>{task.assignedTo.displayName}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{task.locationName ?? 'Customer account'}</dd>
            </div>
            <div>
              <dt>Reminder</dt>
              <dd>{task.reminderAt ? formatDateTime(task.reminderAt, timezone) : 'Not set'}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDateTime(task.updatedAt, timezone)}</dd>
            </div>
          </dl>
        </section>
        {canEdit && task.status === 'open' ? (
          <section className="crm-task-close-card">
            <div>
              <h3>Finish this task</h3>
              <p>Add an optional note, then complete or cancel the follow-up.</p>
            </div>
            <TimelineField label="Closing note (optional)">
              <textarea
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                value={note}
              />
            </TimelineField>
            <div>
              <Button busy={busy} onClick={() => void close('completed')}>
                <Icon name="check" size={15} /> Complete task
              </Button>
              <Button disabled={busy} onClick={() => void close('cancelled')} variant="secondary">
                Cancel task
              </Button>
            </div>
          </section>
        ) : null}
        <section className="crm-timeline-preview-card crm-task-history">
          <h3>Task history</h3>
          <ol>
            {[...task.history].reverse().map((item) => (
              <li key={item.id}>
                <span aria-hidden="true" />
                <div>
                  <strong>{taskEventLabel(item.type)}</strong>
                  {item.note ? <p>{item.note}</p> : null}
                  <small>
                    {formatDateTime(item.changedAt, timezone)} · {item.changedByName}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </TimelineDrawer>
  );
}

function TimelineDrawer({
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
    const activeDrawer = drawer;
    const focusable = () =>
      Array.from(
        activeDrawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    (activeDrawer.querySelector<HTMLElement>('.panel-back-button') ?? activeDrawer).focus();
    function handleKeyboard(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        onBackRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        activeDrawer.focus();
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
    activeDrawer.addEventListener('keydown', handleKeyboard);
    return () => {
      activeDrawer.removeEventListener('keydown', handleKeyboard);
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
        className="security-drawer is-wide crm-timeline-drawer"
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

function TimelineRecord({
  item,
  onOpen,
  timezone,
}: {
  item: CrmTimelineItem;
  onOpen: () => void;
  timezone: string;
}) {
  const interaction = item.kind === 'interaction' ? item.interaction : null;
  const task = item.kind === 'task_event' ? item.task : null;
  return (
    <li className={`is-${item.kind}`}>
      <span className="crm-timeline-node" aria-hidden="true">
        {item.kind === 'interaction' ? 'C' : 'T'}
      </span>
      <button onClick={onOpen} type="button">
        <span className="crm-timeline-record-copy">
          <span className="crm-timeline-record-label">
            {interaction
              ? interactionLabel(interaction.interactionType)
              : taskEventLabel(item.kind === 'task_event' ? item.taskEvent.type : 'created')}
          </span>
          <strong>{interaction?.subject ?? task?.title}</strong>
          <small>{interaction?.notes ?? task?.notes ?? 'Customer follow-up task'}</small>
          <span>
            {interaction?.createdByName ?? task?.assignedTo.displayName}
            {interaction?.locationName || task?.locationName
              ? ` · ${interaction?.locationName ?? task?.locationName}`
              : ''}
          </span>
        </span>
        <time dateTime={item.occurredAt}>{formatDateTime(item.occurredAt, timezone)}</time>
        <Icon name="arrow" size={15} />
      </button>
    </li>
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
function TimelineField({ children, label }: { children: ReactNode; label: string }) {
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
function SummaryMetric({ label, tone, value }: { label: string; tone?: 'danger'; value: number }) {
  return (
    <article className={tone ? `is-${tone}` : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
function TimelineState({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <div className="crm-timeline-empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
function interactionLabel(value: CrmInteractionType): string {
  return {
    chat: 'Chat',
    email: 'Email',
    incoming_call: 'Incoming call',
    on_site_visit: 'On-site visit',
    outgoing_call: 'Outgoing call',
  }[value];
}
function priorityLabel(value: CrmTaskPriority): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function taskStatusLabel(value: CrmTask['status']): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function taskEventLabel(value: CrmTask['history'][number]['type']): string {
  return value === 'created'
    ? 'Task created'
    : value === 'completed'
      ? 'Task completed'
      : 'Task cancelled';
}
function formatDateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}
function localDateTime(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function startOfDay(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}
function endOfDay(value: string): string {
  return new Date(`${value}T23:59:59.999`).toISOString();
}
function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

const interactionFileCopy = {
  add: 'Add attachment',
  back: 'Back',
  cancel: 'Cancel',
  chooseFile: 'Choose file',
  controlledFiles: 'Supporting files',
  download: 'Download',
  downloadError: 'The attachment could not be downloaded.',
  emptyDescription: 'Add a report, quotation, photograph, or other supporting file.',
  emptyTitle: 'No attachments',
  fileRequirements: 'PDF, JPEG, PNG or WebP · up to 10 MB',
  hideVersions: 'Hide versions',
  integrity: 'Integrity checked · access follows this interaction',
  loadError: 'Attachments could not be loaded.',
  loading: 'Loading attachments…',
  open: 'Attachments',
  replace: 'Replace',
  replaceTitle: 'Upload replacement version',
  selection: (name: string) => `Selected: ${name}`,
  subtitle: 'Files retain their checksum and version history.',
  title: 'Attachments',
  upload: 'Upload',
  uploadError: 'The attachment could not be uploaded.',
  uploadTitle: 'Upload attachment',
  version: (value: number) => `Version ${value}`,
  versionCount: (count: number) => `${count} ${count === 1 ? 'version' : 'versions'}`,
  versionsError: 'Version history could not be loaded.',
};
