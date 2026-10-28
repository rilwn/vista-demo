import type {
  PosFiscalSalePreparation,
  PosOfflineSyncEventReason,
  PosSale,
} from '@vista/contracts';

import { ApiClientError } from './api/client';
import {
  cancelPosFiscalSalePreparation,
  confirmPosFiscalSaleReceipt,
  finalizeConfirmedPosFiscalSale,
  findPosCheckout,
  preparePosFiscalSale,
  reportPosOfflineSyncEvent,
} from './api/pos';
import {
  claimOfflineFiscalSaleForSync,
  readOfflineFiscalSales,
  updateOfflineFiscalSale,
  type SavedOfflineFiscalSale,
} from './offline-store';

export interface OfflineFiscalSaleSyncApi {
  cancel: typeof cancelPosFiscalSalePreparation;
  confirm: typeof confirmPosFiscalSaleReceipt;
  finalize: typeof finalizeConfirmedPosFiscalSale;
  find: typeof findPosCheckout;
  prepare: typeof preparePosFiscalSale;
  reportEvent: typeof reportPosOfflineSyncEvent;
}

const defaultApi: OfflineFiscalSaleSyncApi = {
  cancel: cancelPosFiscalSalePreparation,
  confirm: confirmPosFiscalSaleReceipt,
  finalize: finalizeConfirmedPosFiscalSale,
  find: findPosCheckout,
  prepare: preparePosFiscalSale,
  reportEvent: reportPosOfflineSyncEvent,
};

/** Send locally saved retries and conflicts to the immutable server audit trail. */
export async function reportOfflineFiscalSaleAttempts(
  accountId: string,
  token: string,
  saleId: string,
  api: Pick<OfflineFiscalSaleSyncApi, 'reportEvent'> = defaultApi,
): Promise<void> {
  const saved = (await readOfflineFiscalSales(accountId)).find((entry) => entry.id === saleId);
  if (!saved) return;

  const reported = new Set(saved.reportedAttemptIds ?? []);
  for (const attempt of saved.attempts) {
    if (
      (attempt.outcome !== 'conflict' && attempt.outcome !== 'retry') ||
      !attempt.eventId ||
      reported.has(attempt.eventId)
    )
      continue;

    await api.reportEvent(token, {
      cashRegisterId: saved.cashRegisterId,
      clientEventId: attempt.eventId,
      clientTransactionId: saved.clientTransactionId,
      deviceSerial: saved.deviceSerial,
      occurredAt: attempt.at,
      operatorIdentifier: saved.operatorIdentifier,
      reasonCode: attempt.reasonCode ?? defaultReason(attempt.outcome),
      type: attempt.outcome,
      uniqueSaleId: saved.uniqueSaleId,
    });
    reported.add(attempt.eventId);
    await updateOfflineFiscalSale(accountId, saved.id, {
      reportedAttemptIds: [...reported],
    });
  }
}

/** Reconciles one printed offline receipt with the normal server fiscal lifecycle. */
export async function synchronizeOfflineFiscalSale(
  accountId: string,
  token: string,
  saleId: string,
  api: OfflineFiscalSaleSyncApi = defaultApi,
): Promise<PosSale | undefined> {
  const saved = await claimOfflineFiscalSaleForSync(accountId, saleId);
  if (!saved) return undefined;

  try {
    const existing = await api.find(token, saved.clientTransactionId);
    if (existing) {
      await updateOfflineFiscalSale(accountId, saved.id, {
        attempts: [...saved.attempts, { at: new Date().toISOString(), outcome: 'synced' }],
        lastError: '',
        saleNumber: existing.saleNumber,
        status: 'synced',
        syncCompletedAt: new Date().toISOString(),
      });
      return existing;
    }

    const preparation = await api.prepare(
      token,
      {
        ...saved.request,
        deviceSerial: saved.deviceSerial,
        operatorIdentifier: saved.operatorIdentifier,
        uniqueSaleId: saved.uniqueSaleId,
      },
      `${saved.clientTransactionId}:offline-prepare`,
    );

    const mismatch = offlineReceiptMismatch(saved, preparation);
    if (mismatch) {
      if (preparation.status === 'prepared')
        await api.cancel(
          token,
          preparation.id,
          { evidence: 'before_printing' },
          `${saved.clientTransactionId}:offline-cancel`,
        );
      await markConflict(accountId, saved, mismatch);
      return undefined;
    }

    if (preparation.status === 'cancelled' || preparation.status === 'outcome_unknown') {
      await markConflict(
        accountId,
        saved,
        'The server has an unresolved fiscal record for this receipt. Ask a manager to review it.',
        'server_rejected',
      );
      return undefined;
    }

    await api.confirm(
      token,
      preparation.id,
      {
        changeEur: saved.changeEur!,
        fiscalDocumentNumber: saved.fiscalDocumentNumber!,
        ...(saved.fiscalReceiptsSinceDailyReport
          ? { fiscalReceiptsSinceDailyReport: saved.fiscalReceiptsSinceDailyReport }
          : {}),
        uniqueSaleId: saved.uniqueSaleId,
      },
      `${saved.clientTransactionId}:offline-confirm`,
    );
    const completed = await api.finalize(token, preparation.id);
    await updateOfflineFiscalSale(accountId, saved.id, {
      attempts: [...saved.attempts, { at: new Date().toISOString(), outcome: 'synced' }],
      lastError: '',
      saleNumber: completed.saleNumber,
      status: 'synced',
      syncCompletedAt: new Date().toISOString(),
    });
    return completed;
  } catch (error) {
    if (isReconciliationConflict(error)) {
      await markConflict(
        accountId,
        saved,
        error instanceof Error
          ? error.message
          : 'The server could not reconcile this offline receipt.',
        'server_rejected',
      );
    } else {
      await updateOfflineFiscalSale(accountId, saved.id, {
        attempts: [
          ...saved.attempts,
          {
            at: new Date().toISOString(),
            eventId: crypto.randomUUID(),
            message: error instanceof Error ? error.message : 'Connection interrupted.',
            outcome: 'retry',
            reasonCode: 'sync_interrupted',
          },
        ],
        lastError: 'Waiting for the connection. This receipt is still saved on this device.',
        status: 'receipt_confirmed',
      });
    }
    return undefined;
  }
}

