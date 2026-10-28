import type {
  CreatePosSaleRequest,
  PosCatalogItem,
  PosCustomerLocationOption,
  PosCustomerOption,
  PosDatecsUnpLease,
  PosFiscalReceiptLine,
  PosQuickAccess,
  PosTerminalContext,
  PosOfflineSyncEventReason,
} from '@vista/contracts';

const databaseName = 'vista-pos-offline';
const databaseVersion = 6;

interface SavedContext {
  accountId: string;
  context: PosTerminalContext;
  savedAt: string;
}

interface SavedCatalog {
  key: string;
  accountId: string;
  shiftId: string;
  customerPartnerId: string;
  items: PosCatalogItem[];
  savedAt: string;
}

interface SavedPosCustomer {
  accountId: string;
  customer: Omit<PosCustomerOption, 'loyalty'>;
  key: string;
  savedAt: string;
}

export interface SavedOfflineCustomerSelection {
  customer: Omit<PosCustomerOption, 'loyalty'>;
  location?: PosCustomerLocationOption;
}

interface SavedQuickAccess {
  key: string;
  accountId: string;
  shiftId: string;
  customerPartnerId: string;
  value: PosQuickAccess;
  savedAt: string;
}

interface SavedDatecsUnpLease extends PosDatecsUnpLease {
  accountId: string;
  key: string;
  savedAt: string;
}

export type OfflineFiscalSaleStatus =
  | 'cancelled'
  | 'conflict'
  | 'printing'
  | 'receipt_confirmed'
  | 'receipt_unknown'
  | 'synced'
  | 'syncing';

export interface SavedOfflineFiscalSale {
  accountId: string;
  attempts: Array<{
    at: string;
    eventId?: string;
    message?: string;
    outcome: 'conflict' | 'retry' | 'synced';
    reasonCode?: PosOfflineSyncEventReason;
  }>;
  cashRegisterId: string;
  cashTenderedEur: string;
  changeEur?: string;
  clientTransactionId: string;
  createdAt: string;
  deviceSerial: string;
  fiscalDocumentNumber?: string;
  fiscalReceiptsSinceDailyReport?: string;
  id: string;
  lastError?: string;
  operatorIdentifier: string;
  receiptLines: PosFiscalReceiptLine[];
  reportedAttemptIds?: string[];
  request: CreatePosSaleRequest;
  saleNumber?: string;
  shiftId: string;
  status: OfflineFiscalSaleStatus;
  syncCompletedAt?: string;
  syncStartedAt?: string;
  totalGrossEur: string;
  uniqueSaleId: string;
}

export interface OfflineSnapshot<T> {
  savedAt: string;
  value: T;
}

export interface SavedBasketLine {
  batchId?: string;
  item: PosCatalogItem;
  quantity: number;
  serialNumber?: string;
}

export interface SavedBasket {
  accountId: string;
  customer?: SavedOfflineCustomerSelection;
  shiftId: string;
  transactionId: string;
  lines: SavedBasketLine[];
  savedAt: string;
}

export interface UnresolvedFiscalOutcome {
  accountId: string;
  clientTransactionId: string;
  commandCode: number;
  createdAt: string;
  id: string;
  registerId: string;
  status: 'unresolved' | 'reviewed';
  review?: FiscalOutcomeReview;
}

export type FiscalOutcomeReview =
  | {
      decision: 'receipt_confirmed';
      fiscalReceiptNumber?: string;
      note: string;
      reviewedAt: string;
      reviewerAccountId: string;
      uniqueSaleId?: string;
    }
  | {
      decision: 'no_receipt';
      note: string;
      reviewedAt: string;
      reviewerAccountId: string;
    }
  | {
      decision: 'receipt_reversed';
      fiscalReceiptNumber: string;
      fiscalReversalNumber: string;
      note: string;
      reviewedAt: string;
      reviewerAccountId: string;
    };

