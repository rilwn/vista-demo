import { Button, InlineAlert, Toast } from '@vista/ui';
import type {
  AssignServiceWorkOrderRequest,
  CompleteServiceWorkOrderRequest,
  CompleteServiceInspectionRequest,
  CreateServiceRequest,
  CreateServiceInspectionPlanRequest,
  CreateWarrantyClaimRequest,
  ManagedFile,
  ManualServiceRequestChannel,
  ServiceCareOverview,
  ServiceEquipmentHistory,
  ServiceInspectionPlan,
  ServicePartUsageInput,
  ServicePriority,
  ServiceReferenceData,
  ServiceRequest,
  ServiceRequestPage,
  ServiceRequestChannel,
  ServiceSchedule,
  ServiceScheduleDay,
  ServiceTechnicianScheduleWindow,
  ServiceTechnicianWorkload,
  ServiceType,
  ServiceWorkOrder,
  ServiceWorkOrderPage,
  ServiceWorkTimeEntryInput,
  TransitionWarrantyClaimRequest,
  WarrantyClaim,
  CrmTicketPriority,
  CrmTicketReferenceData,
} from '@vista/contracts';
import {
  type FormEvent,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ApiClientError } from '../api/client';
import {
  assignServiceWorkOrder,
  cancelServiceRequest,
  completeServiceInspection,
  completeServiceWorkOrder,
  createServiceInspectionPlan,
  createServiceRequest,
  createWarrantyClaim,
  getServiceEquipmentHistory,
  getServiceCareOverview,
  getServiceReferenceData,
  getServiceRequest,
  getServiceSchedule,
  getServiceWorkOrder,
  listMyServiceWork,
  listServiceRequests,
  listServiceWorkOrders,
  startServiceWorkOrder,
  transitionWarrantyClaim,
  updateServiceTechnicianSchedulePolicy,
  uploadServicePhoto,
} from '../api/service';
import { downloadManagedFile, uploadManagedFile } from '../api/files';
import { ServiceEvidenceGallery } from './ServiceEvidenceGallery';
import { serviceEvidenceText } from './service-evidence.messages';
import { createCrmTicketFromServiceRequest, getCrmTicketReferenceData } from '../api/crm-tickets';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { useLocalization } from '../i18n/LocalizationProvider';
import { Link, useRouter } from '../routing/Router';
import { ServiceReportsView } from './ServiceReportsView';

export type ServiceOperationsView =
  'care' | 'devices' | 'reports' | 'requests' | 'schedule' | 'work-orders';

const emptyReferences: ServiceReferenceData = {
  businessTimezone: 'UTC',
  customers: [],
  equipment: [],
  locations: [],
  parts: [],
  subscriptions: [],
  technicians: [],
};

const emptyRequestPage: ServiceRequestPage = {
  items: [],
  page: 1,
  pageSize: 25,
  summary: { completed: 0, inProgress: 0, new: 0, scheduled: 0 },
  total: 0,
  totalPages: 0,
};

const emptyWorkOrderPage: ServiceWorkOrderPage = {
  items: [],
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 0,
};

export function ServiceOperationsPage({ view }: { view: ServiceOperationsView }) {
  const { hasPermission, session } = useAuth();
  const { t } = useLocalization();
  const { location, navigate } = useRouter();
  const openedFromNavigation = useRef(false);
  const token = session?.sessionToken ?? '';
  const canCreate = hasPermission('erp.service', 'create');
  const canEdit = hasPermission('erp.service', 'edit');
  const canApprove = hasPermission('erp.service', 'approve');
  const canCreateFinance = hasPermission('erp.finance', 'create');
  const canViewFinance = hasPermission('erp.finance', 'view');
  const canCreateCrm = hasPermission('crm', 'create') && hasPermission('crm', 'view');
  const [requestListPage, setRequestListPage] = useState(1);
  const [workOrderListPage, setWorkOrderListPage] = useState(1);
  const data = useServiceData(token, requestListPage, workOrderListPage, canApprove);
  const [creating, setCreating] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<ServiceWorkOrder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const openWorkOrder = useCallback(
    async (id: string) => {
      try {
        setSelectedWorkOrder(await getServiceWorkOrder(token, id));
      } catch {
        setNotice('The work order could not be opened. Try again.');
      }
    },
    [token],
  );

  useEffect(() => {
    if (openedFromNavigation.current) return;
    const requestId = navigationServiceRequestId(location.state);
    if (!requestId) return;
    openedFromNavigation.current = true;
    void getServiceRequest(token, requestId)
      .then(setSelectedRequest)
      .catch(() => setNotice('The linked Service request could not be opened.'));
  }, [location.state, token]);

  const keepPanelOpen = selectedWorkOrder || selectedRequest || creating;
  if (data.loading && !keepPanelOpen) return <ServiceState title="Loading service work" />;
  if (data.error && !keepPanelOpen)
    return (
      <ServiceState title="Service work could not be loaded">
        <Button onClick={data.reload} variant="secondary">
          Try again
        </Button>
      </ServiceState>
    );

  const page = pageMeta(view, t);
  const businessTimezone = data.references.businessTimezone;
  return (
    <div className="page-stack service-workspace">
      <header className="page-header service-workspace-header">
        <div>
          <p className="page-eyebrow">{t('service.eyebrow')}</p>
          <h1>{page.title}</h1>
          <p>{page.description}</p>
        </div>
        {view === 'requests' && canCreate ? (
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" size={17} /> {t('service.newRequest')}
          </Button>
        ) : null}
      </header>

      <nav aria-label={t('service.sections')} className="service-tabs">
        <Link
          className={({ isActive }) => (isActive ? 'is-active' : undefined)}
          end
          to="/modules/erp.service/requests"
        >
          {t('service.requests')}
        </Link>
        <Link
          className={({ isActive }) => (isActive ? 'is-active' : undefined)}
          end
          to="/modules/erp.service/work-orders"
        >
          {t('service.workOrders')}
        </Link>
        <Link
          className={({ isActive }) => (isActive ? 'is-active' : undefined)}
          end
          to="/modules/erp.service/schedule"
        >
          {t('service.schedule')}
        </Link>
        <Link
          className={({ isActive }) => (isActive ? 'is-active' : undefined)}
          end
          to="/modules/erp.service/devices"
        >
          {t('service.equipmentHistory')}
        </Link>
        <Link
          className={({ isActive }) => (isActive ? 'is-active' : undefined)}
          end
          to="/modules/erp.service/care"
        >
          {t('service.care')}
        </Link>
        {canApprove ? (
          <Link
            className={({ isActive }) => (isActive ? 'is-active' : undefined)}
            end
            to="/modules/erp.service/reports"
          >
            {t('service.reports')}
          </Link>
        ) : null}
      </nav>

      {data.error && keepPanelOpen ? (
        <InlineAlert tone="warning">
          {serviceEvidenceText.refreshFailed}
          <Button onClick={data.reload} variant="secondary">
            {serviceEvidenceText.refresh}
          </Button>
        </InlineAlert>
      ) : null}
      {notice ? (
        <Toast
          durationMs={notice.includes('could not') ? 7000 : 5200}
          onDismiss={() => setNotice(null)}
          tone={notice.includes('could not') ? 'error' : 'success'}
        >
          {notice}
        </Toast>
      ) : null}

      {view === 'requests' ? (
        <ServiceRequestsView
          canApprove={canApprove}
          onOpen={setSelectedRequest}
          onOpenWorkOrder={(id) => void openWorkOrder(id)}
          onPageChange={setRequestListPage}
          page={data.requestPage}
          timezone={businessTimezone}
          workOrders={data.workOrderPage.items}
        />
      ) : null}
      {view === 'work-orders' ? (
        <ServiceWorkOrdersView
          canApprove={canApprove}
          currentAccountId={session?.context.accountId ?? ''}
          onOpen={(workOrder) => void openWorkOrder(workOrder.id)}
          onPageChange={setWorkOrderListPage}
          myWorkOrderPage={data.myWorkOrderPage}
          timezone={businessTimezone}
          workOrderPage={data.workOrderPage}
        />
      ) : null}
      {view === 'schedule' ? (
        <ServiceScheduleView
          canApprove={canApprove}
          onOpen={(id) => void openWorkOrder(id)}
          token={token}
          timezone={businessTimezone}
        />
      ) : null}
      {view === 'devices' ? (
        <ServiceDevicesView
          references={data.references}
          token={token}
          timezone={businessTimezone}
        />
      ) : null}
      {view === 'care' ? (
        <ServiceCareView
          canApprove={canApprove}
          canCreate={canCreate}
          canEdit={canEdit}
          references={data.references}
          token={token}
          timezone={businessTimezone}
        />
      ) : null}
      {view === 'reports' ? <ServiceReportsView canExport={canCreate} token={token} /> : null}

      {creating ? (
        <NewServiceRequestDrawer
          onBack={() => setCreating(false)}
          onSaved={(request) => {
            setCreating(false);
            setNotice(`${request.number} is ready for dispatch.`);
            setRequestListPage(1);
            data.reload();
            setSelectedRequest(request);
          }}
          references={data.references}
          token={token}
        />
      ) : null}
      {selectedRequest ? (
        <ServiceRequestDrawer
          canApprove={canApprove}
          canCreateCrm={canCreateCrm}
          onBack={() => setSelectedRequest(null)}
          onOpenWorkOrder={(id) => {
            setSelectedRequest(null);
            void openWorkOrder(id);
          }}
          onOpenCrmTicket={(id) => navigate('/modules/crm/tickets', { state: { ticketId: id } })}
          onSaved={(request, message) => {
            setSelectedRequest(request);
            setNotice(message);
            data.reload();
          }}
          references={data.references}
          request={selectedRequest}
          token={token}
          timezone={businessTimezone}
        />
      ) : null}
      {selectedWorkOrder ? (
        <ServiceWorkOrderDrawer
          canApprove={canApprove}
          canCreateFinance={canCreateFinance}
          canEdit={canEdit}
          canViewFinance={canViewFinance}
          currentAccountId={session?.context.accountId ?? ''}
          onBack={() => setSelectedWorkOrder(null)}
          onSaved={(workOrder, message) => {
            setSelectedWorkOrder(workOrder);
            setNotice(message);
            data.reload();
          }}
          references={data.references}
          token={token}
          timezone={businessTimezone}
          workOrder={selectedWorkOrder}
        />
      ) : null}
    </div>
  );
}

function ServiceRequestsView({
  canApprove,
  onOpen,
  onOpenWorkOrder,
  onPageChange,
  page,
  timezone,
  workOrders,
}: {
  canApprove: boolean;
  onOpen: (request: ServiceRequest) => void;
  onOpenWorkOrder: (id: string) => void;
  onPageChange: (page: number) => void;
  page: ServiceRequestPage;
  timezone: string;
  workOrders: ServiceWorkOrder[];
}) {
  const { items: requests, summary } = page;
  return (
    <>
      <section aria-label="Service request summary" className="service-summary">
        <ServiceMetric label="New" value={summary.new.toString()} />
        <ServiceMetric label="Scheduled" value={summary.scheduled.toString()} />
        <ServiceMetric label="In progress" tone="warning" value={summary.inProgress.toString()} />
        <ServiceMetric label="Completed" value={summary.completed.toString()} />
      </section>
      {!requests.length ? (
        <ServiceState title="No service requests yet">
          <p>Start with a customer, service location, and registered device.</p>
        </ServiceState>
      ) : (
        <section aria-label="Service requests" className="service-register" role="table">
          <div className="service-register-head" role="row">
            <span role="columnheader">Request</span>
            <span role="columnheader">Customer &amp; device</span>
            <span role="columnheader">Schedule</span>
            <span role="columnheader">Status</span>
            <span aria-hidden="true" />
          </div>
          {requests.map((request) => {
            const order = request.workOrderId
              ? workOrders.find((item) => item.id === request.workOrderId)
              : undefined;
            return (
              <article className="service-register-row" key={request.id} role="row">
                <div className="service-record-mark" data-label="Request" role="cell">
                  <span className={`service-priority is-${request.priority}`} />
                  <div>
                    <strong>{request.number}</strong>
                    <small>{sourceLabel(request.sourceChannel)}</small>
                  </div>
                </div>
                <div className="service-customer-cell" data-label="Customer and device" role="cell">
                  <strong>{request.customerName}</strong>
                  <span>
                    {request.deviceName} · {request.serialNumber}
                  </span>
                </div>
                <div className="service-schedule-cell" data-label="Schedule" role="cell">
                  {request.scheduledStart ? (
                    <>
                      <strong>{formatDateTime(request.scheduledStart, timezone)}</strong>
                      <span>{request.assignedTechnician?.displayName ?? 'Technician pending'}</span>
                    </>
                  ) : (
                    <span>
                      {request.plannedVisitDate
                        ? `Planned for ${formatDate(request.plannedVisitDate, timezone)}`
                        : 'Needs dispatch'}
                    </span>
                  )}
                </div>
                <span className="service-status-cell" data-label="Status" role="cell">
                  <ServiceStatus status={request.status} />
                </span>
                <div className="service-row-actions" role="cell">
                  {order ? (
                    <Button onClick={() => onOpenWorkOrder(order.id)} variant="quiet">
                      Work order
                    </Button>
                  ) : null}
                  <Button onClick={() => onOpen(request)} variant="quiet">
                    {canApprove ? 'Manage' : 'View'}
                  </Button>
                </div>
              </article>
            );
          })}
          <ServicePager onPageChange={onPageChange} page={page} />
        </section>
      )}
    </>
  );
}

