import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

export interface IntegrationEventEnvelope {
  aggregateId: string;
  aggregateType: string;
  correlationId: string;
  eventType: string;
  eventVersion: number;
  id: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  sequenceNumber: string;
}

export interface IntegrationEventConsumerBinding {
  consumer: string;
  eventType: string;
  handle: (
    event: IntegrationEventEnvelope,
    client: PoolClient,
  ) => Promise<Record<string, unknown> | undefined>;
}

@Injectable()
export class IntegrationEventConsumerRegistry {
  private readonly bindings = new Map<string, IntegrationEventConsumerBinding>();

  register(binding: IntegrationEventConsumerBinding): void {
    if (!/^[a-z][a-z0-9.-]{1,149}$/u.test(binding.consumer)) {
      throw new Error('Integration consumer must be a stable lowercase dotted identifier');
    }
    if (!/^[a-z][a-z0-9._-]{1,254}$/u.test(binding.eventType)) {
      throw new Error('Integration event type must be a stable lowercase identifier');
    }
    const key = this.key(binding.eventType, binding.consumer);
    if (this.bindings.has(key)) {
      throw new Error(
        `Integration consumer ${binding.consumer} already handles ${binding.eventType}`,
      );
    }
    this.bindings.set(key, binding);
  }

  binding(eventType: string, consumer: string): IntegrationEventConsumerBinding | undefined {
    return this.bindings.get(this.key(eventType, consumer));
  }

  bindingsFor(eventType: string): IntegrationEventConsumerBinding[] {
    return [...this.bindings.values()]
      .filter((binding) => binding.eventType === eventType)
      .sort((left, right) => left.consumer.localeCompare(right.consumer));
  }

  eventTypes(): string[] {
    return [...new Set([...this.bindings.values()].map((binding) => binding.eventType))].sort();
  }

  private key(eventType: string, consumer: string): string {
    return `${eventType}\u0000${consumer}`;
  }
}
