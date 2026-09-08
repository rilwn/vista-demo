import { Button, InlineAlert, Toast } from '@vista/ui';
import type {
  CreateLogisticsDeliveryRequest,
  CreateLogisticsReturnRequest,
  CreateLogisticsRouteRequest,
  LogisticsDelivery,
  LogisticsDeliveryPage,
  LogisticsReferenceData,
  LogisticsReturn,
  LogisticsReturnPage,
  LogisticsRoutePlan,
  LogisticsRoutePlanPage,
} from '@vista/contracts';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  cancelLogisticsDelivery,
  completeLogisticsDelivery,
  createLogisticsDelivery,
  createLogisticsReturn,
  createLogisticsRoute,
  dispatchLogisticsDelivery,
  getLogisticsDelivery,
  getLogisticsReferenceData,
  getLogisticsReturn,
  listLogisticsDeliveries,
  listLogisticsReturns,
  listLogisticsRoutes,
  receiveLogisticsReturn,
  reportLogisticsDeliveryException,
} from '../api/logistics';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Link } from '../routing/Router';

export type LogisticsOperationsView = 'couriers' | 'deliveries' | 'returns' | 'routes';

const emptyReferences: LogisticsReferenceData = {
  assignees: [],
  businessTimezone: 'UTC',
  courierConnections: [
    { connected: false, provider: 'econt' },
    { connected: false, provider: 'speedy' },
  ],
  equipment: [],
  locations: [],
  serviceStops: [],
  shipments: [],
  warehouses: [],
};

const emptyDeliveryPage: LogisticsDeliveryPage = {
  items: [],
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 0,
};

const emptyReturnPage: LogisticsReturnPage = {
  items: [],
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 0,
};

const emptyRoutePage: LogisticsRoutePlanPage = {
  items: [],
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 0,
};

export function LogisticsOperationsPage({ view }: { view: LogisticsOperationsView }) {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const canCreate = hasPermission('erp.logistics', 'create');
  const canEdit = hasPermission('erp.logistics', 'edit');
  const dates = useMemo(() => routeWindow(), []);
  const data = useLogisticsData(token, dates.dateFrom, dates.dateTo);
  const [drawer, setDrawer] = useState<'delivery' | 'return' | 'route' | null>(null);
  const [selectedDelivery, setSelectedDelivery] = useState<LogisticsDelivery | null>(null);
  const [selectedReturn, setSelectedReturn] = useState<LogisticsReturn | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<LogisticsRoutePlan | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const openDelivery = useCallback(
    async (id: string) => {
      try {
        setSelectedDelivery(await getLogisticsDelivery(token, id));
      } catch (caught) {
        setNotice(errorMessage(caught, 'The delivery could not be opened.'));
      }
    },
    [token],
  );
  const openReturn = useCallback(
    async (id: string) => {
      try {
        setSelectedReturn(await getLogisticsReturn(token, id));
      } catch (caught) {
        setNotice(errorMessage(caught, 'The return could not be opened.'));
      }
    },
    [token],
  );

  if (data.loading) return <LogisticsState title="Loading logistics work" />;
  if (data.error)
    return (
      <LogisticsState title="Logistics work could not be loaded">
        <Button onClick={data.reload} variant="secondary">
          Try again
        </Button>
      </LogisticsState>
    );

  const meta = pageMeta(view);
  const action =
    view === 'deliveries'
      ? { label: 'Plan delivery', value: 'delivery' as const }
      : view === 'returns'
        ? { label: 'Register return', value: 'return' as const }
        : view === 'routes'
          ? { label: 'Plan route', value: 'route' as const }
          : null;

  return (
    <div className="page-stack logistics-workspace">
      <header className="page-header logistics-page-header">
        <div>
          <p className="page-eyebrow">ERP · Logistics</p>
          <h1>{meta.title}</h1>
          <p>{meta.description}</p>
        </div>
        {action && canCreate ? (
          <Button onClick={() => setDrawer(action.value)}>
            <Icon name="plus" size={17} /> {action.label}
          </Button>
        ) : null}
      </header>

      <LogisticsTabs />

      {notice ? (
        <Toast onDismiss={() => setNotice(null)} tone="success">
          {notice}
        </Toast>
      ) : null}

      {view === 'deliveries' ? (
        <DeliveriesView deliveries={data.deliveries.items} onOpen={(id) => void openDelivery(id)} />
      ) : null}
      {view === 'couriers' ? <CouriersView references={data.references} /> : null}
      {view === 'returns' ? (
        <ReturnsView onOpen={(id) => void openReturn(id)} returns={data.returns.items} />
      ) : null}
      {view === 'routes' ? (
        <RoutesView onOpen={setSelectedRoute} routes={data.routes.items} />
      ) : null}

      {drawer === 'delivery' ? (
        <NewDeliveryDrawer
          deliveries={data.deliveries.items}
          onBack={() => setDrawer(null)}
          onSaved={(delivery) => {
            setDrawer(null);
            setSelectedDelivery(delivery);
            setNotice(`${delivery.number} has been added to the delivery board.`);
            data.reload();
          }}
          references={data.references}
          token={token}
        />
      ) : null}
      {drawer === 'return' ? (
        <NewReturnDrawer
          onBack={() => setDrawer(null)}
          onSaved={(record) => {
            setDrawer(null);
            setSelectedReturn(record);
            setNotice(`${record.number} is ready to be received.`);
            data.reload();
          }}
          references={data.references}
          token={token}
        />
      ) : null}
      {drawer === 'route' ? (
        <NewRouteDrawer
          deliveries={data.deliveries.items}
          onBack={() => setDrawer(null)}
          onSaved={(route) => {
            setDrawer(null);
            setSelectedRoute(route);
            setNotice(`${route.number} has been added to the route calendar.`);
            data.reload();
          }}
          references={data.references}
          token={token}
        />
      ) : null}
      {selectedDelivery ? (
        <DeliveryDrawer
          canEdit={canEdit}
          delivery={selectedDelivery}
          onBack={() => setSelectedDelivery(null)}
          onChanged={(delivery, message) => {
            setSelectedDelivery(delivery);
            setNotice(message);
            data.reload();
          }}
          token={token}
        />
      ) : null}
      {selectedReturn ? (
        <ReturnDrawer
          canEdit={canEdit}
          onBack={() => setSelectedReturn(null)}
          onChanged={(record) => {
            setSelectedReturn(record);
            setNotice(`${record.number} has been received and linked records are ready.`);
            data.reload();
          }}
          record={selectedReturn}
          token={token}
        />
      ) : null}
      {selectedRoute ? (
        <RouteDrawer onBack={() => setSelectedRoute(null)} route={selectedRoute} />
      ) : null}
    </div>
  );
}

