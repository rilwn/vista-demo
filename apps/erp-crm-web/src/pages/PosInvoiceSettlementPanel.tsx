import type { PosInvoiceSettlement } from '@vista/contracts';
import { Button, InlineAlert } from '@vista/ui';
import {
  formatOperationsCurrency,
  formatOperationsDate,
  useLocalization,
} from '../i18n/LocalizationProvider';
import { useRouter } from '../routing/Router';
import { posInvoiceMessages } from './pos-invoice.messages';
import { posRefundMessages } from './pos-refund.messages';

export function PosInvoiceSettlementPanel({
  settlement,
  customerId,
  documentId,
}: {
  settlement: PosInvoiceSettlement;
  customerId: string;
  documentId: string;
}) {
  const { locale } = useLocalization();
  const copy = posInvoiceMessages(locale);
  const { navigate } = useRouter();
  const money = (amount: string) => formatOperationsCurrency(amount, settlement.currencyCode);
  const status = {
    paid: copy.paid,
    partially_paid: copy.partial,
    unpaid: copy.unpaid,
    overdue: copy.overdue,
    needs_review: copy.review,
    refund_due: posRefundMessages(locale).pending,
  }[settlement.status];
  const method = {
    cash: copy.cash,
    card: copy.card,
    advance: copy.advance,
    on_account: copy.onAccount,
  };
  const tiles = [
    [copy.original, settlement.originalTotal],
    [copy.checkout, settlement.paidAtCheckout],
    [copy.deferred, settlement.deferredAtCheckout],
    [copy.outstanding, settlement.outstandingTotal],
  ] as const;
  return (
    <section
      className="financial-document-preview-section pos-invoice-settlement"
      aria-label={copy.title}
    >
      <header>
        <div>
          <h3>{copy.title}</h3>
          <p>{copy.description}</p>
        </div>
        <span
          className={`finance-status is-${settlement.status === 'needs_review' ? 'overdue' : settlement.status}`}
        >
          {status}
        </span>
      </header>
      <p className="pos-invoice-receipt-reference">
        {settlement.saleNumber} · {settlement.receiptNumber}
      </p>
      {settlement.status === 'needs_review' ? (
        <InlineAlert tone="warning">{copy.reviewHelp}</InlineAlert>
      ) : null}
      <dl className="pos-invoice-balances">
        {tiles.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{money(value)}</dd>
          </div>
        ))}
      </dl>
      {settlement.dueOn ? (
        <p>
          {copy.due}:{' '}
          {formatOperationsDate(new Date(`${settlement.dueOn}T00:00:00Z`), { dateStyle: 'medium' })}
        </p>
      ) : null}
      {Number(settlement.collectedTotal ?? '0') > 0 ? (
        <p>
          <strong>
            {copy.collected}: {money(settlement.collectedTotal!)}
          </strong>
        </p>
      ) : null}
      <div className="pos-invoice-payment-table">
        <table>
          <thead>
            <tr>
              <th>{copy.method}</th>
              <th>{copy.amount}</th>
              <th>{copy.refunded}</th>
            </tr>
          </thead>
          <tbody>
            {settlement.payments.map((payment) => (
              <tr key={payment.id}>
                <th scope="row">{method[payment.method]}</th>
                <td>{money(payment.amount)}</td>
                <td>{money(payment.refundedAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pos-invoice-mobile-payments">
        {settlement.payments.map((payment) => (
          <div key={payment.id}>
            <h4>{method[payment.method]}</h4>
            <dl>
              <div>
                <dt>{copy.amount}</dt>
                <dd>{money(payment.amount)}</dd>
              </div>
              <div>
                <dt>{copy.refunded}</dt>
                <dd>{money(payment.refundedAmount)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      {Number(settlement.deferredAtCheckout) > 0 ? (
        <div className="pos-invoice-account-link">
          <p>{copy.deferredHelp}</p>
          <Button
            variant="secondary"
            onClick={() =>
              navigate('/modules/erp.finance/customer-accounts', {
                state: { customerPartnerId: customerId, returnToFinancialDocumentId: documentId },
              })
            }
          >
            {copy.openAccount}
          </Button>
        </div>
      ) : null}
      {settlement.returnCount > 0 ? (
        <div className="pos-invoice-returns">
          <header>
            <h4>{copy.returns}</h4>
            <span>{settlement.returnState === 'full' ? copy.fullReturn : copy.partialReturn}</span>
          </header>
          <dl className="pos-invoice-balances">
            {[
              [copy.refunds, settlement.refundedTotal],
              [copy.released, settlement.deferredReleased],
              [copy.netPaid, settlement.netPaidTotal],
              [copy.net, settlement.netSaleTotal],
              [posRefundMessages(locale).due, settlement.refundDue ?? '0'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{money(value!)}</dd>
              </div>
            ))}
          </dl>
          <p>{copy.returnHelp}</p>
          <ul>
            {settlement.returns.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.number}</strong>
                  <small>
                    {formatOperationsDate(new Date(item.completedAt), { dateStyle: 'medium' })}
                  </small>
                </div>
                <strong>{money(item.amount)}</strong>
              </li>
            ))}
          </ul>
          {settlement.returnCount > settlement.returns.length ? <p>{copy.first50}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
