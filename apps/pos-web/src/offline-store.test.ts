import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreatePosSaleRequest,
  PosCatalogItem,
  PosCustomerOption,
  PosFiscalReceiptLine,
  PosQuickAccess,
  PosTerminalContext,
} from '@vista/contracts';
import {
  readOfflineCatalog,
  readOfflineContext,
  readOfflineQuickAccess,
  readOfflineBasket,
  readOfflineDatecsUnpLease,
  readOfflinePosCustomers,
  readFiscalOutcomeHistory,
  saveOfflineBasket,
  saveOfflineDatecsUnpLease,
  saveOfflineCatalog,
  saveOfflineContext,
  saveOfflinePosCustomers,
  saveOfflineQuickAccess,
  IndexedDbFiscalOutcomeLockStore,
  consumeOfflineDatecsUnpLease,
  countPendingOfflineFiscalSales,
  claimOfflineFiscalSaleForSync,
  readOfflineFiscalSales,
  reserveOfflineFiscalSale,
  updateOfflineFiscalSale,
  reviewFiscalOutcome,
  type SavedOfflineFiscalSale,
} from './offline-store';

const item = (id: string, name: string): PosCatalogItem => ({
  id,
  name,
  productCode: `CODE-${id}`,
  barcodes: [`BAR-${id}`],
  serialNumbers: [],
  batches: [],
  availableQuantity: '3.0000',
  currencyCode: 'EUR',
  trackingMode: 'none',
  unitCode: 'PCS',
  unitPrice: '10.0000',
  vatTreatment: 'standard_20',
});

const context: PosTerminalContext = {
  currentShift: {
    cashRegisterId: 'register-1',
    cashRegisterName: 'Counter 1',
    expectedCashEur: '0.0000',
    id: 'shift-1',
    openedAt: '2026-10-27T08:00:00.000Z',
    openingCashEur: '0.0000',
    operatorCode: 'OP-01',
    operatorId: 'operator-1',
    shiftNumber: 'SHIFT-01',
    status: 'open',
    version: 1,
    warehouseId: 'warehouse-1',
    warehouseName: 'Central warehouse',
  },
  registers: [],
};

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());