export interface FiscalOutcomeLockStore {
  findUnresolved(registerId: string): Promise<UnresolvedFiscalOutcome | undefined>;
  recordUnresolved(
    outcome: Omit<UnresolvedFiscalOutcome, 'id' | 'status' | 'review'>,
  ): Promise<void>;
  markReviewed(
    registerId: string,
    clientTransactionId: string,
    review: FiscalOutcomeReview,
  ): Promise<void>;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const oldVersion = event.oldVersion;
      if (!database.objectStoreNames.contains('contexts'))
        database.createObjectStore('contexts', { keyPath: 'accountId' });
      if (!database.objectStoreNames.contains('catalogs'))
        database.createObjectStore('catalogs', { keyPath: 'key' });
      if (!database.objectStoreNames.contains('quickAccess'))
        database.createObjectStore('quickAccess', { keyPath: 'key' });
      if (!database.objectStoreNames.contains('baskets'))
        database.createObjectStore('baskets', { keyPath: 'accountId' });
      if (!database.objectStoreNames.contains('fiscalOutcomes')) {
        const store = database.createObjectStore('fiscalOutcomes', { keyPath: 'id' });
        store.createIndex('byRegister', 'registerId', { unique: false });
      }
      if (!database.objectStoreNames.contains('datecsUnpLeases'))
        database.createObjectStore('datecsUnpLeases', { keyPath: 'key' });
      if (!database.objectStoreNames.contains('offlineFiscalSales')) {
        const store = database.createObjectStore('offlineFiscalSales', { keyPath: 'id' });
        store.createIndex('byAccount', 'accountId', { unique: false });
        store.createIndex('byRegister', 'cashRegisterId', { unique: false });
      }
      if (!database.objectStoreNames.contains('offlineCustomers')) {
        const store = database.createObjectStore('offlineCustomers', { keyPath: 'key' });
        store.createIndex('byAccount', 'accountId', { unique: false });
      }
      if (oldVersion < 6 && database.objectStoreNames.contains('offlineFiscalSales')) {
        const sales = request.transaction!.objectStore('offlineFiscalSales');
        const cursorRequest = sales.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const sale = cursor.value as SavedOfflineFiscalSale;
          cursor.update({
            ...sale,
            attempts: (sale.attempts ?? []).map((attempt) => ({
              ...attempt,
              eventId: attempt.eventId ?? crypto.randomUUID(),
            })),
            reportedAttemptIds: sale.reportedAttemptIds ?? [],
          });
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () =>
      reject(request.error ?? new Error('Offline POS storage is unavailable.'));
    request.onblocked = () => reject(new Error('Close other POS tabs and try again.'));
  });
}

export class IndexedDbFiscalOutcomeLockStore implements FiscalOutcomeLockStore {
  async findUnresolved(registerId: string): Promise<UnresolvedFiscalOutcome | undefined> {
    const database = await openDatabase();
    try {
      return await new Promise<UnresolvedFiscalOutcome | undefined>((resolve, reject) => {
        const transaction = database.transaction('fiscalOutcomes', 'readonly');
        const request = transaction
          .objectStore('fiscalOutcomes')
          .index('byRegister')
          .getAll(registerId);
        transaction.oncomplete = () =>
          resolve(
            (request.result as UnresolvedFiscalOutcome[]).find(
              (outcome) => outcome.status === 'unresolved',
            ),
          );
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('Fiscal recovery status could not be read.'));
      });
    } finally {
      database.close();
    }
  }

  async recordUnresolved(
    outcome: Omit<UnresolvedFiscalOutcome, 'id' | 'status' | 'review'>,
  ): Promise<void> {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('fiscalOutcomes', 'readwrite');
        const store = transaction.objectStore('fiscalOutcomes');
        const registerRequest = store.index('byRegister').getAll(outcome.registerId);
        registerRequest.onsuccess = () => {
          const existing = (registerRequest.result as UnresolvedFiscalOutcome[]).find(
            (candidate) => candidate.status === 'unresolved',
          );
          if (existing) {
            if (existing.clientTransactionId !== outcome.clientTransactionId) {
              transaction.abort();
              return;
            }
            return;
          }
          store.add({
            ...outcome,
            id: `${outcome.registerId}:${outcome.clientTransactionId}`,
            status: 'unresolved',
          } satisfies UnresolvedFiscalOutcome);
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(
            transaction.error ?? new Error('Another fiscal outcome is already waiting for review.'),
          );
      });
    } finally {
      database.close();
    }
  }

  async markReviewed(
    registerId: string,
    clientTransactionId: string,
    review: FiscalOutcomeReview,
  ): Promise<void> {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('fiscalOutcomes', 'readwrite');
        const store = transaction.objectStore('fiscalOutcomes');
        const request = store.index('byRegister').getAll(registerId);
        request.onsuccess = () => {
          const outcome = (request.result as UnresolvedFiscalOutcome[]).find(
            (candidate) =>
              candidate.clientTransactionId === clientTransactionId &&
              candidate.status === 'unresolved',
          );
          if (outcome) store.put({ ...outcome, review, status: 'reviewed' });
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('Fiscal recovery status could not be updated.'));
      });
    } finally {
      database.close();
    }
  }
}

