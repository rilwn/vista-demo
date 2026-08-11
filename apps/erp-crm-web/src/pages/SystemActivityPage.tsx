import { Button, InlineAlert } from '@vista/ui';
import type {
  IntegrationDeliverySummary,
  IntegrationEventDetail,
  IntegrationEventStatus,
  IntegrationEventSummary,
  IntegrationEventTelemetry,
} from '@vista/contracts';
import { useCallback, useEffect, useState } from 'react';

import {
  getIntegrationEvent,
  getIntegrationTelemetry,
  listIntegrationEvents,
  replayIntegrationEvent,
} from '../api/integrations';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { messages } from '../messages';

type StatusFilter = IntegrationEventStatus | 'all';

export function SystemActivityPage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const [events, setEvents] = useState<IntegrationEventSummary[]>([]);
  const [telemetry, setTelemetry] = useState<IntegrationEventTelemetry | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setLoadError(false);
    void Promise.all([
      getIntegrationTelemetry(token),
      listIntegrationEvents(token, status === 'all' ? undefined : status),
    ])
      .then(([nextTelemetry, page]) => {
        if (!active) return;
        setTelemetry(nextTelemetry);
        setEvents(page.items);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision, status, token]);

  return (
    <div className="page-stack system-activity-page">
      <header className="page-header system-activity-header">
        <div>
          <p className="page-eyebrow">{messages.operations.eyebrow}</p>
          <h1>{messages.operations.title}</h1>
          <p>{messages.operations.subtitle}</p>
        </div>
        <Button disabled={loading} onClick={reload} variant="secondary">
          {messages.operations.refresh}
        </Button>
      </header>

      {loadError ? (
        <InlineAlert tone="error">
          {messages.operations.loadError}{' '}
          <button className="inline-link-button" onClick={reload} type="button">
            {messages.operations.tryAgain}
          </button>
        </InlineAlert>
      ) : null}

      <ActivitySummary loading={loading} telemetry={telemetry} />

      <section className="content-panel system-activity-panel">
        <div className="system-activity-toolbar">
          <div>
            <strong>{messages.operations.history}</strong>
            <span>{messages.operations.historyHint}</span>
          </div>
          <label>
            <span>{messages.operations.filter}</span>
            <select
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              value={status}
            >
              <option value="all">{messages.operations.allStatuses}</option>
              <option value="pending">{statusLabel('pending')}</option>
              <option value="publishing">{statusLabel('publishing')}</option>
              <option value="published">{statusLabel('published')}</option>
              <option value="completed">{statusLabel('completed')}</option>
              <option value="dead_letter">{statusLabel('dead_letter')}</option>
            </select>
          </label>
        </div>
        {loading ? (
          <ActivityLoading />
        ) : events.length ? (
          <div className="system-activity-table-wrap">
            <table className="system-activity-table">
              <thead>
                <tr>
                  <th>{messages.operations.event}</th>
                  <th>{messages.operations.status}</th>
                  <th>{messages.operations.received}</th>
                  <th>{messages.operations.attempts}</th>
                  <th aria-label={messages.operations.open} />
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <strong>{eventLabel(event.eventType)}</strong>
                      <span>{shortReference(event.id)}</span>
                    </td>
                    <td>
                      <StatusBadge status={event.status} />
                    </td>
                    <td>{dateTime(event.occurredAt)}</td>
                    <td>{event.attemptCount}</td>
                    <td>
                      <button
                        aria-label={`${messages.operations.open} ${eventLabel(event.eventType)}`}
                        className="system-activity-open"
                        onClick={() => setSelectedId(event.id)}
                        type="button"
                      >
                        <Icon name="arrow" size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="system-activity-empty">
            <Icon name="activity" size={28} />
            <strong>{messages.operations.empty}</strong>
            <p>{messages.operations.emptyHint}</p>
          </div>
        )}
      </section>

      {selectedId ? (
        <ActivityDrawer
          canRetry={hasPermission('platform', 'edit')}
          eventId={selectedId}
          onClose={() => setSelectedId(null)}
          onRetried={() => {
            setSelectedId(null);
            reload();
          }}
          token={token}
        />
      ) : null}
    </div>
  );
}

function ActivitySummary({
  loading,
  telemetry,
}: {
  loading: boolean;
  telemetry: IntegrationEventTelemetry | null;
}) {
  const cards = [
    [messages.operations.completed, telemetry?.completed ?? 0, 'is-positive'],
    [messages.operations.inProgress, (telemetry?.pending ?? 0) + (telemetry?.published ?? 0), ''],
    [messages.operations.needsAttention, telemetry?.deadLetter ?? 0, 'is-warning'],
    [messages.operations.failedSteps, telemetry?.failedDeliveries ?? 0, ''],
  ] as const;
  return (
    <section aria-label={messages.operations.summary} className="system-activity-summary">
      {cards.map(([label, value, tone]) => (
        <article className={tone} key={label}>
          <span>{label}</span>
          <strong>{loading ? '—' : value}</strong>
        </article>
      ))}
    </section>
  );
}

