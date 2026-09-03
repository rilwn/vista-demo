import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreatePosCommercialRuleDto, UpdatePosCommercialRuleDto } from './sales-pricing.dto.js';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('Sales pricing request validation', () => {
  it('accepts a dated quantity offer with a qualifying product', async () => {
    const input = plainToInstance(CreatePosCommercialRuleDto, {
      code: 'ADAPTER-PAIR',
      discountType: 'percentage',
      discountValue: '10.0000',
      items: [{ productId: uuid, requiredQuantity: '2.0000' }],
      name: 'Two adapters save 10%',
      priority: 20,
      ruleType: 'quantity',
      validFrom: '2026-09-01',
      validTo: '2026-09-30',
    });
    expect(await validate(input)).toHaveLength(0);
  });

  it('rejects malformed rule lines, discount types, and versions', async () => {
    const input = plainToInstance(UpdatePosCommercialRuleDto, {
      active: true,
      code: 'CARE-BUNDLE',
      discountType: 'free',
      discountValue: '-5',
      items: [{ productId: 'not-a-uuid', requiredQuantity: '0.00000' }],
      name: 'Print care bundle',
      priority: 1001,
      ruleType: 'bundle',
      validFrom: 'not-a-date',
      validTo: '2026-09-30',
      version: 0,
    });
    const errors = await validate(input);
    for (const property of [
      'discountType',
      'discountValue',
      'items',
      'priority',
      'validFrom',
      'version',
    ])
      expect(errors.some((error) => error.property === property)).toBe(true);
  });
});