function LogisticsTabs() {
  return (
    <nav aria-label="Logistics sections" className="service-tabs logistics-tabs">
      <Link to="/modules/erp.logistics/reports">{erpReportMessages.title}</Link>
      <Link
        className={({ isActive }) => (isActive ? 'is-active' : undefined)}
        end
        to="/modules/erp.logistics/deliveries"
      >
        Deliveries
      </Link>
      <Link
        className={({ isActive }) => (isActive ? 'is-active' : undefined)}
        end
        to="/modules/erp.logistics/couriers"
      >
        Couriers
      </Link>
      <Link
        className={({ isActive }) => (isActive ? 'is-active' : undefined)}
        end
        to="/modules/erp.logistics/returns"
      >
        Returns
      </Link>
      <Link
        className={({ isActive }) => (isActive ? 'is-active' : undefined)}
        end
        to="/modules/erp.logistics/routes"
      >
        Routes
      </Link>
    </nav>
  );
}

function DeliveriesView({
  deliveries,
  onOpen,
}: {
  deliveries: LogisticsDelivery[];
  onOpen: (id: string) => void;
}) {
  const planned = deliveries.filter((item) => item.status === 'planned').length;
  const travelling = deliveries.filter((item) => item.status === 'in_transit').length;
  const attention = deliveries.filter((item) => item.status === 'exception').length;
  return (
    <>
      <section className="logistics-summary" aria-label="Delivery summary">
        <SummaryCard label="Planned" value={planned} />
        <SummaryCard label="On the way" value={travelling} />
        <SummaryCard
          label="Needs attention"
          value={attention}
          {...(attention ? { tone: 'warning' as const } : {})}
        />
      </section>
      <section className="content-panel logistics-list-panel">
        <div className="panel-heading">
          <div>
            <h2>Delivery board</h2>
            <p>Each delivery stays linked to its Sales shipment and handover certificate.</p>
          </div>
          <span className="record-count">{deliveries.length} records</span>
        </div>
        {deliveries.length ? (
          <div className="logistics-record-list">
            {deliveries.map((delivery) => (
              <button
                className="logistics-record-row"
                key={delivery.id}
                onClick={() => onOpen(delivery.id)}
                type="button"
              >
                <span className="logistics-record-main">
                  <strong>{delivery.number}</strong>
                  <small>
                    {delivery.customerName} · {delivery.customerLocationName}
                  </small>
                </span>
                <span className="logistics-record-detail">
                  <strong>{formatDateTime(delivery.scheduledStart)}</strong>
                  <small>{delivery.shipmentNumber}</small>
                </span>
                <StatusBadge status={delivery.status} />
                <Icon name="arrow" size={16} />
              </button>
            ))}
          </div>
        ) : (
          <LogisticsEmpty
            description="Completed Sales shipments can be planned here for customer delivery."
            title="No deliveries have been planned"
          />
        )}
      </section>
    </>
  );
}

function CouriersView({ references }: { references: LogisticsReferenceData }) {
  return (
    <section className="content-panel courier-connection-panel">
      <div className="panel-heading">
        <div>
          <h2>Courier connections</h2>
          <p>
            Company transport is available now. Courier booking starts after each account is
            connected.
          </p>
        </div>
      </div>
      <div className="courier-card-grid">
        {references.courierConnections.map((connection) => (
          <article className="courier-card" key={connection.provider}>
            <span className="courier-mark">{connection.provider === 'econt' ? 'E' : 'S'}</span>
            <div>
              <h3>{connection.provider === 'econt' ? 'Econt' : 'Speedy'}</h3>
              <p>
                {connection.connected
                  ? 'Ready for shipment booking and tracking.'
                  : 'Not connected. Booking, labels, tracking, and courier returns remain unavailable.'}
              </p>
            </div>
            <span className={connection.connected ? 'status-badge is-ready' : 'status-badge'}>
              {connection.connected ? 'Connected' : 'Not connected'}
            </span>
          </article>
        ))}
      </div>
      <InlineAlert tone="info">
        Provider accounts and approved shipment rules are required before courier actions can be
        enabled. No courier shipment is created silently.
      </InlineAlert>
    </section>
  );
}

function ReturnsView({
  onOpen,
  returns,
}: {
  onOpen: (id: string) => void;
  returns: LogisticsReturn[];
}) {
  return (
    <section className="content-panel logistics-list-panel">
      <div className="panel-heading">
        <div>
          <h2>Return intake</h2>
          <p>Receive shipped items into the selected warehouse and open repair work when needed.</p>
        </div>
        <span className="record-count">{returns.length} records</span>
      </div>
      {returns.length ? (
        <div className="logistics-record-list">
          {returns.map((record) => (
            <button
              className="logistics-record-row"
              key={record.id}
              onClick={() => onOpen(record.id)}
              type="button"
            >
              <span className="logistics-record-main">
                <strong>{record.number}</strong>
                <small>
                  {record.customerName} · {record.originalShipmentNumber}
                </small>
              </span>
              <span className="logistics-record-detail">
                <strong>
                  {record.lines.length} item{record.lines.length === 1 ? '' : 's'}
                </strong>
                <small>{returnTransportLabel(record.transportMethod)}</small>
              </span>
              <StatusBadge status={record.status} />
              <Icon name="arrow" size={16} />
            </button>
          ))}
        </div>
      ) : (
        <LogisticsEmpty
          description="Register an item against its original Sales shipment before it is received."
          title="No returns have been registered"
        />
      )}
    </section>
  );
}