function ServiceWorkOrdersView({
  canApprove,
  currentAccountId,
  onOpen,
  onPageChange,
  myWorkOrderPage,
  timezone,
  workOrderPage,
}: {
  canApprove: boolean;
  currentAccountId: string;
  onOpen: (workOrder: ServiceWorkOrder) => void;
  onPageChange: (page: number) => void;
  myWorkOrderPage: ServiceWorkOrderPage;
  timezone: string;
  workOrderPage: ServiceWorkOrderPage;
}) {
  const [scope, setScope] = useState<'all' | 'mine'>(canApprove ? 'all' : 'mine');
  const showAllWork = canApprove && scope === 'all';
  const activePage = showAllWork ? workOrderPage : myWorkOrderPage;
  const visible = activePage.items;
  return (
    <section className="service-work-orders-panel">
      <div className="service-view-toolbar">
        <div>
          <h2>{showAllWork ? 'All work orders' : 'My assigned work'}</h2>
          <p>Open one work order to start, record evidence, or complete the visit.</p>
        </div>
        {canApprove ? (
          <div className="service-segmented" role="group" aria-label="Work order scope">
            <button
              className={scope === 'all' ? 'is-active' : undefined}
              onClick={() => setScope('all')}
              type="button"
            >
              All work
            </button>
            <button
              className={scope === 'mine' ? 'is-active' : undefined}
              onClick={() => setScope('mine')}
              type="button"
            >
              My work
            </button>
          </div>
        ) : null}
      </div>
      {!visible.length ? (
        <ServiceState title={showAllWork ? 'No work orders yet' : 'No work assigned to you'}>
          <p>
            {showAllWork
              ? 'Dispatch a service request to create the first work order.'
              : 'Assigned visits will appear here and stay available on a smaller screen.'}
          </p>
        </ServiceState>
      ) : (
        <div className="service-work-order-list">
          {visible.map((workOrder) => (
            <button
              className="service-work-order-card"
              key={workOrder.id}
              onClick={() => onOpen(workOrder)}
              type="button"
            >
              <span className="service-work-order-card-top">
                <ServiceStatus status={workOrder.status} />
                <small>{workOrder.number}</small>
              </span>
              <strong>{workOrder.customerName}</strong>
              <span>
                {workOrder.deviceName} · {workOrder.serialNumber}
              </span>
              <footer>
                <span>{workOrder.assignedTechnician?.displayName ?? 'Technician pending'}</span>
                <span>
                  {workOrder.scheduledStart
                    ? formatDateTime(workOrder.scheduledStart, timezone)
                    : 'Unscheduled'}
                </span>
              </footer>
              {workOrder.assignedTechnician?.accountId === currentAccountId ? (
                <em>Assigned to you</em>
              ) : null}
            </button>
          ))}
        </div>
      )}
      <ServicePager onPageChange={onPageChange} page={activePage} />
    </section>
  );
}

