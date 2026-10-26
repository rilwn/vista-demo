import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import type { CreatePosAccountRefundRequest } from '@vista/contracts';
import { decimalUnits, formatUnits as formatDecimalUnits } from '@vista/domain';
import type { PoolClient } from 'pg';
import { ApiErrorException } from '../common/api-error.exception.js';

export async function postPosAccountRefund(
  client: PoolClient,
  input: CreatePosAccountRefundRequest,
  context: {
    customerId: string;
    saleId: string;
    returnId: string;
    accountId: string;
    correlationId: string;
    timezone: string;
  },
  allocateNumber: () => Promise<string>,
) {
  const fail = (code: string, message: string): never => {
    throw new ApiErrorException(code, message, HttpStatus.CONFLICT);
  };
  const source = (
    await client.query<{ customer_partner_id: string }>(
      'SELECT customer_partner_id FROM pos.sales WHERE id=$1 FOR UPDATE',
      [context.saleId],
    )
  ).rows[0];
  if (!source || source.customer_partner_id !== context.customerId)
    fail('POS_ACCOUNT_SOURCE_INVALID', 'Choose a POS sale belonging to this customer.');
  const credit = (
    await client.query<{
      remaining: string;
      returned_on: string;
      today: string;
      invoice_id: string | null;
      credit_id: string | null;
    }>(
      `
    SELECT (credit.refund_amount-coalesce((SELECT sum(amount) FROM finance.pos_account_refunds WHERE pos_return_id=credit.pos_return_id),0))::text AS remaining,
      (returned.completed_at AT TIME ZONE $3)::date::text AS returned_on,
      (now() AT TIME ZONE $3)::date::text AS today,invoice.id AS invoice_id,note.id AS credit_id
    FROM finance.pos_account_return_credits credit JOIN pos.returns returned ON returned.id=credit.pos_return_id
    LEFT JOIN finance.financial_documents invoice ON invoice.source_pos_sale_id=returned.original_sale_id AND invoice.document_type='invoice' AND invoice.status='issued'
    LEFT JOIN finance.financial_documents note ON note.source_pos_return_id=returned.id AND note.status='issued'
    WHERE returned.id=$1 AND returned.original_sale_id=$2`,
      [context.returnId, context.saleId, context.timezone],
    )
  ).rows[0];
  if (!credit)
    return fail(
      'POS_ACCOUNT_REFUND_NOT_FOUND',
      'This return has no collected account money to repay.',
    );
  if (decimalUnits(credit.remaining, 4) !== decimalUnits(input.expectedRefundDue, 4))
    fail('POS_ACCOUNT_REFUND_CHANGED', 'The refund balance changed. Refresh before continuing.');
  if (
    decimalUnits(input.amount, 4) <= 0n ||
    decimalUnits(input.amount, 4) > decimalUnits(credit.remaining, 4)
  )
    fail(
      'POS_ACCOUNT_REFUND_EXCEEDED',
      'The repayment exceeds the amount still owed for this return.',
    );
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(input.refundedOn) ||
    !Number.isFinite(Date.parse(input.refundedOn)) ||
    new Date(input.refundedOn).toISOString().slice(0, 10) !== input.refundedOn ||
    input.refundedOn < credit.returned_on ||
    input.refundedOn > credit.today
  )
    fail(
      'POS_ACCOUNT_REFUND_DATE_INVALID',
      'Choose a repayment date between the return date and today.',
    );
  if (credit.invoice_id && !credit.credit_id)
    fail(
      'POS_ACCOUNT_REFUND_CREDIT_REQUIRED',
      'Issue the credit note linked to this return before recording its repayment.',
    );
  const payments = await client.query<{ id: string; available: string }>(
    `SELECT payment.id,
    (payment.amount-coalesce((SELECT sum(amount) FROM finance.pos_account_refund_allocations WHERE payment_id=payment.id),0))::text AS available
    FROM finance.payments payment WHERE payment.source_pos_sale_id=$1
      AND NOT EXISTS(SELECT 1 FROM finance.payment_reversals WHERE payment_id=payment.id)
    ORDER BY payment.recorded_at,payment.id FOR UPDATE OF payment`,
    [context.saleId],
  );
  let remaining = decimalUnits(input.amount, 4);
  const allocations: Array<{ id: string; amount: string }> = [];
  for (const payment of payments.rows) {
    const available = decimalUnits(payment.available, 4);
    const used = remaining < available ? remaining : available;
    if (used > 0n) allocations.push({ id: payment.id, amount: formatDecimalUnits(used, 4) });
    remaining -= used;
    if (remaining === 0n) break;
  }
  if (remaining !== 0n)
    fail(
      'POS_ACCOUNT_REFUND_SOURCE_CHANGED',
      'The original collections no longer cover this repayment. Review the account.',
    );
  const id = randomUUID(),
    number = await allocateNumber();
  await client.query(
    `INSERT INTO finance.pos_account_refunds(id,refund_number,pos_return_id,credit_document_id,
    amount,refunded_on,payment_method,payment_reference,recorded_by,correlation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      number,
      context.returnId,
      credit.credit_id,
      input.amount,
      input.refundedOn,
      input.paymentMethod,
      input.paymentReference,
      context.accountId,
      context.correlationId,
    ],
  );
  for (const allocation of allocations)
    await client.query(
      'INSERT INTO finance.pos_account_refund_allocations(refund_id,payment_id,amount) VALUES($1,$2,$3)',
      [id, allocation.id, allocation.amount],
    );
  return { id, number, allocations, creditDocumentId: credit.credit_id, ...input, ...context };
}

// One read model for Customer accounts and invoice reconciliation.
export const posAccountReturnCreditsAggregate = `
  SELECT coalesce(sum(credit.refund_amount),0) AS total,coalesce(sum(paid.total),0) AS paid,
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'returnId',returned.id,'returnNumber',returned.return_number,
      'returnedOn',(returned.completed_at AT TIME ZONE $2)::date::text,'returnTotal',returned.gross_total::text,
      'releasedTotal',coalesce(credit.released_amount,adjustment.amount)::numeric(18,4)::text,'refundableTotal',coalesce(credit.refund_amount,0)::numeric(18,4)::text,
      'refundedTotal',paid.total::numeric(18,4)::text,'refundDue',(coalesce(credit.refund_amount,0)-paid.total)::numeric(18,4)::text,
      'invoice',CASE WHEN invoice.id IS NOT NULL THEN jsonb_build_object('id',invoice.id,'number',invoice.official_number) END,
      'creditNote',CASE WHEN note.id IS NOT NULL THEN jsonb_build_object('id',note.id,'number',coalesce(note.official_number,note.draft_number),'status',note.status) END,
      'refunds',paid.items
    )) ORDER BY returned.completed_at,returned.id),'[]'::jsonb) AS items
  FROM pos.returns returned
  JOIN (SELECT return_id,sum(amount) AS amount FROM pos.return_refunds WHERE refund_method='on_account' GROUP BY return_id) adjustment ON adjustment.return_id=returned.id
  LEFT JOIN finance.pos_account_return_credits credit ON credit.pos_return_id=returned.id
  LEFT JOIN finance.financial_documents invoice ON invoice.source_pos_sale_id=returned.original_sale_id AND invoice.status='issued' AND invoice.document_type='invoice'
  LEFT JOIN finance.financial_documents note ON note.source_pos_return_id=returned.id AND note.status IN ('draft','issued')
  CROSS JOIN LATERAL(SELECT coalesce(sum(refund.amount),0) AS total,
    coalesce(jsonb_agg(jsonb_build_object('number',refund.refund_number,'amount',refund.amount::text,
      'refundedOn',refund.refunded_on::text,'paymentMethod',refund.payment_method,'paymentReference',refund.payment_reference,
      'payments',(SELECT jsonb_agg(jsonb_build_object('number',payment.payment_number,'amount',allocation.amount::text)
        ORDER BY payment.recorded_at,payment.id) FROM finance.pos_account_refund_allocations allocation
        JOIN finance.payments payment ON payment.id=allocation.payment_id WHERE allocation.refund_id=refund.id)
      ) ORDER BY refund.recorded_at,refund.id),'[]'::jsonb) AS items
    FROM finance.pos_account_refunds refund WHERE refund.pos_return_id=returned.id) paid
  WHERE returned.original_sale_id=sale.id`;