function RoutesView({
  onOpen,
  routes,
}: {
  onOpen: (route: LogisticsRoutePlan) => void;
  routes: LogisticsRoutePlan[];
}) {
  const groups = groupRoutesByDate(routes);
  return (
    <section className="content-panel logistics-route-panel">
      <div className="panel-heading">
        <div>
          <h2>Route calendar</h2>
          <p>Combine customer deliveries and scheduled Service visits into a clear daily run.</p>
        </div>
      </div>
      {routes.length ? (
        <div className="route-calendar-list">
          {[...groups.entries()].map(([date, items]) => (
            <section className="route-day" key={date}>
              <header>
                <span>{formatWeekday(date)}</span>
                <strong>{formatDate(date)}</strong>
              </header>
              <div>
                {items.map((route) => (
                  <button key={route.id} onClick={() => onOpen(route)} type="button">
                    <span>
                      <strong>{route.title}</strong>
                      <small>
                        {route.number} · {route.assignedTo}
                      </small>
                    </span>
                    <span>
                      {route.stops.length} stop{route.stops.length === 1 ? '' : 's'}
                    </span>
                    <Icon name="arrow" size={16} />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <LogisticsEmpty
          description="Add a delivery or scheduled Service visit to create the first route."
          title="No routes are planned for this period"
        />
      )}
    </section>
  );
}

function NewDeliveryDrawer({
  deliveries,
  onBack,
  onSaved,
  references,
  token,
}: {
  deliveries: LogisticsDelivery[];
  onBack: () => void;
  onSaved: (delivery: LogisticsDelivery) => void;
  references: LogisticsReferenceData;
  token: string;
}) {
  const existing = new Set(deliveries.map((item) => item.shipmentId));
  const shipments = references.shipments.filter((item) => !existing.has(item.id));
  const [shipmentId, setShipmentId] = useState(shipments[0]?.id ?? '');
  const shipment = shipments.find((item) => item.id === shipmentId);
  const locations = references.locations.filter((item) => item.customerId === shipment?.customerId);
  const firstLocationId = locations[0]?.id ?? '';
  const [locationId, setLocationId] = useState('');
  const times = useMemo(() => deliveryTimes(), []);
  const [scheduledStart, setScheduledStart] = useState(times.start);
  const [scheduledEnd, setScheduledEnd] = useState(times.end);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocationId(firstLocationId);
  }, [firstLocationId, shipmentId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CreateLogisticsDeliveryRequest = {
        customerLocationId: locationId,
        deliveryMethod: 'company_transport',
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        scheduledEnd: localDateTimeToIso(scheduledEnd),
        scheduledStart: localDateTimeToIso(scheduledStart),
        shipmentId,
      };
      onSaved(await createLogisticsDelivery(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorMessage(caught, 'The delivery could not be planned.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <LogisticsDrawer
      busy={busy}
      footer={
        <>
          <Button
            disabled={busy || !shipmentId || !locationId}
            form="new-delivery-form"
            type="submit"
          >
            {busy ? 'Saving…' : 'Plan delivery'}
          </Button>
          <Button disabled={busy} onClick={onBack} variant="secondary">
            Cancel
          </Button>
        </>
      }
      onBack={onBack}
      subtitle="Choose the Sales shipment, customer location, and agreed delivery window."
      title="Plan delivery"
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {!shipments.length ? (
        <InlineAlert tone="info">
          Every completed shipment already has a delivery plan. Complete another shipment in Sales
          to plan a new delivery.
        </InlineAlert>
      ) : (
        <form
          className="logistics-form"
          id="new-delivery-form"
          onSubmit={(event) => void submit(event)}
        >
          <FormSection number="1" title="Sales shipment">
            <label>
              <span>Shipment</span>
              <select
                required
                value={shipmentId}
                onChange={(event) => setShipmentId(event.target.value)}
              >
                {shipments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.number} · {item.customerName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Delivery location</span>
              <select
                required
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
              >
                {locations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.city}
                  </option>
                ))}
              </select>
            </label>
          </FormSection>
          <FormSection number="2" title="Delivery window">
            <div className="logistics-form-grid">
              <label>
                <span>Starts</span>
                <input
                  required
                  type="datetime-local"
                  value={scheduledStart}
                  onChange={(event) => setScheduledStart(event.target.value)}
                />
              </label>
              <label>
                <span>Ends</span>
                <input
                  required
                  type="datetime-local"
                  value={scheduledEnd}
                  onChange={(event) => setScheduledEnd(event.target.value)}
                />
              </label>
            </div>
            <label>
              <span>Transport</span>
              <select value="company_transport" disabled>
                <option value="company_transport">Company transport</option>
              </select>
              <small>Econt and Speedy become available after their accounts are connected.</small>
            </label>
          </FormSection>
          <FormSection number="3" title="Driver notes">
            <label>
              <span>Instructions (optional)</span>
              <textarea
                maxLength={2000}
                placeholder="Access details, contact instructions, or agreed handling notes"
                rows={4}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
              />
            </label>
          </FormSection>
        </form>
      )}
    </LogisticsDrawer>
  );
}

function NewReturnDrawer({
  onBack,
  onSaved,
  references,
  token,
}: {
  onBack: () => void;
  onSaved: (record: LogisticsReturn) => void;
  references: LogisticsReferenceData;
  token: string;
}) {
  const [shipmentId, setShipmentId] = useState(references.shipments[0]?.id ?? '');
  const shipment = references.shipments.find((item) => item.id === shipmentId);
  const locations = references.locations.filter((item) => item.customerId === shipment?.customerId);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [shipmentLineId, setShipmentLineId] = useState(shipment?.lines[0]?.id ?? '');
  const line = shipment?.lines.find((item) => item.id === shipmentLineId);
  const [quantity, setQuantity] = useState(line?.trackingMode === 'serial' ? '1.0000' : '1.0000');
  const [serialNumbers, setSerialNumbers] = useState<string[]>([]);
  const [disposition, setDisposition] = useState<'restock' | 'service'>('service');
  const [warehouseId, setWarehouseId] = useState(references.warehouses[0]?.id ?? '');
  const [equipmentId, setEquipmentId] = useState('');
  const [serviceType, setServiceType] = useState<'out_of_warranty' | 'warranty'>('out_of_warranty');
  const [transportMethod, setTransportMethod] = useState<'company_transport' | 'customer_dropoff'>(
    'customer_dropoff',
  );
  const [scheduledPickupAt, setScheduledPickupAt] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const equipment = references.equipment.filter(
    (item) => item.customerLocationId === locationId && item.customerId === shipment?.customerId,
  );
  const firstEquipmentId = equipment[0]?.id ?? '';

  useEffect(() => {
    const nextLocations = references.locations.filter(
      (item) =>
        item.customerId ===
        references.shipments.find((entry) => entry.id === shipmentId)?.customerId,
    );
    const nextShipment = references.shipments.find((item) => item.id === shipmentId);
    setLocationId(nextLocations[0]?.id ?? '');
    setShipmentLineId(nextShipment?.lines[0]?.id ?? '');
    setSerialNumbers([]);
  }, [references.locations, references.shipments, shipmentId]);

  useEffect(() => {
    const selected = shipment?.lines.find((item) => item.id === shipmentLineId);
    setQuantity(selected?.trackingMode === 'serial' ? '1.0000' : '1.0000');
    setSerialNumbers([]);
  }, [shipment, shipmentLineId]);

  useEffect(() => {
    setEquipmentId(firstEquipmentId);
  }, [firstEquipmentId, locationId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CreateLogisticsReturnRequest = {
        customerLocationId: locationId,
        lines: [
          {
            ...(disposition === 'service' ? { customerEquipmentId: equipmentId, serviceType } : {}),
            destinationWarehouseId: warehouseId,
            disposition,
            quantity,
            ...(serialNumbers.length ? { serialNumbers } : {}),
            shipmentLineId,
          },
        ],
        originalShipmentId: shipmentId,
        reason: reason.trim(),
        ...(transportMethod === 'company_transport' && scheduledPickupAt
          ? { scheduledPickupAt: localDateTimeToIso(scheduledPickupAt) }
          : {}),
        transportMethod,
      };
      onSaved(await createLogisticsReturn(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorMessage(caught, 'The return could not be registered.'));
    } finally {
      setBusy(false);
    }
  }

  const valid =
    !!shipmentId &&
    !!locationId &&
    !!shipmentLineId &&
    !!warehouseId &&
    !!reason.trim() &&
    (disposition === 'restock' || !!equipmentId) &&
    (line?.trackingMode !== 'serial' || serialNumbers.length > 0);

  return (
    <LogisticsDrawer
      busy={busy}
      footer={
        <>
          <Button disabled={busy || !valid} form="new-return-form" type="submit">
            {busy ? 'Saving…' : 'Register return'}
          </Button>
          <Button disabled={busy} onClick={onBack} variant="secondary">
            Cancel
          </Button>
        </>
      }
      onBack={onBack}
      subtitle="Link the item to its shipment before it enters Warehouse or Service."
      title="Register return"
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {!references.shipments.length ? (
        <InlineAlert tone="info">
          Complete a shipment in Sales before registering a return.
        </InlineAlert>
      ) : (
        <form
          className="logistics-form"
          id="new-return-form"
          onSubmit={(event) => void submit(event)}
        >
          <FormSection number="1" title="Original sale">
            <label>
              <span>Shipment</span>
              <select value={shipmentId} onChange={(event) => setShipmentId(event.target.value)}>
                {references.shipments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.number} · {item.customerName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Customer location</span>
              <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                {locations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.city}
                  </option>
                ))}
              </select>
            </label>
          </FormSection>
          <FormSection number="2" title="Returned item">
            <label>
              <span>Shipment item</span>
              <select
                value={shipmentLineId}
                onChange={(event) => setShipmentLineId(event.target.value)}
              >
                {shipment?.lines.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.productName} · shipped {item.quantity}
                  </option>
                ))}
              </select>
            </label>
            <div className="logistics-form-grid">
              <label>
                <span>Quantity</span>
                <input
                  min="0.0001"
                  required
                  step="0.0001"
                  type="number"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>
              <label>
                <span>Destination warehouse</span>
                <select
                  value={warehouseId}
                  onChange={(event) => setWarehouseId(event.target.value)}
                >
                  {references.warehouses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {line?.trackingMode === 'serial' ? (
              <fieldset className="serial-choice-list">
                <legend>Returned serial number</legend>
                {line.serialNumbers.map((serial) => (
                  <label key={serial}>
                    <input
                      checked={serialNumbers.includes(serial)}
                      onChange={(event) => {
                        const nextSerialNumbers = event.target.checked
                          ? [...serialNumbers, serial]
                          : serialNumbers.filter((item) => item !== serial);
                        setSerialNumbers(nextSerialNumbers);
                        setQuantity(`${nextSerialNumbers.length}.0000`);
                      }}
                      type="checkbox"
                    />
                    <span>{serial}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
          </FormSection>
          <FormSection number="3" title="Next action">
            <div className="logistics-choice-grid">
              <button
                className={disposition === 'service' ? 'is-active' : undefined}
                onClick={() => setDisposition('service')}
                type="button"
              >
                <Icon name="service" size={18} />
                <span>
                  <strong>Send to Service</strong>
                  <small>Receiving will open a linked Service request.</small>
                </span>
              </button>
              <button
                className={disposition === 'restock' ? 'is-active' : undefined}
                onClick={() => setDisposition('restock')}
                type="button"
              >
                <Icon name="warehouse" size={18} />
                <span>
                  <strong>Return to stock</strong>
                  <small>Use only after confirming the item can be sold again.</small>
                </span>
              </button>
            </div>
            {disposition === 'service' ? (
              <div className="logistics-form-grid">
                <label>
                  <span>Customer equipment</span>
                  <select
                    required
                    value={equipmentId}
                    onChange={(event) => setEquipmentId(event.target.value)}
                  >
                    {equipment.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.deviceName} · {item.serialNumber}
                      </option>
                    ))}
                  </select>
                  {!equipment.length ? (
                    <small>
                      Add the device under the customer location before sending it to Service.
                    </small>
                  ) : null}
                </label>
                <label>
                  <span>Service type</span>
                  <select
                    value={serviceType}
                    onChange={(event) =>
                      setServiceType(event.target.value as 'out_of_warranty' | 'warranty')
                    }
                  >
                    <option value="out_of_warranty">Out of warranty</option>
                    <option value="warranty">Warranty</option>
                  </select>
                </label>
              </div>
            ) : null}
          </FormSection>
          <FormSection number="4" title="Collection and reason">
            <div className="logistics-form-grid">
              <label>
                <span>How it arrives</span>
                <select
                  value={transportMethod}
                  onChange={(event) =>
                    setTransportMethod(
                      event.target.value as 'company_transport' | 'customer_dropoff',
                    )
                  }
                >
                  <option value="customer_dropoff">Customer drop-off</option>
                  <option value="company_transport">Company collection</option>
                </select>
              </label>
              {transportMethod === 'company_transport' ? (
                <label>
                  <span>Collection time</span>
                  <input
                    required
                    type="datetime-local"
                    value={scheduledPickupAt}
                    onChange={(event) => setScheduledPickupAt(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
            <label>
              <span>Reason for return</span>
              <textarea
                maxLength={2000}
                placeholder="Describe the fault, condition, or agreed return reason"
                required
                rows={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </FormSection>
        </form>
      )}
    </LogisticsDrawer>
  );
}

interface DraftRouteStop {
  duration: number;
  id: string;
  kind: 'delivery' | 'service';
  sourceId: string;
  time: string;
}

function NewRouteDrawer({
  deliveries,
  onBack,
  onSaved,
  references,
  token,
}: {
  deliveries: LogisticsDelivery[];
  onBack: () => void;
  onSaved: (route: LogisticsRoutePlan) => void;
  references: LogisticsReferenceData;
  token: string;
}) {
  const availableDeliveries = deliveries.filter((item) =>
    ['planned', 'in_transit', 'exception'].includes(item.status),
  );
  const initialServiceStop = references.serviceStops[0];
  const initialRouteDate = initialServiceStop
    ? businessDate(initialServiceStop.scheduledStart, references.businessTimezone)
    : todayInput();
  const [routeDate, setRouteDate] = useState(initialRouteDate);
  const [title, setTitle] = useState('Vratsa customer run');
  const [assigneeId, setAssigneeId] = useState(
    availableDeliveries[0]
      ? (references.assignees[0]?.accountId ?? '')
      : (initialServiceStop?.assignedAccountId ?? references.assignees[0]?.accountId ?? ''),
  );
  const [notes, setNotes] = useState('');
  const [stops, setStops] = useState<DraftRouteStop[]>(() => [
    availableDeliveries[0]
      ? newDraftStop(availableDeliveries[0].id, routeDate, 0, 'delivery')
      : newServiceDraftStop(initialServiceStop, references.businessTimezone),
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateStop(id: string, patch: Partial<DraftRouteStop>) {
    setStops((current) => current.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CreateLogisticsRouteRequest = {
        assignedAccountId: assigneeId,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        routeDate,
        stops: stops.map((stop) => {
          const serviceSource =
            stop.kind === 'service'
              ? references.serviceStops.find((source) => source.id === stop.sourceId)
              : undefined;
          return {
            ...(stop.kind === 'delivery'
              ? { deliveryId: stop.sourceId }
              : { serviceWorkOrderId: stop.sourceId }),
            plannedArrival:
              serviceSource?.scheduledStart ??
              businessDateTimeToIso(stop.time, references.businessTimezone),
            plannedDurationMinutes: serviceSource
              ? serviceAppointmentMinutes(serviceSource)
              : stop.duration,
            stopType: stop.kind,
          };
        }),
        title: title.trim(),
      };
      onSaved(await createLogisticsRoute(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorMessage(caught, 'The route could not be planned.'));
    } finally {
      setBusy(false);
    }
  }

  const hasSources = availableDeliveries.length > 0 || references.serviceStops.length > 0;
  const selectedServiceStops = stops
    .filter((stop) => stop.kind === 'service')
    .map((stop) => references.serviceStops.find((source) => source.id === stop.sourceId))
    .filter((source): source is LogisticsReferenceData['serviceStops'][number] => Boolean(source));
  const serviceAssigneeId = selectedServiceStops[0]?.assignedAccountId;
  const valid =
    !!title.trim() && !!assigneeId && stops.length > 0 && stops.every((stop) => stop.sourceId);
  return (
    <LogisticsDrawer
      busy={busy}
      footer={
        <>
          <Button disabled={busy || !valid} form="new-route-form" type="submit">
            {busy ? 'Saving…' : 'Plan route'}
          </Button>
          <Button disabled={busy} onClick={onBack} variant="secondary">
            Cancel
          </Button>
        </>
      }
      onBack={onBack}
      subtitle="Arrange deliveries and scheduled Service visits in the order they should be completed."
      title="Plan route"
      wide
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {!hasSources ? (
        <InlineAlert tone="info">
          Plan a delivery or schedule a Service work order before creating a route.
        </InlineAlert>
      ) : (
        <form
          className="logistics-form"
          id="new-route-form"
          onSubmit={(event) => void submit(event)}
        >
          <FormSection number="1" title="Route details">
            <div className="logistics-form-grid">
              <label>
                <span>Date</span>
                <input
                  disabled={selectedServiceStops.length > 0}
                  required
                  type="date"
                  value={routeDate}
                  onChange={(event) => {
                    setRouteDate(event.target.value);
                    setStops((current) =>
                      current.map((stop, index) => ({
                        ...stop,
                        ...(stop.kind === 'delivery'
                          ? {
                              time: `${event.target.value}T${String(9 + index).padStart(2, '0')}:00`,
                            }
                          : {}),
                      })),
                    );
                  }}
                />
                {selectedServiceStops.length ? (
                  <small>The Service appointment sets the route date.</small>
                ) : null}
              </label>
              <label>
                <span>Assigned employee</span>
                <select
                  disabled={Boolean(serviceAssigneeId)}
                  required
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                >
                  {references.assignees.map((item) => (
                    <option key={item.accountId} value={item.accountId}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
                {serviceAssigneeId ? (
                  <small>The selected Service visit sets the responsible technician.</small>
                ) : null}
              </label>
            </div>
            <label>
              <span>Route title</span>
              <input required value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
          </FormSection>
          <FormSection number="2" title="Stops">
            <div className="route-stop-editor">
              {stops.map((stop, index) => {
                const sources =
                  stop.kind === 'delivery'
                    ? availableDeliveries
                    : references.serviceStops.filter(
                        (source) =>
                          !serviceAssigneeId ||
                          source.assignedAccountId === serviceAssigneeId ||
                          source.id === stop.sourceId,
                      );
                return (
                  <section key={stop.id}>
                    <header>
                      <span>{index + 1}</span>
                      <strong>Stop {index + 1}</strong>
                      {stops.length > 1 ? (
                        <button
                          aria-label={`Remove stop ${index + 1}`}
                          onClick={() =>
                            setStops((current) => current.filter((item) => item.id !== stop.id))
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      ) : null}
                    </header>
                    <div className="logistics-form-grid">
                      <label>
                        <span>Stop type</span>
                        <select
                          value={stop.kind}
                          onChange={(event) => {
                            const kind = event.target.value as DraftRouteStop['kind'];
                            if (kind === 'service') {
                              const source = references.serviceStops.find(
                                (item) =>
                                  !serviceAssigneeId ||
                                  item.assignedAccountId === serviceAssigneeId,
                              );
                              const prepared = newServiceDraftStop(
                                source,
                                references.businessTimezone,
                              );
                              updateStop(stop.id, { ...prepared, id: stop.id });
                              if (source) {
                                setAssigneeId(source.assignedAccountId);
                                setRouteDate(
                                  businessDate(source.scheduledStart, references.businessTimezone),
                                );
                              }
                            } else {
                              updateStop(stop.id, {
                                kind,
                                sourceId: availableDeliveries[0]?.id ?? '',
                                time: `${routeDate}T${String(9 + index).padStart(2, '0')}:00`,
                              });
                            }
                          }}
                        >
                          <option value="delivery">Customer delivery</option>
                          <option value="service">Service visit</option>
                        </select>
                      </label>
                      <label>
                        <span>{stop.kind === 'delivery' ? 'Delivery' : 'Service visit'}</span>
                        <select
                          required
                          value={stop.sourceId}
                          onChange={(event) => {
                            if (stop.kind === 'service') {
                              const source = references.serviceStops.find(
                                (item) => item.id === event.target.value,
                              );
                              const prepared = newServiceDraftStop(
                                source,
                                references.businessTimezone,
                              );
                              updateStop(stop.id, { ...prepared, id: stop.id });
                              if (source) {
                                setAssigneeId(source.assignedAccountId);
                                setRouteDate(
                                  businessDate(source.scheduledStart, references.businessTimezone),
                                );
                              }
                            } else updateStop(stop.id, { sourceId: event.target.value });
                          }}
                        >
                          {sources.map((item) => (
                            <option key={item.id} value={item.id}>
                              {'number' in item
                                ? `${item.number} · ${item.customerName}`
                                : `${item.label} · ${item.customerName}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="logistics-form-grid">
                      <label>
                        <span>Planned arrival</span>
                        <input
                          disabled={stop.kind === 'service'}
                          required
                          type="datetime-local"
                          value={stop.time}
                          onChange={(event) => updateStop(stop.id, { time: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Time at stop (minutes)</span>
                        <input
                          disabled={stop.kind === 'service'}
                          max={1440}
                          min={5}
                          required
                          type="number"
                          value={stop.duration}
                          onChange={(event) =>
                            updateStop(stop.id, { duration: Number(event.target.value) })
                          }
                        />
                        {stop.kind === 'service' ? (
                          <small>Uses the scheduled Service appointment.</small>
                        ) : null}
                      </label>
                    </div>
                  </section>
                );
              })}
              <Button
                onClick={() => {
                  const serviceSource = references.serviceStops.find(
                    (source) =>
                      !serviceAssigneeId || source.assignedAccountId === serviceAssigneeId,
                  );
                  setStops((current) => [
                    ...current,
                    availableDeliveries[0]
                      ? newDraftStop(
                          availableDeliveries[0].id,
                          routeDate,
                          current.length,
                          'delivery',
                        )
                      : newServiceDraftStop(serviceSource, references.businessTimezone),
                  ]);
                }}
                type="button"
                variant="secondary"
              >
                <Icon name="plus" size={15} /> Add stop
              </Button>
            </div>
          </FormSection>
          <FormSection number="3" title="Notes">
            <label>
              <span>Route notes (optional)</span>
              <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
          </FormSection>
        </form>
      )}
    </LogisticsDrawer>
  );
}

function DeliveryDrawer({
  canEdit,
  delivery,
  onBack,
  onChanged,
  token,
}: {
  canEdit: boolean;
  delivery: LogisticsDelivery;
  onBack: () => void;
  onChanged: (delivery: LogisticsDelivery, message: string) => void;
  token: string;
}) {
  const [mode, setMode] = useState<'cancel' | 'complete' | 'exception' | null>(null);
  const [recipientName, setRecipientName] = useState('');
  const [deliveredAt, setDeliveredAt] = useState(nowLocalInput());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function action(kind: 'cancel' | 'complete' | 'dispatch' | 'exception') {
    setBusy(true);
    setError(null);
    try {
      const key = crypto.randomUUID();
      let updated: LogisticsDelivery;
      if (kind === 'dispatch') {
        updated = await dispatchLogisticsDelivery(token, delivery.id, key, {
          expectedVersion: delivery.version,
          note: delivery.status === 'exception' ? 'Delivery resumed' : 'Driver departed',
        });
      } else if (kind === 'complete') {
        updated = await completeLogisticsDelivery(token, delivery.id, key, {
          deliveredAt: localDateTimeToIso(deliveredAt),
          expectedVersion: delivery.version,
          ...(notes.trim() ? { proofNotes: notes.trim() } : {}),
          recipientName: recipientName.trim(),
        });
      } else if (kind === 'exception') {
        updated = await reportLogisticsDeliveryException(token, delivery.id, key, {
          expectedVersion: delivery.version,
          reason: notes.trim(),
        });
      } else {
        updated = await cancelLogisticsDelivery(token, delivery.id, key, {
          expectedVersion: delivery.version,
          note: notes.trim(),
        });
      }
      setMode(null);
      setNotes('');
      onChanged(updated, deliveryActionMessage(kind, updated.number));
    } catch (caught) {
      setError(errorMessage(caught, 'The delivery could not be updated.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <LogisticsDrawer
      busy={busy}
      footer={
        canEdit && delivery.status !== 'delivered' && delivery.status !== 'cancelled' ? (
          <>
            {delivery.status === 'planned' || delivery.status === 'exception' ? (
              <Button disabled={busy} onClick={() => void action('dispatch')}>
                {delivery.status === 'exception' ? 'Resume delivery' : 'Dispatch'}
              </Button>
            ) : null}
            {delivery.status === 'in_transit' ? (
              <Button disabled={busy} onClick={() => setMode('complete')}>
                Record delivery
              </Button>
            ) : null}
            {delivery.status !== 'exception' ? (
              <Button disabled={busy} onClick={() => setMode('exception')} variant="secondary">
                Report issue
              </Button>
            ) : null}
          </>
        ) : (
          <Button onClick={onBack} variant="secondary">
            Close
          </Button>
        )
      }
      onBack={onBack}
      subtitle={`${delivery.customerName} · ${delivery.shipmentNumber}`}
      title={delivery.number}
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {delivery.status === 'exception' && delivery.exceptionReason ? (
        <InlineAlert tone="warning">{delivery.exceptionReason}</InlineAlert>
      ) : null}
      <section className="logistics-detail-hero">
        <StatusBadge status={delivery.status} />
        <h3>{delivery.customerLocationName}</h3>
        <p>
          {delivery.addressLine1}
          {delivery.addressLine2 ? `, ${delivery.addressLine2}` : ''}, {delivery.city}
        </p>
      </section>
      <section className="logistics-detail-grid">
        <Info
          label="Delivery window"
          value={`${formatDateTime(delivery.scheduledStart)}–${formatTime(delivery.scheduledEnd)}`}
        />
        <Info label="Transport" value="Company transport" />
        <Info
          label="Handover"
          value={delivery.handoverStatus === 'accepted' ? 'Accepted' : 'Awaiting receipt'}
        />
        <Info label="Sales shipment" value={delivery.shipmentNumber} />
      </section>
      {delivery.instructions ? (
        <section className="logistics-note-card">
          <strong>Driver notes</strong>
          <p>{delivery.instructions}</p>
        </section>
      ) : null}
      {delivery.status === 'delivered' ? (
        <section className="logistics-note-card is-success">
          <strong>Received by {delivery.recipientName}</strong>
          <p>{delivery.deliveredAt ? formatDateTime(delivery.deliveredAt) : ''}</p>
          {delivery.proofNotes ? <p>{delivery.proofNotes}</p> : null}
        </section>
      ) : null}
      <section className="logistics-timeline">
        <h3>Activity</h3>
        {delivery.history.map((entry) => (
          <div key={`${entry.changedAt}-${entry.nextStatus}`}>
            <span />
            <div>
              <strong>{statusLabel(entry.nextStatus)}</strong>
              <small>
                {formatDateTime(entry.changedAt)} · {entry.changedBy}
              </small>
              {entry.note ? <p>{entry.note}</p> : null}
            </div>
          </div>
        ))}
      </section>
      {mode ? (
        <section className="logistics-action-card">
          <header>
            <h3>
              {mode === 'complete'
                ? 'Customer receipt'
                : mode === 'exception'
                  ? 'Delivery issue'
                  : 'Cancel delivery'}
            </h3>
            <button aria-label="Close action" onClick={() => setMode(null)} type="button">
              <Icon name="close" size={16} />
            </button>
          </header>
          {mode === 'complete' ? (
            <div className="logistics-form-grid">
              <label>
                <span>Recipient name</span>
                <input
                  value={recipientName}
                  onChange={(event) => setRecipientName(event.target.value)}
                />
              </label>
              <label>
                <span>Delivered at</span>
                <input
                  type="datetime-local"
                  value={deliveredAt}
                  onChange={(event) => setDeliveredAt(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          <label>
            <span>{mode === 'complete' ? 'Receipt notes (optional)' : 'Reason'}</span>
            <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <Button
            disabled={busy || (mode === 'complete' ? !recipientName.trim() : !notes.trim())}
            onClick={() => void action(mode)}
          >
            {busy ? 'Saving…' : mode === 'complete' ? 'Confirm receipt' : 'Save'}
          </Button>
          {mode !== 'complete' &&
          (delivery.status === 'planned' || delivery.status === 'exception') ? (
            <button className="text-danger-action" onClick={() => setMode('cancel')} type="button">
              Cancel this delivery instead
            </button>
          ) : null}
        </section>
      ) : null}
    </LogisticsDrawer>
  );
}

function ReturnDrawer({
  canEdit,
  onBack,
  onChanged,
  record,
  token,
}: {
  canEdit: boolean;
  onBack: () => void;
  onChanged: (record: LogisticsReturn) => void;
  record: LogisticsReturn;
  token: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function receive() {
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await receiveLogisticsReturn(token, record.id, crypto.randomUUID(), {
          expectedVersion: record.version,
        }),
      );
    } catch (caught) {
      setError(errorMessage(caught, 'The return could not be received.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <LogisticsDrawer
      busy={busy}
      footer={
        canEdit && record.status === 'registered' ? (
          <>
            <Button disabled={busy} onClick={() => void receive()}>
              {busy ? 'Receiving…' : 'Receive return'}
            </Button>
            <Button disabled={busy} onClick={onBack} variant="secondary">
              Close
            </Button>
          </>
        ) : (
          <Button onClick={onBack} variant="secondary">
            Close
          </Button>
        )
      }
      onBack={onBack}
      subtitle={`${record.customerName} · ${record.originalShipmentNumber}`}
      title={record.number}
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <section className="logistics-detail-hero">
        <StatusBadge status={record.status} />
        <h3>{record.customerLocationName}</h3>
        <p>{record.reason}</p>
      </section>
      <section className="logistics-detail-grid">
        <Info label="Arrival" value={returnTransportLabel(record.transportMethod)} />
        <Info
          label="Collection time"
          value={
            record.scheduledPickupAt
              ? formatDateTime(record.scheduledPickupAt)
              : 'Customer drop-off'
          }
        />
        <Info label="Original shipment" value={record.originalShipmentNumber} />
        <Info label="Status" value={statusLabel(record.status)} />
      </section>
      <section className="return-line-list">
        <h3>Returned items</h3>
        {record.lines.map((line) => (
          <article key={line.id}>
            <div>
              <strong>{line.productName}</strong>
              <small>
                {line.quantity} · {line.destinationWarehouseName}
              </small>
            </div>
            <span>{line.disposition === 'service' ? 'Send to Service' : 'Return to stock'}</span>
            {line.serialNumbers.length ? <code>{line.serialNumbers.join(', ')}</code> : null}
            {line.serviceRequestNumber ? (
              <p>
                Service request <strong>{line.serviceRequestNumber}</strong> created
              </p>
            ) : null}
          </article>
        ))}
      </section>
      {record.status === 'registered' ? (
        <InlineAlert tone="info">
          Receiving posts the warehouse return. Repair items also open a linked Service request.
          Repeating the action cannot post either record twice.
        </InlineAlert>
      ) : (
        <InlineAlert tone="success">
          Warehouse and Service links were created successfully on{' '}
          {record.receivedAt ? formatDateTime(record.receivedAt) : 'receipt'}.
        </InlineAlert>
      )}
    </LogisticsDrawer>
  );
}

function RouteDrawer({ onBack, route }: { onBack: () => void; route: LogisticsRoutePlan }) {
  return (
    <LogisticsDrawer
      footer={
        <Button onClick={onBack} variant="secondary">
          Close
        </Button>
      }
      onBack={onBack}
      subtitle={`${formatDate(route.routeDate)} · ${route.assignedTo}`}
      title={route.title}
    >
      <section className="logistics-detail-hero">
        <StatusBadge status={route.status} />
        <h3>{route.number}</h3>
        <p>
          {route.stops.length} planned stop{route.stops.length === 1 ? '' : 's'}
        </p>
      </section>
      <section className="route-stop-timeline">
        {route.stops.map((stop) => (
          <article key={stop.id}>
            <span>{stop.position}</span>
            <div>
              <small>{formatTime(stop.plannedArrival)}</small>
              <strong>{stop.label}</strong>
              <p>
                {stop.addressLine}, {stop.city}
              </p>
              <small>
                {stop.stopType === 'delivery' ? 'Customer delivery' : 'Service visit'} ·{' '}
                {stop.plannedDurationMinutes} minutes
              </small>
            </div>
          </article>
        ))}
      </section>
      {route.notes ? (
        <section className="logistics-note-card">
          <strong>Route notes</strong>
          <p>{route.notes}</p>
        </section>
      ) : null}
    </LogisticsDrawer>
  );
}

function LogisticsDrawer({
  busy = false,
  children,
  footer,
  onBack,
  subtitle,
  title,
  wide = false,
}: {
  busy?: boolean;
  children: ReactNode;
  footer: ReactNode;
  onBack: () => void;
  subtitle: string;
  title: string;
  wide?: boolean;
}) {
  return (
    <div className="security-drawer-layer logistics-drawer-layer">
      <button
        aria-label="Back to Logistics"
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className={`security-drawer logistics-drawer${wide ? ' is-wide' : ''}`}
        role="dialog"
      >
        <header className="panel-drawer-header logistics-drawer-header">
          <button className="panel-back-button" disabled={busy} onClick={onBack} type="button">
            <Icon name="arrow" size={16} /> Back
          </button>
          <button
            aria-label="Close"
            className="panel-close-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="close" size={18} />
          </button>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </header>
        <div className="security-drawer-body logistics-drawer-body">{children}</div>
        <footer className="security-drawer-actions logistics-drawer-actions">{footer}</footer>
      </aside>
    </div>
  );
}

function FormSection({
  children,
  number,
  title,
}: {
  children: ReactNode;
  number: string;
  title: string;
}) {
  return (
    <section className="logistics-form-section">
      <header>
        <span>{number}</span>
        <h3>{title}</h3>
      </header>
      <div>{children}</div>
    </section>
  );
}

function SummaryCard({ label, tone, value }: { label: string; tone?: 'warning'; value: number }) {
  return (
    <article className={tone ? `logistics-summary-card is-${tone}` : 'logistics-summary-card'}>
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status.replaceAll('_', '-')}`}>
      {statusLabel(status)}
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LogisticsEmpty({ description, title }: { description: string; title: string }) {
  return (
    <div className="logistics-empty-state">
      <span>
        <Icon name="logistics" size={22} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function LogisticsState({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">ERP · Logistics</p>
          <h1>{title}</h1>
          <p>Please wait a moment or try loading the page again.</p>
        </div>
        {children}
      </header>
    </div>
  );
}

function useLogisticsData(token: string, dateFrom: string, dateTo: string) {
  const [references, setReferences] = useState(emptyReferences);
  const [deliveries, setDeliveries] = useState(emptyDeliveryPage);
  const [returns, setReturns] = useState(emptyReturnPage);
  const [routes, setRoutes] = useState(emptyRoutePage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void Promise.all([
      getLogisticsReferenceData(token),
      listLogisticsDeliveries(token),
      listLogisticsReturns(token),
      listLogisticsRoutes(token, dateFrom, dateTo),
    ])
      .then(([nextReferences, nextDeliveries, nextReturns, nextRoutes]) => {
        if (!active) return;
        setReferences(nextReferences);
        setDeliveries(nextDeliveries);
        setReturns(nextReturns);
        setRoutes(nextRoutes);
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [dateFrom, dateTo, revision, token]);

  return { deliveries, error, loading, references, reload, returns, routes };
}

function pageMeta(view: LogisticsOperationsView) {
  if (view === 'deliveries')
    return {
      description: 'Plan customer delivery, follow its progress, and capture customer receipt.',
      title: 'Deliveries',
    };
  if (view === 'couriers')
    return {
      description: 'See which courier connections are ready for booking and tracking.',
      title: 'Couriers',
    };
  if (view === 'returns')
    return {
      description: 'Receive returned goods safely and send repairable equipment to Service.',
      title: 'Returns & reverse logistics',
    };
  return {
    description: 'Arrange customer deliveries and Service visits into practical daily routes.',
    title: 'Routes',
  };
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    cancelled: 'Cancelled',
    completed: 'Completed',
    delivered: 'Delivered',
    exception: 'Needs attention',
    in_progress: 'In progress',
    in_transit: 'On the way',
    planned: 'Planned',
    received: 'Received',
    registered: 'Registered',
  };
  return labels[status] ?? status.replaceAll('_', ' ');
}

function returnTransportLabel(value: LogisticsReturn['transportMethod']) {
  if (value === 'customer_dropoff') return 'Customer drop-off';
  if (value === 'company_transport') return 'Company collection';
  return value === 'econt' ? 'Econt return' : 'Speedy return';
}

function deliveryActionMessage(action: string, number: string) {
  if (action === 'dispatch') return `${number} is on the way.`;
  if (action === 'complete') return `${number} was received by the customer.`;
  if (action === 'exception') return `${number} has been marked for attention.`;
  return `${number} was cancelled.`;
}

function localDateTimeToIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Enter a valid date and time.');
  return date.toISOString();
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}

function formatWeekday(value: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function todayInput() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function nowLocalInput() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function deliveryTimes() {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(11, 0, 0, 0);
  return { start: localInput(start), end: localInput(end) };
}

function localInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function routeWindow() {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 7);
  const dateTo = new Date();
  dateTo.setDate(dateTo.getDate() + 30);
  return { dateFrom: dateOnly(dateFrom), dateTo: dateOnly(dateTo) };
}

function dateOnly(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function newDraftStop(
  sourceId: string,
  routeDate: string,
  index = 0,
  kind: DraftRouteStop['kind'] = 'delivery',
): DraftRouteStop {
  return {
    duration: 45,
    id: crypto.randomUUID(),
    kind,
    sourceId,
    time: `${routeDate}T${String(9 + index).padStart(2, '0')}:00`,
  };
}

function newServiceDraftStop(
  source: LogisticsReferenceData['serviceStops'][number] | undefined,
  timezone: string,
): DraftRouteStop {
  if (!source)
    return {
      duration: 45,
      id: crypto.randomUUID(),
      kind: 'service',
      sourceId: '',
      time: `${todayInput()}T09:00`,
    };
  return {
    duration: serviceAppointmentMinutes(source),
    id: crypto.randomUUID(),
    kind: 'service',
    sourceId: source.id,
    time: toBusinessDateTimeInput(source.scheduledStart, timezone),
  };
}

function serviceAppointmentMinutes(source: LogisticsReferenceData['serviceStops'][number]): number {
  return Math.max(
    5,
    Math.round(
      (new Date(source.scheduledEnd).getTime() - new Date(source.scheduledStart).getTime()) /
        60_000,
    ),
  );
}

function businessDate(value: string, timezone: string) {
  const parts = zonedDateTimeParts(new Date(value), timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function toBusinessDateTimeInput(value: string, timezone: string) {
  const parts = zonedDateTimeParts(new Date(value), timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function businessDateTimeToIso(value: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return localDateTimeToIso(value);
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
    const observed = zonedDateTimeParts(new Date(instant), timezone);
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

function zonedDateTimeParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return {
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    month: part('month'),
    year: part('year'),
  };
}

function groupRoutesByDate(routes: LogisticsRoutePlan[]) {
  const groups = new Map<string, LogisticsRoutePlan[]>();
  for (const route of routes) {
    const group = groups.get(route.routeDate) ?? [];
    group.push(route);
    groups.set(route.routeDate, group);
  }
  return groups;
}

function errorMessage(caught: unknown, fallback: string) {
  if (!(caught instanceof ApiClientError)) return fallback;
  const details = caught.details.map((detail) => detail.message.trim()).filter(Boolean);
  return details.length
    ? 'Some information is missing or invalid. Review the form and try again.'
    : caught.message;
}
import { erpReportMessages } from './erp-report.messages';
