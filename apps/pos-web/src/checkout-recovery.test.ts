import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreatePosSaleRequest, PosSale } from '@vista/contracts';
import { ApiClientError } from './api/client';
import { completePosSale } from './api/pos';
import {
  readCheckout,
  saveCheckout,
  clearCheckout,
  readCheckoutHistory,
  recordCheckoutAttempt,
  watchCheckouts,
} from './checkout-store';
import { submitDurableCheckout } from './checkout-recovery';
import { TestCheckoutChannel } from './test-checkout-channel';

vi.mock('./api/pos', () => ({ completePosSale: vi.fn() }));
const request: CreatePosSaleRequest = {
  clientTransactionId: '86a47c28-7521-4a81-aafd-c04d92363230',
  shiftId: '93045dfc-5bbe-43e9-bff0-ec563915ece5',
  lines: [{ productId: 'f5f78775-ac83-4cdc-bf6e-760377ff789a', quantity: '1.0000' }],
  payments: [{ amount: '60.0000', method: 'cash', tenderedAmount: '100.0000' }],
};

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.stubGlobal('BroadcastChannel', TestCheckoutChannel);
  vi.mocked(completePosSale).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('durable checkout recovery', () => {
  it('commits the exact request before sending and clears only after success', async () => {
    vi.mocked(completePosSale).mockImplementation(async () => {
      expect((await readCheckout('cashier'))?.request).toEqual(request);
      return { id: 'sale' } as PosSale;
    });
    await submitDurableCheckout('cashier', 'secret-token', request);
    expect(completePosSale).toHaveBeenCalledWith(
      'secret-token',
      request,
      request.clientTransactionId,
    );
    expect(await readCheckout('cashier')).toBeUndefined();
  });
  it('retains an ambiguous network outcome across database reopen without credentials', async () => {
    vi.mocked(completePosSale).mockRejectedValue(new ApiClientError('Offline', 'UNAVAILABLE', 0));
    await expect(submitDurableCheckout('cashier', 'secret-token', request)).rejects.toThrow();
    expect((await readCheckout('cashier'))?.request).toEqual(request);
    expect(JSON.stringify(await readCheckout('cashier'))).not.toContain('secret-token');
    expect(await readCheckout('another-cashier')).toBeUndefined();
  });
  it('prevents two browser tabs from overwriting an unresolved checkout', async () => {
    const saved = { accountId: 'cashier', request, savedAt: new Date().toISOString() };
    const results = await Promise.allSettled([saveCheckout(saved), saveCheckout(saved)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await clearCheckout('cashier', 'a-different-transaction');
    expect(await readCheckout('cashier')).toEqual(saved);
  });
  it('never sends a checkout when local storage fails', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(submitDurableCheckout('cashier', 'token', request)).rejects.toThrow();
    expect(completePosSale).not.toHaveBeenCalled();
  });
  it('reacts to other-tab notifications and removes listeners on unmount', async () => {
    const changed = vi.fn();
    const stop = watchCheckouts(changed);
    const otherTab = new TestCheckoutChannel('vista-checkouts');
    otherTab.postMessage();
    await Promise.resolve();
    expect(changed).toHaveBeenCalledOnce();
    stop();
    otherTab.postMessage();
    await Promise.resolve();
    expect(changed).toHaveBeenCalledOnce();
    otherTab.close();
  });
  it('records ordered attempts and atomically confirms only the matching checkout', async () => {
    await saveCheckout({ accountId: 'cashier', request, savedAt: new Date().toISOString() });
    await recordCheckoutAttempt('cashier', request.clientTransactionId, 'interrupted');
    await recordCheckoutAttempt('cashier', request.clientTransactionId, 'retry');
    await clearCheckout('cashier', request.clientTransactionId, {
      kind: 'confirmed',
      saleNumber: 'SALE-01',
    });
    await clearCheckout('cashier', request.clientTransactionId, {
      kind: 'confirmed',
      saleNumber: 'SALE-01',
    });
    expect((await readCheckoutHistory('cashier')).map((event) => event.kind)).toEqual([
      'confirmed',
      'retry',
      'interrupted',
      'saved',
    ]);
    expect(await readCheckoutHistory('another-cashier')).toEqual([]);
  });
  it('upgrades the existing local database without losing an unresolved checkout', async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('vista-pos-checkouts', 1);
      open.onupgradeneeded = () =>
        open.result.createObjectStore('pending', { keyPath: 'accountId' });
      open.onsuccess = () => {
        const tx = open.result.transaction('pending', 'readwrite');
        tx.objectStore('pending').add({
          accountId: 'cashier',
          request,
          savedAt: new Date().toISOString(),
        });
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
      open.onerror = () => reject(new Error('Unable to prepare old database'));
    });
    expect((await readCheckout('cashier'))?.request).toEqual(request);
    expect(await readCheckoutHistory('cashier')).toEqual([]);
  });
  it('releases a definitively rejected stock request so the cashier can correct it', async () => {
    vi.mocked(completePosSale).mockRejectedValue(
      new ApiClientError('Insufficient stock', 'POS_STOCK_UNAVAILABLE', 409),
    );
    await expect(submitDurableCheckout('cashier', 'token', request)).rejects.toThrow();
    expect(await readCheckout('cashier')).toBeUndefined();
  });
});
