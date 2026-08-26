import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { fixtureId } from '../database/development-fixtures.js';
import {
  CreateCrmTicketDto,
  CreateCrmTicketFromServiceRequestDto,
  RecordCrmTicketResponseDto,
} from './crm-tickets.dto.js';

describe('CRM ticket DTOs', () => {
  it('accepts a complete customer ticket from the shared fixture records', async () => {
    const input = plainToInstance(CreateCrmTicketDto, {
      assignedToAccountId: fixtureId('account:crm'),
      categoryId: fixtureId('crm-ticket-category:technical_support'),
      channel: 'telephone',
      customerEquipmentId: fixtureId('customer-equipment:alfa-printer'),
      customerLocationId: fixtureId('customer-location:alfa-store'),
      customerPartnerId: fixtureId('partner:alfa'),
      description: 'The receipt printer stops after several transactions.',
      priority: 'normal',
      slaPolicyId: fixtureId('crm-sla-policy:normal'),
      subject: 'Receipt printer stops during busy periods',
    });

    expect(await validate(input)).toEqual([]);
  });

  it('accepts the retry-safe Service-to-CRM command and first response', async () => {
    const serviceLink = plainToInstance(CreateCrmTicketFromServiceRequestDto, {
      categoryId: fixtureId('crm-ticket-category:technical_support'),
      priority: 'high',
      slaPolicyId: fixtureId('crm-sla-policy:high'),
    });
    const response = plainToInstance(RecordCrmTicketResponseDto, {
      expectedVersion: 1,
      note: 'We have received the issue and scheduled a technician review.',
    });

    await expect(Promise.all([validate(serviceLink), validate(response)])).resolves.toEqual([
      [],
      [],
    ]);
  });

  it('rejects unknown channels and malformed shared references', async () => {
    const input = plainToInstance(CreateCrmTicketDto, {
      categoryId: 'not-a-category',
      channel: 'social_media',
      customerPartnerId: fixtureId('partner:alfa'),
      description: 'Customer issue.',
      priority: 'normal',
      slaPolicyId: fixtureId('crm-sla-policy:normal'),
      subject: 'Customer issue',
    });

    const properties = (await validate(input)).map((error) => error.property);
    expect(properties).toContain('categoryId');
    expect(properties).toContain('channel');
  });
});
