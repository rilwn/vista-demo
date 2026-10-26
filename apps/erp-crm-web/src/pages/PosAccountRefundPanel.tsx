import type {
  CustomerPaymentAccount,
  PosAccountReceivable,
  PosAccountReturnCredit,
} from '@vista/contracts';
import { Button, InlineAlert } from '@vista/ui';
import { useMemo, useState, type FormEvent } from 'react';
import { ApiClientError } from '../api/client';
import { getCustomerPaymentAccount, recordPosAccountRefund } from '../api/finance';
import { formatOperationsCurrency, useLocalization } from '../i18n/LocalizationProvider';
import { DocumentDrawer } from './FinancialDocumentDrawer';
import { posRefundMessages } from './pos-refund.messages';
import './pos-account.css';

export function PosAccountRefundPanel({
  account,
  sale,
  credit,
  token,
  timezone,
  onBack,
  onSaved,
}: {
  account: CustomerPaymentAccount;
  sale: PosAccountReceivable;
  credit: PosAccountReturnCredit;
  token: string;
  timezone: string;
  onBack: () => void;
  onSaved: (account: CustomerPaymentAccount, notice: string) => void;
}) {
  const { locale } = useLocalization(),
    copy = posRefundMessages(locale);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [amount, setAmount] = useState(credit.refundDue),
    [date, setDate] = useState(today),
    [method, setMethod] = useState<'bank_transfer' | 'cash'>('bank_transfer');
  const [reference, setReference] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const key = useMemo(() => crypto.randomUUID(), [amount, date, method, reference]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) return;
    const normalized = amount.trim().replace(',', '.');
    if (
      !/^\d+(\.\d{1,4})?$/u.test(normalized) ||
      Number(normalized) <= 0 ||
      reference.trim().length < 3
    ) {
      setError(copy.invalid);
      return;
    }
    setBusy(true);
    setError('');
    try {
      onSaved(
        await recordPosAccountRefund(
          token,
          account.customerPartnerId,
          sale.saleId,
          credit.returnId,
          key,
          {
            amount: normalized,
            expectedRefundDue: credit.refundDue,
            refundedOn: date,
            paymentMethod: method,
            paymentReference: reference.trim(),
          },
        ),
        copy.saved,
      );
    } catch (cause) {
      const messages: Record<string, string> = {
        POS_ACCOUNT_REFUND_CHANGED: copy.changed,
        POS_ACCOUNT_REFUND_EXCEEDED: copy.exceeded,
        POS_ACCOUNT_REFUND_DATE_INVALID: copy.dateError,
        POS_ACCOUNT_REFUND_CREDIT_REQUIRED: copy.creditFirst,
      };
      setError(cause instanceof ApiClientError ? (messages[cause.code] ?? copy.error) : copy.error);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    try {
      onSaved(await getCustomerPaymentAccount(token, account.customerPartnerId), '');
    } catch {
      setError(copy.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <DocumentDrawer
      busy={busy}
      title={copy.record}
      subtitle={`${account.customerName} · ${credit.returnNumber}`}
      onBack={onBack}
      className="pos-account-payment-drawer"
    >
      <form className="pos-account-payment-form" onSubmit={(event) => void submit(event)}>
        <div className="pos-account-payment-scroll">
          {error ? (
            <InlineAlert tone="error">
              {error}
              <Button variant="quiet" disabled={busy} onClick={() => void refresh()}>
                {copy.refresh}
              </Button>
            </InlineAlert>
          ) : null}
          <section className="pos-account-payment-card">
            <p>{copy.help}</p>
            <dl className="pos-account-amounts">
              <div>
                <dt>{copy.due}</dt>
                <dd>{formatOperationsCurrency(credit.refundDue, 'EUR')}</dd>
              </div>
              <div>
                <dt>{copy.repaid}</dt>
                <dd>{formatOperationsCurrency(credit.refundedTotal, 'EUR')}</dd>
              </div>
            </dl>
          </section>
          <section className="pos-account-payment-card">
            <div className="pos-account-payment-fields">
              <label>
                <span>{copy.amount}</span>
                <input
                  required
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  min="0.0001"
                  max={credit.refundDue}
                  value={amount}
                  disabled={busy}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <label>
                <span>{copy.date}</span>
                <input
                  required
                  type="date"
                  min={credit.returnedOn}
                  max={today}
                  value={date}
                  disabled={busy}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label>
                <span>{copy.method}</span>
                <select
                  value={method}
                  disabled={busy}
                  onChange={(event) => setMethod(event.target.value as 'cash' | 'bank_transfer')}
                >
                  <option value="bank_transfer">{copy.bank_transfer}</option>
                  <option value="cash">{copy.cash}</option>
                </select>
              </label>
              <label>
                <span>{copy.reference}</span>
                <input
                  required
                  minLength={3}
                  maxLength={255}
                  value={reference}
                  disabled={busy}
                  onChange={(event) => setReference(event.target.value)}
                />
              </label>
            </div>
          </section>
          <label className="pos-account-confirm">
            <input
              required
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>{copy.confirm}</span>
          </label>
        </div>
        <footer className="pos-account-payment-actions">
          <Button variant="secondary" onClick={onBack} disabled={busy}>
            {copy.back}
          </Button>
          <Button type="submit" disabled={busy || !confirmed}>
            {busy ? copy.saving : copy.save}
          </Button>
        </footer>
      </form>
    </DocumentDrawer>
  );
}
