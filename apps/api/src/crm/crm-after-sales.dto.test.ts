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
      sourceId: '4991c0ca-3b58-4bc8-885d-12da92b4fcd5',
      sourceKind: 'service',
    });
    const response = plainToInstance(RecordCrmSurveyResponseDto, {
      comment: 'Clear and helpful service.',
      score: 10,
    });
    const referral = plainToInstance(CreateCrmReferralDto, {
      contactName: 'Mila Petrova',
      organizationName: 'North Shop Ltd.',
      ownerAccountId: '7c36732f-f2df-4990-a3e3-1a8130327796',
      referringCustomerPartnerId: 'b8e82f1c-374a-45dc-805d-6df6c3d61cec',
      telephone: '+359 888 123 456',
    });
    expect(await validate(warranty)).toHaveLength(0);
    expect(await validate(survey)).toHaveLength(0);
    expect(await validate(response)).toHaveLength(0);
    expect(await validate(referral)).toHaveLength(0);
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