export async function readFiscalOutcomeHistory(
  registerId: string,
): Promise<UnresolvedFiscalOutcome[]> {
  const database = await openDatabase();
  try {
    return await new Promise<UnresolvedFiscalOutcome[]>((resolve, reject) => {
      const transaction = database.transaction('fiscalOutcomes', 'readonly');
      const request = transaction
        .objectStore('fiscalOutcomes')
        .index('byRegister')
        .getAll(registerId);
      transaction.oncomplete = () =>
        resolve(
          (request.result as UnresolvedFiscalOutcome[]).sort((first, second) =>
            first.createdAt.localeCompare(second.createdAt),
          ),
        );
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Fiscal recovery history could not be read.'));
    });
  } finally {
    database.close();
  }
}

export async function reviewFiscalOutcome(
  registerId: string,
  clientTransactionId: string,
  review: FiscalOutcomeReview,
): Promise<UnresolvedFiscalOutcome> {
  const note = review.note.trim();
  if (!note || !review.reviewerAccountId.trim())
    throw new Error('A reviewer and a short explanation are required.');
  if (
    review.decision === 'receipt_confirmed' &&
    !review.fiscalReceiptNumber?.trim() &&
    !review.uniqueSaleId?.trim()
  )
    throw new Error('Enter the confirmed fiscal receipt number or unique sale ID.');

  const database = await openDatabase();
  try {
    return await new Promise<UnresolvedFiscalOutcome>((resolve, reject) => {
      const transaction = database.transaction('fiscalOutcomes', 'readwrite');
      const store = transaction.objectStore('fiscalOutcomes');
      const id = `${registerId}:${clientTransactionId}`;
      const request = store.get(id);
      let reviewed: UnresolvedFiscalOutcome | undefined;
      request.onsuccess = () => {
        const existing = request.result as UnresolvedFiscalOutcome | undefined;
        if (!existing || existing.status !== 'unresolved') {
          transaction.abort();
          return;
        }
        reviewed = { ...existing, status: 'reviewed', review: { ...review, note } };
        store.put(reviewed);
      };
      transaction.oncomplete = () => {
        if (reviewed) resolve(reviewed);
        else reject(new Error('The printer outcome is no longer waiting for review.'));
      };
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('The printer outcome could not be reviewed.'));
    });
  } finally {
    database.close();
  }
}

async function readOne<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(key);
      transaction.oncomplete = () => resolve(request.result as T | undefined);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Offline data could not be read.'));
    });
  } finally {
    database.close();
  }
}

async function writeOne<T>(storeName: string, value: T): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(value);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Offline data could not be saved.'));
    });
  } finally {
    database.close();
  }
}

export async function saveOfflineContext(
  accountId: string,
  context: PosTerminalContext,
): Promise<void> {
  await writeOne<SavedContext>('contexts', {
    accountId,
    context,
    savedAt: new Date().toISOString(),
  });
}

export async function readOfflineContext(
  accountId: string,
): Promise<OfflineSnapshot<PosTerminalContext> | undefined> {
  const saved = await readOne<SavedContext>('contexts', accountId);
  return saved ? { value: saved.context, savedAt: saved.savedAt } : undefined;
}

