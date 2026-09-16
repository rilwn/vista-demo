import type { NotificationMessage, NotificationPage } from '@vista/contracts';
import { useEffect, useState } from 'react';

import { ApiClientError } from '../api/client';
import { listNotifications, markNotificationRead } from '../api/notifications';
import { useAuth } from '../auth/AuthProvider';
import { useLocalization } from '../i18n/LocalizationProvider';
import { Icon } from './Icon';

export function NotificationCenter() {
  const { session } = useAuth();
  const { dateLocale, t } = useLocalization();
  const [data, setData] = useState<NotificationPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const token = session?.sessionToken;

  useEffect(() => {
    if (!open || !token) return;
    const activeToken = token;
    let active = true;
    let refreshing = false;

    async function refresh(initial: boolean) {
      if (refreshing) return;
      refreshing = true;
      if (initial) setLoading(true);
      try {
        const page = await listNotifications(activeToken);
        if (active) {
          setData(page);
          setError(null);
        }
      } catch (caught) {
        if (active)
          setError(
            caught instanceof ApiClientError ? caught.message : t('notifications.loadError'),
          );
      } finally {
        refreshing = false;
        if (active && initial) setLoading(false);
      }
    }

    void refresh(true);
    const interval = window.setInterval(() => void refresh(false), 5_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [open, t, token]);

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
      setError(caught instanceof ApiClientError ? caught.message : t('notifications.readError'));
    }
  }

  return (
    <div className="notification-center">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('notifications.open')}
        className="notification-trigger"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Icon name="bell" size={18} />
        {data?.unreadCount ? <span className="notification-count">{data.unreadCount}</span> : null}
      </button>
      {open ? (
        <section aria-label={t('notifications.title')} className="notification-panel" role="dialog">
          <header>
            <div>
              <h2>{t('notifications.title')}</h2>
            </div>
            <button
              aria-label={t('notifications.close')}
              onClick={() => setOpen(false)}
              type="button"
            >
              <Icon name="close" size={17} />
            </button>
          </header>
          {loading ? <p className="notification-state">{t('notifications.loading')}</p> : null}
          {error ? <p className="notification-state is-error">{error}</p> : null}
          {!loading && !error && data?.items.length === 0 ? (
            <p className="notification-state">{t('notifications.empty')}</p>
          ) : null}
          {!loading && !error && data ? (
            <ul>
              {data.items.map((notification) => (
                <li className={notification.readAt ? 'is-read' : 'is-unread'} key={notification.id}>
                  <button onClick={() => void read(notification)} type="button">
                    <span className="notification-dot" aria-hidden="true" />
                    <span>
                      <strong>{notificationTitle(notification, t)}</strong>
                      <small>{notificationDetail(notification, t, dateLocale)}</small>
                      <time dateTime={notification.deliveredAt}>
                        {formatDate(notification.deliveredAt, dateLocale)}
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

type Translator = ReturnType<typeof useLocalization>['t'];

function notificationTitle(notification: NotificationMessage, t: Translator): string {
  if (notification.templateKey === 'report.export.ready') return t('notifications.reportReady');
  if (notification.templateKey === 'inventory.low_stock') return t('notifications.lowStock');
  if (notification.templateKey === 'finance.payment.upcoming')
    return t('notifications.paymentUpcoming');
  if (notification.templateKey === 'finance.payment.overdue')
    return t('notifications.paymentOverdue');
  if (notification.templateKey === 'service.inspection.due')
    return t('notifications.inspectionDue');
  if (notification.templateKey === 'service.warranty.due') return t('notifications.warrantyDue');
  if (notification.templateKey === 'crm.ticket.sla.at_risk') return t('notifications.ticketRisk');
  if (notification.templateKey === 'crm.ticket.sla.breached')
    return t('notifications.ticketBreached');
  if (notification.templateKey === 'crm.task.reminder') return t('notifications.taskDue');
  return t('notifications.new');
}

function notificationDetail(
  notification: NotificationMessage,
  t: Translator,
  dateLocale: string,
): string {
  if (notification.templateKey === 'report.export.ready')
    return t('notifications.reportDetail', { report: value(notification.payload, 'reportName') });
  if (notification.templateKey === 'inventory.low_stock') {
    const available = value(notification.payload, 'availableQuantity');
    const minimum = value(notification.payload, 'minimumQuantity');
    return t('notifications.stockDetail', { available, minimum });
  }
  if (
    notification.templateKey === 'finance.payment.upcoming' ||
    notification.templateKey === 'finance.payment.overdue'
  ) {
    const number = value(notification.payload, 'number');
    const counterparty = value(notification.payload, 'counterpartyName');
    const amount = money(value(notification.payload, 'outstandingBgn'), dateLocale);
    const dueDate = dateValue(notification.payload, 'dueDate', dateLocale);
    return t('notifications.paymentDetail', { amount, counterparty, date: dueDate, number });
  }
  if (
    notification.templateKey === 'crm.ticket.sla.at_risk' ||
    notification.templateKey === 'crm.ticket.sla.breached'
  ) {
    const number = value(notification.payload, 'ticketNumber');
    const customer = value(notification.payload, 'customerName');
    const subject = value(notification.payload, 'subject');
    const timer = t(
      value(notification.payload, 'timerType') === 'response'
        ? 'notifications.response'
        : 'notifications.resolution',
    );
    return t('notifications.ticketDetail', { customer, number, subject, timer });
  }
  if (notification.templateKey === 'crm.task.reminder') {
    const title = value(notification.payload, 'title');
    const customer = value(notification.payload, 'customerName');
    const dueAt = dateTimeValue(notification.payload, 'dueAt', dateLocale);
    return t('notifications.taskDetail', { customer, date: dueAt, title });
  }
  if (
    notification.templateKey === 'service.inspection.due' ||
    notification.templateKey === 'service.warranty.due'
  ) {
    const device = value(notification.payload, 'deviceName');
    const serial = value(notification.payload, 'serialNumber');
    const customer = value(notification.payload, 'customerName');
    const dueDate = dateValue(notification.payload, 'dueDate', dateLocale);
    return t('notifications.serviceDetail', { customer, date: dueDate, device, serial });
  }
  return t('notifications.details');
}

function dateTimeValue(payload: Record<string, unknown>, key: string, locale: string): string {
  const candidate = payload[key];
  if (typeof candidate !== 'string') return '—';
  const date = new Date(candidate);
  return Number.isNaN(date.getTime())
    ? candidate
    : new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Sofia',
      }).format(date);
}

function dateValue(payload: Record<string, unknown>, key: string, locale: string): string {
  const candidate = payload[key];
  if (typeof candidate !== 'string') return '—';
  const date = new Date(`${candidate}T00:00:00+03:00`);
  return Number.isNaN(date.getTime())
    ? candidate
    : new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeZone: 'Europe/Sofia',
      }).format(date);
}

function money(candidate: string, locale: string): string {
  const amount = Number(candidate);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'BGN' }).format(amount)
    : 'BGN —';
}

function value(payload: Record<string, unknown>, key: string): string {
  const candidate = payload[key];
  return typeof candidate === 'string' || typeof candidate === 'number' ? String(candidate) : '—';
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sofia',
  }).format(new Date(value));
}
