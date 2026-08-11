import { randomUUID } from 'node:crypto';

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';

import { IntegrationEventConsumerRegistry } from './integration-event-consumer.registry.js';

export const lowStockEventType = 'inventory.low_stock.detected';
export const lowStockNotificationConsumer = 'notifications.low-stock';

@Injectable()
export class LowStockNotificationConsumer implements OnModuleInit {
  constructor(
    @Inject(IntegrationEventConsumerRegistry)
    private readonly consumers: IntegrationEventConsumerRegistry,
  ) {}

  onModuleInit(): void {
    this.consumers.register({
      consumer: lowStockNotificationConsumer,
      eventType: lowStockEventType,
      handle: async (event, client) => {
        const payload = lowStockPayload(event.payload);
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO notifications.messages (
             id, recipient_account_id, channel, template_key, template_version,
             payload, idempotency_key
           ) VALUES ($1, $2, 'in_system', 'inventory.low_stock', 1, $3, $4)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
          [randomUUID(), payload.recipientAccountId, payload.notificationPayload, event.id],
        );
        const existing = inserted.rows[0]?.id
          ? inserted.rows[0]
          : (
              await client.query<{ id: string }>(
                'SELECT id FROM notifications.messages WHERE idempotency_key = $1',
                [event.id],
              )
            ).rows[0];
        if (!existing) throw new Error('Low-stock notification could not be reconciled');
        return { notificationId: existing.id };
      },
    });
  }
}

function lowStockPayload(value: Record<string, unknown>): {
  notificationPayload: Record<string, unknown>;
  recipientAccountId: string;
} {
  const recipientAccountId = value['recipientAccountId'];
  const fields = [
    'availableQuantity',
    'cycleNumber',
    'minimumQuantity',
    'productId',
    'recommendedQuantity',
    'targetQuantity',
    'warehouseId',
  ] as const;
  if (typeof recipientAccountId !== 'string' || !uuid(recipientAccountId)) {
    throw new UnrecoverableError('Low-stock event recipient is invalid');
  }
  const notificationPayload: Record<string, unknown> = {};
  for (const field of fields) {
    const fieldValue = value[field];
    if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
      throw new UnrecoverableError(`Low-stock event field ${field} is invalid`);
    }
    notificationPayload[field] = fieldValue;
  }
  if (
    !uuid(String(notificationPayload['productId'])) ||
    !uuid(String(notificationPayload['warehouseId']))
  ) {
    throw new UnrecoverableError('Low-stock event stock identity is invalid');
  }
  return { notificationPayload, recipientAccountId };
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
