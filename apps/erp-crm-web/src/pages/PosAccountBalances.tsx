import type {
  CustomerPaymentAccount,
  PosAccountReceivable,
  PosAccountPayment,
  CustomerAdvancePaymentMethod,
  PosAccountReturnCredit,
} from '@vista/contracts';
import { Button, InlineAlert } from '@vista/ui';
import { useMemo, useState, type FormEvent } from 'react';
import { ApiClientError } from '../api/client';
import {
  collectPosAccountPayment,
  reversePosAccountPayment,
  getCustomerPaymentAccount,
} from '../api/finance';
import {
  formatOperationsCurrency,
  formatOperationsDate,
  useLocalization,
} from '../i18n/LocalizationProvider';
import { useRouter } from '../routing/Router';
import { DocumentDrawer } from './FinancialDocumentDrawer';
import { posAccountMessages } from './pos-account.messages';
import './pos-account.css';
import { PosAccountReturnCredits } from './PosAccountReturnCredits';
import { posRefundMessages } from './pos-refund.messages';
const money = (value: string) => formatOperationsCurrency(value, 'EUR');
const date = (value: string) =>
  formatOperationsDate(new Date(`${value}T12:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });

export function PosAccountBalances({
  records,
  canCollect,
  canReverse,
  onCollect,
  onReverse,
  customerId,
  onRefund,
}: {
  records: PosAccountReceivable[];
  canCollect: boolean;
  canReverse: boolean;
  onCollect: (sale: PosAccountReceivable) => void;
  onReverse: (sale: PosAccountReceivable, payment: PosAccountPayment) => void;
  customerId: string;
  onRefund: (sale: PosAccountReceivable, credit: PosAccountReturnCredit) => void;
}) {
  const { locale } = useLocalization(),
    copy = posAccountMessages(locale),
    { navigate } = useRouter();
  return (
    <section className="customer-account-section pos-account-balances" aria-label={copy.title}>
      <header>
        <div>
          <h3>{copy.title}</h3>
          <p>{copy.description}</p>
        </div>
        <strong>{records.length}</strong>
      </header>
      {records.length ? (
        records.map((sale) => (
          <article className="pos-account-sale" key={sale.saleId}>
            <header>
              <div>
                <h4>{sale.saleNumber}</h4>
                <p>{sale.receiptNumber}</p>
                <small>
                  {copy.due}: {date(sale.dueOn)}
                </small>
              </div>
              <span className={`finance-status is-${sale.status}`}>
                {sale.status === 'paid' ? copy.paidStatus : copy[sale.status]}
              </span>
            </header>
            <dl className="pos-account-amounts">
              {[
                [copy.original, sale.originalTotal],
                [copy.returned, sale.returnCredit],
                [copy.paid, sale.paidTotal],
                [copy.balance, sale.outstandingTotal],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{money(value!)}</dd>
                </div>
              ))}
            </dl>
            <div className="pos-account-sale-actions">
              {canCollect && Number(sale.outstandingTotal) > 0 ? (
                <Button onClick={() => onCollect(sale)}>{copy.collect}</Button>
              ) : null}
              {sale.invoice ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    navigate('/modules/erp.finance/invoices', {
                      state: { financialDocumentId: sale.invoice!.id },
                    })
                  }
                >
                  {copy.openInvoice}
                </Button>
              ) : null}
            </div>
            {sale.payments.length ? (
              <div className="pos-account-history">
                <h5>{copy.history}</h5>
                {sale.payments.map((payment) => (
                  <article key={payment.id}>
                    <div>
                      <strong>{payment.number}</strong>
                      <small>
                        {copy[payment.paymentMethod]} · {date(payment.paymentDate)}
                      </small>
                      {payment.paymentReference ? <small>{payment.paymentReference}</small> : null}
                      {payment.reversal ? (
                        <small>
                          {copy.reversed} · {payment.reversal.number} · {payment.reversal.reason}
                        </small>
                      ) : null}
                    </div>
                    <strong>{money(payment.amount)}</strong>
                    {canReverse &&
                    !payment.reversal &&
                    !sale.returnCredits?.some((credit) => Number(credit.refundableTotal) > 0) ? (
                      <Button variant="quiet" onClick={() => onReverse(sale, payment)}>
                        {copy.reverse}
                      </Button>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
            {sale.returnCredits?.length ? (
              <PosAccountReturnCredits
                customerId={customerId}
                credits={sale.returnCredits}
                onRefund={(credit) => onRefund(sale, credit)}
              />
            ) : null}
          </article>
        ))
      ) : (
        <p className="customer-account-empty">{copy.empty}</p>
      )}
    </section>
  );
}

export function PosAccountPaymentPanel({
  account,
  sale,
  businessTimezone,
  payment,
  token,
  onBack,
  onSaved,
}: {
  account: CustomerPaymentAccount;
  businessTimezone: string;
  sale: PosAccountReceivable;
  payment?: PosAccountPayment;
  token: string;
  onBack: () => void;
  onSaved: (account: CustomerPaymentAccount, notice: string) => void;
}) {
  const { locale } = useLocalization(),
    copy = posAccountMessages(locale);
  const [amount, setAmount] = useState(sale.outstandingTotal),
    [method, setMethod] = useState<CustomerAdvancePaymentMethod>('bank_transfer');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [paymentDate, setDate] = useState(today),
    [reference, setReference] = useState(''),
    [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const key = useMemo(() => crypto.randomUUID(), [amount, method, paymentDate, reference, reason]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) return;
    const normalized = amount.trim().replace(',', '.');
    if (!payment && (!/^\d+(\.\d{1,4})?$/u.test(normalized) || Number(normalized) <= 0)) {
      setError(copy.invalid);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = payment
        ? await reversePosAccountPayment(
            token,
            account.customerPartnerId,
            sale.saleId,
            payment.id,
            key,
            { reason, expectedOutstanding: sale.outstandingTotal },
          )
        : await collectPosAccountPayment(token, account.customerPartnerId, sale.saleId, key, {
            amount: normalized,
            expectedOutstanding: sale.outstandingTotal,
            paymentDate,
            paymentMethod: method,
            ...(reference.trim() ? { paymentReference: reference.trim() } : {}),
          });
      onSaved(result, payment ? copy.reversalSaved : copy.saved);
    } catch (cause) {
      const messages: Record<string, string> = {
        POS_ACCOUNT_BALANCE_CHANGED: copy.changed,
        POS_ACCOUNT_PAYMENT_EXCEEDS_BALANCE: copy.exceeded,
        POS_ACCOUNT_PAYMENT_DATE_INVALID: copy.dateError,
        FINANCE_PAYMENT_ALREADY_REVERSED: copy.alreadyReversed,
        FINANCE_PAYMENT_REVERSAL_REASON_REQUIRED: copy.reasonHelp,
        POS_ACCOUNT_PAYMENT_RETURNED: posRefundMessages(locale).returnedPayment,
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
      title={payment ? copy.reverse : copy.collect}
      subtitle={`${account.customerName} · ${sale.saleNumber}`}
      onBack={onBack}
      className="pos-account-payment-drawer"
    >
      <form className="pos-account-payment-form" onSubmit={(event) => void submit(event)}>
        <div className="pos-account-payment-scroll">
          {error ? (
            <InlineAlert tone="error">
              {error}
              <Button disabled={busy} variant="quiet" onClick={() => void refresh()}>
                {copy.refresh}
              </Button>
            </InlineAlert>
          ) : null}
          <section className="pos-account-payment-card">
            <p>{payment ? copy.reverseHelp : copy.paymentHelp}</p>
            <dl className="pos-account-amounts">
              <div>
                <dt>{copy.balance}</dt>
                <dd>{money(sale.outstandingTotal)}</dd>
              </div>
              {payment ? (
                <div>
                  <dt>{payment.number}</dt>
                  <dd>{money(payment.amount)}</dd>
                </div>
              ) : null}
            </dl>
          </section>
          <section className="pos-account-payment-card">
            <div className="pos-account-payment-fields">
              {payment ? (
                <label className="pos-account-full">
                  <span>{copy.reason}</span>
                  <textarea
                    aria-label={copy.reason}
                    aria-describedby="pos-payment-reversal-help"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    minLength={10}
                    maxLength={1000}
                    required
                    disabled={busy}
                  />
                  <small id="pos-payment-reversal-help">{copy.reasonHelp}</small>
                </label>
              ) : (
                <>
                  <label>
                    <span>{copy.amount}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.0001"
                      step="0.0001"
                      max={sale.outstandingTotal}
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      required
                      disabled={busy}
                    />
                  </label>
                  <label>
                    <span>{copy.date}</span>
                    <input
                      type="date"
                      value={paymentDate}
                      max={today}
                      onChange={(event) => setDate(event.target.value)}
                      required
                      disabled={busy}
                    />
                  </label>
                  <label>
                    <span>{copy.method}</span>
                    <select
                      value={method}
                      onChange={(event) =>
                        setMethod(event.target.value as CustomerAdvancePaymentMethod)
                      }
                      disabled={busy}
                    >
                      {(['bank_transfer', 'cash', 'card', 'pos_terminal'] as const).map((item) => (
                        <option key={item} value={item}>
                          {copy[item]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{copy.reference}</span>
                    <input
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      maxLength={255}
                      disabled={busy}
                    />
                  </label>
                </>
              )}
            </div>
          </section>
          <label className="pos-account-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={busy}
              required
            />
            <span>{copy.confirm}</span>
          </label>
        </div>
        <footer className="pos-account-payment-actions">
          <Button variant="secondary" onClick={onBack} disabled={busy}>
            {copy.back}
          </Button>
          <Button type="submit" disabled={busy || !confirmed}>
            {busy ? copy.saving : payment ? copy.reverse : copy.save}
          </Button>
        </footer>
      </form>
    </DocumentDrawer>
  );
}
