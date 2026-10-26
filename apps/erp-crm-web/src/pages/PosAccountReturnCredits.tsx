import type { PosAccountReturnCredit } from '@vista/contracts';
import { Button, InlineAlert } from '@vista/ui';
import { useRef, useState } from 'react';
import { preparePosReturnCreditNote } from '../api/finance';
import { useAuth } from '../auth/AuthProvider';
import {
  formatOperationsCurrency,
  formatOperationsDate,
  useLocalization,
} from '../i18n/LocalizationProvider';
import { useRouter } from '../routing/Router';
import { posRefundMessages } from './pos-refund.messages';

export function PosAccountReturnCredits({
  credits,
  customerId,
  onRefund,
}: {
  credits: PosAccountReturnCredit[];
  customerId: string;
  onRefund: (credit: PosAccountReturnCredit) => void;
}) {
  const { locale } = useLocalization(),
    copy = posRefundMessages(locale),
    { session, hasPermission } = useAuth(),
    { navigate } = useRouter();
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const keys = useRef(new Map<string, string>());
  const open = (id: string) =>
    navigate('/modules/erp.finance/invoices', {
      state: { financialDocumentId: id, returnToCustomerAccountId: customerId },
    });
  async function prepare(credit: PosAccountReturnCredit) {
    setBusy(credit.returnId);
    setError('');
    const key = keys.current.get(credit.returnId) ?? crypto.randomUUID();
    keys.current.set(credit.returnId, key);
    try {
      const document = await preparePosReturnCreditNote(
        session?.sessionToken ?? '',
        credit.returnId,
        key,
      );
      open(document.id);
    } catch {
      setError(copy.prepareError);
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="pos-account-return-credits" aria-label={copy.title}>
      <h5>{copy.title}</h5>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {credits.map((credit) => (
        <article key={credit.returnId} className="pos-account-return-credit">
          <header>
            <div>
              <strong>{credit.returnNumber}</strong>
              <small>
                {formatOperationsDate(new Date(`${credit.returnedOn}T12:00:00Z`), {
                  dateStyle: 'medium',
                })}
              </small>
            </div>
            <span
              className={`finance-status is-${Number(credit.refundDue) > 0 ? 'overdue' : 'paid'}`}
            >
              {Number(credit.refundDue) > 0 ? copy.pending : copy.done}
            </span>
          </header>
          <dl className="pos-account-amounts">
            {[
              [copy.returned, credit.returnTotal],
              [copy.released, credit.releasedTotal],
              [copy.repaid, credit.refundedTotal],
              [copy.due, credit.refundDue],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{formatOperationsCurrency(value!, 'EUR')}</dd>
              </div>
            ))}
          </dl>
          <div className="pos-account-sale-actions">
            {credit.creditNote ? (
              <Button variant="secondary" onClick={() => open(credit.creditNote!.id)}>
                {copy.open}
              </Button>
            ) : credit.invoice && hasPermission('erp.finance', 'create') ? (
              <Button
                disabled={Boolean(busy)}
                variant="secondary"
                onClick={() => void prepare(credit)}
              >
                {copy.prepare}
              </Button>
            ) : null}
            {Number(credit.refundDue) > 0 &&
            hasPermission('erp.finance', 'approve') &&
            (!credit.invoice || credit.creditNote?.status === 'issued') ? (
              <Button onClick={() => onRefund(credit)}>{copy.record}</Button>
            ) : null}
          </div>
          {credit.invoice && credit.creditNote?.status !== 'issued' ? (
            <p>
              {hasPermission('erp.finance', 'create') ? copy.creditFirst : copy.preparePermission}
            </p>
          ) : Number(credit.refundDue) > 0 && !hasPermission('erp.finance', 'approve') ? (
            <p>{copy.approveRequired}</p>
          ) : null}
          {credit.refunds.length ? (
            <div className="pos-account-history">
              <h5>{copy.history}</h5>
              {credit.refunds.map((refund) => (
                <article key={refund.number}>
                  <div>
                    <strong>{refund.number}</strong>
                    <small>
                      {copy[refund.paymentMethod]} ·{' '}
                      {formatOperationsDate(new Date(`${refund.refundedOn}T12:00:00Z`), {
                        dateStyle: 'medium',
                      })}
                    </small>
                    <small>{refund.paymentReference}</small>
                    <small>
                      {copy.allocations}:{' '}
                      {refund.payments
                        .map(
                          (payment) =>
                            `${payment.number} (${formatOperationsCurrency(payment.amount, 'EUR')})`,
                        )
                        .join(', ')}
                    </small>
                  </div>
                  <strong>{formatOperationsCurrency(refund.amount, 'EUR')}</strong>
                </article>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}