export async function saveOfflinePosCustomers(
  accountId: string,
  customers: PosCustomerOption[],
): Promise<void> {
  if (!customers.length) return;
  const savedAt = new Date().toISOString();
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('offlineCustomers', 'readwrite');
      const store = transaction.objectStore('offlineCustomers');
      const existingRequest = store.index('byAccount').getAll(accountId);
      existingRequest.onsuccess = () => {
        const merged = new Map(
          (existingRequest.result as SavedPosCustomer[]).map((entry) => [entry.key, entry]),
        );
        customers.forEach((customer) => {
          const cachedCustomer: Omit<PosCustomerOption, 'loyalty'> = {
            id: customer.id,
            locations: customer.locations,
            name: customer.name,
            ...(customer.uic ? { uic: customer.uic } : {}),
            ...(customer.vatNumber ? { vatNumber: customer.vatNumber } : {}),
          };
          const key = `${accountId}:${customer.id}`;
          merged.set(key, { accountId, customer: cachedCustomer, key, savedAt });
        });
        const newest = [...merged.values()]
          .sort((first, second) => second.savedAt.localeCompare(first.savedAt))
          .slice(0, 500);
        const retained = new Set(newest.map((entry) => entry.key));
        for (const entry of merged.values()) {
          if (!retained.has(entry.key)) store.delete(entry.key);
        }
        newest.forEach((entry) => store.put(entry));
      };
      existingRequest.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Customer records could not be saved offline.'));
    });
  } finally {
    database.close();
  }
}

export async function readOfflinePosCustomers(
  accountId: string,
  search?: string,
): Promise<OfflineSnapshot<PosCustomerOption[]> | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise<OfflineSnapshot<PosCustomerOption[]> | undefined>(
      (resolve, reject) => {
        const transaction = database.transaction('offlineCustomers', 'readonly');
        const request = transaction
          .objectStore('offlineCustomers')
          .index('byAccount')
          .getAll(accountId);
        transaction.oncomplete = () => {
          const entries = request.result as SavedPosCustomer[];
          if (!entries.length) {
            resolve(undefined);
            return;
          }
          const query = search?.trim().toLocaleLowerCase();
          const customers = entries
            .map((entry) => entry.customer)
            .filter(
              (customer) =>
                !query ||
                [customer.name, customer.uic, customer.vatNumber]
                  .filter(Boolean)
                  .join(' ')
                  .toLocaleLowerCase()
                  .includes(query),
            )
            .sort((first, second) => first.name.localeCompare(second.name));
          const savedAt = entries
            .map((entry) => entry.savedAt)
            .sort((first, second) => second.localeCompare(first))[0];
          resolve(savedAt ? { savedAt, value: customers } : undefined);
        };
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('Saved customer records could not be read.'));
      },
    );
  } finally {
    database.close();
  }
}

function cacheKey(accountId: string, shiftId: string, customerPartnerId?: string): string {
  return `${accountId}:${shiftId}:${customerPartnerId ?? 'counter'}`;
}

function datecsLeaseKey(
  accountId: string,
  cashRegisterId: string,
  deviceSerial: string,
  operatorIdentifier: string,
): string {
  return [accountId, cashRegisterId, deviceSerial, operatorIdentifier]
    .map((part) => part.trim().toUpperCase())
    .join(':');
}

export async function saveOfflineDatecsUnpLease(
  accountId: string,
  lease: PosDatecsUnpLease,
): Promise<void> {
  const deviceSerial = lease.deviceSerial.trim().toUpperCase();
  const operatorIdentifier = lease.operatorIdentifier.trim().toUpperCase();
  const uniqueSaleIds = [...new Set(lease.uniqueSaleIds.map((id) => id.trim().toUpperCase()))];
  if (
    !/^[A-Z0-9]{8}$/u.test(deviceSerial) ||
    !/^[A-Z0-9]{4}$/u.test(operatorIdentifier) ||
    uniqueSaleIds.some(
      (id) => !new RegExp(`^${deviceSerial}-${operatorIdentifier}-\\d{7}$`, 'u').test(id),
    )
  )
    throw new Error('The saved DATECS receipt references are invalid.');

  const key = datecsLeaseKey(accountId, lease.cashRegisterId, deviceSerial, operatorIdentifier);
  await writeOne<SavedDatecsUnpLease>('datecsUnpLeases', {
    ...lease,
    accountId,
    deviceSerial,
    operatorIdentifier,
    uniqueSaleIds,
    key,
    savedAt: new Date().toISOString(),
  });
}

