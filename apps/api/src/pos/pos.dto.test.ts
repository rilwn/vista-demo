import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import {
  ClosePosShiftDto,
  CreatePosCashSaleDto,
  OpenPosShiftDto,
  PosCatalogQueryDto,
} from './pos.dto.js';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('POS request validation', () => {
  it('accepts a complete cashier shift request', async () => {
    const input = plainToInstance(OpenPosShiftDto, {
      cashRegisterId: uuid,
      openingCashBgn: '100.0000',
    });
    expect(await validate(input)).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(ClosePosShiftDto, {
          closingCashBgn: '100.0000',
          version: 1,
        }),
      ),
    ).toHaveLength(0);
  });

  it('rejects negative opening cash and malformed catalog context', async () => {
    const shift = plainToInstance(OpenPosShiftDto, {
      cashRegisterId: uuid,
      openingCashBgn: '-1',
    });
    const catalog = plainToInstance(PosCatalogQueryDto, {
      page: 0,
      pageSize: 101,
      shiftId: 'not-a-uuid',
    });
    expect(await validate(shift)).not.toHaveLength(0);
    expect(await validate(catalog)).toHaveLength(3);
  });

  it('validates nested basket lines before checkout reaches stock posting', async () => {
    const input = plainToInstance(CreatePosCashSaleDto, {
      cashTendered: '100.0000',
      clientTransactionId: uuid,
      lines: [{ productId: 'not-a-uuid', quantity: '0.00000' }],
      shiftId: uuid,
    });
    const errors = await validate(input);
    expect(errors.some((error) => error.property === 'lines')).toBe(true);
  });
});
