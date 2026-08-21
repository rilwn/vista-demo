import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { ReceiveStockDto } from './inventory.dto.js';

describe('ReceiveStockDto', () => {
  it('accepts deterministic fixture UUIDs for browser warehouse movements', async () => {
    const input = Object.assign(new ReceiveStockDto(), {
      productId: '564edc0f-1057-d53c-7808-8286a4c2c39e',
      quantity: '20',
      referenceId: 'TEST-RESTOCK-2026-08-21-01',
      unitCostBgn: '12.50',
      warehouseId: '3c3e7e88-8450-40a8-a3e2-e9311b40c16a',
    });

    expect(await validate(input)).toEqual([]);
  });

  it('still rejects malformed entity identifiers', async () => {
    const input = Object.assign(new ReceiveStockDto(), {
      productId: 'not-a-product-id',
      quantity: '20',
      referenceId: 'TEST-RESTOCK-2026-08-21-01',
      unitCostBgn: '12.50',
      warehouseId: '3c3e7e88-8450-40a8-a3e2-e9311b40c16a',
    });

    expect((await validate(input)).map((error) => error.property)).toContain('productId');
  });
});
