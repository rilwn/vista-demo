import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { fixtureId } from '../database/development-fixtures.js';
import { CreateLogisticsDeliveryDto } from './logistics.dto.js';

describe('CreateLogisticsDeliveryDto', () => {
  it('accepts the stable PostgreSQL UUID references returned by Logistics fixtures', async () => {
    const input = plainToInstance(CreateLogisticsDeliveryDto, {
      customerLocationId: fixtureId('customer-location:alfa-store'),
      deliveryMethod: 'company_transport',
      instructions: 'Call before arrival.',
      scheduledEnd: '2026-08-26T11:00:00.000Z',
      scheduledStart: '2026-08-26T09:00:00.000Z',
      shipmentId: fixtureId('sales-shipment:completed'),
    });

    expect(await validate(input)).toEqual([]);
  });

  it('still rejects a malformed Logistics reference', async () => {
    const input = plainToInstance(CreateLogisticsDeliveryDto, {
      customerLocationId: fixtureId('customer-location:alfa-store'),
      deliveryMethod: 'company_transport',
      scheduledEnd: '2026-08-26T11:00:00.000Z',
      scheduledStart: '2026-08-26T09:00:00.000Z',
      shipmentId: 'not-a-shipment-id',
    });

    expect((await validate(input)).map((error) => error.property)).toContain('shipmentId');
  });
});
