import type { PosCatalogItem } from '@vista/contracts';
import { describe, expect, it } from 'vitest';

import { exceedsCachedOfflineStock, offlineFiscalLinesFor } from './offline-fiscal-lines';

const item = (id: string, overrides: Partial<PosCatalogItem> = {}): PosCatalogItem => ({
  id,
  name: `Product ${id}`,
  productCode: `CODE-${id}`,
  barcodes: [],
  serialNumbers: [],
  batches: [],
  availableQuantity: '5.0000',
  currencyCode: 'EUR',
  trackingMode: 'none',
  unitCode: 'PCS',
  unitPrice: '10.0000',
  vatTreatment: 'standard_20',
  ...overrides,
});

describe('offline DATECS receipt lines', () => {
  it('prices multi-product and multi-quantity baskets using cached VAT treatment', () => {
    expect(
      offlineFiscalLinesFor([
        { item: item('1'), quantity: 2 },
        { item: item('2', { unitPrice: '1.0000', vatTreatment: 'reduced_9' }), quantity: 3 },
      ]),
    ).toEqual([
      {
        description: 'Product 1',
        grossTotalEur: '24.00',
        quantity: '2',
        unitCode: 'PCS',
        unitPriceEur: '12.00',
        vatTreatment: 'standard_20',
      },
      {
        description: 'Product 2',
        grossTotalEur: '3.27',
        quantity: '3',
        unitCode: 'PCS',
        unitPriceEur: '1.09',
        vatTreatment: 'reduced_9',
      },
    ]);
  });

  it('supports selected cached batches and serials while refusing incomplete or fractional lines', () => {
    expect(offlineFiscalLinesFor([])).toBeUndefined();
    expect(offlineFiscalLinesFor([{ item: item('1'), quantity: 1.5 }])).toBeUndefined();
    expect(offlineFiscalLinesFor([{ item: item('1'), quantity: 0 }])).toBeUndefined();
    const serialItem = item('serial-product', {
      availableQuantity: '2.0000',
      serialNumbers: ['SN-001', 'SN-002'],
      trackingMode: 'serial',
    });
    expect(
      offlineFiscalLinesFor([{ item: serialItem, serialNumber: 'sn-001', quantity: 1 }]),
    ).toEqual([
      {
        description: 'Product serial-product',
        grossTotalEur: '12.00',
        quantity: '1',
        unitCode: 'PCS',
        unitPriceEur: '12.00',
        vatTreatment: 'standard_20',
      },
    ]);
    expect(offlineFiscalLinesFor([{ item: serialItem, quantity: 1 }])).toBeUndefined();
    expect(
      offlineFiscalLinesFor([{ item: serialItem, serialNumber: 'SN-NOT-SAVED', quantity: 1 }]),
    ).toBeUndefined();
    expect(offlineFiscalLinesFor([{ item: serialItem, serialNumber: 'SN-001', quantity: 2 }])).toBe(
      undefined,
    );
    const batchItem = item('batch-product', {
      batches: [
        { batchId: 'batch-1', batchNumber: 'LOT-01', quantity: '2.0000' },
        { batchId: 'batch-2', batchNumber: 'LOT-02', quantity: '3.0000' },
      ],
      trackingMode: 'batch',
    });
    expect(offlineFiscalLinesFor([{ item: batchItem, batchId: 'batch-1', quantity: 2 }])).toEqual([
      {
        description: 'Product batch-product',
        grossTotalEur: '24.00',
        quantity: '2',
        unitCode: 'PCS',
        unitPriceEur: '12.00',
        vatTreatment: 'standard_20',
      },
    ]);
    expect(offlineFiscalLinesFor([{ item: batchItem, quantity: 1 }])).toBeUndefined();
    expect(
      offlineFiscalLinesFor([{ item: batchItem, batchId: 'not-cached', quantity: 1 }]),
    ).toBeUndefined();
    expect(
      offlineFiscalLinesFor([{ item: batchItem, batchId: 'batch-1', quantity: 3 }]),
    ).toBeUndefined();
  });

  it('checks combined quantity against cached stock for each product', () => {
    expect(
      exceedsCachedOfflineStock([
        { item: item('1', { availableQuantity: '3.0000' }), quantity: 2 },
        { item: item('1', { availableQuantity: '3.0000' }), quantity: 2 },
      ]),
    ).toBe(true);
    expect(
      exceedsCachedOfflineStock([
        { item: item('1', { availableQuantity: '3.0000' }), quantity: 2 },
        { item: item('2', { availableQuantity: '3.0000' }), quantity: 2 },
      ]),
    ).toBe(false);
  });

  it('checks requested quantity against the selected cached batch', () => {
    const batchItem = item('batch-product', {
      availableQuantity: '5.0000',
      batches: [
        { batchId: 'batch-1', batchNumber: 'LOT-01', quantity: '2.0000' },
        { batchId: 'batch-2', batchNumber: 'LOT-02', quantity: '3.0000' },
      ],
      trackingMode: 'batch',
    });
    expect(
      exceedsCachedOfflineStock([
        { item: batchItem, batchId: 'batch-1', quantity: 2 },
        { item: batchItem, batchId: 'batch-1', quantity: 1 },
      ]),
    ).toBe(true);
    expect(
      exceedsCachedOfflineStock([
        { item: batchItem, batchId: 'batch-1', quantity: 2 },
        { item: batchItem, batchId: 'batch-2', quantity: 3 },
      ]),
    ).toBe(false);
    expect(exceedsCachedOfflineStock([{ item: batchItem, quantity: 1 }])).toBe(true);
  });

  it('reserves only selected cached serials and does not allow local duplicate selection', () => {
    const serialItem = item('serial-product', {
      availableQuantity: '2.0000',
      serialNumbers: ['SN-001', 'SN-002'],
      trackingMode: 'serial',
    });
    expect(
      exceedsCachedOfflineStock([{ item: serialItem, serialNumber: 'SN-001', quantity: 1 }]),
    ).toBe(false);
    expect(
      exceedsCachedOfflineStock([
        { item: serialItem, serialNumber: 'SN-001', quantity: 1 },
        { item: serialItem, serialNumber: 'sn-001', quantity: 1 },
      ]),
    ).toBe(true);
    expect(
      exceedsCachedOfflineStock([{ item: serialItem, serialNumber: 'SN-003', quantity: 1 }]),
    ).toBe(true);
    expect(
      exceedsCachedOfflineStock([{ item: serialItem, serialNumber: 'SN-001', quantity: 2 }]),
    ).toBe(true);
  });
});
