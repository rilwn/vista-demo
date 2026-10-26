import type { PosInvoiceSettlement } from '@vista/contracts';
import type { PoolClient } from 'pg';
import { posAccountPaymentsAggregate } from './pos-account-ledger.js';

/** One statement reads one consistent source snapshot, without creating payments or collections. */
export async function loadPosInvoiceSettlement(
  client: PoolClient,
  saleId: string,
  asOfDate: string,
): Promise<PosInvoiceSettlement | undefined> {
  const result = await client.query<{ settlement: PosInvoiceSettlement }>(
    `
    SELECT jsonb_build_object(
      'saleId',sale.id,'saleNumber',sale.sale_number,'receiptNumber',sale.fiscal_receipt_number,
      'currencyCode',sale.currency_code,'originalTotal',sale.gross_total::text,
      'paidAtCheckout',payments.paid::numeric(18,4)::text,'deferredAtCheckout',payments.deferred::numeric(18,4)::text,
      'refundedTotal',(refunds.paid+accountcredits.paid)::numeric(18,4)::text,'deferredReleased',ledger.credits::numeric(18,4)::text,
      'netPaidTotal',(payments.paid-refunds.paid+collections.collected-accountcredits.paid)::numeric(18,4)::text,
      'accountRefundedTotal',accountcredits.paid::numeric(18,4)::text,'refundDue',(accountcredits.total-accountcredits.paid)::numeric(18,4)::text,
      'collectedTotal',collections.collected::numeric(18,4)::text,'accountPayments',collections.items,
      'netSaleTotal',(sale.gross_total-returned.total)::numeric(18,4)::text,
      'outstandingTotal',(ledger.charges-ledger.credits-ledger.collected)::numeric(18,4)::text,
      'status',CASE WHEN payments.total<>sale.gross_total OR refunds.total<>returned.total
        OR payments.deferred<>ledger.charges OR refunds.deferred<>ledger.credits+accountcredits.total
        OR payments.paid-refunds.paid+ledger.charges-ledger.credits-accountcredits.total<>sale.gross_total-returned.total
        OR payments.paid<refunds.paid OR ledger.charges<ledger.credits OR returned.total>sale.gross_total
        OR payments.due_on IS DISTINCT FROM ledger.due_on
        OR ledger.collected<>collections.collected OR ledger.charges-ledger.credits<ledger.collected
        OR NOT refunds.sources_match OR NOT payments.amounts_valid THEN 'needs_review'
        WHEN accountcredits.total>accountcredits.paid THEN 'refund_due'
        WHEN ledger.charges=ledger.credits+ledger.collected THEN 'paid'
        WHEN payments.due_on<$2::date THEN 'overdue'
        WHEN payments.paid-refunds.paid+collections.collected>0 THEN 'partially_paid' ELSE 'unpaid' END,
      'returnState',CASE WHEN returned.count=0 THEN 'none' WHEN returned.total=sale.gross_total THEN 'full' ELSE 'partial' END,
      'returnCount',returned.count,'payments',payments.items,'returns',returned.items
    ) || CASE WHEN payments.due_on IS NOT NULL THEN jsonb_build_object('dueOn',payments.due_on::text) ELSE '{}'::jsonb END AS settlement
    FROM pos.sales sale
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(payment.amount),0) AS total,
        coalesce(sum(payment.amount) FILTER(WHERE payment.payment_method<>'on_account'),0) AS paid,
        coalesce(sum(payment.amount) FILTER(WHERE payment.payment_method='on_account'),0) AS deferred,
        max(payment.account_due_on) AS due_on,
        coalesce(bool_and(coalesce(refunded.amount,0)<=payment.amount AND coalesce(refunded.sources_match,true)),true) AS amounts_valid,
        coalesce(jsonb_agg(jsonb_build_object('id',payment.id,'method',payment.payment_method,'amount',payment.amount::text,
          'refundedAmount',coalesce(refunded.amount,0)::numeric(18,4)::text)
          || CASE WHEN payment.account_due_on IS NOT NULL THEN jsonb_build_object('dueOn',payment.account_due_on::text) ELSE '{}'::jsonb END
          ORDER BY payment.recorded_at,payment.id),'[]'::jsonb) AS items
      FROM pos.payments payment
      LEFT JOIN LATERAL(SELECT sum(refund.amount) AS amount,
        bool_and(returned.original_sale_id=payment.sale_id AND refund.refund_method=payment.payment_method) AS sources_match
        FROM pos.return_refunds refund JOIN pos.returns returned ON returned.id=refund.return_id
        WHERE refund.original_payment_id=payment.id) refunded ON true
      WHERE payment.sale_id=sale.id
    ) payments
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(refund.amount),0) AS total,
        coalesce(sum(refund.amount) FILTER(WHERE refund.refund_method<>'on_account'),0) AS paid,
        coalesce(sum(refund.amount) FILTER(WHERE refund.refund_method='on_account'),0) AS deferred,
        coalesce(bool_and(coalesce(original.sale_id=sale.id AND original.payment_method=refund.refund_method,false)),true) AS sources_match
      FROM pos.returns returned JOIN pos.return_refunds refund ON refund.return_id=returned.id
      LEFT JOIN pos.payments original ON original.id=refund.original_payment_id
      WHERE returned.original_sale_id=sale.id
    ) refunds
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(entry.amount) FILTER(WHERE entry.entry_type='charge'),0) AS charges,
        max(entry.due_on) FILTER(WHERE entry.entry_type='charge') AS due_on,
        coalesce(sum(entry.amount) FILTER(WHERE entry.entry_type='return_credit'),0) AS credits,
        coalesce(sum(CASE WHEN entry.entry_type='payment' THEN entry.amount
          WHEN entry.entry_type='payment_reversal' THEN -entry.amount ELSE 0 END),0) AS collected
      FROM finance.customer_account_entries entry WHERE entry.pos_sale_id=sale.id
    ) ledger
    CROSS JOIN LATERAL (${posAccountPaymentsAggregate}) collections
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(credit.refund_amount),0) AS total,
        coalesce(sum((SELECT coalesce(sum(amount),0) FROM finance.pos_account_refunds WHERE pos_return_id=credit.pos_return_id)),0) AS paid
      FROM finance.pos_account_return_credits credit JOIN pos.returns item ON item.id=credit.pos_return_id
      WHERE item.original_sale_id=sale.id
    ) accountcredits
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(item.gross_total),0) AS total,count(*)::integer AS count,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id',recent.id,'number',recent.return_number,'amount',recent.gross_total::text,'completedAt',recent.completed_at)
          ORDER BY recent.completed_at DESC,recent.id DESC) FROM (
            SELECT id,return_number,gross_total,completed_at FROM pos.returns WHERE original_sale_id=sale.id
            ORDER BY completed_at DESC,id DESC LIMIT 50
          ) recent),'[]'::jsonb) AS items
      FROM pos.returns item WHERE item.original_sale_id=sale.id
    ) returned
    WHERE sale.id=$1`,
    [saleId, asOfDate],
  );
  return result.rows[0]?.settlement;
}
