import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import {
  ClosePosShiftDto,
  CreatePosDiscountAuthorizationDto,
  CreatePosReturnDto,
  CreatePosSaleDto,
  OpenPosShiftDto,
  PricePosBasketDto,
  PosCatalogQueryDto,
  UpdatePosQuickAccessDto,
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
    const input = plainToInstance(CreatePosSaleDto, {
      clientTransactionId: uuid,
      lines: [{ productId: 'not-a-uuid', quantity: '0.00000' }],
      payments: [{ amount: '60.0000', method: 'cash', tenderedAmount: '100.0000' }],
      shiftId: uuid,
    });
    const errors = await validate(input);
    expect(errors.some((error) => error.property === 'lines')).toBe(true);
  });

  it('validates nested refunds and requires a useful linked-return reason', async () => {
    const input = plainToInstance(CreatePosReturnDto, {
      lines: [
        {
          disposition: 'restock',
          originalSaleLineId: uuid,
          quantity: '1.0000',
        },
      ],
      originalSaleId: uuid,
      reason: 'No',
      refunds: [{ amount: 'not-money', method: 'voucher' }],
      shiftId: uuid,
    });
    const errors = await validate(input);
    expect(errors.some((error) => error.property === 'reason')).toBe(true);
    expect(errors.some((error) => error.property === 'refunds')).toBe(true);
  });

  it('limits quick access to 12 unique product identifiers', async () => {
    const repeated = plainToInstance(UpdatePosQuickAccessDto, {
      productIds: [uuid, uuid],
      shiftId: uuid,
    });
    const tooMany = plainToInstance(UpdatePosQuickAccessDto, {
      productIds: Array.from(
        { length: 13 },
        (_, index) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      ),
      shiftId: uuid,
    });
    expect(await validate(repeated)).not.toHaveLength(0);
    expect(await validate(tooMany)).not.toHaveLength(0);
  });

  it('validates protected discounts and loyalty redemption inside a priced basket', async () => {
    const authorization = plainToInstance(CreatePosDiscountAuthorizationDto, {
      approverEmail: 'manager@vista.local',
      approverPassword: 'A-strong-test-password',
      discountType: 'percentage',
      discountValue: '10.0000',
      lines: [{ productId: uuid, quantity: '2.0000' }],
      reason: 'Customer care adjustment',
      shiftId: uuid,
    });
    expect(await validate(authorization)).toHaveLength(0);

    const basket = plainToInstance(PricePosBasketDto, {
      lines: [{ productId: uuid, quantity: '2.0000' }],
      loyaltyPointsToRedeem: -1,
      manualDiscount: {
        authorizationId: 'not-a-uuid',
        discountType: 'percentage',
        discountValue: '101.0000',
      },
      shiftId: uuid,
    });
    const errors = await validate(basket);
    expect(errors.some((error) => error.property === 'loyaltyPointsToRedeem')).toBe(true);
    expect(errors.some((error) => error.property === 'manualDiscount')).toBe(true);
  });
});