function ActivityDrawer({
  canRetry,
  eventId,
  onClose,
  onRetried,
  token,
}: {
  canRetry: boolean;
  eventId: string;
  onClose: () => void;
  onRetried: () => void;
  token: string;
}) {
  const [event, setEvent] = useState<IntegrationEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let active = true;
    void getIntegrationEvent(token, eventId)
      .then((value) => {
        if (active) setEvent(value);
      })
      .catch(() => {
        if (active) setError(messages.operations.detailError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId, token]);

  async function retry() {
    if (!event) return;
    setRetrying(true);
    setError('');
    try {
      await replayIntegrationEvent(token, crypto.randomUUID(), event);
      onRetried();
    } catch {
      setError(messages.operations.retryError);
      setRetrying(false);
      setConfirming(false);
    }
  }

  return (
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label={messages.operations.close}
        className="security-drawer-scrim"
        onClick={onClose}
        type="button"
      />
      <aside aria-label={messages.operations.details} className="security-drawer" role="dialog">
        <header>
          <div>
            <h2>{event ? eventLabel(event.eventType) : messages.operations.details}</h2>
            <p>{event ? shortReference(event.id) : messages.operations.loading}</p>
          </div>
          <button aria-label={messages.operations.close} onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <div className="security-drawer-body system-activity-detail">
          {loading ? <ActivityLoading /> : null}
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          {event ? (
            <>
              <div className="system-activity-detail-heading">
                <StatusBadge status={event.status} />
                <span>{messages.operations.lastUpdated(dateTime(lastEventDate(event)))}</span>
              </div>
              <dl className="system-activity-facts">
                <div>
                  <dt>{messages.operations.received}</dt>
                  <dd>{dateTime(event.occurredAt)}</dd>
                </div>
                <div>
                  <dt>{messages.operations.requestReference}</dt>
                  <dd>{event.correlationId}</dd>
                </div>
                <div>
                  <dt>{messages.operations.sequence}</dt>
                  <dd>{event.sequenceNumber}</dd>
                </div>
                <div>
                  <dt>{messages.operations.attempts}</dt>
                  <dd>{event.attemptCount}</dd>
                </div>
              </dl>
              <section className="system-activity-deliveries">
                <h3>{messages.operations.deliverySteps}</h3>
                {event.deliveries.length ? (
                  event.deliveries.map((delivery) => (
                    <DeliveryRow delivery={delivery} key={delivery.consumer} />
                  ))
                ) : (
                  <p>{messages.operations.noDeliverySteps}</p>
                )}
              </section>
              {event.status === 'dead_letter' && canRetry ? (
                <div className="system-activity-recovery">
                  <strong>{messages.operations.retryTitle}</strong>
                  <p>{messages.operations.retryHint}</p>
                  {confirming ? (
                    <div>
                      <Button disabled={retrying} onClick={() => void retry()}>
                        {retrying ? messages.operations.retrying : messages.operations.confirmRetry}
                      </Button>
                      <Button
                        disabled={retrying}
                        onClick={() => setConfirming(false)}
                        variant="secondary"
                      >
                        {messages.operations.cancel}
                      </Button>
                    </div>
                  ) : (
                    <Button onClick={() => setConfirming(true)} variant="secondary">
                      {messages.operations.retry}
                    </Button>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function DeliveryRow({ delivery }: { delivery: IntegrationDeliverySummary }) {
  return (
    <article>
      <span className={`delivery-node delivery-node--${delivery.status}`} aria-hidden="true" />
      <div>
        <strong>{consumerLabel(delivery.consumer)}</strong>
        <span>{statusLabel(delivery.status)}</span>
      </div>
      <small>{messages.operations.deliveryAttempts(delivery.attemptCount)}</small>
    </article>
  );
}

function StatusBadge({
  status,
}: {
  status: IntegrationDeliverySummary['status'] | IntegrationEventStatus;
}) {
  return <span className={`system-status system-status--${status}`}>{statusLabel(status)}</span>;
}

function ActivityLoading() {
  return (
    <div aria-label={messages.operations.loading} className="system-activity-loading" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}

function eventLabel(type: string): string {
  if (type === 'inventory.low_stock.detected') return messages.operations.lowStock;
  return type
    .split(/[._-]/u)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

function consumerLabel(consumer: string): string {
  return consumer === 'notifications.low-stock'
    ? messages.operations.inAppAlert
    : messages.operations.delivery;
}

function statusLabel(
  status: IntegrationDeliverySummary['status'] | IntegrationEventStatus,
): string {
  return messages.operations.statuses[status];
}

function shortReference(value: string): string {
  return messages.operations.reference(value.slice(0, 8).toUpperCase());
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function lastEventDate(event: IntegrationEventDetail): string {
  return event.completedAt ?? event.deadLetteredAt ?? event.publishedAt ?? event.occurredAt;
}
