import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';

export interface BackgroundJobContext {
  attemptNumber: number;
  correlationId: string;
  enqueuedAt: string;
  idempotencyKey: string;
  jobId: string;
  maxAttempts: number;
  name: string;
  payload: Record<string, unknown>;
  retryAllowed: boolean;
}

export interface BackgroundJobHandler {
  handle(context: BackgroundJobContext): Promise<unknown>;
}

@Injectable()
export class JobHandlerRegistry {
  private readonly handlers = new Map<string, BackgroundJobHandler>();

  register(name: string, handler: BackgroundJobHandler): void {
    if (!/^[a-z][a-z0-9.-]{1,127}$/.test(name)) {
      throw new Error('Job handler name must be a stable lowercase dotted identifier');
    }
    if (this.handlers.has(name)) {
      throw new Error(`A handler is already registered for ${name}`);
    }
    this.handlers.set(name, handler);
  }

  registeredNames(): string[] {
    return [...this.handlers.keys()].sort((left, right) => left.localeCompare(right));
  }

  async execute(context: BackgroundJobContext): Promise<unknown> {
    const handler = this.handlers.get(context.name);
    if (!handler) {
      throw new UnrecoverableError(`No background-job handler is registered for ${context.name}`);
    }
    return handler.handle(context);
  }
}
