import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { fixtureId } from '../database/development-fixtures.js';
import {
  AssignServiceWorkOrderDto,
  CompleteServiceInspectionDto,
  CreateServiceInspectionPlanDto,
  CreateServiceRequestDto,
  CreateWarrantyClaimDto,
  TransitionWarrantyClaimDto,
} from './service.dto.js';

describe('Service request DTOs', () => {
  it('accepts the customer, location, and equipment references returned by local fixtures', async () => {
    const input = plainToInstance(CreateServiceRequestDto, {
      customerEquipmentId: fixtureId('customer-equipment:alfa-printer'),
      customerLocationId: fixtureId('customer-location:alfa-store'),
      customerPartnerId: fixtureId('partner:alfa'),
      priority: 'normal',
      problemDescription: 'Printer pauses after several receipts.',
      serviceType: 'out_of_warranty',
      sourceChannel: 'telephone',
    });

    expect(await validate(input)).toEqual([]);
  });

  it('accepts the technician and warehouse references returned by local fixtures', async () => {
    const input = plainToInstance(AssignServiceWorkOrderDto, {
      expectedVersion: 1,
      scheduledEnd: '2026-08-27T12:00:00.000Z',
      scheduledStart: '2026-08-27T11:00:00.000Z',
      technicianAccountId: fixtureId('account:technician'),
      technicianWarehouseId: fixtureId('warehouse:technician'),
    });

    expect(await validate(input)).toEqual([]);
  });

  it('still rejects malformed Service references', async () => {
    const input = plainToInstance(CreateServiceRequestDto, {
      customerEquipmentId: 'not-an-equipment-id',
      customerLocationId: fixtureId('customer-location:alfa-store'),
      customerPartnerId: fixtureId('partner:alfa'),
      priority: 'normal',
      problemDescription: 'Printer pauses after several receipts.',
      serviceType: 'out_of_warranty',
      sourceChannel: 'telephone',
    });

    expect((await validate(input)).map((error) => error.property)).toContain('customerEquipmentId');
  });

  it('keeps scheduled plan visits out of manual request intake', async () => {
    const input = plainToInstance(CreateServiceRequestDto, {
      customerEquipmentId: fixtureId('customer-equipment:alfa-printer'),
      customerLocationId: fixtureId('customer-location:alfa-store'),
      customerPartnerId: fixtureId('partner:alfa'),
      priority: 'normal',
      problemDescription: 'Preventive visit generated from the active service plan.',
      serviceType: 'subscription',
      sourceChannel: 'service_plan',
    });

    expect((await validate(input)).map((error) => error.property)).toContain('sourceChannel');
  });

  it('accepts complete warranty-claim and inspection commands', async () => {
    const claim = plainToInstance(CreateWarrantyClaimDto, {
      customerEquipmentId: fixtureId('customer-equipment:alfa-printer'),
      customerLocationId: fixtureId('customer-location:alfa-store'),
      customerPartnerId: fixtureId('partner:alfa'),
      description: 'The receipt printer feed stops intermittently.',
    });
    const transition = plainToInstance(TransitionWarrantyClaimDto, {
      expectedVersion: 1,
      nextStatus: 'approved',
      note: 'The fault is covered by the active warranty.',
    });
    const plan = plainToInstance(CreateServiceInspectionPlanDto, {
      customerEquipmentId: fixtureId('customer-equipment:alfa-printer'),
      inspectionType: 'technical',
      intervalMonths: 12,
      nextDueDate: '2026-09-02',
      reminderLeadDays: 30,
    });
    const completion = plainToInstance(CompleteServiceInspectionDto, {
      completedOn: '2026-09-02',
      expectedVersion: 1,
      notes: 'All required checks passed.',
      outcome: 'passed',
    });

    await expect(
      Promise.all([claim, transition, plan, completion].map((value) => validate(value))),
    ).resolves.toEqual([[], [], [], []]);
  });
});
