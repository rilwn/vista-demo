import { IDBFactory } from 'fake-indexeddb';
import type {
  CreatePosSaleRequest,
  PosFiscalSalePreparation,
  PosFiscalReceiptLine,
  PosSale,
} from '@vista/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  countPendingOfflineFiscalSales,
  readOfflineFiscalSales,
  reserveOfflineFiscalSale,
  saveOfflineDatecsUnpLease,
  updateOfflineFiscalSale,
} from './offline-store';
import { ApiClientError } from './api/client';
import {
  offlineReceiptMismatch,
  reportOfflineFiscalSaleAttempts,
  synchronizeOfflineFiscalSale,
  type OfflineFiscalSaleSyncApi,
} from './offline-reconciliation';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());

const line: PosFiscalReceiptLine = {
  description: 'Adapter',
  grossTotalEur: '12.00',
  quantity: '1',
  unitCode: 'PCS',
  unitPriceEur: '12.00',
  vatTreatment: 'standard_20',
};

async function savedReceipt(overrides: Partial<CreatePosSaleRequest> = {}) {
  await saveOfflineDatecsUnpLease('cashier-1', {
    cashRegisterId: 'register-1',
    deviceSerial: 'DT000600',
    operatorIdentifier: 'OP01',
    uniqueSaleIds: ['DT000600-OP01-0001000'],
  });
  const request: CreatePosSaleRequest = {
    clientTransactionId: 'offline-transaction-1',
    lines: [{ productId: 'product-1', quantity: '1.0000' }],
    payments: [{ amount: '12.00', method: 'cash', tenderedAmount: '20.00' }],
    shiftId: 'shift-1',
    ...overrides,
  };
  const saved = await reserveOfflineFiscalSale('cashier-1', {
    accountId: 'cashier-1',
    cashRegisterId: 'register-1',
    cashTenderedEur: '20.00',
    clientTransactionId: request.clientTransactionId,
    deviceSerial: 'DT000600',
    operatorIdentifier: 'OP01',
    receiptLines: [line],
    request,
    shiftId: 'shift-1',
    totalGrossEur: '12.00',
  });
  return updateOfflineFiscalSale('cashier-1', saved.id, {
    changeEur: '8.00',
    fiscalDocumentNumber: '001234',
    fiscalReceiptsSinceDailyReport: '4',
    status: 'receipt_confirmed',
  });
}

function preparation(overrides: Partial<PosFiscalSalePreparation> = {}): PosFiscalSalePreparation {
  return {
    cashTenderedEur: '20.00',
    changeEur: '8.00',
    deviceSerial: 'DT000600',
    id: 'preparation-1',
    lines: [line],
    status: 'prepared',
    totalGrossEur: '12.00',
    uniqueSaleId: 'DT000600-OP01-0001000',
    ...overrides,
  };
}

function syncApi(prepared: PosFiscalSalePreparation): OfflineFiscalSaleSyncApi {
  const completed = { saleNumber: 'POS-2026-000001' };
  return {
    cancel: vi.fn().mockResolvedValue({ ...prepared, status: 'cancelled' }),
    confirm: vi.fn().mockResolvedValue(completed),
    finalize: vi.fn().mockResolvedValue(completed),
    find: vi.fn().mockResolvedValue(undefined),
    prepare: vi.fn().mockResolvedValue(prepared),
    reportEvent: vi.fn().mockImplementation((_token: string, input: { clientEventId: string }) =>
      Promise.resolve({
        auditEventId: 'audit-event-1',
        clientEventId: input.clientEventId,
        duplicate: false,
      }),
    ),
  };
}

