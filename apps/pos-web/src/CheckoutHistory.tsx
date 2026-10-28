import { useEffect, useState } from 'react';
import type { PosSale } from '@vista/contracts';
import { findPosCheckout } from './api/pos';
import {
  readCheckout,
  readCheckoutHistory,
  watchCheckouts,
  type CheckoutEvent,
  type SavedCheckout,
} from './checkout-store';
import { getPosDateLocale, useLocalization } from './i18n/LocalizationProvider';
import { CheckoutReference } from './CheckoutReference';
import { readOfflineFiscalSales, type SavedOfflineFiscalSale } from './offline-store';

const labels: Record<CheckoutEvent['kind'], string> = {
  saved: 'Checkout saved',
  retry: 'Retry requested',
  interrupted: 'Confirmation interrupted',
  confirmed: 'Sale confirmed',
  rejected: 'Checkout declined',
};

export function CheckoutHistory({
  accountId,
  token,
  onBack,
  onReceipt,
  onRecoveryContainer,
}: {
  accountId: string;
  token: string;
  onBack: () => void;
  onReceipt: (sale: PosSale) => void;
  onRecoveryContainer: (container: HTMLDivElement | null) => void;
}) {
  const [events, setEvents] = useState<CheckoutEvent[]>([]);
  const [pending, setPending] = useState<SavedCheckout>();
  const [offlineSales, setOfflineSales] = useState<SavedOfflineFiscalSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string>();
  const { locale } = useLocalization();
  useEffect(() => {
    let active = true;
    let revision = 0;
    const load = async () => {
      const request = ++revision;
      try {
        const [saved, history, fiscalSales] = await Promise.all([
          readCheckout(accountId),
          readCheckoutHistory(accountId),
          readOfflineFiscalSales(accountId),
        ]);
        if (!active || request !== revision) return;
        setPending(saved);
        setEvents(history);
        setOfflineSales(fiscalSales);
        setError('');
      } catch {
        if (active) setError('Saved checkouts could not be read. Allow site storage, then reload.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const stop = watchCheckouts(() => void load());
    const refreshTimer = window.setInterval(() => void load(), 5000);
    return () => {
      active = false;
      stop();
      window.clearInterval(refreshTimer);
    };
  }, [accountId]);

  async function view(transactionId: string) {
    setOpening(transactionId);
    try {
      const sale = await findPosCheckout(token, transactionId);
      if (sale) onReceipt(sale);
      else
        setError(
          'This receipt is not available for your account. Check Sale history or contact your manager.',
        );
    } catch {
      setError('The receipt could not be opened. Check your connection and try again.');
    } finally {
      setOpening(undefined);
    }
  }

  return (
    <div className="pos-register-page pos-checkout-history">
      <header className="pos-page-heading">
        <div>
          <p>Point of sale</p>
          <h1>Checkout recovery</h1>
          <span>Saved checkouts and recent activity for your account on this browser.</span>
        </div>
        <button
          className="pos-secondary-button"
          type="button"
          onClick={onBack}
          aria-label="Back to sale"
        >
          ← Back
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {loading ? (
        <p role="status">Loading saved checkouts…</p>
      ) : (
        <>
          <section className="pos-recovery-summary" aria-label="Pending checkout">
            <div className="pos-recovery-slot" ref={onRecoveryContainer} />
            {!pending ? (
              <>
                <h2>No pending checkouts</h2>
                <p>Your account has no saved checkout waiting for confirmation on this browser.</p>
              </>
            ) : null}
            {pending ? (
              <dl>
                <div>
                  <dt>Saved</dt>
                  <dd>{formatDate(pending.savedAt)}</dd>
                </div>
                <div>
                  <dt>Reference</dt>
                  <dd>
                    <CheckoutReference value={pending.request.clientTransactionId} />
                  </dd>
                </div>
              </dl>
            ) : null}
            {pending ? <p>Keep this browser’s site data until the sale is confirmed.</p> : null}
          </section>
          {offlineSales.length ? (
            <section className="pos-recovery-events" aria-label="Offline fiscal sales">
              <header>
                <h2>Offline sales</h2>
                <p>
                  {locale === 'bg'
                    ? 'Отпечатаните бележки от DATECS се пазят тук, докато сървърът ги потвърди.'
                    : 'Printed DATECS receipts are saved here until the server confirms them.'}
                </p>
              </header>
              <ol>
                {[...offlineSales].reverse().map((sale) => (
                  <li key={sale.id}>
                    <div>
                      <strong>{offlineStatusLabel(sale.status, locale)}</strong>
                      <span>
                        {sale.fiscalDocumentNumber
                          ? locale === 'bg'
                            ? `Бележка №${sale.fiscalDocumentNumber}`
                            : `Receipt ${sale.fiscalDocumentNumber}`
                          : sale.status === 'printing' || sale.status === 'receipt_unknown'
                            ? locale === 'bg'
                              ? 'Необходимо е потвърждение от устройството'
                              : 'Printer confirmation required'
                            : locale === 'bg'
                              ? 'Бележката още не е записана'
                              : 'Receipt not yet recorded'}
                      </span>
                      <time dateTime={sale.createdAt}>{formatDate(sale.createdAt)}</time>
                      <CheckoutReference value={sale.uniqueSaleId} />
                      {sale.saleNumber ? <span>{sale.saleNumber}</span> : null}
                      {sale.lastError ? (
                        <p role={sale.status === 'conflict' ? 'alert' : undefined}>
                          {sale.lastError}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <section className="pos-recovery-events" aria-label="Recent checkout activity">
            <header>
              <h2>Recent activity</h2>
              <p>Latest 50 events. Confirmed receipts remain in Sale history.</p>
            </header>
            {!events.length ? (
              <p className="pos-recovery-empty">No checkout activity has been saved here yet.</p>
            ) : (
              <ol>
                {events.map((event, index) => (
                  <li key={`${event.transactionId}-${event.occurredAt}-${index}`}>
                    <div>
                      <strong>{labels[event.kind]}</strong>
                      {event.saleNumber ? <span>{event.saleNumber}</span> : null}
                      <time dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
                      {!event.saleNumber ? <CheckoutReference value={event.transactionId} /> : null}
                    </div>
                    {event.kind === 'confirmed' ? (
                      <button
                        className="pos-secondary-button"
                        type="button"
                        disabled={Boolean(opening)}
                        onClick={() => void view(event.transactionId)}
                      >
                        {opening === event.transactionId ? 'Opening…' : 'View receipt'}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function offlineStatusLabel(status: SavedOfflineFiscalSale['status'], locale: 'bg' | 'en'): string {
  const bulgarian: Record<SavedOfflineFiscalSale['status'], string> = {
    cancelled: 'Не е издадена бележка',
    conflict: 'Нужна е проверка',
    printing: 'Проверете фискалното устройство',
    receipt_confirmed: 'Чака синхронизация',
    receipt_unknown: 'Проверете фискалното устройство',
    synced: 'Записано в История на продажбите',
    syncing: 'Синхронизиране',
  };
  if (locale === 'bg') return bulgarian[status];
  switch (status) {
    case 'cancelled':
      return 'No receipt issued';
    case 'conflict':
      return 'Needs review';
    case 'printing':
    case 'receipt_unknown':
      return 'Check the printer';
    case 'receipt_confirmed':
      return 'Waiting to sync';
    case 'syncing':
      return 'Syncing';
    case 'synced':
      return 'Recorded in Sale history';
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(getPosDateLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sofia',
  }).format(new Date(value));
}
