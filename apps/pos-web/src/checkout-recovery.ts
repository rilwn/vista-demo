import type { CreatePosSaleRequest, PosSale } from '@vista/contracts';
import { ApiClientError } from './api/client';
import { completePosSale } from './api/pos';
import { clearCheckout, saveCheckout, recordCheckoutAttempt } from './checkout-store';

// Keep uncertain outcomes saved until the server confirms what happened.
export function definitelyRejected(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    ([400, 422].includes(error.status) ||
      (error.status === 409 &&
        [
          'POS_STOCK_UNAVAILABLE',
          'POS_BATCH_UNAVAILABLE',
          'POS_SERIAL_UNAVAILABLE',
          'POS_PRICE_UNAVAILABLE',
          'POS_PRODUCT_UNAVAILABLE',
          'POS_SHIFT_NOT_OPEN',
          'POS_PAYMENT_TOTAL_MISMATCH',
          'POS_LOYALTY_BALANCE_EXCEEDED',
          'POS_ADVANCE_BALANCE_EXCEEDED',
          'POS_ACCOUNT_CREDIT_EXCEEDED',
        ].includes(error.code)))
  );
}

export async function submitDurableCheckout(
  accountId: string,
  token: string,
  request: CreatePosSaleRequest,
): Promise<PosSale> {
  await saveCheckout({ accountId, request, savedAt: new Date().toISOString() });
  try {
    const sale = await completePosSale(token, request, request.clientTransactionId);
    await clearCheckout(accountId, request.clientTransactionId, {
      kind: 'confirmed',
      saleNumber: sale.saleNumber,
    });
    return sale;
  } catch (error) {
    if (definitelyRejected(error))
      await clearCheckout(accountId, request.clientTransactionId, { kind: 'rejected' });
    else
      await recordCheckoutAttempt(accountId, request.clientTransactionId, 'interrupted').catch(
        () => undefined,
      );
    throw error;
  }
}
