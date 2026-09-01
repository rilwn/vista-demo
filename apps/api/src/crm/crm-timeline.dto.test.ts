import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { fixtureId } from '../database/development-fixtures.js';
import {
  CreateCrmInteractionDto,
  CreateCrmTaskDto,
  ListCrmTimelineQueryDto,
  TransitionCrmTaskDto,
} from './crm-timeline.dto.js';

describe('CRM timeline DTOs', () => {
  it('accepts a customer interaction, follow-up task, and completion command', async () => {
    const interaction = plainToInstance(CreateCrmInteractionDto, {
      customerLocationId: fixtureId('customer-location:alfa-store'),
      customerPartnerId: fixtureId('partner:alfa'),
      interactionType: 'incoming_call',
      notes: 'The customer requested a quotation and expects a reply tomorrow.',
      occurredAt: '2026-09-01T09:30:00.000Z',
      subject: 'Request for an additional receipt printer',
    });
    const task = plainToInstance(CreateCrmTaskDto, {
      assignedToAccountId: fixtureId('account:crm'),
      customerPartnerId: fixtureId('partner:alfa'),
      dueAt: '2026-09-03T12:00:00.000Z',
      priority: 'normal',
      reminderAt: '2026-09-03T09:00:00.000Z',
      title: 'Send the printer quotation',
    });
    const transition = plainToInstance(TransitionCrmTaskDto, {
      expectedVersion: 1,
      note: 'Quotation sent by email.',
      status: 'completed',
    });

    await expect(
      Promise.all([validate(interaction), validate(task), validate(transition)]),
    ).resolves.toEqual([[], [], []]);
  });

  it('transforms pagination and rejects malformed filters and unsupported activity values', async () => {
    const query = plainToInstance(ListCrmTimelineQueryDto, {
      customerPartnerId: 'not-a-customer',
      page: '0',
      pageSize: '101',
    });
    const interaction = plainToInstance(CreateCrmInteractionDto, {
      customerPartnerId: fixtureId('partner:alfa'),
      interactionType: 'social_media',
      notes: 'Customer message.',
      occurredAt: 'not-a-date',
      subject: 'Customer message',
    });

    expect((await validate(query)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['customerPartnerId', 'page', 'pageSize']),
    );
    expect((await validate(interaction)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['interactionType', 'occurredAt']),
    );
  });
});