describe('offline DATECS receipt reconciliation', () => {
  it('posts a matching printed receipt once and records its sale number', async () => {
    const saved = await savedReceipt();
    const api = syncApi(preparation());

    const sale = await synchronizeOfflineFiscalSale('cashier-1', 'token', saved.id, api);

    expect(sale?.saleNumber).toBe('POS-2026-000001');
    expect(api.prepare).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({ uniqueSaleId: saved.uniqueSaleId }),
      `${saved.clientTransactionId}:offline-prepare`,
    );
    expect(api.confirm).toHaveBeenCalledOnce();
    expect(api.finalize).toHaveBeenCalledOnce();
    expect(await readOfflineFiscalSales('cashier-1')).toMatchObject([
      { saleNumber: 'POS-2026-000001', status: 'synced' },
    ]);
    expect(await countPendingOfflineFiscalSales('cashier-1')).toBe(0);
  });

  it('uploads retry and conflict history once and remembers successful audit receipts', async () => {
    const saved = await savedReceipt();
    await updateOfflineFiscalSale('cashier-1', saved.id, {
      attempts: [
        {
          at: '2026-10-27T10:00:00.000Z',
          eventId: 'event-retry-1',
          outcome: 'retry',
          reasonCode: 'sync_interrupted',
        },
        {
          at: '2026-10-27T10:01:00.000Z',
          eventId: 'event-conflict-1',
          outcome: 'conflict',
          reasonCode: 'receipt_mismatch',
        },
      ],
    });
    const api = syncApi(preparation());

    await reportOfflineFiscalSaleAttempts('cashier-1', 'token', saved.id, api);
    await reportOfflineFiscalSaleAttempts('cashier-1', 'token', saved.id, api);

    expect(api.reportEvent).toHaveBeenCalledTimes(2);
    expect(api.reportEvent).toHaveBeenNthCalledWith(
      1,
      'token',
      expect.objectContaining({
        clientEventId: 'event-retry-1',
        clientTransactionId: saved.clientTransactionId,
        reasonCode: 'sync_interrupted',
        type: 'retry',
      }),
    );
    expect(await readOfflineFiscalSales('cashier-1')).toMatchObject([
      { reportedAttemptIds: ['event-retry-1', 'event-conflict-1'] },
    ]);
  });

  it('keeps an event pending locally when the server audit receipt is unavailable', async () => {
    const saved = await savedReceipt();
    await updateOfflineFiscalSale('cashier-1', saved.id, {
      attempts: [
        {
          at: '2026-10-27T10:00:00.000Z',
          eventId: 'event-retry-2',
          outcome: 'retry',
          reasonCode: 'sync_interrupted',
        },
      ],
    });
    const api = syncApi(preparation());
    vi.mocked(api.reportEvent).mockRejectedValueOnce(new Error('offline'));

    await expect(
      reportOfflineFiscalSaleAttempts('cashier-1', 'token', saved.id, api),
    ).rejects.toThrow('offline');
    expect(await readOfflineFiscalSales('cashier-1')).toMatchObject([{ reportedAttemptIds: [] }]);
  });

  it('recognizes an earlier server post and does not create a duplicate after retry', async () => {
    const saved = await savedReceipt();
    const api = syncApi(preparation());
    const existing = { saleNumber: 'POS-2026-000001' } as PosSale;
    vi.mocked(api.find).mockResolvedValueOnce(existing);

    const recovered = await synchronizeOfflineFiscalSale('cashier-1', 'token', saved.id, api);

    expect(recovered).toBe(existing);
    expect(api.prepare).not.toHaveBeenCalled();
    expect(api.confirm).not.toHaveBeenCalled();
    expect(api.finalize).not.toHaveBeenCalled();
    expect(await readOfflineFiscalSales('cashier-1')).toMatchObject([
      { saleNumber: existing.saleNumber, status: 'synced' },
    ]);
  });

  it('cancels the unprinted server preparation and preserves a changed-price conflict', async () => {
    const saved = await savedReceipt();
    const api = syncApi(preparation({ totalGrossEur: '13.00' }));

    expect(await synchronizeOfflineFiscalSale('cashier-1', 'token', saved.id, api)).toBeUndefined();
    expect(api.cancel).toHaveBeenCalledWith(
      'token',
      'preparation-1',
      { evidence: 'before_printing' },
      `${saved.clientTransactionId}:offline-cancel`,
    );
    expect(api.confirm).not.toHaveBeenCalled();
    const [conflict] = await readOfflineFiscalSales('cashier-1');
    expect(conflict?.lastError).toContain('sale total differs');
    expect(conflict?.status).toBe('conflict');
    expect(conflict?.attempts).toMatchObject([{ outcome: 'conflict' }]);
    expect(await countPendingOfflineFiscalSales('cashier-1')).toBe(1);
  });

  it('holds an offline base-price receipt when a server promotion changes the total', async () => {
    const saved = await savedReceipt();
    const api = syncApi(
      preparation({
        lines: [{ ...line, discountEur: '1.20', grossTotalEur: '10.80', unitPriceEur: '10.80' }],
        totalGrossEur: '10.80',
      }),
    );

    expect(await synchronizeOfflineFiscalSale('cashier-1', 'token', saved.id, api)).toBeUndefined();
    expect(api.cancel).toHaveBeenCalledOnce();
    expect(api.confirm).not.toHaveBeenCalled();
    const [conflict] = await readOfflineFiscalSales('cashier-1');
    expect(conflict?.status).toBe('conflict');
    expect(conflict?.lastError).toContain('sale total differs');
  });

  it('keeps a server-rejected cached customer or serial sale visible for reconciliation', async () => {
    const saved = await savedReceipt({
      customerLocationId: 'location-1',
      customerPartnerId: 'customer-1',
      lines: [
        {
          productId: 'product-1',
          quantity: '1.0000',
          serialNumbers: ['SERIAL-001'],
        },
      ],
    });
    const api = syncApi(preparation());
    vi.mocked(api.prepare).mockRejectedValueOnce(
      new ApiClientError('The saved serial is no longer available.', 'STOCK_CONFLICT', 409),
    );

    expect(await synchronizeOfflineFiscalSale('cashier-1', 'token', saved.id, api)).toBeUndefined();
    expect(api.prepare).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({
        customerLocationId: 'location-1',
        customerPartnerId: 'customer-1',
        lines: [expect.objectContaining({ serialNumbers: ['SERIAL-001'] })],
      }),
      `${saved.clientTransactionId}:offline-prepare`,
    );
    expect(api.confirm).not.toHaveBeenCalled();
    expect(await readOfflineFiscalSales('cashier-1')).toMatchObject([
      {
        attempts: [{ outcome: 'conflict', message: 'The saved serial is no longer available.' }],
        lastError: 'The saved serial is no longer available.',
        status: 'conflict',
      },
    ]);
  });

  it('returns to the automatic retry queue after an interrupted request', async () => {
    const saved = await savedReceipt();
    const api = syncApi(preparation());
    vi.mocked(api.find).mockRejectedValueOnce(new TypeError('Network interrupted'));

    expect(await synchronizeOfflineFiscalSale('cashier-1', 'token', saved.id, api)).toBeUndefined();
    expect(await readOfflineFiscalSales('cashier-1')).toMatchObject([
      { status: 'receipt_confirmed', attempts: [{ outcome: 'retry' }] },
    ]);
    expect(await countPendingOfflineFiscalSales('cashier-1')).toBe(1);
  });

  it('detects line, VAT, tender and change mismatches before receipt confirmation', async () => {
    const saved = await savedReceipt();
    expect(offlineReceiptMismatch(saved, preparation({ lines: [] }))).toContain(
      'sale lines differ',
    );
    expect(offlineReceiptMismatch(saved, preparation({ cashTenderedEur: '19.00' }))).toContain(
      'cash tender differs',
    );
    expect(offlineReceiptMismatch(saved, preparation({ changeEur: '7.00' }))).toContain(
      'cash change does not match',
    );
  });
});
