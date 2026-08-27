import { Button, InlineAlert, TextField } from '@vista/ui';
import type { SerialTraceEvent, SerialTraceability } from '@vista/contracts';
import { type FormEvent, useState } from 'react';

import { ApiClientError } from '../api/client';
import { getSerialTraceability } from '../api/inventory';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';

export function SerialTraceabilityPage({ compact = false }: { compact?: boolean }) {
  const { session } = useAuth();
  const [serialNumber, setSerialNumber] = useState('');
  const [trace, setTrace] = useState<SerialTraceability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const token = session?.sessionToken;
    const serial = serialNumber.trim();
    if (!token || !serial) return;
    setLoading(true);
    setError(null);
    try {
      setTrace(await getSerialTraceability(token, serial));
    } catch (caught) {
      setTrace(null);
      setError(
        caught instanceof ApiClientError && caught.code === 'SERIAL_NOT_FOUND'
          ? 'No inventory record matches this serial number.'
          : 'The serial history could not be loaded. Try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`page-stack trace-page${compact ? ' trace-page-compact' : ''}`}>
      {compact ? (
        <div className="command-card-heading">
          <div>
            <span>Device lifecycle</span>
            <h2>Trace a serial</h2>
          </div>
          <small>Supplier to customer and Service</small>
        </div>
      ) : (
        <header className="page-header workflow-header">
          <div>
            <p className="page-eyebrow">ERP · Warehouse</p>
            <h1>Serial traceability</h1>
            <p>
              Follow one device from supplier receipt through sale, Service, repair, and return.
            </p>
          </div>
        </header>
      )}

      <form className="trace-search" onSubmit={(event) => void submit(event)}>
        <TextField
          id={compact ? 'embedded-serial-number' : 'serial-number'}
          label="Serial number"
          onChange={(event) => setSerialNumber(event.target.value)}
          placeholder="Scan or enter a serial"
          value={serialNumber}
        />
        <Button disabled={loading || !serialNumber.trim()} type="submit">
          {loading ? 'Tracing…' : 'Trace serial'}
        </Button>
      </form>

      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {!trace && !error ? (
        <section className="workflow-empty trace-empty">
          <div>
            <span className="workflow-empty-icon">
              <Icon name="search" size={22} />
            </span>
            <div>
              <strong>Ready for a serial scan</strong>
              <p>Supplier, sale, customer, Service, and return history will appear here.</p>
            </div>
          </div>
        </section>
      ) : null}

      {trace ? (
        <>
          <section className="trace-summary">
            <div>
              <span>Serial</span>
              <strong>{trace.serialNumber}</strong>
            </div>
            <div>
              <span>Product</span>
              <strong>{trace.product.displayName}</strong>
            </div>
            <div>
              <span>Current custody</span>
              <strong>{trace.currentCustody.displayName}</strong>
            </div>
            <div>
              <span>{trace.customerEquipment ? 'Equipment status' : 'Stock status'}</span>
              <strong
                className={`trace-status is-${trace.customerEquipment?.status ?? trace.status}`}
              >
                {statusLabel(trace.customerEquipment?.status ?? trace.status)}
              </strong>
            </div>
          </section>
          {trace.customer && trace.customerEquipment ? (
            <section className="trace-owner" aria-label="Registered customer equipment">
              <span className="trace-owner-icon">
                <Icon name="customers" size={18} />
              </span>
              <div>
                <span>Registered equipment</span>
                <strong>{trace.customer.displayName}</strong>
                <p>{trace.customerEquipment.location.displayName}</p>
              </div>
            </section>
          ) : null}
          <section className="trace-timeline" aria-label="Serial lifecycle history">
            {trace.events.map((event) => (
              <TraceEventCard event={event} key={event.eventId} />
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}

function TraceEventCard({ event }: { event: SerialTraceEvent }) {
  const custody =
    event.toWarehouse?.displayName ??
    event.customerLocation?.displayName ??
    event.warehouse?.displayName;
  return (
    <article className={`trace-event is-${event.eventType}`}>
      <span className="trace-event-mark">
        <Icon name={eventIcon(event)} size={16} />
      </span>
      <div>
        <div className="trace-event-heading">
          <strong>{eventLabel(event)}</strong>
          <time>{new Date(event.occurredAt).toLocaleString()}</time>
        </div>
        <p>
          {event.referenceType} · {event.referenceId}
        </p>
        {event.description ? <p className="trace-event-description">{event.description}</p> : null}
        <dl>
          {custody ? (
            <div>
              <dt>{event.eventType === 'transfer' ? 'Destination' : 'Location'}</dt>
              <dd>{custody}</dd>
            </div>
          ) : null}
          {event.actor ? (
            <div>
              <dt>Recorded by</dt>
              <dd>{event.actor.displayName}</dd>
            </div>
          ) : null}
          {event.supplier ? (
            <div>
              <dt>Supplier</dt>
              <dd>{event.supplier.displayName}</dd>
            </div>
          ) : null}
          {event.customer ? (
            <div>
              <dt>Customer</dt>
              <dd>{event.customer.displayName}</dd>
            </div>
          ) : null}
          {event.technician ? (
            <div>
              <dt>Technician</dt>
              <dd>{event.technician.displayName}</dd>
            </div>
          ) : null}
          {event.details?.map((detail) => (
            <div key={`${detail.label}-${detail.value}`}>
              <dt>{detail.label}</dt>
              <dd>{detailValue(detail.label, detail.value)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  );
}

function eventLabel(event: SerialTraceEvent) {
  if (event.eventType === 'receipt')
    return event.supplier ? 'Received from supplier' : 'Received into inventory';
  if (event.eventType === 'transfer')
    return `Transferred from ${event.fromWarehouse?.displayName ?? 'warehouse'}`;
  if (event.eventType === 'sale') return 'Sold and shipped';
  if (event.eventType === 'handover') return 'Accepted by customer';
  if (event.eventType === 'return_registered') return 'Return registered';
  if (event.eventType === 'return_received') return 'Return received';
  if (event.eventType === 'service_requested') return 'Service requested';
  if (event.eventType === 'service_scheduled') return 'Service visit scheduled';
  if (event.eventType === 'service_started') return 'Repair started';
  if (event.eventType === 'repair_completed') return 'Repair completed';
  if (event.eventType === 'stocktake') return 'Stocktake adjustment';
  return 'Issued from inventory';
}

function eventIcon(
  event: SerialTraceEvent,
): 'arrow' | 'check' | 'logistics' | 'sales' | 'service' | 'warehouse' {
  if (event.eventType === 'transfer') return 'arrow';
  if (event.eventType === 'sale') return 'sales';
  if (event.eventType === 'handover' || event.eventType === 'repair_completed') return 'check';
  if (event.eventType === 'return_registered' || event.eventType === 'return_received')
    return 'logistics';
  if (event.eventType.startsWith('service_')) return 'service';
  return 'warehouse';
}

function detailValue(label: string, value: string) {
  return label === 'Appointment' ? new Date(value).toLocaleString() : value;
}

function statusLabel(value: string) {
  const label = value.replaceAll('_', ' ');
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}
