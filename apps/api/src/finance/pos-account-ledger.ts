import type { PosAccountReceivable } from '@vista/contracts';
import type { PoolClient } from 'pg';
import { posAccountReturnCreditsAggregate } from './pos-account-refunds.js';

// Both read models use the same original Finance payments and immutable reversals.
export const posAccountPaymentsAggregate = `
  SELECT coalesce(sum(payment.amount) FILTER(WHERE reversal.payment_id IS NULL),0) AS collected,
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',payment.id,'number',payment.payment_number,'amount',payment.amount::text,
      'paymentMethod',payment.payment_method,'paymentDate',payment.payment_date::text,
      'paymentReference',payment.payment_reference,
      'reversal',CASE WHEN reversal.payment_id IS NOT NULL THEN jsonb_build_object(
        'number',reversal.reversal_number,'reason',reversal.reason,'reversedOn',reversal.reversed_on::text) END
    )) ORDER BY payment.recorded_at,payment.id),'[]'::jsonb) AS items
  FROM finance.payments payment LEFT JOIN finance.payment_reversals reversal ON reversal.payment_id=payment.id
  WHERE payment.source_pos_sale_id=sale.id`;

export async function loadPosAccountReceivables(
  client: Pick<PoolClient, 'query'>,
  customerId: string,
  timezone: string,
): Promise<PosAccountReceivable[]> {
  const result = await client.query<{ record: PosAccountReceivable }>(
    `
    SELECT jsonb_strip_nulls(jsonb_build_object(
      'saleId',sale.id,'saleNumber',sale.sale_number,'receiptNumber',sale.fiscal_receipt_number,
      'invoice',document.link,'dueOn',charge.due_on::text,'originalTotal',charge.amount::text,
      'returnCredit',ledger.credits::numeric(18,4)::text,'paidTotal',payments.collected::numeric(18,4)::text,
      'outstandingTotal',ledger.balance::numeric(18,4)::text,
      'status',CASE WHEN ledger.balance=0 THEN 'paid'
        WHEN charge.due_on<(now() AT TIME ZONE $2)::date THEN 'overdue'
        WHEN payments.collected>0 THEN 'partially_paid' ELSE 'unpaid' END,
      'payments',payments.items
      ,'returnCredits',returncredits.items,'refundDue',(returncredits.total-returncredits.paid)::numeric(18,4)::text,
      'refundedTotal',returncredits.paid::numeric(18,4)::text
    )) AS record
    FROM finance.customer_account_entries charge JOIN pos.sales sale ON sale.id=charge.pos_sale_id
    CROSS JOIN LATERAL (SELECT
      coalesce(sum(CASE WHEN entry.entry_type IN ('charge','payment_reversal') THEN entry.amount ELSE -entry.amount END),0) AS balance,
      coalesce(sum(entry.amount) FILTER(WHERE entry.entry_type='return_credit'),0) AS credits
      FROM finance.customer_account_entries entry WHERE entry.pos_sale_id=sale.id) ledger
    CROSS JOIN LATERAL (${posAccountPaymentsAggregate}) payments
    CROSS JOIN LATERAL (${posAccountReturnCreditsAggregate}) returncredits
    LEFT JOIN LATERAL (SELECT jsonb_build_object('id',id,'number',coalesce(official_number,draft_number)) AS link
      FROM finance.financial_documents WHERE source_pos_sale_id=sale.id AND status IN ('draft','issued')
      ORDER BY created_at DESC,id DESC LIMIT 1) document ON true
    WHERE charge.customer_partner_id=$1 AND charge.entry_type='charge'
    ORDER BY charge.due_on,sale.completed_at,sale.id`,
    [customerId, timezone],
  );
  return result.rows.map((row) => row.record);
}