export function offlineReceiptMismatch(
  saved: SavedOfflineFiscalSale,
  preparation: PosFiscalSalePreparation,
): string | undefined {
  if (preparation.uniqueSaleId !== saved.uniqueSaleId)
    return 'The server receipt reference does not match this printed receipt.';
  if (cents(preparation.totalGrossEur) !== cents(saved.totalGrossEur))
    return 'The current sale total differs from the printed receipt. This receipt needs review.';
  if (cents(preparation.cashTenderedEur) !== cents(saved.cashTenderedEur))
    return 'The cash tender differs from the printed receipt. This receipt needs review.';
  if (!preparation.lines || preparation.lines.length !== saved.receiptLines.length)
    return 'The current sale lines differ from the printed receipt. This receipt needs review.';

  for (const [index, expected] of saved.receiptLines.entries()) {
    const current = preparation.lines[index];
    if (
      !current ||
      current.description !== expected.description ||
      current.unitCode !== expected.unitCode ||
      current.vatTreatment !== expected.vatTreatment ||
      decimal(current.quantity, 3) !== decimal(expected.quantity, 3) ||
      cents(current.unitPriceEur) !== cents(expected.unitPriceEur) ||
      cents(current.grossTotalEur) !== cents(expected.grossTotalEur) ||
      cents(current.discountEur ?? '0') !== cents(expected.discountEur ?? '0')
    )
      return 'A product price, VAT treatment or quantity changed since the last sync. This receipt needs review.';
  }

  if (
    cents(preparation.changeEur) !== cents(saved.changeEur ?? '0') ||
    cents(preparation.cashTenderedEur) - cents(preparation.totalGrossEur) !==
      cents(preparation.changeEur)
  )
    return 'The cash change does not match the printed receipt. This receipt needs review.';
  if (!saved.fiscalDocumentNumber?.trim())
    return 'The DATECS receipt number is missing. This receipt needs review.';
  return undefined;
}

async function markConflict(
  accountId: string,
  saved: SavedOfflineFiscalSale,
  message: string,
  reasonCode: PosOfflineSyncEventReason = 'receipt_mismatch',
) {
  await updateOfflineFiscalSale(accountId, saved.id, {
    attempts: [
      ...saved.attempts,
      {
        at: new Date().toISOString(),
        eventId: crypto.randomUUID(),
        message,
        outcome: 'conflict',
        reasonCode,
      },
    ],
    lastError: message,
    status: 'conflict',
  });
}

function defaultReason(outcome: 'conflict' | 'retry'): PosOfflineSyncEventReason {
  return outcome === 'conflict' ? 'server_rejected' : 'sync_interrupted';
}

function isReconciliationConflict(error: unknown): boolean {
  return error instanceof ApiClientError && [400, 409, 422].includes(error.status);
}

function cents(value: string): number {
  return Math.round(Number(value) * 100);
}

function decimal(value: string, precision: number): number {
  return Math.round(Number(value) * 10 ** precision);
}
