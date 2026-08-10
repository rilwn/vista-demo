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
            <span>Movement history</span>
            <h2>Trace a serial</h2>
          </div>
          <small>Recorded stock movements</small>
        </div>
      ) : (
        <header className="page-header workflow-header">
          <div>
            <p className="page-eyebrow">ERP · Warehouse</p>
            <h1>Serial traceability</h1>
            <p>Follow one device from supplier receipt through every warehouse and final issue.</p>
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
              <p>
                Supplier, warehouse, customer, and technician history will appear when recorded.
              </p>
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
              <strong>{trace.currentWarehouse.displayName}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong className={`trace-status is-${trace.status}`}>{trace.status}</strong>
            </div>
          </section>
          <section className="trace-timeline" aria-label="Serial movement history">
            {trace.events.map((event) => (
              <TraceEventCard event={event} key={`${event.eventType}-${event.movementId}`} />
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}

function TraceEventCard({ event }: { event: SerialTraceEvent }) {
  const custody = event.toWarehouse?.displayName ?? event.warehouse.displayName;
  return (
    <article className="trace-event">
      <span className="trace-event-mark">
        <Icon name={event.eventType === 'transfer' ? 'arrow' : 'warehouse'} size={16} />
      </span>
      <div>
        <div className="trace-event-heading">
          <strong>{eventLabel(event)}</strong>
          <time>{new Date(event.occurredAt).toLocaleString()}</time>
        </div>
        <p>
          {event.referenceType} · {event.referenceId}
        </p>
        <dl>
          <div>
            <dt>Custody</dt>
            <dd>{custody}</dd>
          </div>
          <div>
            <dt>Recorded by</dt>
            <dd>{event.actor.displayName}</dd>
          </div>
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
        </dl>
      </div>
    </article>
  );
}

function eventLabel(event: SerialTraceEvent) {
  if (event.eventType === 'receipt') return 'Received into inventory';
  if (event.eventType === 'transfer')
    return `Transferred from ${event.fromWarehouse?.displayName ?? 'warehouse'}`;
  if (event.eventType === 'stocktake') return 'Stocktake adjustment';
  return 'Issued from inventory';
}
