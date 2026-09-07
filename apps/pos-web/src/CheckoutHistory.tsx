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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string>();
  useEffect(() => {
    let active = true;
    let revision = 0;
    const load = async () => {
      const request = ++revision;
      try {
        const [saved, history] = await Promise.all([
          readCheckout(accountId),
          readCheckoutHistory(accountId),
        ]);
        if (!active || request !== revision) return;
        setPending(saved);
        setEvents(history);
        setError('');
      } catch {
        if (active) setError('Saved checkouts could not be read. Allow site storage, then reload.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const stop = watchCheckouts(() => void load());
    return () => {
      active = false;
      stop();
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
                  <dd>{pending.request.clientTransactionId}</dd>
                </div>
              </dl>
            ) : null}
            {pending ? <p>Keep this browser’s site data until the sale is confirmed.</p> : null}
          </section>
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
                      <span>
                        {event.saleNumber ?? `Reference ${event.transactionId.slice(0, 8)}`}
                      </span>
                      <time dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sofia',
  }).format(new Date(value));
}