function ServiceScheduleView({
  canApprove,
  onOpen,
  token,
  timezone,
}: {
  canApprove: boolean;
  onOpen: (workOrderId: string) => void;
  token: string;
  timezone: string;
}) {
  const [dateFrom, setDateFrom] = useState(() => startOfBusinessWeek(today(timezone)));
  const dateTo = useMemo(() => addCalendarDays(dateFrom, 6), [dateFrom]);
  const [schedule, setSchedule] = useState<ServiceSchedule | null>(null);
  const [editing, setEditing] = useState<ServiceTechnicianWorkload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSchedule(await getServiceSchedule(token, dateFrom, dateTo));
    } catch (caught) {
      setError(errorText(caught, 'The technician schedule could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const appointments = useMemo(
    () =>
      schedule?.technicians.reduce(
        (count, technician) =>
          count + technician.days.reduce((dayCount, day) => dayCount + day.visits.length, 0),
        0,
      ) ?? 0,
    [schedule],
  );

  function moveWeek(days: number) {
    setDateFrom((current) => addCalendarDays(current, days));
    setNotice(null);
  }

  return (
    <section className="service-schedule-panel">
      <div className="service-view-toolbar">
        <div>
          <h2>{canApprove ? 'Technician schedule' : 'My schedule'}</h2>
          <p>
            {canApprove
              ? 'Compare appointments with each technician’s working hours and daily capacity.'
              : 'Review your visits, working hours, and remaining capacity for the week.'}
          </p>
        </div>
        <div className="service-calendar-actions">
          <button aria-label="Previous week" onClick={() => moveWeek(-7)} type="button">
            <Icon name="arrow" size={15} />
          </button>
          <Button
            onClick={() => setDateFrom(startOfBusinessWeek(today(timezone)))}
            variant="secondary"
          >
            This week
          </Button>
          <button aria-label="Next week" onClick={() => moveWeek(7)} type="button">
            <Icon name="arrow" size={15} />
          </button>
        </div>
      </div>
      <div className="service-calendar-period">
        <div>
          <span>Week</span>
          <strong>{formatScheduleRange(dateFrom, dateTo, timezone)}</strong>
        </div>
        <span className="service-schedule-count">
          {appointments} visit{appointments === 1 ? '' : 's'}
        </span>
      </div>

      {notice ? (
        <Toast onDismiss={() => setNotice(null)} tone="success">
          {notice}
        </Toast>
      ) : null}
      {error ? (
        <div className="service-calendar-message">
          <InlineAlert tone="error">{error}</InlineAlert>
          <Button onClick={() => void load()} variant="secondary">
            Try again
          </Button>
        </div>
      ) : null}
      {loading ? <ServiceState title="Loading technician schedule" /> : null}
      {!loading && !error && schedule && !schedule.technicians.length ? (
        <ServiceState title="No active technicians">
          <p>Add a technician operator and mobile warehouse in Business structure first.</p>
        </ServiceState>
      ) : null}
      {!loading && !error && schedule?.technicians.length ? (
        <>
          <div className="service-workload-strip">
            {schedule.technicians.map((workload) => (
              <TechnicianWorkloadCard
                canApprove={canApprove}
                key={workload.technician.accountId}
                onEdit={() => setEditing(workload)}
                workload={workload}
              />
            ))}
          </div>
          <div className="service-resource-calendar-wrap">
            <div className="service-resource-calendar">
              <div className="service-resource-corner">Technician</div>
              {calendarDates(dateFrom, dateTo).map((date) => (
                <header className={date === today(timezone) ? 'is-today' : undefined} key={date}>
                  <span>{weekdayShort(date, timezone)}</span>
                  <strong>{calendarDayNumber(date)}</strong>
                  <small>{calendarMonthShort(date, timezone)}</small>
                </header>
              ))}
              {schedule.technicians.map((workload) => (
                <TechnicianCalendarRow
                  key={workload.technician.accountId}
                  onOpen={onOpen}
                  timezone={timezone}
                  workload={workload}
                />
              ))}
            </div>
          </div>
          {!appointments ? (
            <div className="service-calendar-empty-note">
              <Icon name="service" size={18} />
              <div>
                <strong>No visits in this week</strong>
                <span>Assign a service request to place it on the schedule.</span>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {editing ? (
        <TechnicianAvailabilityDrawer
          onBack={() => setEditing(null)}
          onSaved={async (name) => {
            setEditing(null);
            setNotice(`${name}’s working hours were updated.`);
            await load();
          }}
          token={token}
          workload={editing}
        />
      ) : null}
    </section>
  );
}

function TechnicianWorkloadCard({
  canApprove,
  onEdit,
  workload,
}: {
  canApprove: boolean;
  onEdit: () => void;
  workload: ServiceTechnicianWorkload;
}) {
  const hasCapacity = workload.capacityMinutes !== undefined;
  const percent = hasCapacity
    ? Math.min(
        100,
        Math.round((workload.bookedMinutes / Math.max(workload.capacityMinutes!, 1)) * 100),
      )
    : 0;
  return (
    <article className="service-workload-card">
      <header>
        <div>
          <strong>{workload.technician.displayName}</strong>
          <span>{workload.technician.warehouseName}</span>
        </div>
        <span className={workload.policy.configured ? 'is-ready' : 'is-unconfigured'}>
          {workload.policy.configured ? 'Hours set' : 'Hours needed'}
        </span>
      </header>
      <div className="service-workload-meter" aria-label={`${percent}% of weekly capacity booked`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <dl>
        <div>
          <dt>Booked</dt>
          <dd>{formatScheduleMinutes(workload.bookedMinutes)}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{hasCapacity ? formatScheduleMinutes(workload.remainingMinutes ?? 0) : 'Not set'}</dd>
        </div>
        <div>
          <dt>Visits</dt>
          <dd>{workload.visitCount}</dd>
        </div>
      </dl>
      {canApprove ? (
        <button className="service-manage-hours" onClick={onEdit} type="button">
          Manage working hours <Icon name="arrow" size={14} />
        </button>
      ) : null}
    </article>
  );
}

function TechnicianCalendarRow({
  onOpen,
  timezone,
  workload,
}: {
  onOpen: (workOrderId: string) => void;
  timezone: string;
  workload: ServiceTechnicianWorkload;
}) {
  return (
    <>
      <div className="service-resource-person">
        <span>{initials(workload.technician.displayName)}</span>
        <div>
          <strong>{workload.technician.displayName}</strong>
          <small>{workload.technician.warehouseName}</small>
        </div>
      </div>
      {workload.days.map((day) => (
        <ServiceCalendarCell day={day} key={day.date} onOpen={onOpen} timezone={timezone} />
      ))}
    </>
  );
}

function ServiceCalendarCell({
  day,
  onOpen,
  timezone,
}: {
  day: ServiceScheduleDay;
  onOpen: (workOrderId: string) => void;
  timezone: string;
}) {
  return (
    <div
      className={`service-resource-day${day.capacityMinutes === undefined ? ' is-unavailable' : ''}`}
    >
      <div className="service-day-capacity">
        {day.capacityMinutes === undefined ? (
          <span>Unavailable</span>
        ) : (
          <>
            <span>
              {formatScheduleMinutes(day.bookedMinutes)} /{' '}
              {formatScheduleMinutes(day.capacityMinutes)}
            </span>
            <small>
              {day.startsAt}–{day.endsAt}
            </small>
          </>
        )}
      </div>
      <div className="service-day-visits">
        {day.visits.map((visit) => (
          <button
            className={`is-${visit.priority}`}
            key={visit.workOrderId}
            onClick={() => onOpen(visit.workOrderId)}
            title={`${visit.customerName} · ${visit.deviceName}`}
            type="button"
          >
            <span>
              {formatTime(visit.scheduledStart, timezone)}–
              {formatTime(visit.scheduledEnd, timezone)}
            </span>
            <strong>{visit.customerName}</strong>
            <small>{visit.customerLocationName}</small>
            <em>{visit.workOrderNumber}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

interface AvailabilityWindowForm {
  capacityMinutes: number;
  enabled: boolean;
  endsAt: string;
  maxVisits: number;
  startsAt: string;
  weekday: number;
}

const scheduleWeekdays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

function TechnicianAvailabilityDrawer({
  onBack,
  onSaved,
  token,
  workload,
}: {
  onBack: () => void;
  onSaved: (technicianName: string) => Promise<void>;
  token: string;
  workload: ServiceTechnicianWorkload;
}) {
  const [windows, setWindows] = useState<AvailabilityWindowForm[]>(() =>
    scheduleWeekdays.map((_, index) => {
      const saved = workload.policy.windows.find((window) => window.weekday === index + 1);
      return {
        capacityMinutes: saved?.capacityMinutes ?? 480,
        enabled: Boolean(saved),
        endsAt: saved?.endsAt ?? '17:00',
        maxVisits: saved?.maxVisits ?? 6,
        startsAt: saved?.startsAt ?? '08:00',
        weekday: index + 1,
      };
    }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateWindow(weekday: number, patch: Partial<AvailabilityWindowForm>) {
    setWindows((current) =>
      current.map((window) => (window.weekday === weekday ? { ...window, ...patch } : window)),
    );
  }

  function useWeekdayTemplate() {
    setWindows((current) =>
      current.map((window) => ({
        ...window,
        capacityMinutes: 480,
        enabled: window.weekday <= 5,
        endsAt: '17:00',
        maxVisits: 6,
        startsAt: '08:00',
      })),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const enabledWindows: ServiceTechnicianScheduleWindow[] = windows
        .filter((window) => window.enabled)
        .map(({ capacityMinutes, endsAt, maxVisits, startsAt, weekday }) => ({
          capacityMinutes,
          endsAt,
          maxVisits,
          startsAt,
          weekday,
        }));
      await updateServiceTechnicianSchedulePolicy(
        token,
        workload.technician.accountId,
        crypto.randomUUID(),
        { expectedVersion: workload.policy.version, windows: enabledWindows },
      );
      await onSaved(workload.technician.displayName);
    } catch (caught) {
      setError(errorText(caught, 'The working hours could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ServiceDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${workload.technician.displayName} · ${workload.technician.warehouseName}`}
      title="Working hours and capacity"
    >
      <form className="service-availability-form" onSubmit={(event) => void submit(event)}>
        <section className="service-availability-intro">
          <div>
            <span>Weekly availability</span>
            <p>
              Only enabled days accept new visits. Capacity can be lower than the full time window.
            </p>
          </div>
          <Button onClick={useWeekdayTemplate} type="button" variant="secondary">
            Use Mon–Fri template
          </Button>
        </section>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <div className="service-availability-table">
          <div className="service-availability-head" aria-hidden="true">
            <span>Day</span>
            <span>Start</span>
            <span>End</span>
            <span>Bookable minutes</span>
            <span>Visit limit</span>
          </div>
          {windows.map((window, index) => (
            <div
              className={`service-availability-row${window.enabled ? ' is-enabled' : ''}`}
              key={window.weekday}
            >
              <label className="service-day-toggle">
                <input
                  checked={window.enabled}
                  onChange={(event) =>
                    updateWindow(window.weekday, { enabled: event.target.checked })
                  }
                  type="checkbox"
                />
                <span>{scheduleWeekdays[index]}</span>
              </label>
              <label>
                <span>Start</span>
                <input
                  disabled={!window.enabled}
                  onChange={(event) =>
                    updateWindow(window.weekday, { startsAt: event.target.value })
                  }
                  required={window.enabled}
                  type="time"
                  value={window.startsAt}
                />
              </label>
              <label>
                <span>End</span>
                <input
                  disabled={!window.enabled}
                  onChange={(event) => updateWindow(window.weekday, { endsAt: event.target.value })}
                  required={window.enabled}
                  type="time"
                  value={window.endsAt}
                />
              </label>
              <label>
                <span>Bookable minutes</span>
                <input
                  disabled={!window.enabled}
                  max="1440"
                  min="15"
                  onChange={(event) =>
                    updateWindow(window.weekday, { capacityMinutes: Number(event.target.value) })
                  }
                  required={window.enabled}
                  step="15"
                  type="number"
                  value={window.capacityMinutes}
                />
              </label>
              <label>
                <span>Visit limit</span>
                <input
                  disabled={!window.enabled}
                  max="100"
                  min="1"
                  onChange={(event) =>
                    updateWindow(window.weekday, { maxVisits: Number(event.target.value) })
                  }
                  required={window.enabled}
                  type="number"
                  value={window.maxVisits}
                />
              </label>
            </div>
          ))}
        </div>
        <div className="service-availability-help">
          <strong>How capacity works</strong>
          <p>
            A visit must fit inside the day’s start and end time. It is also blocked when it
            overlaps another visit or exceeds the bookable minutes or visit limit.
          </p>
        </div>
        <div className="service-drawer-actions service-availability-actions">
          <Button busy={busy} type="submit">
            Save working hours
          </Button>
          <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
            Cancel
          </Button>
        </div>
      </form>
    </ServiceDrawer>
  );
}

function ServiceDevicesView({
  references,
  token,
  timezone,
}: {
  references: ServiceReferenceData;
  token: string;
  timezone: string;
}) {
  const { t } = useLocalization();
  const [equipmentId, setEquipmentId] = useState(references.equipment[0]?.id ?? '');
  const [history, setHistory] = useState<ServiceEquipmentHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!equipmentId) {
      setHistory(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void getServiceEquipmentHistory(token, equipmentId)
      .then((result) => active && setHistory(result))
      .catch((caught) => active && setError(errorText(caught, t('service.historyError'))))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [equipmentId, t, token]);

  return (
    <section className="service-device-history-panel">
      <div className="service-device-picker">
        <div>
          <h2>{t('service.historyTitle')}</h2>
          <p>{t('service.historyHint')}</p>
        </div>
        <label>
          <span>{t('service.device')}</span>
          <select onChange={(event) => setEquipmentId(event.target.value)} value={equipmentId}>
            {!references.equipment.length ? (
              <option value="">{t('service.noEquipment')}</option>
            ) : null}
            {references.equipment.map((equipment) => (
              <option key={equipment.id} value={equipment.id}>
                {equipment.deviceName} · {equipment.serialNumber}
                {equipment.status === 'retired' ? ` · ${t('service.retired')}` : ''}
                {!equipment.active ? ` · ${t('service.inactive')}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading ? <ServiceState title={t('service.loadingHistory')} /> : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {!loading && !error && history ? (
        <div className="service-device-history">
          <header>
            <span className="service-device-mark">
              <Icon name="service" size={20} />
            </span>
            <div>
              <h3>{history.deviceName}</h3>
              <p>
                {t('service.serial', { serial: history.serialNumber })}
                {history.warrantyEndsOn
                  ? ` · ${t('service.warrantyUntil', {
                      date: formatDate(history.warrantyEndsOn, timezone),
                    })}`
                  : ''}
              </p>
            </div>
            <strong>
              {t(history.events.length === 1 ? 'service.recordCount' : 'service.recordsCount', {
                count: history.events.length,
              })}
            </strong>
          </header>
          {!history.events.length ? (
            <p className="service-empty-inline">{t('service.noHistory')}</p>
          ) : (
            <ol className="service-history-list">
              {history.events.map((event) => (
                <li key={event.id}>
                  <span aria-hidden="true" />
                  <div>
                    <div className="service-history-event-heading">
                      <strong>{event.workOrderNumber}</strong>
                      <ServiceStatus status={event.status} />
                    </div>
                    <p>{event.description}</p>
                    <small>
                      {formatDateTime(event.occurredAt, timezone)}
                      {event.technicianName ? ` · ${event.technicianName}` : ''}
                    </small>
                    {event.parts.length ? (
                      <div className="service-history-parts">
                        {event.parts.map((part) => (
                          <span key={part.id}>
                            {part.productName} × {part.quantity}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ServiceCareView({
  canApprove,
  canCreate,
  canEdit,
  references,
  token,
  timezone,
}: {
  canApprove: boolean;
  canCreate: boolean;
  canEdit: boolean;
  references: ServiceReferenceData;
  token: string;
  timezone: string;
}) {
  const [overview, setOverview] = useState<ServiceCareOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [creatingClaim, setCreatingClaim] = useState(false);
  const [creatingInspection, setCreatingInspection] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<WarrantyClaim | null>(null);
  const [selectedInspection, setSelectedInspection] = useState<ServiceInspectionPlan | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getServiceCareOverview(token)
      .then((result) => active && setOverview(result))
      .catch(
        (caught) =>
          active &&
          setError(errorText(caught, 'Warranty and inspection records could not be loaded.')),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [revision, token]);

  function reload() {
    setRevision((current) => current + 1);
  }

  function updateClaim(claim: WarrantyClaim) {
    setSelectedClaim(claim);
    setOverview((current) =>
      current
        ? {
            ...current,
            claims: current.claims.map((item) => (item.id === claim.id ? claim : item)),
          }
        : current,
    );
  }

  function updateInspection(plan: ServiceInspectionPlan) {
    setSelectedInspection(plan);
    setOverview((current) =>
      current
        ? {
            ...current,
            inspections: current.inspections.map((item) => (item.id === plan.id ? plan : item)),
          }
        : current,
    );
  }

  if (loading) return <ServiceState title="Loading warranty and inspection work" />;
  if (error || !overview)
    return (
      <ServiceState title="Warranty and inspection work could not be loaded">
        <Button onClick={reload} variant="secondary">
          Try again
        </Button>
      </ServiceState>
    );

  const activeWarranties = overview.warranties.filter((item) => item.status === 'active').length;
  const expiringSoon = overview.warranties.filter(
    (item) =>
      item.remainingDays !== undefined && item.remainingDays >= 0 && item.remainingDays <= 30,
  ).length;
  const openClaims = overview.claims.filter((item) => item.status !== 'closed').length;
  const todayValue = today(timezone);
  const inspectionsDue = overview.inspections.filter(
    (item) => item.active && item.nextDueDate <= todayValue,
  ).length;

  return (
    <div className="service-care-workspace">
      <section aria-label="Warranty and inspection summary" className="service-summary">
        <ServiceMetric label="Active warranties" value={String(activeWarranties)} />
        <ServiceMetric
          label="Expiring in 30 days"
          {...(expiringSoon ? { tone: 'warning' as const } : {})}
          value={String(expiringSoon)}
        />
        <ServiceMetric
          label="Open claims"
          {...(openClaims ? { tone: 'warning' as const } : {})}
          value={String(openClaims)}
        />
        <ServiceMetric
          label="Inspections due"
          {...(inspectionsDue ? { tone: 'warning' as const } : {})}
          value={String(inspectionsDue)}
        />
      </section>

      <section className="service-care-section">
        <header className="service-view-toolbar">
          <div>
            <h2>Warranty claims</h2>
            <p>Keep the decision, evidence, and claim history with the registered device.</p>
          </div>
          {canCreate ? (
            <Button onClick={() => setCreatingClaim(true)}>
              <Icon name="plus" size={16} /> New warranty claim
            </Button>
          ) : null}
        </header>
        {!overview.claims.length ? (
          <p className="service-empty-inline">No warranty claims have been recorded.</p>
        ) : (
          <div className="service-care-register">
            {overview.claims.map((claim) => (
              <button key={claim.id} onClick={() => setSelectedClaim(claim)} type="button">
                <span className="service-care-record-mark">W</span>
                <span>
                  <strong>{claim.number}</strong>
                  <small>
                    {claim.customerName} · {claim.customerLocationName}
                  </small>
                </span>
                <span>
                  <strong>{claim.deviceName}</strong>
                  <small>{claim.serialNumber}</small>
                </span>
                <span>
                  <strong>{formatDateTime(claim.receivedAt, timezone)}</strong>
                  <small>
                    {claim.attachments.length} file{claim.attachments.length === 1 ? '' : 's'}
                  </small>
                </span>
                <CareStatus value={claim.status} />
                <Icon name="arrow" size={16} />
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="service-care-section">
        <header className="service-view-toolbar">
          <div>
            <h2>Inspection schedule</h2>
            <p>
              Technical and metrological checks use the frequency and reminder set for each device.
            </p>
          </div>
          {canApprove ? (
            <Button onClick={() => setCreatingInspection(true)} variant="secondary">
              <Icon name="plus" size={16} /> Add inspection plan
            </Button>
          ) : null}
        </header>
        {!overview.inspections.length ? (
          <p className="service-empty-inline">No inspection plans have been added.</p>
        ) : (
          <div className="service-inspection-grid">
            {overview.inspections.map((plan) => {
              const due = plan.nextDueDate <= todayValue;
              return (
                <button key={plan.id} onClick={() => setSelectedInspection(plan)} type="button">
                  <span className={`service-inspection-icon${due ? ' is-due' : ''}`}>
                    <Icon name="activity" size={18} />
                  </span>
                  <span>
                    <small>{inspectionTypeLabel(plan.inspectionType)}</small>
                    <strong>{plan.deviceName}</strong>
                    <em>
                      {plan.customerName} · {plan.serialNumber}
                    </em>
                  </span>
                  <span>
                    <small>{due ? 'Due now' : 'Next inspection'}</small>
                    <strong>{formatDate(plan.nextDueDate, timezone)}</strong>
                    <em>
                      Every {plan.intervalMonths} month{plan.intervalMonths === 1 ? '' : 's'}
                    </em>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="service-care-section">
        <header className="service-view-toolbar">
          <div>
            <h2>Warranty coverage</h2>
            <p>Coverage is calculated from the warranty date on the shared equipment register.</p>
          </div>
        </header>
        <div className="service-warranty-grid">
          {overview.warranties.map((item) => (
            <article key={item.equipmentId}>
              <div>
                <strong>{item.deviceName}</strong>
                <span>
                  {item.customerName} · {item.serialNumber}
                </span>
              </div>
              <CareStatus value={item.status} />
              <div>
                <small>{item.warrantyEndsOn ? 'Coverage ends' : 'Coverage date'}</small>
                <strong>
                  {item.warrantyEndsOn ? formatDate(item.warrantyEndsOn, timezone) : 'Not recorded'}
                </strong>
              </div>
              <span>
                {item.claimCount} claim{item.claimCount === 1 ? '' : 's'}
              </span>
            </article>
          ))}
        </div>
      </section>

      {creatingClaim ? (
        <NewWarrantyClaimDrawer
          onBack={() => setCreatingClaim(false)}
          onSaved={(claim) => {
            setCreatingClaim(false);
            reload();
            setSelectedClaim(claim);
          }}
          references={references}
          token={token}
        />
      ) : null}
      {creatingInspection ? (
        <NewInspectionPlanDrawer
          existing={overview.inspections}
          onBack={() => setCreatingInspection(false)}
          onSaved={(plan) => {
            setCreatingInspection(false);
            reload();
            setSelectedInspection(plan);
          }}
          references={references}
          token={token}
          timezone={timezone}
        />
      ) : null}
      {selectedClaim ? (
        <WarrantyClaimDrawer
          canApprove={canApprove}
          canEdit={canEdit}
          claim={selectedClaim}
          onBack={() => setSelectedClaim(null)}
          onChanged={updateClaim}
          token={token}
          timezone={timezone}
        />
      ) : null}
      {selectedInspection ? (
        <InspectionPlanDrawer
          canEdit={canEdit}
          onBack={() => setSelectedInspection(null)}
          onChanged={updateInspection}
          plan={selectedInspection}
          token={token}
          timezone={timezone}
        />
      ) : null}
    </div>
  );
}

function NewWarrantyClaimDrawer({
  onBack,
  onSaved,
  references,
  token,
}: {
  onBack: () => void;
  onSaved: (claim: WarrantyClaim) => void;
  references: ServiceReferenceData;
  token: string;
}) {
  const equipment = references.equipment.filter((item) => item.active && item.status !== 'retired');
  const [equipmentId, setEquipmentId] = useState(equipment[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = equipment.find((item) => item.id === equipmentId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const input: CreateWarrantyClaimRequest = {
      customerEquipmentId: selected.id,
      customerLocationId: selected.customerLocationId,
      customerPartnerId: selected.customerPartnerId,
      description,
    };
    setBusy(true);
    setError(null);
    try {
      onSaved(await createWarrantyClaim(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The warranty claim could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ServiceDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Registered customer equipment"
      title="New warranty claim"
      variant="care"
    >
      <form className="service-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <FormSection
          index="1"
          title="Device"
          description="Choose the affected device from the shared equipment register."
        >
          <ServiceField label="Customer device">
            <select
              onChange={(event) => setEquipmentId(event.target.value)}
              required
              value={equipmentId}
            >
              <option value="">Choose device</option>
              {equipment.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.deviceName} · {item.serialNumber} ·{' '}
                  {customerName(references, item.customerPartnerId)}
                </option>
              ))}
            </select>
          </ServiceField>
          {selected ? (
            <div className="service-selected-context">
              <Icon name="service" size={17} />
              <span>
                <strong>{customerName(references, selected.customerPartnerId)}</strong>
                <small>{locationName(references, selected.customerLocationId)}</small>
              </span>
              <CareStatus value={warrantyStatus(selected.warrantyEndsOn)} />
            </div>
          ) : null}
        </FormSection>
        <FormSection
          index="2"
          title="Claim details"
          description="Describe the reported fault and the circumstances clearly."
        >
          <ServiceField label="Description">
            <textarea
              maxLength={4000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe the fault, when it appeared, and any checks already completed."
              required
              rows={6}
              value={description}
            />
          </ServiceField>
        </FormSection>
        <DrawerActions
          busy={busy}
          disabled={!selected}
          onBack={onBack}
          submitLabel="Create claim"
        />
      </form>
    </ServiceDrawer>
  );
}

function NewInspectionPlanDrawer({
  existing,
  onBack,
  onSaved,
  references,
  token,
  timezone,
}: {
  existing: ServiceInspectionPlan[];
  onBack: () => void;
  onSaved: (plan: ServiceInspectionPlan) => void;
  references: ServiceReferenceData;
  token: string;
  timezone: string;
}) {
  const equipment = references.equipment.filter((item) => item.active && item.status !== 'retired');
  const [equipmentId, setEquipmentId] = useState(equipment[0]?.id ?? '');
  const [inspectionType, setInspectionType] =
    useState<CreateServiceInspectionPlanRequest['inspectionType']>('technical');
  const [intervalMonths, setIntervalMonths] = useState(12);
  const [nextDueDate, setNextDueDate] = useState(today(timezone));
  const [reminderLeadDays, setReminderLeadDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const duplicate = existing.some(
    (item) => item.equipmentId === equipmentId && item.inspectionType === inspectionType,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await createServiceInspectionPlan(token, crypto.randomUUID(), {
          customerEquipmentId: equipmentId,
          inspectionType,
          intervalMonths,
          nextDueDate,
          reminderLeadDays,
        }),
      );
    } catch (caught) {
      setError(errorText(caught, 'The inspection plan could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ServiceDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Device, frequency, and reminder"
      title="Add inspection plan"
      variant="care"
    >
      <form className="service-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <FormSection
          index="1"
          title="Inspection"
          description="Use the inspection requirement approved for this device."
        >
          <ServiceField label="Customer device">
            <select
              onChange={(event) => setEquipmentId(event.target.value)}
              required
              value={equipmentId}
            >
              <option value="">Choose device</option>
              {equipment.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.deviceName} · {item.serialNumber} ·{' '}
                  {customerName(references, item.customerPartnerId)}
                </option>
              ))}
            </select>
          </ServiceField>
          <div className="service-form-grid">
            <ServiceField label="Inspection type">
              <select
                onChange={(event) =>
                  setInspectionType(
                    event.target.value as CreateServiceInspectionPlanRequest['inspectionType'],
                  )
                }
                value={inspectionType}
              >
                <option value="technical">Technical</option>
                <option value="metrological">Metrological</option>
              </select>
            </ServiceField>
            <ServiceField label="Frequency (months)">
              <input
                max="120"
                min="1"
                onChange={(event) => setIntervalMonths(Number(event.target.value))}
                required
                type="number"
                value={intervalMonths}
              />
            </ServiceField>
          </div>
        </FormSection>
        <FormSection
          index="2"
          title="First due date"
          description="Set when the next inspection is due and how early Service should be reminded."
        >
          <div className="service-form-grid">
            <ServiceField label="Next due date">
              <input
                onChange={(event) => setNextDueDate(event.target.value)}
                required
                type="date"
                value={nextDueDate}
              />
            </ServiceField>
            <ServiceField label="Reminder (days before)">
              <input
                max="365"
                min="0"
                onChange={(event) => setReminderLeadDays(Number(event.target.value))}
                required
                type="number"
                value={reminderLeadDays}
              />
            </ServiceField>
          </div>
          {duplicate ? (
            <InlineAlert tone="warning">This device already has that inspection plan.</InlineAlert>
          ) : null}
        </FormSection>
        <DrawerActions
          busy={busy}
          disabled={!equipmentId || duplicate}
          onBack={onBack}
          submitLabel="Add inspection plan"
        />
      </form>
    </ServiceDrawer>
  );
}

function WarrantyClaimDrawer({
  canApprove,
  canEdit,
  claim,
  onBack,
  onChanged,
  token,
  timezone,
}: {
  canApprove: boolean;
  canEdit: boolean;
  claim: WarrantyClaim;
  onBack: () => void;
  onChanged: (claim: WarrantyClaim) => void;
  token: string;
  timezone: string;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileAttempt = useRef<{ file: File; key: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function transition(nextStatus: TransitionWarrantyClaimRequest['nextStatus']) {
    setBusy(true);
    setError(null);
    try {
      const input: TransitionWarrantyClaimRequest = {
        expectedVersion: claim.version,
        nextStatus,
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      onChanged(await transitionWarrantyClaim(token, claim.id, crypto.randomUUID(), input));
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
    <ServiceDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${claim.customerName} · ${claim.deviceName}`}
      title={claim.number}
      variant="care"
    >
      <div className="service-claim-preview">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="service-care-hero">
          <div>
            <span>Warranty claim</span>
            <h3>{claim.deviceName}</h3>
            <p>
              {claim.serialNumber} · {claim.customerLocationName}
            </p>
          </div>
          <CareStatus value={claim.status} />
        </section>
        <section className="service-preview-section">
          <header>
            <div>
              <h3>Reported issue</h3>
              <p>Received {formatDateTime(claim.receivedAt, timezone)}</p>
            </div>
          </header>
          <p className="service-care-description">{claim.description}</p>
          {claim.decisionNote ? (
            <div className="service-decision-note">
              <strong>Decision note</strong>
              <p>{claim.decisionNote}</p>
            </div>
          ) : null}
        </section>
        <section className="service-preview-section">
          <header>
            <div>
              <h3>Supporting files</h3>
              <p>Photos, reports, and documents follow this claim’s access rules.</p>
            </div>
            <span>{claim.attachments.length}</span>
          </header>
          <div className="service-claim-files">
            {claim.attachments.map((attachment) => (
              <ClaimFile key={attachment.id} file={attachment} token={token} />
            ))}
            {canEdit && claim.status !== 'closed' ? (
              <div className="service-claim-upload">
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
                  type="button"
                  variant="secondary"
                >
                  Upload file
                </Button>
              </div>
            ) : null}
          </div>
        </section>
        <section className="service-preview-section">
          <header>
            <div>
              <h3>Claim history</h3>
              <p>Every workflow decision remains recorded.</p>
            </div>
          </header>
          <ol className="service-history-list is-compact">
            {claim.history.map((entry) => (
              <li key={entry.id}>
                <span aria-hidden="true" />
                <div>
                  <strong>{claimStatusLabel(entry.nextStatus)}</strong>
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
        {canApprove && claim.status !== 'closed' ? (
          <section className="service-claim-decision">
            <div>
              <h3>Next step</h3>
              <p>{claimNextStep(claim.status)}</p>
            </div>
            {claim.status === 'under_review' ? (
              <textarea
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Record the findings and decision reason."
                required
                rows={3}
                value={note}
              />
            ) : null}
            <div className="service-drawer-actions">
              {claim.status === 'received' ? (
                <Button onClick={() => void transition('under_review')} type="button">
                  Start review
                </Button>
              ) : null}
              {claim.status === 'under_review' ? (
                <>
                  <Button
                    disabled={!note.trim()}
                    onClick={() => void transition('approved')}
                    type="button"
                  >
                    Approve claim
                  </Button>
                  <Button
                    disabled={!note.trim()}
                    onClick={() => void transition('rejected')}
                    type="button"
                    variant="secondary"
                  >
                    Reject claim
                  </Button>
                </>
              ) : null}
              {claim.status === 'approved' || claim.status === 'rejected' ? (
                <Button onClick={() => void transition('closed')} type="button">
                  Close claim
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </ServiceDrawer>
  );
}

function InspectionPlanDrawer({
  canEdit,
  onBack,
  onChanged,
  plan,
  token,
  timezone,
}: {
  canEdit: boolean;
  onBack: () => void;
  onChanged: (plan: ServiceInspectionPlan) => void;
  plan: ServiceInspectionPlan;
  token: string;
  timezone: string;
}) {
  const [completing, setCompleting] = useState(false);
  const [completedOn, setCompletedOn] = useState(today(timezone));
  const [outcome, setOutcome] = useState<CompleteServiceInspectionRequest['outcome']>('passed');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await completeServiceInspection(token, plan.id, crypto.randomUUID(), {
          completedOn,
          expectedVersion: plan.version,
          notes,
          outcome,
        }),
      );
      setCompleting(false);
      setNotes('');
    } catch (caught) {
      setError(errorText(caught, 'The inspection result could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ServiceDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${plan.customerName} · ${plan.serialNumber}`}
      title={`${inspectionTypeLabel(plan.inspectionType)} inspection`}
      variant="care"
    >
      <div className="service-inspection-preview">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="service-care-hero">
          <div>
            <span>Inspection plan</span>
            <h3>{plan.deviceName}</h3>
            <p>{plan.customerLocationName}</p>
          </div>
          <div className="service-due-date">
            <small>Next due</small>
            <strong>{formatDate(plan.nextDueDate, timezone)}</strong>
          </div>
        </section>
        <section className="service-care-facts">
          <div>
            <span>Frequency</span>
            <strong>Every {plan.intervalMonths} months</strong>
          </div>
          <div>
            <span>Reminder</span>
            <strong>{plan.reminderLeadDays} days before</strong>
          </div>
          <div>
            <span>Last completed</span>
            <strong>
              {plan.lastCompletedOn
                ? formatDate(plan.lastCompletedOn, timezone)
                : 'No completion yet'}
            </strong>
          </div>
        </section>
        {canEdit && !completing ? (
          <section className="service-inspection-record-action">
            <div>
              <h3>After the inspection</h3>
              <p>Once the check has taken place, save its date, outcome, and findings here.</p>
            </div>
            <Button onClick={() => setCompleting(true)}>Record completed inspection</Button>
          </section>
        ) : null}
        {completing ? (
          <form
            className="service-form service-inspection-completion"
            onSubmit={(event) => void submit(event)}
          >
            <FormSection
              index="1"
              title="Inspection result"
              description="Record the date, outcome, and findings from the completed check."
            >
              <div className="service-form-grid">
                <ServiceField label="Completed on">
                  <input
                    onChange={(event) => setCompletedOn(event.target.value)}
                    required
                    type="date"
                    value={completedOn}
                  />
                </ServiceField>
                <ServiceField label="Outcome">
                  <select
                    onChange={(event) =>
                      setOutcome(event.target.value as CompleteServiceInspectionRequest['outcome'])
                    }
                    value={outcome}
                  >
                    <option value="passed">Passed</option>
                    <option value="attention_required">Attention required</option>
                  </select>
                </ServiceField>
              </div>
              <ServiceField label="Findings">
                <textarea
                  maxLength={2000}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Record checks completed, readings, and any follow-up needed."
                  required
                  rows={4}
                  value={notes}
                />
              </ServiceField>
            </FormSection>
            <DrawerActions
              backLabel="Cancel"
              busy={busy}
              onBack={() => setCompleting(false)}
              submitLabel="Save inspection result"
            />
          </form>
        ) : null}
        <section className="service-preview-section">
          <header>
            <div>
              <h3>Completed inspections</h3>
              <p>Previous results remain available for this device.</p>
            </div>
            <span>{plan.records.length}</span>
          </header>
          {!plan.records.length ? (
            <p className="service-empty-inline">No completed inspection has been recorded.</p>
          ) : (
            <ol className="service-history-list is-compact">
              {plan.records.map((record) => (
                <li key={record.id}>
                  <span aria-hidden="true" />
                  <div>
                    <strong>{record.outcome === 'passed' ? 'Passed' : 'Attention required'}</strong>
                    <p>{record.notes}</p>
                    <small>
                      {formatDate(record.completedOn, timezone)} · due{' '}
                      {formatDate(record.dueDate, timezone)}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </ServiceDrawer>
  );
}

function ClaimFile({ file, token }: { file: ManagedFile; token: string }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const result = await downloadManagedFile(token, file);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="service-claim-file">
      <Icon name="finance" size={17} />
      <span>
        <strong>{file.originalName}</strong>
        <small>
          {formatFileSize(file.byteSize)} · Version {file.version}
        </small>
      </span>
      <Button busy={busy} onClick={() => void download()} variant="quiet">
        Download
      </Button>
    </div>
  );
}

function CareStatus({ value }: { value: string }) {
  return <span className={`service-care-status is-${value}`}>{claimStatusLabel(value)}</span>;
}
function claimStatusLabel(value: string) {
  return (
    (
      {
        active: 'Active',
        approved: 'Approved',
        closed: 'Closed',
        expired: 'Expired',
        not_recorded: 'Not recorded',
        received: 'Received',
        rejected: 'Rejected',
        under_review: 'Under review',
      } as Record<string, string>
    )[value] ?? value
  );
}
function inspectionTypeLabel(value: ServiceInspectionPlan['inspectionType']) {
  return value === 'technical' ? 'Technical' : 'Metrological';
}
function claimNextStep(value: WarrantyClaim['status']) {
  return (
    {
      approved: 'Confirm the approved work is complete, then close the claim.',
      received: 'Start the review when the supporting details are ready.',
      rejected: 'Confirm the customer has been informed, then close the claim.',
      under_review: 'Record the findings before approving or rejecting the claim.',
      closed: '',
    } as const
  )[value];
}
function customerName(references: ServiceReferenceData, id: string) {
  return references.customers.find((item) => item.id === id)?.name ?? 'Customer';
}
function locationName(references: ServiceReferenceData, id: string) {
  return references.locations.find((item) => item.id === id)?.name ?? 'Service location';
}
function warrantyStatus(endsOn?: string) {
  return !endsOn
    ? 'not_recorded'
    : endsOn >= new Date().toISOString().slice(0, 10)
      ? 'active'
      : 'expired';
}
function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function navigationServiceRequestId(value: unknown): string | undefined {
  return value &&
    typeof value === 'object' &&
    'serviceRequestId' in value &&
    typeof value.serviceRequestId === 'string'
    ? value.serviceRequestId
    : undefined;
}

function NewServiceRequestDrawer({
  onBack,
  onSaved,
  references,
  token,
}: {
  onBack: () => void;
  onSaved: (request: ServiceRequest) => void;
  references: ServiceReferenceData;
  token: string;
}) {
  const eligibleEquipment = references.equipment.filter(
    (item) => item.active && item.status === 'active',
  );
  const initialEquipment = eligibleEquipment[0];
  const initialCustomerPartnerId =
    initialEquipment?.customerPartnerId ?? references.customers[0]?.id ?? '';
  const [customerPartnerId, setCustomerPartnerId] = useState(initialCustomerPartnerId);
  const locations = references.locations.filter(
    (location) => location.customerPartnerId === customerPartnerId,
  );
  const initialCustomerLocationId =
    initialEquipment?.customerLocationId ??
    references.locations.find((location) => location.customerPartnerId === initialCustomerPartnerId)
      ?.id ??
    '';
  const [customerLocationId, setCustomerLocationId] = useState(initialCustomerLocationId);
  const equipment = eligibleEquipment.filter(
    (item) =>
      item.customerPartnerId === customerPartnerId &&
      item.customerLocationId === customerLocationId,
  );
  const [customerEquipmentId, setCustomerEquipmentId] = useState(initialEquipment?.id ?? '');
  const [sourceChannel, setSourceChannel] = useState<ManualServiceRequestChannel>('telephone');
  const [serviceType, setServiceType] = useState<ServiceType>('warranty');
  const [subscriptionContractId, setSubscriptionContractId] = useState('');
  const [priority, setPriority] = useState<ServicePriority>('normal');
  const [problemDescription, setProblemDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeCustomer(nextCustomerId: string) {
    const nextEquipment = eligibleEquipment.find(
      (item) => item.customerPartnerId === nextCustomerId,
    );
    const nextLocationId =
      nextEquipment?.customerLocationId ??
      references.locations.find((location) => location.customerPartnerId === nextCustomerId)?.id;
    setCustomerPartnerId(nextCustomerId);
    setCustomerLocationId(nextLocationId ?? '');
    setCustomerEquipmentId(nextEquipment?.id ?? '');
    setSubscriptionContractId('');
  }

  function changeLocation(nextLocationId: string) {
    const nextEquipmentId = eligibleEquipment.find(
      (item) =>
        item.customerPartnerId === customerPartnerId && item.customerLocationId === nextLocationId,
    )?.id;
    setCustomerLocationId(nextLocationId);
    setCustomerEquipmentId(nextEquipmentId ?? '');
    setSubscriptionContractId('');
  }

  const subscriptions = references.subscriptions.filter(
    (contract) =>
      contract.customerPartnerId === customerPartnerId &&
      contract.customerLocationId === customerLocationId &&
      contract.customerEquipmentIds.includes(customerEquipmentId),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CreateServiceRequest = {
        customerEquipmentId,
        customerLocationId,
        customerPartnerId,
        priority,
        problemDescription,
        serviceType,
        sourceChannel,
        ...(serviceType === 'subscription' ? { subscriptionContractId } : {}),
      };
      onSaved(await createServiceRequest(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The service request could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ServiceDrawer
      actions={
        <>
          <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
            Back
          </Button>
          <Button
            busy={busy}
            disabled={!customerEquipmentId || !customerLocationId || !customerPartnerId}
            form="new-service-request-form"
            type="submit"
          >
            Create request
          </Button>
        </>
      }
      busy={busy}
      onBack={onBack}
      subtitle="Customer, device, and request details"
      title="New service request"
      variant="request"
    >
      <form
        className="service-form"
        id="new-service-request-form"
        onSubmit={(event) => void submit(event)}
      >
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        {!references.customers.length ? (
          <InlineAlert tone="warning">
            Add a customer before creating a service request.
          </InlineAlert>
        ) : (
          <>
            <FormSection
              index="1"
              title="Customer and equipment"
              description="Choose the customer, service location, and device."
            >
              <div className="service-form-grid">
                <ServiceField label="Customer">
                  <select
                    onChange={(event) => changeCustomer(event.target.value)}
                    required
                    value={customerPartnerId}
                  >
                    {references.customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </ServiceField>
                <ServiceField label="Service location">
                  <select
                    onChange={(event) => changeLocation(event.target.value)}
                    required
                    value={customerLocationId}
                  >
                    <option value="">Choose location</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </ServiceField>
              </div>
              {equipment.length ? (
                <ServiceField label="Device and serial number">
                  <select
                    onChange={(event) => {
                      setCustomerEquipmentId(event.target.value);
                      setSubscriptionContractId('');
                    }}
                    required
                    value={customerEquipmentId}
                  >
                    {equipment.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.deviceName} · {item.serialNumber}
                      </option>
                    ))}
                  </select>
                </ServiceField>
              ) : (
                <InlineAlert tone="warning">
                  This location has no active registered device. Choose another customer or
                  location, or register the device first.
                </InlineAlert>
              )}
            </FormSection>
            {equipment.length ? (
              <FormSection
                index="2"
                title="Request details"
                description="Add how the request arrived, its priority, and service coverage."
              >
                <div className="service-form-grid">
                  <ServiceField label="Request source">
                    <select
                      onChange={(event) =>
                        setSourceChannel(event.target.value as ManualServiceRequestChannel)
                      }
                      value={sourceChannel}
                    >
                      {sourceChannels.map((channel) => (
                        <option key={channel} value={channel}>
                          {sourceLabel(channel)}
                        </option>
                      ))}
                    </select>
                  </ServiceField>
                  <ServiceField label="Priority">
                    <select
                      onChange={(event) => setPriority(event.target.value as ServicePriority)}
                      value={priority}
                    >
                      {priorities.map((item) => (
                        <option key={item} value={item}>
                          {priorityLabel(item)}
                        </option>
                      ))}
                    </select>
                  </ServiceField>
                  <ServiceField label="Service type">
                    <select
                      onChange={(event) => setServiceType(event.target.value as ServiceType)}
                      value={serviceType}
                    >
                      {serviceTypes.map((item) => (
                        <option key={item} value={item}>
                          {serviceTypeLabel(item)}
                        </option>
                      ))}
                    </select>
                  </ServiceField>
                  {serviceType === 'subscription' ? (
                    <ServiceField label="Service subscription">
                      <select
                        onChange={(event) => setSubscriptionContractId(event.target.value)}
                        required
                        value={subscriptionContractId}
                      >
                        <option value="">Choose a contract</option>
                        {subscriptions.map((contract) => (
                          <option key={contract.id} value={contract.id}>
                            {contract.number}
                          </option>
                        ))}
                      </select>
                    </ServiceField>
                  ) : null}
                </div>
                <ServiceField label="Problem description">
                  <textarea
                    maxLength={4000}
                    onChange={(event) => setProblemDescription(event.target.value)}
                    placeholder="Describe the reported issue and any useful context."
                    required
                    rows={5}
                    value={problemDescription}
                  />
                </ServiceField>
              </FormSection>
            ) : null}
          </>
        )}
      </form>
    </ServiceDrawer>
  );
}

function ServiceRequestDrawer({
  canApprove,
  canCreateCrm,
  onBack,
  onOpenCrmTicket,
  onOpenWorkOrder,
  onSaved,
  references,
  request,
  token,
  timezone,
}: {
  canApprove: boolean;
  canCreateCrm: boolean;
  onBack: () => void;
  onOpenCrmTicket: (id: string) => void;
  onOpenWorkOrder: (id: string) => void;
  onSaved: (request: ServiceRequest, message: string) => void;
  references: ServiceReferenceData;
  request: ServiceRequest;
  token: string;
  timezone: string;
}) {
  const [assigning, setAssigning] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [showCancellation, setShowCancellation] = useState(false);
  const [showCrmTicket, setShowCrmTicket] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!cancellationReason.trim()) {
      setError('Enter the reason for cancelling this request.');
      return;
    }
    setCancelling(true);
    setError(null);
    try {
      const saved = await cancelServiceRequest(token, request.id, crypto.randomUUID(), {
        cancellationReason,
        expectedVersion: request.version,
      });
      setShowCancellation(false);
      onSaved(saved, `${saved.number} was cancelled.`);
    } catch (caught) {
      setError(errorText(caught, 'The service request could not be cancelled.'));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <ServiceDrawer
      busy={cancelling}
      onBack={onBack}
      subtitle={request.customerName}
      title={request.number}
    >
      <div className="service-preview">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="service-preview-hero">
          <div>
            <ServiceStatus status={request.status} />
            <h3>{request.deviceName}</h3>
            <p>
              {request.serialNumber} · {serviceTypeLabel(request.serviceType)}
            </p>
          </div>
          {request.workOrderId ? (
            <Button onClick={() => onOpenWorkOrder(request.workOrderId!)} variant="secondary">
              Open work order
            </Button>
          ) : canApprove ? (
            <Button onClick={() => setAssigning(true)}>Dispatch request</Button>
          ) : null}
        </section>
        <section className="service-preview-section">
          <header>
            <div>
              <h3>Reported issue</h3>
              <p>
                {sourceLabel(request.sourceChannel)} · {priorityLabel(request.priority)}
              </p>
            </div>
          </header>
          <p className="service-problem-copy">{request.problemDescription}</p>
        </section>
        <section className="service-preview-section">
          <header>
            <div>
              <h3>Service location</h3>
              <p>Shared ERP customer and equipment data.</p>
            </div>
          </header>
          <dl className="service-fact-grid">
            <div>
              <dt>Customer</dt>
              <dd>{request.customerName}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{request.customerLocationName}</dd>
            </div>
            <div>
              <dt>Device</dt>
              <dd>{request.deviceName}</dd>
            </div>
            <div>
              <dt>Serial number</dt>
              <dd>{request.serialNumber}</dd>
            </div>
          </dl>
        </section>
        {request.assignedTechnician ? (
          <section className="service-preview-section">
            <header>
              <div>
                <h3>Dispatch</h3>
                <p>Scheduled work stays with the assigned technician.</p>
              </div>
            </header>
            <div className="service-assignment-card">
              <span>{request.assignedTechnician.displayName}</span>
              <strong>
                {request.scheduledStart
                  ? formatDateTime(request.scheduledStart, timezone)
                  : 'Time pending'}
              </strong>
              <small>{request.assignedTechnician.warehouseName}</small>
            </div>
            {canApprove && request.status === 'scheduled' ? (
              <Button onClick={() => setAssigning(true)} variant="quiet">
                Reschedule
              </Button>
            ) : null}
          </section>
        ) : null}
        {canCreateCrm ? (
          <section className="service-preview-section service-crm-link-section">
            <header>
              <div>
                <h3>CRM customer ticket</h3>
                <p>
                  Connect this Service request to the customer-service queue without creating
                  duplicates.
                </p>
              </div>
              {!showCrmTicket ? (
                <Button onClick={() => setShowCrmTicket(true)} variant="secondary">
                  Create or open ticket
                </Button>
              ) : null}
            </header>
            {showCrmTicket ? (
              <CreateCrmTicketFromServiceForm
                onCancel={() => setShowCrmTicket(false)}
                onCreated={onOpenCrmTicket}
                request={request}
                token={token}
              />
            ) : null}
          </section>
        ) : null}
        {assigning ? (
          <AssignServiceRequestForm
            onCancel={() => setAssigning(false)}
            onError={setError}
            onSaved={(saved) => {
              setAssigning(false);
              onSaved(saved, `${saved.number} was assigned to a technician.`);
            }}
            references={references}
            request={request}
            token={token}
            timezone={timezone}
          />
        ) : null}
        {canApprove && (request.status === 'new' || request.status === 'scheduled') ? (
          <section className="service-preview-section service-cancel-section">
            <header>
              <div>
                <h3>Cancel request</h3>
                <p>
                  Use this only when the visit will not go ahead. The reason remains in the record.
                </p>
              </div>
              {!showCancellation ? (
                <Button onClick={() => setShowCancellation(true)} variant="quiet">
                  Cancel request
                </Button>
              ) : null}
            </header>
            {showCancellation ? (
              <div className="service-cancel-form">
                <ServiceField label="Cancellation reason">
                  <textarea
                    maxLength={1000}
                    onChange={(event) => setCancellationReason(event.target.value)}
                    required
                    rows={3}
                    value={cancellationReason}
                  />
                </ServiceField>
                <div className="service-inline-actions">
                  <Button
                    busy={cancelling}
                    onClick={() => void cancel()}
                    type="button"
                    variant="danger"
                  >
                    Confirm cancellation
                  </Button>
                  <Button
                    disabled={cancelling}
                    onClick={() => setShowCancellation(false)}
                    type="button"
                    variant="secondary"
                  >
                    Keep request
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </ServiceDrawer>
  );
}

function CreateCrmTicketFromServiceForm({
  onCancel,
  onCreated,
  request,
  token,
}: {
  onCancel: () => void;
  onCreated: (ticketId: string) => void;
  request: ServiceRequest;
  token: string;
}) {
  const priority: CrmTicketPriority = request.priority === 'critical' ? 'urgent' : request.priority;
  const [references, setReferences] = useState<CrmTicketReferenceData | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [slaPolicyId, setSlaPolicyId] = useState('');
  const [assignedToAccountId, setAssignedToAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getCrmTicketReferenceData(token)
      .then((value) => {
        if (!active) return;
        setReferences(value);
        setCategoryId(
          value.categories.find((item) => item.code === 'technical_support')?.id ??
            value.categories[0]?.id ??
            '',
        );
        const policies = value.slaPolicies.filter(
          (item) =>
            (!item.customerPartnerId || item.customerPartnerId === request.customerPartnerId) &&
            (!item.serviceSubscriptionContractId ||
              item.serviceSubscriptionContractId === request.subscriptionContractId) &&
            (!item.priority || item.priority === priority),
        );
        setSlaPolicyId(policies[0]?.id ?? '');
      })
      .catch((caught) => {
        if (active) setError(errorText(caught, 'CRM choices could not be loaded.'));
      });
    return () => {
      active = false;
    };
  }, [priority, request.customerPartnerId, request.subscriptionContractId, token]);

  const policies =
    references?.slaPolicies.filter(
      (item) =>
        (!item.customerPartnerId || item.customerPartnerId === request.customerPartnerId) &&
        (!item.serviceSubscriptionContractId ||
          item.serviceSubscriptionContractId === request.subscriptionContractId) &&
        (!item.priority || item.priority === priority),
    ) ?? [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ticket = await createCrmTicketFromServiceRequest(
        token,
        request.id,
        crypto.randomUUID(),
        {
          ...(assignedToAccountId ? { assignedToAccountId } : {}),
          categoryId,
          priority,
          slaPolicyId,
        },
      );
      onCreated(ticket.id);
    } catch (caught) {
      setError(errorText(caught, 'The CRM ticket could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="service-dispatch-form service-crm-link-form"
      onSubmit={(event) => void submit(event)}
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {!references ? (
        <p className="service-problem-copy">Loading CRM choices…</p>
      ) : (
        <>
          <div className="service-form-grid">
            <ServiceField label="Ticket category">
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
            </ServiceField>
            <ServiceField label="CRM owner">
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
            </ServiceField>
          </div>
          <ServiceField label="SLA rule">
            <select
              onChange={(event) => setSlaPolicyId(event.target.value)}
              required
              value={slaPolicyId}
            >
              {policies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </ServiceField>
          {!policies.length ? (
            <InlineAlert tone="warning">No active SLA rule applies to this priority.</InlineAlert>
          ) : null}
        </>
      )}
      <div className="service-inline-actions">
        <Button busy={busy} disabled={!references || !categoryId || !slaPolicyId} type="submit">
          Create or open ticket
        </Button>
        <Button disabled={busy} onClick={onCancel} type="button" variant="secondary">
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AssignServiceRequestForm({
  onCancel,
  onError,
  onSaved,
  references,
  request,
  token,
  timezone,
}: {
  onCancel: () => void;
  onError: (message: string | null) => void;
  onSaved: (request: ServiceRequest) => void;
  references: ServiceReferenceData;
  request: ServiceRequest;
  token: string;
  timezone: string;
}) {
  const [technicianAccountId, setTechnicianAccountId] = useState(
    request.assignedTechnician?.accountId ?? references.technicians[0]?.accountId ?? '',
  );
  const technician = references.technicians.find((item) => item.accountId === technicianAccountId);
  const [scheduledStart, setScheduledStart] = useState(
    toBusinessDateTimeInput(request.scheduledStart ?? nextBusinessHour(timezone), timezone),
  );
  const [scheduledEnd, setScheduledEnd] = useState(
    toBusinessDateTimeInput(request.scheduledEnd ?? nextBusinessHour(timezone, 2), timezone),
  );
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!technician) return;
    setBusy(true);
    onError(null);
    try {
      const input: AssignServiceWorkOrderRequest = {
        expectedVersion: request.version,
        scheduledEnd: businessDateTimeToIso(scheduledEnd, timezone),
        scheduledStart: businessDateTimeToIso(scheduledStart, timezone),
        technicianAccountId: technician.accountId,
        technicianWarehouseId: technician.warehouseId,
      };
      onSaved(await assignServiceWorkOrder(token, request.id, crypto.randomUUID(), input));
    } catch (caught) {
      onError(errorText(caught, 'The request could not be assigned.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="service-dispatch-form">
      <header>
        <span>Dispatch</span>
        <p>Assign the visit to a technician and their mapped mobile warehouse.</p>
      </header>
      {!references.technicians.length ? (
        <InlineAlert tone="warning">
          Set up an active technician operator and technician warehouse in Business structure first.
        </InlineAlert>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <div className="service-form-grid">
            <ServiceField label="Technician">
              <select
                onChange={(event) => setTechnicianAccountId(event.target.value)}
                value={technicianAccountId}
              >
                {references.technicians.map((item) => (
                  <option key={item.warehouseId} value={item.accountId}>
                    {item.displayName} · {item.warehouseName}
                  </option>
                ))}
              </select>
            </ServiceField>
            <ServiceField label="Scheduled start">
              <input
                onChange={(event) => setScheduledStart(event.target.value)}
                required
                type="datetime-local"
                value={scheduledStart}
              />
            </ServiceField>
            <ServiceField label="Scheduled end">
              <input
                onChange={(event) => setScheduledEnd(event.target.value)}
                required
                type="datetime-local"
                value={scheduledEnd}
              />
            </ServiceField>
          </div>
          <div className="service-inline-actions">
            <Button busy={busy} type="submit">
              Assign visit
            </Button>
            <Button disabled={busy} onClick={onCancel} type="button" variant="secondary">
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function ServiceWorkOrderDrawer({
  canApprove,
  canCreateFinance,
  canEdit,
  canViewFinance,
  currentAccountId,
  onBack,
  onSaved,
  references,
  token,
  timezone,
  workOrder,
}: {
  canApprove: boolean;
  canCreateFinance: boolean;
  canEdit: boolean;
  canViewFinance: boolean;
  currentAccountId: string;
  onBack: () => void;
  onSaved: (workOrder: ServiceWorkOrder, message: string) => void;
  references: ServiceReferenceData;
  token: string;
  timezone: string;
  workOrder: ServiceWorkOrder;
}) {
  const { navigate } = useRouter();
  const [mode, setMode] = useState<'details' | 'complete'>('details');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const photoRequest = useRef<{ file: File; key: string } | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const canManage =
    canEdit && (canApprove || workOrder.assignedTechnician?.accountId === currentAccountId);

  if (mode === 'complete')
    return (
      <CompleteWorkOrderDrawer
        onBack={() => setMode('details')}
        onSaved={(saved) => {
          setMode('details');
          onSaved(saved, `${saved.number} was completed and the visit was recorded.`);
        }}
        references={references}
        token={token}
        timezone={timezone}
        workOrder={workOrder}
      />
    );

  async function start() {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await startServiceWorkOrder(token, workOrder.id, crypto.randomUUID(), {
          expectedVersion: workOrder.version,
        }),
        `${workOrder.number} is now in progress.`,
      );
    } catch (caught) {
      setError(errorText(caught, 'The work order could not be started.'));
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto() {
    if (!photo) return;
    setBusy(true);
    setError(null);
    try {
      if (photoRequest.current?.file !== photo)
        photoRequest.current = { file: photo, key: crypto.randomUUID() };
      await uploadServicePhoto(token, workOrder.id, photoRequest.current.key, photo);
      const refreshed = await getServiceWorkOrder(token, workOrder.id);
      setPhoto(null);
      photoRequest.current = null;
      if (photoInput.current) photoInput.current.value = '';
      onSaved(refreshed, 'Photo evidence was added to the work order.');
    } catch (caught) {
      setError(errorText(caught, 'The photo could not be uploaded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ServiceDrawer
      busy={busy}
      onBack={onBack}
      subtitle={workOrder.customerName}
      title={workOrder.number}
    >
      <div className="service-preview">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="service-preview-hero">
          <div>
            <ServiceStatus status={workOrder.status} />
            <h3>{workOrder.deviceName}</h3>
            <p>
              {workOrder.serialNumber} ·{' '}
              {workOrder.assignedTechnician?.displayName ?? 'Technician pending'}
            </p>
          </div>
          {canManage && workOrder.status === 'scheduled' ? (
            <Button busy={busy} onClick={() => void start()}>
              Start work
            </Button>
          ) : null}
          {canManage && workOrder.status === 'in_progress' ? (
            <Button onClick={() => setMode('complete')}>Complete work</Button>
          ) : null}
        </section>
        <section className="service-preview-section">
          <header>
            <div>
              <h3>Visit</h3>
              <p>{workOrder.problemDescription}</p>
            </div>
          </header>
          <dl className="service-fact-grid">
            <div>
              <dt>Location</dt>
              <dd>{workOrder.customerLocationName}</dd>
            </div>
            <div>
              <dt>Service type</dt>
              <dd>{serviceTypeLabel(workOrder.serviceType)}</dd>
            </div>
            <div>
              <dt>Scheduled</dt>
              <dd>
                {workOrder.scheduledStart
                  ? formatDateTime(workOrder.scheduledStart, timezone)
                  : 'Not scheduled'}
              </dd>
            </div>
            <div>
              <dt>Technician warehouse</dt>
              <dd>{workOrder.assignedTechnician?.warehouseName ?? 'Not assigned'}</dd>
            </div>
          </dl>
        </section>
        {canManage && workOrder.status === 'in_progress' ? (
          <section className="service-preview-section service-photo-upload">
            <header>
              <div>
                <h3>Photo evidence</h3>
                <p>JPEG, PNG, or WebP up to 5 MB.</p>
              </div>
            </header>
            <div>
              <input
                accept="image/jpeg,image/png,image/webp"
                aria-label="Service photo"
                disabled={busy}
                ref={photoInput}
                onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
                type="file"
              />
              <Button
                busy={busy}
                disabled={!photo}
                onClick={() => void uploadPhoto()}
                variant="secondary"
              >
                Upload photo
              </Button>
            </div>
          </section>
        ) : null}
        <ServiceWorkEvidence
          canCreateFinance={canCreateFinance}
          canViewFinance={canViewFinance}
          onOpenFinance={() =>
            navigate('/modules/erp.finance/invoices', {
              state: workOrder.financialDocumentId
                ? { financialDocumentId: workOrder.financialDocumentId }
                : { serviceWorkOrderId: workOrder.id },
            })
          }
          token={token}
          timezone={timezone}
          workOrder={workOrder}
        />
      </div>
    </ServiceDrawer>
  );
}

function ServiceWorkEvidence({
  canCreateFinance,
  canViewFinance,
  onOpenFinance,
  token,
  timezone,
  workOrder,
}: {
  canCreateFinance: boolean;
  canViewFinance: boolean;
  onOpenFinance: () => void;
  token: string;
  timezone: string;
  workOrder: ServiceWorkOrder;
}) {
  return (
    <>
      <section className="service-preview-section">
        <header>
          <div>
            <h3>Evidence</h3>
            <p>Time, parts, and photos remain attached to this work order.</p>
          </div>
          <span>
            {workOrder.photos.length + workOrder.parts.length + workOrder.timeEntries.length}
          </span>
        </header>
        <div className="service-evidence-grid">
          <div>
            <span>Working time</span>
            <strong>{formatMinutes(workOrder.laborMinutes)}</strong>
          </div>
          <div>
            <span>Parts used</span>
            <strong>{workOrder.parts.length}</strong>
          </div>
          <div>
            <span>Photos</span>
            <strong>{workOrder.photos.length}</strong>
          </div>
        </div>
        {workOrder.parts.length ? (
          <div className="service-part-list">
            {workOrder.parts.map((part) => (
              <div key={part.id}>
                <div>
                  <strong>{part.productName}</strong>
                  <span>
                    {part.quantity} from {part.warehouseName}
                  </span>
                </div>
                <strong>{formatMoney(part.totalCostBgn)}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {workOrder.photos.length || workOrder.signature ? (
          <ServiceEvidenceGallery token={token} workOrder={workOrder} />
        ) : null}
      </section>
      {workOrder.status === 'completed' ? (
        <section className="service-preview-section">
          <header>
            <div>
              <h3>Completion</h3>
              <p>{workOrder.completionNotes}</p>
            </div>
          </header>
          <dl className="service-cost-grid">
            <div>
              <dt>Labour</dt>
              <dd>{formatMoney(workOrder.laborCostBgn)}</dd>
            </div>
            <div>
              <dt>Parts</dt>
              <dd>{formatMoney(workOrder.partsCostBgn)}</dd>
            </div>
            <div>
              <dt>Transport</dt>
              <dd>{formatMoney(workOrder.transportCostBgn)}</dd>
            </div>
            <div>
              <dt>Total service cost</dt>
              <dd>{formatMoney(workOrder.totalCostBgn)}</dd>
            </div>
          </dl>
          {workOrder.signature ? (
            <div className="service-signature-summary">
              <Icon name="check" size={17} />
              <span>
                Customer confirmation captured from{' '}
                <strong>{workOrder.signature.signerName}</strong>
              </span>
            </div>
          ) : null}
          {Number(workOrder.totalCostBgn) > 0 &&
          ((workOrder.financialDocumentId && canViewFinance) || canCreateFinance) ? (
            <div className="service-finance-handoff">
              <div>
                <span>{workOrder.financialDocumentId ? 'Finance draft' : 'Ready for Finance'}</span>
                <strong>
                  {workOrder.financialDocumentNumber ??
                    'Prepare an invoice draft from these charges'}
                </strong>
                <small>
                  {workOrder.financialDocumentId
                    ? 'The work order and Finance draft remain linked.'
                    : 'Finance will review VAT before saving the draft.'}
                </small>
              </div>
              <Button onClick={onOpenFinance} variant="secondary">
                {workOrder.financialDocumentId ? 'Open Finance draft' : 'Prepare invoice draft'}
                <Icon name="arrow" size={15} />
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      <section className="service-preview-section">
        <header>
          <div>
            <h3>Activity</h3>
            <p>Status changes are kept with the work order.</p>
          </div>
        </header>
        <ol className="service-history-list is-compact">
          {workOrder.history.map((entry) => (
            <li key={entry.id}>
              <span aria-hidden="true" />
              <div>
                <strong>{workOrderStatusLabel(entry.nextStatus)}</strong>
                <p>{historyLabel(entry.reason)}</p>
                <small>
                  {formatDateTime(entry.changedAt, timezone)}
                  {entry.changedByName ? ` · ${entry.changedByName}` : ''}
                </small>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function CompleteWorkOrderDrawer({
  onBack,
  onSaved,
  references,
  token,
  timezone,
  workOrder,
}: {
  onBack: () => void;
  onSaved: (workOrder: ServiceWorkOrder) => void;
  references: ServiceReferenceData;
  token: string;
  timezone: string;
  workOrder: ServiceWorkOrder;
}) {
  const [completionNotes, setCompletionNotes] = useState('');
  const [laborCostBgn, setLaborCostBgn] = useState('0');
  const [transportCostBgn, setTransportCostBgn] = useState('0');
  const [timeEntries, setTimeEntries] = useState<ServiceWorkTimeEntryInput[]>([
    { minutes: 30, workDate: today(timezone) },
  ]);
  const [parts, setParts] = useState<PartForm[]>([]);
  const [signerName, setSignerName] = useState('');
  const [signatureImageDataUrl, setSignatureImageDataUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availableParts = references.parts.filter(
    (part) => part.warehouseId === workOrder.assignedTechnician?.warehouseId,
  );

  function addPart() {
    const first = availableParts[0];
    if (!first) return;
    setParts((current) => [...current, { productId: first.productId, quantity: '1' }]);
  }

  function updatePart(index: number, patch: Partial<PartForm>) {
    setParts((current) =>
      current.map((part, itemIndex) => (itemIndex === index ? { ...part, ...patch } : part)),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signatureImageDataUrl) {
      setError('Capture the customer signature before completing the work order.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input: CompleteServiceWorkOrderRequest = {
        completionNotes,
        expectedVersion: workOrder.version,
        laborCostBgn,
        parts: parts.map(partInput),
        signatureImageDataUrl,
        signerName,
        timeEntries,
        transportCostBgn,
      };
      onSaved(await completeServiceWorkOrder(token, workOrder.id, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The work order could not be completed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ServiceDrawer
      actions={
        <>
          <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
            Back
          </Button>
          <Button busy={busy} form="complete-service-work-form" type="submit">
            Complete work
          </Button>
        </>
      }
      busy={busy}
      onBack={onBack}
      subtitle={`${workOrder.number} · ${workOrder.customerName}`}
      title="Complete work"
      variant="completion"
    >
      <form
        className="service-form service-completion-form"
        id="complete-service-work-form"
        onSubmit={(event) => void submit(event)}
      >
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <FormSection
          index="1"
          title="Work performed"
          description="Record the result and the time spent on site."
        >
          <ServiceField label="Completion notes">
            <textarea
              maxLength={4000}
              onChange={(event) => setCompletionNotes(event.target.value)}
              placeholder="Describe the diagnosis, repair, checks, and outcome."
              required
              rows={4}
              value={completionNotes}
            />
          </ServiceField>
          <div className="service-time-entries">
            {timeEntries.map((entry, index) => (
              <div className="service-time-entry" key={`time-${index}`}>
                <ServiceField label="Work date">
                  <input
                    onChange={(event) =>
                      setTimeEntries((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, workDate: event.target.value } : item,
                        ),
                      )
                    }
                    required
                    type="date"
                    value={entry.workDate}
                  />
                </ServiceField>
                <ServiceField label="Minutes">
                  <input
                    max="1440"
                    min="1"
                    onChange={(event) =>
                      setTimeEntries((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, minutes: Number(event.target.value) }
                            : item,
                        ),
                      )
                    }
                    required
                    type="number"
                    value={entry.minutes}
                  />
                </ServiceField>
                <ServiceField label="Note (optional)">
                  <input
                    maxLength={1000}
                    onChange={(event) =>
                      setTimeEntries((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, note: event.target.value } : item,
                        ),
                      )
                    }
                    value={entry.note ?? ''}
                  />
                </ServiceField>
                {timeEntries.length > 1 ? (
                  <button
                    aria-label="Remove time entry"
                    className="service-remove-row"
                    onClick={() =>
                      setTimeEntries((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    type="button"
                  >
                    <Icon name="close" size={15} />
                  </button>
                ) : null}
              </div>
            ))}
            <Button
              onClick={() =>
                setTimeEntries((current) => [
                  ...current,
                  { minutes: 30, workDate: today(timezone) },
                ])
              }
              type="button"
              variant="quiet"
            >
              <Icon name="plus" size={15} /> Add time
            </Button>
          </div>
        </FormSection>
        <FormSection
          index="2"
          title="Parts and costs"
          description="Parts are deducted from the assigned technician warehouse when saved."
        >
          <div className="service-cost-inputs">
            <ServiceField label="Labour cost (BGN)">
              <input
                min="0"
                onChange={(event) => setLaborCostBgn(event.target.value)}
                required
                step="0.0001"
                type="number"
                value={laborCostBgn}
              />
            </ServiceField>
            <ServiceField label="Transport cost (BGN)">
              <input
                min="0"
                onChange={(event) => setTransportCostBgn(event.target.value)}
                required
                step="0.0001"
                type="number"
                value={transportCostBgn}
              />
            </ServiceField>
          </div>
          {!availableParts.length ? (
            <InlineAlert tone="warning">
              No available parts were found in this technician warehouse. You can still complete the
              work without a part.
            </InlineAlert>
          ) : null}
          <div className="service-part-editor">
            {parts.map((part, index) => {
              const reference = availableParts.find((item) => item.productId === part.productId);
              return (
                <div className="service-part-editor-row" key={`part-${index}`}>
                  <ServiceField label="Part">
                    <select
                      onChange={(event) =>
                        updatePart(index, {
                          productId: event.target.value,
                          serialNumbers: '',
                          batchNumber: '',
                        })
                      }
                      value={part.productId}
                    >
                      {availableParts.map((item) => (
                        <option key={item.productId} value={item.productId}>
                          {item.productName} · {item.availableQuantity} available
                        </option>
                      ))}
                    </select>
                  </ServiceField>
                  <ServiceField label="Quantity">
                    <input
                      min="0.0001"
                      onChange={(event) => updatePart(index, { quantity: event.target.value })}
                      required
                      step="0.0001"
                      type="number"
                      value={part.quantity}
                    />
                  </ServiceField>
                  {reference?.trackingMode === 'batch' ? (
                    <ServiceField label="Batch number">
                      <input
                        onChange={(event) => updatePart(index, { batchNumber: event.target.value })}
                        required
                        value={part.batchNumber ?? ''}
                      />
                    </ServiceField>
                  ) : null}
                  {reference?.trackingMode === 'serial' ? (
                    <ServiceField label="Serial number">
                      <input
                        onChange={(event) =>
                          updatePart(index, { serialNumbers: event.target.value })
                        }
                        required
                        value={part.serialNumbers ?? ''}
                      />
                    </ServiceField>
                  ) : null}
                  <button
                    aria-label="Remove part"
                    className="service-remove-row"
                    onClick={() =>
                      setParts((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }
                    type="button"
                  >
                    <Icon name="close" size={15} />
                  </button>
                </div>
              );
            })}
            <Button
              disabled={!availableParts.length}
              onClick={addPart}
              type="button"
              variant="quiet"
            >
              <Icon name="plus" size={15} /> Add used part
            </Button>
          </div>
        </FormSection>
        <FormSection
          index="3"
          title="Customer confirmation"
          description="Capture the customer name and signature after the completed work is reviewed."
        >
          <ServiceField label="Customer representative">
            <input
              maxLength={255}
              onChange={(event) => setSignerName(event.target.value)}
              required
              value={signerName}
            />
          </ServiceField>
          <SignaturePad onChange={setSignatureImageDataUrl} />
        </FormSection>
      </form>
    </ServiceDrawer>
  );
}

function SignaturePad({ onChange }: { onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [error, setError] = useState<string | null>(null);

  function position(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function begin(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    setError(null);
    const point = position(event);
    drawing.current = true;
    canvas.setPointerCapture(event.pointerId);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 2.4;
    context.strokeStyle = '#182230';
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function draw(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const point = position(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function finish() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setError(null);
    onChange('');
  }

  function chooseSignature(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2_000_000) {
      setError('Choose a PNG, JPEG, or WebP image smaller than 2 MB.');
      return;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) return;
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(source);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      context.drawImage(
        image,
        (canvas.width - width) / 2,
        (canvas.height - height) / 2,
        width,
        height,
      );
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        const luminance =
          pixels.data[index]! * 0.299 +
          pixels.data[index + 1]! * 0.587 +
          pixels.data[index + 2]! * 0.114;
        const color = luminance < 205 ? 24 : 255;
        pixels.data[index] = color;
        pixels.data[index + 1] = color;
        pixels.data[index + 2] = color;
        pixels.data[index + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      const signature = canvas.toDataURL('image/png');
      if (Math.ceil((signature.length * 3) / 4) > 100_000) {
        clear();
        setError('This signature image is too detailed. Choose a simpler image or draw below.');
        return;
      }
      setError(null);
      onChange(signature);
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      setError('The selected signature image could not be read.');
    };
    image.src = source;
  }

  return (
    <div className="service-signature-pad">
      <div>
        <span>Customer signature</span>
        <button onClick={clear} type="button">
          Clear
        </button>
      </div>
      <canvas
        aria-describedby="service-signature-help"
        aria-label="Customer signature pad"
        height="150"
        onPointerCancel={finish}
        onPointerDown={begin}
        onPointerLeave={finish}
        onPointerMove={draw}
        onPointerUp={finish}
        ref={canvasRef}
        width="620"
      />
      <small id="service-signature-help">
        Draw with a mouse, trackpad, finger, or stylus. If drawing is not practical, choose a saved
        signature image.
      </small>
      <label className="service-signature-upload">
        <Icon name="plus" size={15} />
        <span>Choose signature image</span>
        <input accept="image/png,image/jpeg,image/webp" onChange={chooseSignature} type="file" />
      </label>
      {error ? (
        <small className="service-signature-error" role="alert">
          {error}
        </small>
      ) : null}
    </div>
  );
}

function ServiceDrawer({
  actions,
  busy,
  children,
  onBack,
  subtitle,
  title,
  variant,
}: {
  actions?: ReactNode;
  busy: boolean;
  children: ReactNode;
  onBack: () => void;
  subtitle: string;
  title: string;
  variant?: 'care' | 'completion' | 'request';
}) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    const drawerElement = drawerRef.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!drawerElement) return;
    const drawer: HTMLElement = drawerElement;
    const focusable = () =>
      Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    const initialFocus = drawer.querySelector<HTMLElement>('.panel-back-button');
    (initialFocus ?? drawer).focus();
    function trapFocus(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        onBack();
        return;
      }
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
      previousFocus?.focus();
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
        className={`security-drawer is-wide service-drawer${variant === 'care' ? ' service-care-drawer' : ''}${variant === 'request' ? ' service-request-drawer' : ''}${variant === 'completion' ? ' service-completion-drawer' : ''}`}
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="panel-drawer-header service-drawer-header">
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
        {actions ? <footer className="service-panel-footer">{actions}</footer> : null}
      </aside>
    </div>
  );
}

function FormSection({
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
    <section className="service-form-section">
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

function ServiceField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="service-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function DrawerActions({
  backLabel = 'Back',
  busy,
  disabled,
  onBack,
  submitLabel,
}: {
  backLabel?: string;
  busy: boolean;
  disabled?: boolean;
  onBack: () => void;
  submitLabel: string;
}) {
  return (
    <div className="service-drawer-actions">
      <Button busy={busy} disabled={disabled} type="submit">
        {submitLabel}
      </Button>
      <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
        {backLabel}
      </Button>
    </div>
  );
}

function ServicePager({
  onPageChange,
  page,
}: {
  onPageChange: (page: number) => void;
  page: Pick<ServiceRequestPage, 'page' | 'total' | 'totalPages'>;
}) {
  if (page.totalPages < 2) return null;
  return (
    <nav aria-label="Service list pages" className="service-pager">
      <Button
        disabled={page.page <= 1}
        onClick={() => onPageChange(page.page - 1)}
        variant="secondary"
      >
        Previous
      </Button>
      <span>
        Page {page.page} of {page.totalPages} · {page.total} records
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

function ServiceMetric({ label, tone, value }: { label: string; tone?: 'warning'; value: string }) {
  return (
    <div className={tone ? `is-${tone}` : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ServiceStatus({
  status,
}: {
  status: ServiceRequest['status'] | ServiceWorkOrder['status'];
}) {
  const { t } = useLocalization();
  const labels = {
    cancelled: t('service.status.cancelled'),
    completed: t('service.status.completed'),
    in_progress: t('service.status.in_progress'),
    new: t('service.status.new'),
    scheduled: t('service.status.scheduled'),
  };
  return <span className={`service-status is-${status}`}>{labels[status]}</span>;
}

function ServiceState({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <section className="service-state">
      <Icon name="service" size={25} />
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function useServiceData(
  token: string,
  requestListPage: number,
  workOrderListPage: number,
  canApprove: boolean,
) {
  const [references, setReferences] = useState<ServiceReferenceData>(emptyReferences);
  const [requestPage, setRequestPage] = useState<ServiceRequestPage>(emptyRequestPage);
  const [workOrderPage, setWorkOrderPage] = useState<ServiceWorkOrderPage>(emptyWorkOrderPage);
  const [myWorkOrderPage, setMyWorkOrderPage] = useState<ServiceWorkOrderPage>(emptyWorkOrderPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(false);
    const myWorkOrders = listMyServiceWork(token, workOrderListPage);
    const scopedWorkOrders = canApprove
      ? listServiceWorkOrders(token, workOrderListPage)
      : myWorkOrders;
    void Promise.all([
      getServiceReferenceData(token),
      listServiceRequests(token, requestListPage),
      scopedWorkOrders,
      myWorkOrders,
    ])
      .then(([nextReferences, nextRequests, nextWorkOrders, nextMyWorkOrders]) => {
        if (!active) return;
        setReferences(nextReferences);
        setRequestPage(nextRequests);
        setWorkOrderPage(nextWorkOrders);
        setMyWorkOrderPage(nextMyWorkOrders);
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [canApprove, requestListPage, revision, token, workOrderListPage]);

  return useMemo(
    () => ({ error, loading, myWorkOrderPage, references, reload, requestPage, workOrderPage }),
    [error, loading, myWorkOrderPage, references, reload, requestPage, workOrderPage],
  );
}

interface PartForm {
  batchNumber?: string;
  productId: string;
  quantity: string;
  serialNumbers?: string;
}

function partInput(part: PartForm): ServicePartUsageInput {
  return {
    ...(part.batchNumber?.trim() ? { batchNumber: part.batchNumber.trim() } : {}),
    productId: part.productId,
    quantity: part.quantity,
    ...(part.serialNumbers?.trim()
      ? {
          serialNumbers: part.serialNumbers
            .split(/[\n,]+/u)
            .map((item) => item.trim())
            .filter(Boolean),
        }
      : {}),
  };
}

function pageMeta(view: ServiceOperationsView, t: ReturnType<typeof useLocalization>['t']) {
  return {
    care: {
      description: t('service.careDescription'),
      title: t('service.care'),
    },
    devices: {
      description: t('service.devicesDescription'),
      title: t('service.equipmentHistory'),
    },
    requests: {
      description: t('service.requestsDescription'),
      title: t('service.requests'),
    },
    reports: {
      description: t('service.reportsDescription'),
      title: t('service.reportsTitle'),
    },
    schedule: {
      description: t('service.scheduleDescription'),
      title: t('service.scheduleTitle'),
    },
    'work-orders': {
      description: t('service.workOrdersDescription'),
      title: t('service.workOrders'),
    },
  }[view];
}

const sourceChannels: ManualServiceRequestChannel[] = [
  'telephone',
  'email',
  'customer_portal',
  'on_site',
];
const serviceTypes: ServiceType[] = ['warranty', 'out_of_warranty', 'subscription'];
const priorities: ServicePriority[] = ['low', 'normal', 'high', 'critical'];

function sourceLabel(value: ServiceRequestChannel) {
  return {
    customer_portal: 'Customer portal',
    email: 'Email',
    on_site: 'On-site visit',
    service_plan: 'Service plan',
    telephone: 'Telephone',
  }[value];
}

function serviceTypeLabel(value: ServiceType) {
  return {
    out_of_warranty: 'Out of warranty',
    subscription: 'Subscription',
    warranty: 'Warranty',
  }[value];
}

function priorityLabel(value: ServicePriority) {
  return { critical: 'Critical', high: 'High', low: 'Low', normal: 'Normal' }[value];
}

function workOrderStatusLabel(status: ServiceRequest['status'] | ServiceWorkOrder['status']) {
  return {
    cancelled: 'Cancelled',
    completed: 'Completed',
    in_progress: 'In progress',
    new: 'New',
    scheduled: 'Scheduled',
  }[status];
}

function historyLabel(reason: string) {
  return (
    {
      request_cancelled: 'Request cancelled before the visit.',
      technician_assigned: 'Technician and warehouse assigned.',
      technician_completed_work: 'Work completed with customer confirmation.',
      technician_reassigned: 'Visit rescheduled or reassigned.',
      technician_started_work: 'Technician started work.',
    }[reason] ?? 'Work order updated.'
  );
}

function startOfBusinessWeek(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function calendarDates(dateFrom: string, dateTo: string) {
  const dates: string[] = [];
  for (let date = dateFrom; date <= dateTo; date = addCalendarDays(date, 1)) dates.push(date);
  return dates;
}

function formatScheduleRange(dateFrom: string, dateTo: string, timezone: string) {
  return `${formatDate(dateFrom, timezone)} – ${formatDate(dateTo, timezone)}`;
}

function weekdayShort(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short' }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

function calendarMonthShort(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: timezone }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

function calendarDayNumber(value: string) {
  return String(Number(value.slice(8, 10)));
}

function formatScheduleMinutes(value: number) {
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours}h${minutes ? ` ${minutes}m` : ''}`;
}

function initials(value: string) {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat(activeDateLocale(), {
    dateStyle: 'medium',
    timeZone: timezone,
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat(activeDateLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat(activeDateLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(value));
}

function formatMoney(value: string) {
  return new Intl.NumberFormat(activeDateLocale(), { currency: 'BGN', style: 'currency' }).format(
    Number(value),
  );
}

function activeDateLocale() {
  return document.documentElement.lang === 'bg' ? 'bg-BG' : 'en-GB';
}

function formatMinutes(value: number) {
  if (!value) return 'Not recorded';
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return hours ? `${hours}h${minutes ? ` ${minutes}m` : ''}` : `${minutes}m`;
}

function today(timezone: string) {
  const parts = zonedParts(new Date(), timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function nextBusinessHour(timezone: string, hours = 1) {
  const rounded = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 + hours * 3_600_000);
  return rounded.toISOString();
}

function toBusinessDateTimeInput(value: string, timezone: string) {
  const parts = zonedParts(new Date(value), timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function businessDateTimeToIso(value: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return new Date(value).toISOString();
  const [, year, month, day, hour, minute] = match;
  const target = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  let instant = target;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const observed = zonedParts(new Date(instant), timezone);
    const observedAsUtc = Date.UTC(
      Number(observed.year),
      Number(observed.month) - 1,
      Number(observed.day),
      Number(observed.hour),
      Number(observed.minute),
    );
    instant += target - observedAsUtc;
  }
  return new Date(instant).toISOString();
}

function zonedParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).formatToParts(value);
  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return {
    day: lookup('day'),
    hour: lookup('hour'),
    minute: lookup('minute'),
    month: lookup('month'),
    year: lookup('year'),
  };
}

function errorText(error: unknown, fallback: string) {
  if (!(error instanceof ApiClientError)) return fallback;
  if (error.message !== 'Request validation failed') return error.message;
  const detailText = error.details.map((detail) => detail.message).join(' ');
  const fieldMessage = serviceValidationMessages.find(([field]) => detailText.includes(field));
  return fieldMessage?.[1] ?? 'Review the entered details and try again.';
}

const serviceValidationMessages: ReadonlyArray<readonly [string, string]> = [
  ['customerEquipmentId', 'Choose an active registered device.'],
  ['customerLocationId', 'Choose the customer’s Service location.'],
  ['customerPartnerId', 'Choose a customer.'],
  ['problemDescription', 'Describe the reported problem.'],
  ['sourceChannel', 'Choose how the request was received.'],
  ['subscriptionContractId', 'Choose an active Service subscription.'],
  ['serviceType', 'Choose the Service type.'],
  ['technicianAccountId', 'Choose an active technician.'],
  ['technicianWarehouseId', 'Choose the technician’s warehouse.'],
  ['scheduledStart', 'Choose a valid visit start time.'],
  ['scheduledEnd', 'Choose a valid visit end time.'],
  ['productId', 'Choose an available spare part.'],
];