export async function readOfflineDatecsUnpLease(
  accountId: string,
  cashRegisterId: string,
  deviceSerial: string,
  operatorIdentifier: string,
): Promise<OfflineSnapshot<PosDatecsUnpLease> | undefined> {
  const key = datecsLeaseKey(accountId, cashRegisterId, deviceSerial, operatorIdentifier);
  const saved = await readOne<SavedDatecsUnpLease>('datecsUnpLeases', key);
  return saved
    ? {
        savedAt: saved.savedAt,
        value: {
          cashRegisterId: saved.cashRegisterId,
          deviceSerial: saved.deviceSerial,
          operatorIdentifier: saved.operatorIdentifier,
          uniqueSaleIds: saved.uniqueSaleIds,
        },
      }
    : undefined;
}

export async function consumeOfflineDatecsUnpLease(
  accountId: string,
  cashRegisterId: string,
  deviceSerial: string,
  operatorIdentifier: string,
): Promise<string | undefined> {
  const key = datecsLeaseKey(accountId, cashRegisterId, deviceSerial, operatorIdentifier);
  const database = await openDatabase();
  try {
    return await new Promise<string | undefined>((resolve, reject) => {
      const transaction = database.transaction('datecsUnpLeases', 'readwrite');
      const store = transaction.objectStore('datecsUnpLeases');
      const request = store.get(key);
      let consumed: string | undefined;
      request.onsuccess = () => {
        const saved = request.result as SavedDatecsUnpLease | undefined;
        consumed = saved?.uniqueSaleIds[0];
        if (!saved || !consumed) return;
        store.put({ ...saved, uniqueSaleIds: saved.uniqueSaleIds.slice(1) });
      };
      transaction.oncomplete = () => resolve(consumed);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('A DATECS receipt reference could not be reserved.'));
    });
  } finally {
    database.close();
  }
}

/**
 * Atomically consumes a server-leased DATECS identifier and writes the local
 * transaction intent before the printer can issue a receipt.
 */
