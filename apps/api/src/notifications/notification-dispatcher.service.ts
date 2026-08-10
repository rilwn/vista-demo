import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import { UnrecoverableError } from 'bullmq';
import type { PoolClient } from 'pg';

import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import {
  type BackgroundJobContext,
  JobHandlerRegistry,
} from '../jobs/job-handler-registry.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';

export const notificationDispatchJobName = 'notification.dispatch';

interface PendingNotificationRow {
  id: string;
  idempotency_key: string;
}

interface ClaimedNotificationRow {
  channel: 'email' | 'in_system' | 'sms';
  id: string;
  recipient_account_id: string | null;
  template_key: string;
}

@Injectable()
export class NotificationDispatcherService
  implements OnApplicationBootstrap, OnApplicationShutdown, OnModuleInit
{
  private interval: ReturnType<typeof setInterval> | undefined;
  private polling = false;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(JobHandlerRegistry) private readonly handlers: JobHandlerRegistry,
    @Inject(JobQueueService) private readonly jobs: JobQueueService,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
  ) {}

  onModuleInit(): void {
    this.handlers.register(notificationDispatchJobName, {
      handle: (context) => this.handleJob(context),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.environment.NODE_ENV === 'test') return;
    await this.scheduleAvailable();
    this.interval = setInterval(
      () => void this.scheduleAvailable(),
      this.environment.NOTIFICATION_DISPATCH_INTERVAL_MS,
    );
  }

  onApplicationShutdown(): void {
    if (this.interval) clearInterval(this.interval);
  }

  async dispatch(notificationId: string, retryAllowed = false): Promise<void> {
    const client = await this.database.getPool().connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const claimed = await this.claim(client, notificationId);
      if (!claimed) {
        await client.query('COMMIT');
        transactionOpen = false;
        return;
      }
      if (claimed.channel !== 'in_system') {
        await this.fail(client, notificationId, 'NOTIFICATION_CHANNEL_NOT_CONFIGURED', false);
        await client.query('COMMIT');
        transactionOpen = false;
        throw new UnrecoverableError(
          `${claimed.channel} notification delivery is not configured for this environment`,
        );
      }
      if (!claimed.recipient_account_id) {
        await this.fail(client, notificationId, 'NOTIFICATION_RECIPIENT_REQUIRED', false);
        await client.query('COMMIT');
        transactionOpen = false;
        throw new UnrecoverableError('An in-system notification requires a recipient account');
      }
      await client.query(
        `UPDATE notifications.messages
         SET status = 'delivered', delivered_at = now(), processing_started_at = NULL,
             last_error_code = NULL
         WHERE id = $1 AND status = 'processing'`,
        [notificationId],
      );
      await client.query('COMMIT');
      transactionOpen = false;
      this.logger.event('info', 'notification.delivered', {
        channel: claimed.channel,
        notificationId,
        recipientAccountId: claimed.recipient_account_id,
        templateKey: claimed.template_key,
      });
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK');
      if (error instanceof UnrecoverableError) throw error;
      await this.recordUnexpectedFailure(notificationId, retryAllowed, error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async handleJob(context: BackgroundJobContext): Promise<void> {
    const notificationId = context.payload['notificationId'];
    if (typeof notificationId !== 'string' || notificationId.length === 0) {
      throw new UnrecoverableError('Notification dispatch requires a notification identifier');
    }
    await this.dispatch(notificationId, context.retryAllowed);
  }

  private async scheduleAvailable(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.recoverStaleClaims();
      const result = await this.database.getPool().query<PendingNotificationRow>(
        `SELECT id, idempotency_key
         FROM notifications.messages
         WHERE status = 'pending' AND available_at <= now()
         ORDER BY available_at, created_at, id
         LIMIT 100`,
      );
      await Promise.all(
        result.rows.map((message) =>
          this.jobs.enqueue({
            correlationId: message.id,
            idempotencyKey: message.idempotency_key,
            name: notificationDispatchJobName,
            payload: { notificationId: message.id },
          }),
        ),
      );
    } catch (error) {
      this.logger.event('error', 'notification.schedule.failed', {
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
    } finally {
      this.polling = false;
    }
  }

  private async claim(
    client: PoolClient,
    notificationId: string,
  ): Promise<ClaimedNotificationRow | undefined> {
    const result = await client.query<ClaimedNotificationRow>(
      `UPDATE notifications.messages
       SET status = 'processing', attempt_count = attempt_count + 1,
           last_error_code = NULL, processing_started_at = now()
       WHERE id = $1 AND status = 'pending' AND available_at <= now()
       RETURNING id, channel, recipient_account_id, template_key`,
      [notificationId],
    );
    return result.rows[0];
  }

  private async fail(
    client: PoolClient,
    notificationId: string,
    errorCode: string,
    retryAllowed: boolean,
  ): Promise<void> {
    await client.query(
      `UPDATE notifications.messages
       SET status = $2, last_error_code = $3, processing_started_at = NULL,
           available_at = CASE WHEN $2 = 'pending' THEN now() ELSE available_at END
       WHERE id = $1 AND status = 'processing'`,
      [notificationId, retryAllowed ? 'pending' : 'failed', errorCode],
    );
  }

  private async recordUnexpectedFailure(
    notificationId: string,
    retryAllowed: boolean,
    error: unknown,
  ): Promise<void> {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      await this.fail(
        client,
        notificationId,
        error instanceof Error ? error.constructor.name : 'NOTIFICATION_DELIVERY_FAILED',
        retryAllowed,
      );
      await client.query('COMMIT');
    } catch (failure) {
      await client.query('ROLLBACK');
      this.logger.event('error', 'notification.failure.recording_failed', {
        errorType: failure instanceof Error ? failure.constructor.name : 'UnknownError',
        notificationId,
      });
    } finally {
      client.release();
    }
  }

  private async recoverStaleClaims(): Promise<void> {
    const result = await this.database.getPool().query<{ id: string }>(
      `UPDATE notifications.messages
       SET status = 'pending', processing_started_at = NULL,
           last_error_code = 'NOTIFICATION_PROCESSING_TIMEOUT', available_at = now()
       WHERE status = 'processing'
         AND processing_started_at < now() - ($1::bigint * interval '1 millisecond')
       RETURNING id`,
      [this.environment.NOTIFICATION_PROCESSING_TIMEOUT_MS],
    );
    if (result.rowCount) {
      this.logger.event('warn', 'notification.processing.recovered', { count: result.rowCount });
    }
  }
}
