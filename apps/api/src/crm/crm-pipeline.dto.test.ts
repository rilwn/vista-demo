import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { fixtureId } from '../database/development-fixtures.js';
import {
  ConvertCrmLeadDto,
  CreateCrmLeadDto,
  ListCrmOpportunitiesQueryDto,
  MoveCrmOpportunityDto,
} from './crm-pipeline.dto.js';

describe('CRM pipeline DTOs', () => {
  it('accepts complete lead, conversion, and pipeline-stage commands', async () => {
    const lead = plainToInstance(CreateCrmLeadDto, {
      contactName: 'Petar Dimitrov',
      organizationName: 'North Star Retail Ltd.',
      ownerAccountId: fixtureId('account:crm'),
      source: 'trade_exhibition',
      telephone: '+359 888 200 300',
    });
    const conversion = plainToInstance(ConvertCrmLeadDto, {
      createOpportunity: true,
      expectedVersion: 2,
      newCustomer: {
        displayName: 'North Star Retail Ltd.',
        kind: 'legal_entity',
        uic: '207654321',
      },
      opportunity: {
        estimatedRevenueBgn: '1800.00',
        expectedCloseOn: '2026-10-15',
        ownerAccountId: fixtureId('account:crm'),
        probabilityPercent: 40,
        title: 'Fiscal device and annual service package',
      },
    });
    const stage = plainToInstance(MoveCrmOpportunityDto, {
      expectedVersion: 1,
      probabilityPercent: 55,
      stage: 'quotation_sent',
    });

    await expect(
      Promise.all([validate(lead), validate(conversion), validate(stage)]),
    ).resolves.toEqual([[], [], []]);
  });

  it('rejects malformed filters, money, identifiers, and unsupported pipeline values', async () => {
    const lead = plainToInstance(CreateCrmLeadDto, {
      contactName: '',
      organizationName: 'North Star Retail Ltd.',
      ownerAccountId: 'not-an-account',
      source: 'advertisement',
    });
    const conversion = plainToInstance(ConvertCrmLeadDto, {
      createOpportunity: true,
      expectedVersion: 0,
      newCustomer: { displayName: '', kind: 'company' },
      opportunity: {
        estimatedRevenueBgn: '18.999',
        ownerAccountId: 'not-an-account',
        probabilityPercent: 101,
        title: '',
      },
    });
    const query = plainToInstance(ListCrmOpportunitiesQueryDto, {
      page: '0',
      pageSize: '201',
      stage: 'closed',
    });

    expect((await validate(lead)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['contactName', 'ownerAccountId', 'source']),
    );
    expect((await validate(conversion)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['expectedVersion', 'newCustomer', 'opportunity']),
    );
    expect((await validate(query)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['page', 'pageSize', 'stage']),
    );
  });
});