export async function reserveOfflineFiscalSale(
  accountId: string,
  input: Omit<
    SavedOfflineFiscalSale,
    | 'attempts'
    | 'changeEur'
    | 'createdAt'
    | 'fiscalDocumentNumber'
    | 'fiscalReceiptsSinceDailyReport'
    | 'id'
    | 'lastError'
    | 'reportedAttemptIds'
    | 'saleNumber'
    | 'status'
    | 'syncStartedAt'
    | 'uniqueSaleId'
  >,
): Promise<SavedOfflineFiscalSale> {
  if (
    input.accountId !== accountId ||
    input.request.clientTransactionId !== input.clientTransactionId
  )
    throw new Error('The offline sale does not match the signed-in cashier.');

  const id = `${input.cashRegisterId}:${input.clientTransactionId}`;
  const key = datecsLeaseKey(
    accountId,
    input.cashRegisterId,
    input.deviceSerial,
    input.operatorIdentifier,
  );
  const database = await openDatabase();
  try {
    return await new Promise<SavedOfflineFiscalSale>((resolve, reject) => {
      const transaction = database.transaction(
        ['datecsUnpLeases', 'offlineFiscalSales'],
        'readwrite',
      );
      const leases = transaction.objectStore('datecsUnpLeases');
      const sales = transaction.objectStore('offlineFiscalSales');
      const existingRequest = sales.get(id);
      const leaseRequest = leases.get(key);
      const openSalesRequest = sales.index('byRegister').getAll(input.cashRegisterId);
      let reserved: SavedOfflineFiscalSale | undefined;
      let failure: Error | undefined;
      let ready = 0;

      const tryReserve = () => {
        ready += 1;
        if (ready !== 3 || failure) return;
        const existing = existingRequest.result as SavedOfflineFiscalSale | undefined;
        if (existing) {
          failure = new Error('This offline sale reference has already been used.');
          transaction.abort();
          return;
        }
        const pending = (openSalesRequest.result as SavedOfflineFiscalSale[]).find((sale) =>
          ['printing', 'receipt_unknown', 'conflict'].includes(sale.status),
        );
        if (pending) {
          failure = new Error(
            'Resolve the earlier offline receipt before starting another sale on this register.',
          );
          transaction.abort();
          return;
        }
        const lease = leaseRequest.result as SavedDatecsUnpLease | undefined;
        const uniqueSaleId = lease?.uniqueSaleIds[0];
        if (!lease || !uniqueSaleId) {
          failure = new Error('No saved DATECS receipt reference is available for offline use.');
          transaction.abort();
          return;
        }
        if (
          lease.accountId !== accountId ||
          lease.cashRegisterId !== input.cashRegisterId ||
          lease.deviceSerial !== input.deviceSerial ||
          lease.operatorIdentifier !== input.operatorIdentifier
        ) {
          failure = new Error('The saved DATECS receipt reference belongs to another register.');
          transaction.abort();
          return;
        }
        reserved = {
          ...input,
          attempts: [],
          createdAt: new Date().toISOString(),
          id,
          status: 'printing',
          reportedAttemptIds: [],
          uniqueSaleId,
        };
        sales.add(reserved);
        leases.put({ ...lease, uniqueSaleIds: lease.uniqueSaleIds.slice(1) });
      };

      existingRequest.onsuccess = tryReserve;
      leaseRequest.onsuccess = tryReserve;
      openSalesRequest.onsuccess = tryReserve;
      existingRequest.onerror =
        leaseRequest.onerror =
        openSalesRequest.onerror =
          () => {
            failure = new Error('The offline receipt could not be prepared on this device.');
            transaction.abort();
          };
      transaction.oncomplete = () => {
        if (reserved) resolve(reserved);
        else reject(new Error('The offline receipt could not be saved.'));
      };
      transaction.onabort = () =>
        reject(
          failure ?? transaction.error ?? new Error('The offline receipt could not be saved.'),
        );
    });
  } finally {
    database.close();
  }
}

export async function readOfflineFiscalSales(accountId: string): Promise<SavedOfflineFiscalSale[]> {
  const database = await openDatabase();
  try {
    return await new Promise<SavedOfflineFiscalSale[]>((resolve, reject) => {
      const transaction = database.transaction('offlineFiscalSales', 'readonly');
      const request = transaction
        .objectStore('offlineFiscalSales')
        .index('byAccount')
        .getAll(accountId);
      transaction.oncomplete = () =>
        resolve(
          (request.result as SavedOfflineFiscalSale[]).sort((first, second) =>
            first.createdAt.localeCompare(second.createdAt),
          ),
        );
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Offline sale history could not be read.'));
    });
  } finally {
    database.close();
  }
}

export async function countPendingOfflineFiscalSales(accountId: string): Promise<number> {
  const sales = await readOfflineFiscalSales(accountId);
  return sales.filter((sale) =>
    ['printing', 'receipt_confirmed', 'receipt_unknown', 'syncing', 'conflict'].includes(
      sale.status,
    ),
  ).length;
}

