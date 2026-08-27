import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { describe, expect, it } from 'vitest';

import { fixtureId } from '../database/development-fixtures.js';
import { CreatePurchaseOrderDto, CreateSupplierInvoiceDto } from './procurement.dto.js';

describe('CreatePurchaseOrderDto', () => {
  it('accepts deterministic fixture UUIDs selected by the Procurement screen', async () => {
    const input = plainToInstance(CreatePurchaseOrderDto, {
      currencyCode: 'BGN',
      lines: [
        {
          expectedDeliveryDate: '2026-09-01',
          productId: fixtureId('catalog:product:fiscal-register'),
          quantity: '1',
          unitPrice: '750',
        },
      ],
      supplierPartnerId: fixtureId('partner:supplier'),
      warehouseId: fixtureId('warehouse:central'),
    });

    expect(await validate(input)).toEqual([]);
  });

  it('rejects malformed purchase-order entity references', async () => {
    const input = plainToInstance(CreatePurchaseOrderDto, {
      currencyCode: 'BGN',
      lines: [
        {
          expectedDeliveryDate: '2026-09-01',
          productId: 'not-a-product',
          quantity: '1',
          unitPrice: '750',
        },
      ],
      supplierPartnerId: 'not-a-supplier',
      warehouseId: 'not-a-warehouse',
    });

    const errors = await validate(input);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['lines', 'supplierPartnerId', 'warehouseId']),
    );
  });
});

describe('CreateSupplierInvoiceDto', () => {
  it('accepts a supplier invoice with a recorded standard VAT snapshot', async () => {
    const input = plainToInstance(CreateSupplierInvoiceDto, {
      invoiceDate: '2026-08-25',
      invoiceNumber: 'TEST-SUP-2026-001',
      lines: [
        {
          orderLineId: fixtureId('procurement-order-line:open-adapter'),
          quantity: '2',
          unitPrice: '12.50',
          vatTreatment: 'standard_20',
        },
      ],
      purchaseOrderId: fixtureId('procurement-order:open'),
    });

    expect(await validate(input)).toEqual([]);
  });

  it('rejects an intra-community acquisition without its recorded rate', async () => {
    const input = plainToInstance(CreateSupplierInvoiceDto, {
      invoiceDate: '2026-08-25',
      invoiceNumber: 'TEST-SUP-2026-002',
      lines: [
        {
          orderLineId: fixtureId('procurement-order-line:open-adapter'),
          quantity: '2',
          unitPrice: '12.50',
          vatTreatment: 'ica',
        },
      ],
      purchaseOrderId: fixtureId('procurement-order:open'),
    });

    const errors = await validate(input);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('lines');
    expect(errors[0]?.children?.[0]?.children?.map((error) => error.property)).toContain('vatRate');
  });
});