describe('POS offline snapshots', () => {
  it('upgrades previously saved reconciliation attempts without losing their retry trail', async () => {
    const request = indexedDB.open('vista-pos-offline', 5);
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('offlineFiscalSales', { keyPath: 'id' });
        store.createIndex('byAccount', 'accountId', { unique: false });
        store.createIndex('byRegister', 'cashRegisterId', { unique: false });
        store.add({
          accountId: 'operator-1',
          attempts: [
            { at: '2026-10-27T08:00:00.000Z', outcome: 'retry' },
            { at: '2026-10-27T08:01:00.000Z', outcome: 'conflict' },
          ],
          cashRegisterId: 'register-1',
          cashTenderedEur: '12.00',
          clientTransactionId: 'transaction-1',
          createdAt: '2026-10-27T08:00:00.000Z',
          deviceSerial: 'DT000600',
          id: 'register-1:transaction-1',
          operatorIdentifier: 'OP01',
          receiptLines: [],
          request: {
            clientTransactionId: 'transaction-1',
            lines: [],
            payments: [],
            shiftId: 'shift-1',
          },
          shiftId: 'shift-1',
          status: 'receipt_confirmed',
          totalGrossEur: '12.00',
          uniqueSaleId: 'DT000600-OP01-0001000',
        } satisfies SavedOfflineFiscalSale);
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });

    const [upgraded] = await readOfflineFiscalSales('operator-1');

    expect(upgraded?.attempts).toHaveLength(2);
    expect(
      upgraded?.attempts.every((attempt) => /^[0-9a-f-]{36}$/iu.test(attempt.eventId ?? '')),
    ).toBe(true);
    expect(upgraded?.reportedAttemptIds).toEqual([]);
    expect(upgraded?.status).toBe('receipt_confirmed');
  });

  it('stores the authorized terminal context without caching a session token', async () => {
    await saveOfflineContext('operator-1', context);

    expect((await readOfflineContext('operator-1'))?.value).toEqual(context);
    expect(await readOfflineContext('another-operator')).toBeUndefined();
    expect(JSON.stringify(await readOfflineContext('operator-1'))).not.toContain('token');
  });

  it('merges browsed products and searches cached names, codes, and barcodes', async () => {
    await saveOfflineCatalog('operator-1', 'shift-1', [item('1', 'Adapter')]);
    await saveOfflineCatalog('operator-1', 'shift-1', [item('2', 'Fiscal Register')]);

    expect((await readOfflineCatalog('operator-1', 'shift-1'))?.value).toHaveLength(2);
    expect((await readOfflineCatalog('operator-1', 'shift-1', 'bar-2'))?.value[0]?.name).toBe(
      'Fiscal Register',
    );
    expect((await readOfflineCatalog('operator-1', 'shift-1', 'CODE-1'))?.value[0]?.name).toBe(
      'Adapter',
    );
  });

  it('keeps cached prices and stock separated by customer and open shift', async () => {
    await saveOfflineCatalog('operator-1', 'shift-1', [item('1', 'Counter price')]);
    await saveOfflineCatalog('operator-1', 'shift-1', [item('1', 'Contract price')], 'customer-1');

    expect((await readOfflineCatalog('operator-1', 'shift-1'))?.value[0]?.name).toBe(
      'Counter price',
    );
    expect(
      (await readOfflineCatalog('operator-1', 'shift-1', undefined, 'customer-1'))?.value[0]?.name,
    ).toBe('Contract price');
    expect(await readOfflineCatalog('operator-1', 'shift-2')).toBeUndefined();
    expect(await readOfflineCatalog('another-operator', 'shift-1')).toBeUndefined();
  });

  it('caches only cashier-needed customer details and scopes them to the account', async () => {
    const customer: PosCustomerOption = {
      id: 'customer-1',
      loyalty: {
        balance: 99,
        cardNumber: 'PRIVATE-LOYALTY-CARD',
        id: 'loyalty-1',
        programName: 'Rewards',
        redemptionValueEur: '0.0100',
        status: 'active',
      },
      locations: [{ city: 'Vratsa', id: 'location-1', name: 'Central store' }],
      name: 'Alfa Market Demo Ltd.',
      uic: '206666666',
      vatNumber: 'BG206666666',
    };
    await saveOfflinePosCustomers('operator-1', [customer]);

    expect(await readOfflinePosCustomers('operator-1')).toMatchObject({
      value: [
        {
          id: 'customer-1',
          name: customer.name,
          locations: customer.locations,
          uic: customer.uic,
          vatNumber: customer.vatNumber,
        },
      ],
    });
    expect(await readOfflinePosCustomers('operator-2')).toBeUndefined();
    expect((await readOfflinePosCustomers('operator-1', 'BG206'))?.value).toHaveLength(1);
    expect(JSON.stringify(await readOfflinePosCustomers('operator-1'))).not.toContain(
      'PRIVATE-LOYALTY-CARD',
    );
  });

  it('keeps quick-access products scoped to the account, shift, and customer', async () => {
    const quickAccess: PosQuickAccess = {
      cashRegisterId: 'register-1',
      items: [item('1', 'Adapter')],
      productIds: ['1'],
    };
    await saveOfflineQuickAccess('operator-1', 'shift-1', quickAccess);

    expect((await readOfflineQuickAccess('operator-1', 'shift-1'))?.value).toEqual(quickAccess);
    expect(await readOfflineQuickAccess('another-operator', 'shift-1')).toBeUndefined();
    expect(await readOfflineQuickAccess('operator-1', 'shift-1', 'customer-1')).toBeUndefined();
  });

  it('saves an unfinished basket with its stable sale ID but no payment credentials', async () => {
    const basket = {
      accountId: 'operator-1',
      shiftId: 'shift-1',
      transactionId: 'transaction-1',
      lines: [{ item: item('1', 'Adapter'), quantity: 2 }],
      savedAt: '2026-10-27T08:00:00.000Z',
    };
    await saveOfflineBasket(basket);

    expect(await readOfflineBasket('operator-1')).toEqual(basket);
    expect(await readOfflineBasket('another-operator')).toBeUndefined();
    expect(JSON.stringify(await readOfflineBasket('operator-1'))).not.toContain('token');
  });

  it('stores DATECS receipt references by cashier, register, device, and operator and consumes them once', async () => {
    const lease = {
      cashRegisterId: 'register-1',
      deviceSerial: 'DT000600',
      operatorIdentifier: 'OP01',
      uniqueSaleIds: ['DT000600-OP01-0001000', 'DT000600-OP01-0001001'],
    };
    await saveOfflineDatecsUnpLease('operator-1', lease);

    expect(
      (await readOfflineDatecsUnpLease('operator-1', 'register-1', 'DT000600', 'OP01'))?.value,
    ).toEqual(lease);
    expect(
      await readOfflineDatecsUnpLease('operator-2', 'register-1', 'DT000600', 'OP01'),
    ).toBeUndefined();
    expect(
      await readOfflineDatecsUnpLease('operator-1', 'register-2', 'DT000600', 'OP01'),
    ).toBeUndefined();

    expect(await consumeOfflineDatecsUnpLease('operator-1', 'register-1', 'DT000600', 'OP01')).toBe(
      'DT000600-OP01-0001000',
    );
    expect(await consumeOfflineDatecsUnpLease('operator-1', 'register-1', 'DT000600', 'OP01')).toBe(
      'DT000600-OP01-0001001',
    );
    expect(
      await consumeOfflineDatecsUnpLease('operator-1', 'register-1', 'DT000600', 'OP01'),
    ).toBeUndefined();
  });

  it('rejects receipt references that do not belong to the configured DATECS device and operator', async () => {
    await expect(
      saveOfflineDatecsUnpLease('operator-1', {
        cashRegisterId: 'register-1',
        deviceSerial: 'DT000600',
        operatorIdentifier: 'OP01',
        uniqueSaleIds: ['DT000600-OP02-0001000'],
      }),
    ).rejects.toThrow('references are invalid');
  });

  it('atomically saves an offline receipt intent with a one-use DATECS reference', async () => {
    await saveOfflineDatecsUnpLease('operator-1', {
      cashRegisterId: 'register-1',
      deviceSerial: 'DT000600',
      operatorIdentifier: 'OP01',
      uniqueSaleIds: ['DT000600-OP01-0001000', 'DT000600-OP01-0001001'],
    });
    const request: CreatePosSaleRequest = {
      clientTransactionId: 'offline-transaction-1',
      lines: [{ productId: 'product-1', quantity: '1.0000' }],
      payments: [{ amount: '12.00', method: 'cash', tenderedAmount: '20.00' }],
      shiftId: 'shift-1',
    };
    const receiptLines: PosFiscalReceiptLine[] = [
      {
        description: 'Adapter',
        grossTotalEur: '12.00',
        quantity: '1',
        unitCode: 'PCS',
        unitPriceEur: '12.00',
        vatTreatment: 'standard_20',
      },
    ];
    const intent = await reserveOfflineFiscalSale('operator-1', {
      accountId: 'operator-1',
      cashRegisterId: 'register-1',
      cashTenderedEur: '20.00',
      clientTransactionId: request.clientTransactionId,
      deviceSerial: 'DT000600',
      operatorIdentifier: 'OP01',
      receiptLines,
      request,
      shiftId: 'shift-1',
      totalGrossEur: '12.00',
    });

    expect(intent).toMatchObject({
      status: 'printing',
      uniqueSaleId: 'DT000600-OP01-0001000',
    });
    expect(await countPendingOfflineFiscalSales('operator-1')).toBe(1);
    expect(
      (await readOfflineDatecsUnpLease('operator-1', 'register-1', 'DT000600', 'OP01'))?.value
        .uniqueSaleIds,
    ).toEqual(['DT000600-OP01-0001001']);
    await expect(
      reserveOfflineFiscalSale('operator-1', {
        accountId: 'operator-1',
        cashRegisterId: 'register-1',
        cashTenderedEur: '20.00',
        clientTransactionId: 'offline-transaction-2',
        deviceSerial: 'DT000600',
        operatorIdentifier: 'OP01',
        receiptLines,
        request: { ...request, clientTransactionId: 'offline-transaction-2' },
        shiftId: 'shift-1',
        totalGrossEur: '12.00',
      }),
    ).rejects.toThrow('Resolve the earlier offline receipt');

    await updateOfflineFiscalSale('operator-1', intent.id, {
      changeEur: '8.00',
      fiscalDocumentNumber: '001234',
      status: 'receipt_confirmed',
    });
    const second = await reserveOfflineFiscalSale('operator-1', {
      accountId: 'operator-1',
      cashRegisterId: 'register-1',
      cashTenderedEur: '20.00',
      clientTransactionId: 'offline-transaction-2',
      deviceSerial: 'DT000600',
      operatorIdentifier: 'OP01',
      receiptLines,
      request: { ...request, clientTransactionId: 'offline-transaction-2' },
      shiftId: 'shift-1',
      totalGrossEur: '12.00',
    });
    expect(second.uniqueSaleId).toBe('DT000600-OP01-0001001');
  });

  it('reserves locally sold quantity and avoids subtracting a sale after a fresh stock snapshot', async () => {
    await saveOfflineCatalog('operator-1', 'shift-1', [item('product-1', 'Adapter')]);
    await saveOfflineDatecsUnpLease('operator-1', {
      cashRegisterId: 'register-1',
      deviceSerial: 'DT000600',
      operatorIdentifier: 'OP01',
      uniqueSaleIds: ['DT000600-OP01-0001000'],
    });
    const request: CreatePosSaleRequest = {
      clientTransactionId: 'offline-stock-reservation-1',
      lines: [{ productId: 'product-1', quantity: '2.0000' }],
      payments: [{ amount: '24.00', method: 'cash', tenderedAmount: '24.00' }],
      shiftId: 'shift-1',
    };
    const sale = await reserveOfflineFiscalSale('operator-1', {
      accountId: 'operator-1',
      cashRegisterId: 'register-1',
      cashTenderedEur: '24.00',
      clientTransactionId: request.clientTransactionId,
      deviceSerial: 'DT000600',
      operatorIdentifier: 'OP01',
      receiptLines: [
        {
          description: 'Adapter',
          grossTotalEur: '24.00',
          quantity: '2',
          unitCode: 'PCS',
          unitPriceEur: '12.00',
          vatTreatment: 'standard_20',
        },
      ],
      request,
      shiftId: 'shift-1',
      totalGrossEur: '24.00',
    });
    await updateOfflineFiscalSale('operator-1', sale.id, {
      changeEur: '0.00',
      fiscalDocumentNumber: '001235',
      status: 'receipt_confirmed',
    });
    expect((await readOfflineCatalog('operator-1', 'shift-1'))?.value[0]?.availableQuantity).toBe(
      '1.0000',
    );

    const syncCompletedAt = new Date(Date.now() + 2).toISOString();
    await updateOfflineFiscalSale('operator-1', sale.id, {
      saleNumber: 'POS-2026-000010',
      status: 'synced',
      syncCompletedAt,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveOfflineCatalog('operator-1', 'shift-1', [
      { ...item('product-1', 'Adapter'), availableQuantity: '1.0000' },
    ]);
    expect((await readOfflineCatalog('operator-1', 'shift-1'))?.value[0]?.availableQuantity).toBe(
      '1.0000',
    );
    await updateOfflineFiscalSale('operator-1', sale.id, { syncCompletedAt: 'invalid' });
    expect((await readOfflineCatalog('operator-1', 'shift-1'))?.value[0]?.availableQuantity).toBe(
      '0.0000',
    );
  });

  it('reserves offline batch sales against that batch until a fresh stock snapshot arrives', async () => {
    const batchItem: PosCatalogItem = {
      ...item('batch-product', 'Receipt rolls'),
      availableQuantity: '3.0000',
      batches: [
        { batchId: 'batch-1', batchNumber: 'LOT-01', quantity: '1.0000' },
        { batchId: 'batch-2', batchNumber: 'LOT-02', quantity: '2.0000' },
      ],
      trackingMode: 'batch',
    };
    await saveOfflineCatalog('operator-1', 'shift-1', [batchItem]);
    await saveOfflineDatecsUnpLease('operator-1', {
      cashRegisterId: 'register-1',
      deviceSerial: 'DT000600',
      operatorIdentifier: 'OP01',
      uniqueSaleIds: ['DT000600-OP01-0001000'],
    });
    const request: CreatePosSaleRequest = {
      clientTransactionId: 'offline-batch-sale-1',
      lines: [{ batchId: 'batch-1', productId: 'batch-product', quantity: '1.0000' }],
      payments: [{ amount: '12.00', method: 'cash', tenderedAmount: '12.00' }],
      shiftId: 'shift-1',
    };
    const sale = await reserveOfflineFiscalSale('operator-1', {
      accountId: 'operator-1',
      cashRegisterId: 'register-1',
      cashTenderedEur: '12.00',
      clientTransactionId: request.clientTransactionId,
      deviceSerial: 'DT000600',
      operatorIdentifier: 'OP01',
      receiptLines: [
        {
          description: 'Receipt rolls',
          grossTotalEur: '12.00',
          quantity: '1',
          unitCode: 'PCS',
          unitPriceEur: '12.00',
          vatTreatment: 'standard_20',
        },
      ],
      request,
      shiftId: 'shift-1',
      totalGrossEur: '12.00',
    });
    await updateOfflineFiscalSale('operator-1', sale.id, {
      changeEur: '0.00',
      fiscalDocumentNumber: '001236',
      status: 'receipt_confirmed',
    });

    expect((await readOfflineCatalog('operator-1', 'shift-1'))?.value[0]).toMatchObject({
      availableQuantity: '2.0000',
      batches: [
        { batchId: 'batch-1', quantity: '0.0000' },
        { batchId: 'batch-2', quantity: '2.0000' },
      ],
    });

    const syncCompletedAt = new Date(Date.now() + 2).toISOString();
    await updateOfflineFiscalSale('operator-1', sale.id, {
      saleNumber: 'POS-2026-000011',
      status: 'synced',
      syncCompletedAt,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveOfflineCatalog('operator-1', 'shift-1', [
      {
        ...batchItem,
        availableQuantity: '2.0000',
        batches: [
          { batchId: 'batch-1', batchNumber: 'LOT-01', quantity: '0.0000' },
          { batchId: 'batch-2', batchNumber: 'LOT-02', quantity: '2.0000' },
        ],
      },
    ]);
    expect((await readOfflineCatalog('operator-1', 'shift-1'))?.value[0]).toMatchObject({
      availableQuantity: '2.0000',
      batches: [
        { batchId: 'batch-1', quantity: '0.0000' },
        { batchId: 'batch-2', quantity: '2.0000' },
      ],
    });
  });

  it('reserves offline serial sales locally until a fresh stock snapshot arrives', async () => {
    const serialItem: PosCatalogItem = {
      ...item('serial-product', 'Demo Fiscal Register X1'),
      availableQuantity: '2.0000',
      serialNumbers: ['SERIAL-001', 'SERIAL-002'],
      trackingMode: 'serial',
    };
    await saveOfflineCatalog('operator-1', 'shift-1', [serialItem]);
    await saveOfflineDatecsUnpLease('operator-1', {
      cashRegisterId: 'register-1',
      deviceSerial: 'DT000600',
      operatorIdentifier: 'OP01',
      uniqueSaleIds: ['DT000600-OP01-0001000'],
    });
    const request: CreatePosSaleRequest = {
      clientTransactionId: 'offline-serial-sale-1',
      lines: [
        {
          productId: 'serial-product',
          quantity: '1.0000',
          serialNumbers: ['SERIAL-001'],
        },
      ],
      payments: [{ amount: '12.00', method: 'cash', tenderedAmount: '12.00' }],
      shiftId: 'shift-1',
    };
    const sale = await reserveOfflineFiscalSale('operator-1', {
      accountId: 'operator-1',
      cashRegisterId: 'register-1',
      cashTenderedEur: '12.00',
      clientTransactionId: request.clientTransactionId,
      deviceSerial: 'DT000600',
      operatorIdentifier: 'OP01',
      receiptLines: [
        {
          description: 'Demo Fiscal Register X1',
          grossTotalEur: '12.00',
          quantity: '1',
          unitCode: 'PCS',
          unitPriceEur: '12.00',
          vatTreatment: 'standard_20',
        },
      ],
      request,
      shiftId: 'shift-1',
      totalGrossEur: '12.00',
    });
    await updateOfflineFiscalSale('operator-1', sale.id, {
      changeEur: '0.00',
      fiscalDocumentNumber: '001237',
      status: 'receipt_confirmed',
    });
    expect((await readOfflineCatalog('operator-1', 'shift-1'))?.value[0]).toMatchObject({
      availableQuantity: '1.0000',
      serialNumbers: ['SERIAL-002'],
    });

    const syncCompletedAt = new Date(Date.now() + 2).toISOString();
    await updateOfflineFiscalSale('operator-1', sale.id, {
      saleNumber: 'POS-2026-000012',
      status: 'synced',
      syncCompletedAt,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveOfflineCatalog('operator-1', 'shift-1', [
      { ...serialItem, availableQuantity: '1.0000', serialNumbers: ['SERIAL-002'] },
    ]);
    expect((await readOfflineCatalog('operator-1', 'shift-1'))?.value[0]).toMatchObject({
      availableQuantity: '1.0000',
      serialNumbers: ['SERIAL-002'],
    });
  });

  it('claims an offline sale for synchronization only once across tabs', async () => {
    await saveOfflineDatecsUnpLease('operator-1', {
      cashRegisterId: 'register-1',
      deviceSerial: 'DT000600',
      operatorIdentifier: 'OP01',
      uniqueSaleIds: ['DT000600-OP01-0001000'],
    });
    const request: CreatePosSaleRequest = {
      clientTransactionId: 'offline-transaction-1',
      lines: [{ productId: 'product-1', quantity: '1.0000' }],
      payments: [{ amount: '12.00', method: 'cash', tenderedAmount: '12.00' }],
      shiftId: 'shift-1',
    };
    const intent = await reserveOfflineFiscalSale('operator-1', {
      accountId: 'operator-1',
      cashRegisterId: 'register-1',
      cashTenderedEur: '12.00',
      clientTransactionId: request.clientTransactionId,
      deviceSerial: 'DT000600',
      operatorIdentifier: 'OP01',
      receiptLines: [
        {
          description: 'Adapter',
          grossTotalEur: '12.00',
          quantity: '1',
          unitPriceEur: '12.00',
          vatTreatment: 'standard_20',
        },
      ],
      request,
      shiftId: 'shift-1',
      totalGrossEur: '12.00',
    });
    await updateOfflineFiscalSale('operator-1', intent.id, {
      changeEur: '0.00',
      fiscalDocumentNumber: '001234',
      status: 'receipt_confirmed',
    });

    const [first, second] = await Promise.all([
      claimOfflineFiscalSaleForSync('operator-1', intent.id),
      claimOfflineFiscalSaleForSync('operator-1', intent.id),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect((await readOfflineFiscalSales('operator-1'))[0]?.status).toBe('syncing');
  });

  it('persists an uncertain fiscal command across client restarts until it is reviewed', async () => {
    const store = new IndexedDbFiscalOutcomeLockStore();
    await store.recordUnresolved({
      accountId: 'operator-1',
      clientTransactionId: 'sale-001',
      commandCode: 0x38,
      createdAt: '2026-10-27T08:15:00.000Z',
      registerId: 'register-1',
    });

    expect(await new IndexedDbFiscalOutcomeLockStore().findUnresolved('register-1')).toMatchObject({
      clientTransactionId: 'sale-001',
      status: 'unresolved',
    });
    await expect(
      store.recordUnresolved({
        accountId: 'operator-2',
        clientTransactionId: 'sale-002',
        commandCode: 0x30,
        createdAt: '2026-10-27T08:16:00.000Z',
        registerId: 'register-1',
      }),
    ).rejects.toThrow('already waiting for review');

    await reviewFiscalOutcome('register-1', 'sale-001', {
      decision: 'receipt_confirmed',
      fiscalReceiptNumber: '000123',
      note: 'Compared the printed receipt with the cash drawer copy.',
      reviewedAt: '2026-10-27T08:20:00.000Z',
      reviewerAccountId: 'operator-1',
    });

    expect(await store.findUnresolved('register-1')).toBeUndefined();
    expect(await readFiscalOutcomeHistory('register-1')).toMatchObject([
      {
        clientTransactionId: 'sale-001',
        review: { decision: 'receipt_confirmed' },
        status: 'reviewed',
      },
    ]);
  });

  it('requires evidence before confirming an uncertain receipt', async () => {
    await expect(
      reviewFiscalOutcome('register-1', 'missing', {
        decision: 'receipt_confirmed',
        note: 'Reviewed the printer.',
        reviewedAt: '2026-10-27T08:20:00.000Z',
        reviewerAccountId: 'operator-1',
      }),
    ).rejects.toThrow('receipt number or unique sale ID');
  });
});