export async function updateOfflineFiscalSale(
  accountId: string,
  id: string,
  update: Partial<
    Pick<
      SavedOfflineFiscalSale,
      | 'attempts'
      | 'changeEur'
      | 'fiscalDocumentNumber'
      | 'fiscalReceiptsSinceDailyReport'
      | 'lastError'
      | 'reportedAttemptIds'
      | 'saleNumber'
      | 'status'
      | 'syncCompletedAt'
      | 'syncStartedAt'
    >
  >,
): Promise<SavedOfflineFiscalSale> {
  const database = await openDatabase();
  try {
    return await new Promise<SavedOfflineFiscalSale>((resolve, reject) => {
      const transaction = database.transaction('offlineFiscalSales', 'readwrite');
      const store = transaction.objectStore('offlineFiscalSales');
      const request = store.get(id);
      let updated: SavedOfflineFiscalSale | undefined;
      request.onsuccess = () => {
        const existing = request.result as SavedOfflineFiscalSale | undefined;
        if (!existing || existing.accountId !== accountId) {
          transaction.abort();
          return;
        }
        updated = { ...existing, ...update };
        store.put(updated);
      };
      transaction.oncomplete = () => {
        if (updated) resolve(updated);
        else reject(new Error('The offline sale could not be updated.'));
      };
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('The offline sale could not be updated.'));
    });
  } finally {
    database.close();
  }
}

export async function claimOfflineFiscalSaleForSync(
  accountId: string,
  id: string,
  now = new Date(),
): Promise<SavedOfflineFiscalSale | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise<SavedOfflineFiscalSale | undefined>((resolve, reject) => {
      const transaction = database.transaction('offlineFiscalSales', 'readwrite');
      const store = transaction.objectStore('offlineFiscalSales');
      const request = store.get(id);
      let claimed: SavedOfflineFiscalSale | undefined;
      request.onsuccess = () => {
        const sale = request.result as SavedOfflineFiscalSale | undefined;
        const staleSync =
          sale?.status === 'syncing' &&
          (!sale.syncStartedAt || now.getTime() - Date.parse(sale.syncStartedAt) > 90_000);
        if (
          !sale ||
          sale.accountId !== accountId ||
          (sale.status !== 'receipt_confirmed' && !staleSync)
        )
          return;
        claimed = { ...sale, status: 'syncing', syncStartedAt: now.toISOString() };
        store.put(claimed);
      };
      transaction.oncomplete = () => resolve(claimed);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('The offline sale could not be queued for sync.'));
    });
  } finally {
    database.close();
  }
}

export async function saveOfflineCatalog(
  accountId: string,
  shiftId: string,
  items: PosCatalogItem[],
  customerPartnerId?: string,
): Promise<void> {
  const key = cacheKey(accountId, shiftId, customerPartnerId);
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('catalogs', 'readwrite');
      const store = transaction.objectStore('catalogs');
      const request = store.get(key);
      request.onsuccess = () => {
        const existing = request.result as SavedCatalog | undefined;
        const merged = new Map((existing?.items ?? []).map((item) => [item.id, item]));
        items.forEach((item) => merged.set(item.id, item));
        store.put({
          key,
          accountId,
          shiftId,
          customerPartnerId: customerPartnerId ?? '',
          items: [...merged.values()].slice(-500),
          savedAt: new Date().toISOString(),
        } satisfies SavedCatalog);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Offline data could not be saved.'));
    });
  } finally {
    database.close();
  }
}

