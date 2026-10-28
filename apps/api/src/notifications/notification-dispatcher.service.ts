import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import { UnrecoverableError } from 'bullmq';

import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import {
  type BackgroundJobContext,
  JobHandlerRegistry,
} from '../jobs/job-handler-registry.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import { SmsGatewayService } from './sms-gateway.service.js';
import { SmtpMailerService, type SmtpMessage } from './smtp-mailer.service.js';

export const notificationDispatchJobName = 'notification.dispatch';

interface PendingNotificationRow {
  id: string;
  idempotency_key: string;
}

interface ClaimedNotificationRow {
  channel: 'email' | 'in_system' | 'sms';
  id: string;
  payload: Record<string, unknown>;
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
    @Inject(SmtpMailerService) private readonly mailer: SmtpMailerService,
    @Inject(SmsGatewayService) private readonly sms: SmsGatewayService,
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
    const claimed = await this.claim(notificationId);
    if (!claimed) return;
    try {
      if (claimed.channel === 'in_system') {
        if (!claimed.recipient_account_id)
          throw new UnrecoverableError('An in-system notification requires a recipient account');
      } else if (claimed.channel === 'email') {
        await this.mailer.send(emailMessage(claimed.payload));
      } else {
        await this.sms.send(smsMessage(claimed.payload));
      }
      await this.finish(notificationId, 'delivered');
      this.logger.event('info', 'notification.delivered', {
        channel: claimed.channel,
        notificationId,
        recipientAccountId: claimed.recipient_account_id,
        templateKey: claimed.template_key,
      });
    } catch (error) {
      const isTerminal = error instanceof UnrecoverableError || !retryAllowed;
      await this.finish(
        notificationId,
        isTerminal ? 'failed' : 'pending',
        error instanceof UnrecoverableError
          ? 'NOTIFICATION_CHANNEL_NOT_CONFIGURED'
          : error instanceof Error
            ? error.constructor.name
            : 'NOTIFICATION_DELIVERY_FAILED',
      );
      if (error instanceof UnrecoverableError) throw error;
      if (isTerminal)
        throw new UnrecoverableError('Notification delivery failed after the final attempt');
      throw error;
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
        result.rows.map(async (message) => {
          const queued = await this.jobs.enqueue({
            correlationId: message.id,
            idempotencyKey: message.idempotency_key,
            name: notificationDispatchJobName,
            payload: { notificationId: message.id },
          });
          // A recovered database claim must not be stranded behind its retained
          // failed BullMQ job. Terminal message failures are not selected here.
          if (queued.deduplicated && (await this.jobs.getJobState(queued.jobId)) === 'failed') {
            await this.jobs.retryFailed(queued.jobId);
          }
        }),
      );
    } catch (error) {
      this.logger.event('error', 'notification.schedule.failed', {
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
    } finally {
      this.polling = false;
    }
  }

  private async claim(notificationId: string): Promise<ClaimedNotificationRow | undefined> {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<ClaimedNotificationRow>(
        `UPDATE notifications.messages
         SET status = 'processing', attempt_count = attempt_count + 1,
             last_error_code = NULL, processing_started_at = now()
         WHERE id = $1 AND status = 'pending' AND available_at <= now()
         RETURNING id, channel, recipient_account_id, template_key, payload`,
        [notificationId],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (failure) {
      await client.query('ROLLBACK');
      throw failure;
    } finally {
      client.release();
    }
  }

  private async finish(
    notificationId: string,
    status: 'delivered' | 'failed' | 'pending',
    errorCode?: string,
  ): Promise<void> {
    await this.database.getPool().query(
      `UPDATE notifications.messages
       SET status = $2::varchar,
           delivered_at = CASE WHEN $2::varchar = 'delivered' THEN now() ELSE delivered_at END,
           last_error_code = $3, processing_started_at = NULL,
           available_at = CASE WHEN $2::varchar = 'pending' THEN now() ELSE available_at END
       WHERE id = $1 AND status = 'processing'`,
      [notificationId, status, errorCode ?? null],
    );
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

function emailMessage(payload: Record<string, unknown>): SmtpMessage {
  const attachment = payload['attachment'];
  if (
    typeof payload['to'] !== 'string' ||
    typeof payload['subject'] !== 'string' ||
    typeof payload['text'] !== 'string' ||
    typeof payload['messageId'] !== 'string'
  )
    throw new UnrecoverableError('The queued email is missing required message details');
  if (attachment !== undefined && attachment !== null && typeof attachment !== 'object')
    throw new UnrecoverableError('The queued email attachment is invalid');
  const file = attachment as Record<string, unknown> | undefined;
  let decodedAttachment: SmtpMessage['attachment'];
  if (file) {
    if (
      typeof file['fileName'] !== 'string' ||
      typeof file['mediaType'] !== 'string' ||
      typeof file['contentBase64'] !== 'string' ||
      file['contentBase64'].length > 11_184_812
    )
      throw new UnrecoverableError('The queued email attachment is incomplete or too large');
    decodedAttachment = {
      content: Buffer.from(file['contentBase64'], 'base64'),
      fileName: file['fileName'],
      mediaType: file['mediaType'],
    };
  }
  return {
    ...(decodedAttachment ? { attachment: decodedAttachment } : {}),
    messageId: payload['messageId'],
    subject: payload['subject'],
    text: payload['text'],
    to: payload['to'],
  };
}

function smsMessage(payload: Record<string, unknown>): { body: string; to: string } {
  if (typeof payload['to'] !== 'string' || typeof payload['body'] !== 'string') {
    throw new UnrecoverableError('The queued SMS is missing required message details');
  }
  return { body: payload['body'], to: payload['to'] };
}
