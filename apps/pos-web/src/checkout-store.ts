import type { CreatePosSaleRequest } from '@vista/contracts';

export interface SavedCheckout {
  accountId: string;
  request: CreatePosSaleRequest;
  savedAt: string;
}

export interface CheckoutEvent {
  accountId: string;
  transactionId: string;
  kind: 'saved' | 'retry' | 'interrupted' | 'confirmed' | 'rejected';
  occurredAt: string;
  saleNumber?: string;
}

function changed() {
  window.dispatchEvent(new Event('vista-checkouts-changed'));
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel('vista-checkouts');
      channel.postMessage('changed');
      channel.close();
    } catch {
      /* Broadcast is optional; the durable write has already succeeded. */
    }
  }
}

export function watchCheckouts(callback: () => void): () => void {
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel('vista-checkouts');
  } catch {
    /* Window focus still rechecks storage when cross-tab messaging is unavailable. */
  }
  if (channel) channel.onmessage = callback;
  window.addEventListener('vista-checkouts-changed', callback);
  window.addEventListener('focus', callback);
  return () => {
    channel?.close();
    window.removeEventListener('vista-checkouts-changed', callback);
    window.removeEventListener('focus', callback);
  };
}

// One unresolved command per employee in this browser. Never persist credentials.
function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('vista-pos-checkouts', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('pending'))
        request.result.createObjectStore('pending', { keyPath: 'accountId' });
      if (!request.result.objectStoreNames.contains('history'))
        request.result
          .createObjectStore('history', { autoIncrement: true })
          .createIndex('account', 'accountId');
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Checkout storage could not open.'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close other POS tabs and try again.'));
    };
  });
}

export async function readCheckout(accountId: string): Promise<SavedCheckout | undefined> {
  const db = await openStore();
  try {
    return await new Promise<SavedCheckout | undefined>((resolve, reject) => {
      const transaction = db.transaction('pending', 'readonly');
      const request = transaction.objectStore('pending').get(accountId);
      transaction.oncomplete = () => resolve(request.result as SavedCheckout | undefined);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Checkout storage could not be read.'));
    });
  } finally {
    db.close();
  }
}

export async function saveCheckout(checkout: SavedCheckout): Promise<void> {
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['pending', 'history'], 'readwrite');
      const store = transaction.objectStore('pending');
      const request = store.get(checkout.accountId);
      request.onsuccess = () => {
        if (request.result) {
          transaction.abort();
          return;
        }
        store.add(checkout);
        transaction.objectStore('history').add({
          accountId: checkout.accountId,
          transactionId: checkout.request.clientTransactionId,
          kind: 'saved',
          occurredAt: checkout.savedAt,
        } satisfies CheckoutEvent);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(new Error('Resolve the saved checkout before starting another sale.'));
    });
    changed();
  } finally {
    db.close();
  }
}

export async function clearCheckout(
  accountId: string,
  transactionId: string,
  outcome?: Pick<CheckoutEvent, 'kind' | 'saleNumber'>,
): Promise<void> {
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['pending', 'history'], 'readwrite');
      const store = transaction.objectStore('pending');
      const request = store.get(accountId);
      request.onsuccess = () => {
        const current = request.result as SavedCheckout | undefined;
        if (current?.request.clientTransactionId === transactionId) {
          store.delete(accountId);
          if (outcome)
            transaction.objectStore('history').add({
              accountId,
              transactionId,
              ...outcome,
              occurredAt: new Date().toISOString(),
            } satisfies CheckoutEvent);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Checkout storage could not be updated.'));
    });
    changed();
  } finally {
    db.close();
  }
}

export async function recordCheckoutAttempt(
  accountId: string,
  transactionId: string,
  kind: 'retry' | 'interrupted',
): Promise<void> {
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['pending', 'history'], 'readwrite');
      const request = transaction.objectStore('pending').get(accountId);
      request.onsuccess = () => {
        const current = request.result as SavedCheckout | undefined;
        if (current?.request.clientTransactionId === transactionId)
          transaction.objectStore('history').add({
            accountId,
            transactionId,
            kind,
            occurredAt: new Date().toISOString(),
          } satisfies CheckoutEvent);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Checkout history could not be saved.'));
    });
    changed();
  } finally {
    db.close();
  }
}

export async function readCheckoutHistory(accountId: string): Promise<CheckoutEvent[]> {
  const db = await openStore();
  try {
    return await new Promise<CheckoutEvent[]>((resolve, reject) => {
      const transaction = db.transaction('history', 'readonly');
      const request = transaction
        .objectStore('history')
        .index('account')
        .openCursor(IDBKeyRange.only(accountId), 'prev');
      const events: CheckoutEvent[] = [];
      request.onsuccess = () => {
        if (!request.result || events.length >= 50) return;
        events.push(request.result.value as CheckoutEvent);
        request.result.continue();
      };
      transaction.oncomplete = () => resolve(events);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Checkout history could not be read.'));
    });
  } finally {
    db.close();
  }
}
