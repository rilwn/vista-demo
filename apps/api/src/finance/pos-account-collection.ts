import { HttpStatus } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

import { ApiErrorException } from '../common/api-error.exception.js';

export interface LockedPosAccountCharge {
  balance: string;
  credit_limit_eur: string;
  customer_partner_id: string;
  due_on: string;
  id: string;
  payment_terms_days: number;
  payment_terms_id: string;
  pos_sale_id: string;
  sale_date: string;
}

export async function lockPosAccountCharge(
  client: PoolClient,
  customerId: string,
  saleId: string,
  businessTimezone: string,
): Promise<LockedPosAccountCharge> {
  if (
    ![customerId, saleId].every((id) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(id))
  )
    throw new ApiErrorException(
      'POS_ACCOUNT_SOURCE_INVALID',
      'Choose a valid customer and POS sale.',
      HttpStatus.BAD_REQUEST,
    );
  const sale = (
    await client.query<{ customer_partner_id: string; status: string }>(
      'SELECT customer_partner_id,status FROM pos.sales WHERE id=$1 FOR UPDATE',
      [saleId],
    )
  ).rows[0];
  if (!sale || sale.customer_partner_id !== customerId || sale.status !== 'completed')
    throw new ApiErrorException(
      'POS_ACCOUNT_SOURCE_INVALID',
      'Choose a completed POS sale belonging to this customer.',
      HttpStatus.CONFLICT,
    );
  await client.query(
    'SELECT id FROM sales.customer_payment_terms WHERE customer_partner_id=$1 FOR UPDATE',
    [customerId],
  );
  const charge = (
    await client.query<LockedPosAccountCharge>(
      `SELECT charge.id,charge.customer_partner_id,charge.payment_terms_id,
         charge.due_on::text,charge.credit_limit_eur::text,charge.payment_terms_days,charge.pos_sale_id,
         (sale.completed_at AT TIME ZONE $2)::date::text AS sale_date,
         (SELECT coalesce(sum(CASE WHEN entry_type IN ('charge','payment_reversal') THEN amount ELSE -amount END),0)::text
            FROM finance.customer_account_entries WHERE pos_sale_id=$1) AS balance
       FROM finance.customer_account_entries charge JOIN pos.sales sale ON sale.id=charge.pos_sale_id
       WHERE charge.pos_sale_id=$1 AND charge.entry_type='charge'`,
      [saleId, businessTimezone],
    )
  ).rows[0];
  if (!charge)
    throw new ApiErrorException(
      'POS_ACCOUNT_CHARGE_NOT_FOUND',
      'The POS sale has no customer-account charge to collect.',
      HttpStatus.NOT_FOUND,
    );
  return charge;
}

export async function appendPosAccountPaymentEntry(
  client: PoolClient,
  charge: LockedPosAccountCharge,
  paymentId: string,
  amount: string,
  accountId: string,
  correlationId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO finance.customer_account_entries(id,customer_partner_id,payment_terms_id,entry_type,
      amount,due_on,credit_limit_eur,payment_terms_days,pos_sale_id,source_entry_id,payment_id,
      actor_account_id,correlation_id)
     VALUES($1,$2,$3,'payment',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      randomUUID(),
      charge.customer_partner_id,
      charge.payment_terms_id,
      amount,
      charge.due_on,
      charge.credit_limit_eur,
      charge.payment_terms_days,
      charge.pos_sale_id,
      charge.id,
      paymentId,
      accountId,
      correlationId,
    ],
  );
}
