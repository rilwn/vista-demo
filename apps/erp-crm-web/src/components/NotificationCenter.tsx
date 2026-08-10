import type { NotificationMessage, NotificationPage } from '@vista/contracts';
import { useEffect, useState } from 'react';

import { ApiClientError } from '../api/client';
import { listNotifications, markNotificationRead } from '../api/notifications';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from './Icon';

export function NotificationCenter() {
  const { session } = useAuth();
  const [data, setData] = useState<NotificationPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const token = session?.sessionToken;

  useEffect(() => {
    if (!open || !token) return;
    let active = true;
    setLoading(true);
    setError(null);
    void listNotifications(token)
      .then((page) => {
        if (active) setData(page);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof ApiClientError
              ? caught.message
              : 'Notifications could not be loaded right now.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, token]);

  if (!session) return null;
  const sessionToken = session.sessionToken;

  async function read(notification: NotificationMessage) {
    if (notification.readAt) return;
    try {
      const updated = await markNotificationRead(sessionToken, notification.id);
      setData((current) =>
        current
          ? {
              items: current.items.map((item) => (item.id === updated.id ? updated : item)),
              unreadCount: Math.max(0, current.unreadCount - 1),
            }
          : current,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The notification could not be marked as read.',
      );
    }
  }

  return (
    <div className="notification-center">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Open notifications"
        className="notification-trigger"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Icon name="bell" size={18} />
        {data?.unreadCount ? <span className="notification-count">{data.unreadCount}</span> : null}
      </button>
      {open ? (
        <section aria-label="Notifications" className="notification-panel" role="dialog">
          <header>
            <div>
              <h2>Notifications</h2>
            </div>
            <button aria-label="Close notifications" onClick={() => setOpen(false)} type="button">
              <Icon name="close" size={17} />
            </button>
          </header>
          {loading ? <p className="notification-state">Loading notifications…</p> : null}
          {error ? <p className="notification-state is-error">{error}</p> : null}
          {!loading && !error && data?.items.length === 0 ? (
            <p className="notification-state">You are up to date.</p>
          ) : null}
          {!loading && !error && data ? (
            <ul>
              {data.items.map((notification) => (
                <li className={notification.readAt ? 'is-read' : 'is-unread'} key={notification.id}>
                  <button onClick={() => void read(notification)} type="button">
                    <span className="notification-dot" aria-hidden="true" />
                    <span>
                      <strong>{notificationTitle(notification)}</strong>
                      <small>{notificationDetail(notification)}</small>
                      <time dateTime={notification.deliveredAt}>
                        {formatDate(notification.deliveredAt)}
                      </time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function notificationTitle(notification: NotificationMessage): string {
  if (notification.templateKey === 'inventory.low_stock') return 'Low stock needs attention';
  return 'New notification';
}

function notificationDetail(notification: NotificationMessage): string {
  if (notification.templateKey === 'inventory.low_stock') {
    const available = value(notification.payload, 'availableQuantity');
    const minimum = value(notification.payload, 'minimumQuantity');
    return `Available stock is ${available}; the configured minimum is ${minimum}.`;
  }
  return 'Open this notification for more details.';
}

function value(payload: Record<string, unknown>, key: string): string {
  const candidate = payload[key];
  return typeof candidate === 'string' || typeof candidate === 'number' ? String(candidate) : '—';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sofia',
  }).format(new Date(value));
}
