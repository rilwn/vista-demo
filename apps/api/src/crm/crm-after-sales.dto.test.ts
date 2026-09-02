import { ParseUUIDPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import {
  CreateCrmReferralDto,
  RecordCrmSurveyResponseDto,
  SendCrmCustomerSurveyDto,
  UpdateCrmWarrantyOfferDto,
} from './crm-after-sales.dto.js';

describe('CRM after-sales DTOs', () => {
  it('accepts the supported after-sales commands', async () => {
    const warranty = plainToInstance(UpdateCrmWarrantyOfferDto, { offerStatus: 'interested' });
    const survey = plainToInstance(SendCrmCustomerSurveyDto, {
      sourceId: '45b842ca-ac89-b31c-c25c-9d20fcd86ff2',
      sourceKind: 'service',
    });
    const response = plainToInstance(RecordCrmSurveyResponseDto, {
      comment: 'Clear and helpful service.',
      score: 10,
    });
    const referral = plainToInstance(CreateCrmReferralDto, {
      contactName: 'Mila Petrova',
      organizationName: 'North Shop Ltd.',
      ownerAccountId: '76d38aa6-ada6-8b23-3c5b-c15be78edc09',
      referringCustomerPartnerId: '45b842ca-ac89-b31c-c25c-9d20fcd86ff2',
      telephone: '+359 888 123 456',
    });
    expect(await validate(warranty)).toHaveLength(0);
    expect(await validate(survey)).toHaveLength(0);
    expect(await validate(response)).toHaveLength(0);
    expect(await validate(referral)).toHaveLength(0);
  });

  it('accepts UUID-shaped PostgreSQL identifiers used by stable fixture records', async () => {
    const id = '76d38aa6-ada6-8b23-3c5b-c15be78edc09';
    const parsed = await new ParseUUIDPipe().transform(id, {
      data: 'id',
      metatype: String,
      type: 'param',
    });
    expect(parsed).toBe(id);
  });

  it('rejects invalid survey scores and referrals without contact details', async () => {
    const response = plainToInstance(RecordCrmSurveyResponseDto, { score: 11 });
    const referral = plainToInstance(CreateCrmReferralDto, {
      contactName: '',
      organizationName: 'North Shop Ltd.',
      ownerAccountId: 'not-a-uuid',
      referringCustomerPartnerId: 'not-a-uuid',
    });
    expect(await validate(response)).not.toHaveLength(0);
    expect(await validate(referral)).not.toHaveLength(0);
  });
});
