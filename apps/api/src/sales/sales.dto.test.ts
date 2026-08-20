import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { fixtureId } from '../database/development-fixtures.js';
import { CreateSalesQuotationDto } from './sales.dto.js';

describe('CreateSalesQuotationDto', () => {
  it('accepts stable PostgreSQL UUID references returned by development fixtures', async () => {
    const input = plainToInstance(CreateSalesQuotationDto, {
      currencyCode: 'BGN',
      customerPartnerId: fixtureId('partner:balkan'),
      lines: [
        {
          discountPercent: '0',
          productId: fixtureId('catalog:product:adapter'),
          quantity: '1',
          unitPrice: '50',
          vatTreatment: 'standard_20',
        },
      ],
      overallDiscountPercent: '0',
      validUntil: '2026-09-03',
      warehouseId: fixtureId('warehouse:central'),
    });

    expect(await validate(input)).toEqual([]);
  });

  it('still rejects malformed Sales references', async () => {
    const input = plainToInstance(CreateSalesQuotationDto, {
      currencyCode: 'BGN',
      customerPartnerId: fixtureId('partner:balkan'),
      lines: [
        {
          discountPercent: '0',
          productId: 'not-a-uuid',
          quantity: '1',
          unitPrice: '50',
          vatTreatment: 'standard_20',
        },
      ],
      overallDiscountPercent: '0',
      validUntil: '2026-09-03',
      warehouseId: fixtureId('warehouse:central'),
    });

    const errors = await validate(input);
    expect(errors.some(({ property }) => property === 'lines')).toBe(true);
  });
});