export async function readOfflineCatalog(
  accountId: string,
  shiftId: string,
  search?: string,
  customerPartnerId?: string,
): Promise<OfflineSnapshot<PosCatalogItem[]> | undefined> {
  const database = await openDatabase();
  let saved: SavedCatalog | undefined;
  let localSales: SavedOfflineFiscalSale[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['catalogs', 'offlineFiscalSales'], 'readonly');
      const catalogRequest = transaction
        .objectStore('catalogs')
        .get(cacheKey(accountId, shiftId, customerPartnerId));
      const salesRequest = transaction
        .objectStore('offlineFiscalSales')
        .index('byAccount')
        .getAll(accountId);
      transaction.oncomplete = () => {
        saved = catalogRequest.result as SavedCatalog | undefined;
        localSales = salesRequest.result as SavedOfflineFiscalSale[];
        resolve();
      };
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Offline catalog could not be read.'));
    });
  } finally {
    database.close();
  }
  if (!saved) return undefined;
  const snapshotAt = Date.parse(saved.savedAt);
  const salesAfterSnapshot = localSales.filter((sale) => {
    if (sale.shiftId !== shiftId || sale.status === 'cancelled') return false;
    if (sale.status !== 'synced') return true;
    const syncCompletedAt = Date.parse(sale.syncCompletedAt ?? sale.createdAt);
    return (
      !Number.isFinite(snapshotAt) ||
      !Number.isFinite(syncCompletedAt) ||
      syncCompletedAt >= snapshotAt
    );
  });
  const localQuantities = new Map<string, number>();
  const localBatchQuantities = new Map<string, number>();
  const localSerialNumbers = new Map<string, Set<string>>();
  for (const sale of salesAfterSnapshot) {
    for (const line of sale.request.lines) {
      localQuantities.set(
        line.productId,
        (localQuantities.get(line.productId) ?? 0) + Number(line.quantity),
      );
      if (line.batchId) {
        const batchKey = `${line.productId}\u0000${line.batchId}`;
        localBatchQuantities.set(
          batchKey,
          (localBatchQuantities.get(batchKey) ?? 0) + Number(line.quantity),
        );
      }
      if (line.serialNumbers?.length) {
        const serials = localSerialNumbers.get(line.productId) ?? new Set<string>();
        line.serialNumbers.forEach((serial) => serials.add(serial.toUpperCase()));
        localSerialNumbers.set(line.productId, serials);
      }
    }
  }
  const projectedItems = saved.items.map((item) => {
    const reservedQuantity = localQuantities.get(item.id);
    const projectedItem =
      reservedQuantity === undefined
        ? item
        : {
            ...item,
            availableQuantity: Math.max(
              0,
              Number(item.availableQuantity) - reservedQuantity,
            ).toFixed(4),
          };
    const reservedSerials = localSerialNumbers.get(item.id);
    const itemWithSerials = reservedSerials
      ? {
          ...projectedItem,
          serialNumbers: item.serialNumbers.filter(
            (serial) => !reservedSerials.has(serial.toUpperCase()),
          ),
        }
      : projectedItem;
    if (!item.batches.length) return itemWithSerials;
    return {
      ...itemWithSerials,
      batches: item.batches.map((batch) => {
        const batchReserved = localBatchQuantities.get(`${item.id}\u0000${batch.batchId}`);
        return batchReserved === undefined
          ? batch
          : {
              ...batch,
              quantity: Math.max(0, Number(batch.quantity) - batchReserved).toFixed(4),
            };
      }),
    };
  });
  const query = search?.trim().toLocaleLowerCase();
  const items = query
    ? projectedItems.filter((item) =>
        [item.name, item.productCode, ...item.barcodes]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query),
      )
    : projectedItems;
  return { value: items, savedAt: saved.savedAt };
}

export async function saveOfflineQuickAccess(
  accountId: string,
  shiftId: string,
  value: PosQuickAccess,
  customerPartnerId?: string,
): Promise<void> {
  const key = cacheKey(accountId, shiftId, customerPartnerId);
  await writeOne<SavedQuickAccess>('quickAccess', {
    key,
    accountId,
    shiftId,
    customerPartnerId: customerPartnerId ?? '',
    value,
    savedAt: new Date().toISOString(),
  });
}

export async function readOfflineQuickAccess(
  accountId: string,
  shiftId: string,
  customerPartnerId?: string,
): Promise<OfflineSnapshot<PosQuickAccess> | undefined> {
  const saved = await readOne<SavedQuickAccess>(
    'quickAccess',
    cacheKey(accountId, shiftId, customerPartnerId),
  );
  return saved ? { value: saved.value, savedAt: saved.savedAt } : undefined;
}

export async function saveOfflineBasket(basket: SavedBasket): Promise<void> {
  await writeOne('baskets', basket);
}

export async function readOfflineBasket(accountId: string): Promise<SavedBasket | undefined> {
  return readOne<SavedBasket>('baskets', accountId);
}

export async function clearOfflineBasket(accountId: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('baskets', 'readwrite');
      transaction.objectStore('baskets').delete(accountId);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Saved sale could not be cleared.'));
    });
  } finally {
    database.close();
  }
}
