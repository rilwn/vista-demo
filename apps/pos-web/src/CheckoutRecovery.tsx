import type { PosSale } from '@vista/contracts';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { completePosSale, findPosCheckout } from './api/pos';
import {
  clearCheckout,
  readCheckout,
  recordCheckoutAttempt,
  watchCheckouts,
  type SavedCheckout,
} from './checkout-store';
import { definitelyRejected } from './checkout-recovery';

export function CheckoutRecovery({
  accountId,
  token,
  refresh,
  onBlocked,
  onRecovered,
  onPending,
  paused = false,
  container,
}: {
  accountId: string;
  token: string;
  refresh: number;
  onBlocked: (blocked: boolean) => void;
  onRecovered: (sale: PosSale) => void;
  onPending?: (count: number | undefined) => void;
  paused?: boolean;
  container?: HTMLElement | null;
}) {
  const [pending, setPending] = useState<SavedCheckout>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [revision, setRevision] = useState(0);
  const operation = useRef(false);
  const errorBelongsToPending = useRef(false);
  const callbacks = useRef({ onBlocked, onRecovered, onPending });
  callbacks.current = { onBlocked, onRecovered, onPending };
  useEffect(() => watchCheckouts(() => setRevision((value) => value + 1)), []);

  useEffect(() => {
    let active = true;
    void readCheckout(accountId)
      .then((saved) => {
        if (!active) return;
        if (!saved && errorBelongsToPending.current) setError('');
        setPending((current) =>
          current?.request.clientTransactionId === saved?.request.clientTransactionId
            ? current
            : saved,
        );
        callbacks.current.onBlocked(Boolean(saved));
        callbacks.current.onPending?.(saved ? 1 : 0);
      })
      .catch(() => {
        if (!active) return;
        errorBelongsToPending.current = false;
        setError('Checkout storage is unavailable. Allow site storage, then reload Vista POS.');
        callbacks.current.onBlocked(true);
        callbacks.current.onPending?.(undefined);
      });
    return () => {
      active = false;
    };
  }, [accountId, refresh, revision]);

  useEffect(() => {
    setChecked(false);
    if (!pending || paused) return;
    let active = true;
    let running = false;
    const check = async () => {
      if (running || operation.current) return;
      running = true;
      operation.current = true;
      try {
        const sale = await findPosCheckout(token, pending.request.clientTransactionId);
        if (!active) return;
        if (sale) {
          await clearCheckout(accountId, pending.request.clientTransactionId, {
            kind: 'confirmed',
            saleNumber: sale.saleNumber,
          });
          if (!active) return;
          setPending(undefined);
          setError('');
          callbacks.current.onBlocked(false);
          callbacks.current.onRecovered(sale);
        } else {
          errorBelongsToPending.current = true;
          setChecked(true);
          setError(
            'The server has not confirmed this sale. Retry the saved checkout to finish it.',
          );
        }
      } catch {
        if (active) {
          errorBelongsToPending.current = true;
          setError('Waiting for a connection. This checkout is saved on this device.');
        }
      } finally {
        running = false;
        operation.current = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 10000);
    const onOnline = () => void check();
    window.addEventListener('online', onOnline);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [accountId, pending, token, paused]);

  async function retry() {
    if (!pending || busy || operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      const existing = await findPosCheckout(token, pending.request.clientTransactionId);
      if (!existing)
        await recordCheckoutAttempt(accountId, pending.request.clientTransactionId, 'retry');
      const sale =
        existing ??
        (await completePosSale(token, pending.request, pending.request.clientTransactionId));
      await clearCheckout(accountId, pending.request.clientTransactionId, {
        kind: 'confirmed',
        saleNumber: sale.saleNumber,
      });
      setPending(undefined);
      setError('');
      callbacks.current.onBlocked(false);
      callbacks.current.onRecovered(sale);
    } catch (caught) {
      errorBelongsToPending.current = false;
      if (definitelyRejected(caught)) {
        try {
          await clearCheckout(accountId, pending.request.clientTransactionId, { kind: 'rejected' });
        } catch {
          setError(
            'This checkout could not be updated on this device. Allow site storage, then reload.',
          );
          return;
        }
        setPending(undefined);
        callbacks.current.onBlocked(false);
      } else
        await recordCheckoutAttempt(
          accountId,
          pending.request.clientTransactionId,
          'interrupted',
        ).catch(() => undefined);
      setError(caught instanceof Error ? caught.message : 'Unable to confirm this checkout.');
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  if (paused || (!pending && !error)) return null;
  const notice = (
    <div className="pos-recovery" role="status">
      <div>
        <strong>{pending ? '1 checkout awaiting confirmation' : 'Checkout needs attention'}</strong>
        <p>{error || 'Checking the saved checkout…'}</p>
        {pending ? (
          <small>
            Saved{' '}
            {new Intl.DateTimeFormat('en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Europe/Sofia',
            }).format(new Date(pending.savedAt))}{' '}
            · Reference {pending.request.clientTransactionId.slice(0, 8)}
          </small>
        ) : null}
      </div>
      {pending ? (
        <button
          className="pos-secondary-button"
          disabled={busy || !checked}
          onClick={() => void retry()}
          type="button"
        >
          {busy ? 'Checking…' : 'Retry saved checkout'}
        </button>
      ) : (
        <button className="pos-secondary-button" onClick={() => setError('')} type="button">
          Dismiss
        </button>
      )}
    </div>
  );
  return container ? createPortal(notice, container) : notice;
}
