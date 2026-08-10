import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { NotificationMessage, NotificationPage } from '@vista/contracts';

import type { AuthenticationContext } from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';
import type { NotificationListQueryDto } from './notifications.dto.js';

interface NotificationRow {
  channel: 'in_system';
  created_at: Date;
  delivered_at: Date;
  id: string;
  payload: Record<string, unknown>;
  read_at: Date | null;
  template_key: string;
  template_version: number;
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async list(
    authentication: AuthenticationContext,
    query: NotificationListQueryDto,
  ): Promise<NotificationPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const pool = this.database.getPool();
    const [messages, unread] = await Promise.all([
      pool.query<NotificationRow>(
        `SELECT id, channel, template_key, template_version, payload, created_at,
                delivered_at, read_at
         FROM notifications.messages
         WHERE recipient_account_id = $1 AND channel = 'in_system' AND status = 'delivered'
         ORDER BY delivered_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [authentication.accountId, pageSize, offset],
      ),
      pool.query<{ unread_count: string }>(
        `SELECT count(*)::text AS unread_count
         FROM notifications.messages
         WHERE recipient_account_id = $1 AND channel = 'in_system' AND status = 'delivered'
           AND read_at IS NULL`,
        [authentication.accountId],
      ),
    ]);
    return {
      items: messages.rows.map(mapMessage),
      unreadCount: Number(unread.rows[0]?.unread_count ?? '0'),
    };
  }

  async markRead(id: string, authentication: AuthenticationContext): Promise<NotificationMessage> {
    const result = await this.database.getPool().query<NotificationRow>(
      `UPDATE notifications.messages
       SET read_at = COALESCE(read_at, now())
       WHERE id = $1 AND recipient_account_id = $2 AND channel = 'in_system'
         AND status = 'delivered'
       RETURNING id, channel, template_key, template_version, payload, created_at,
                 delivered_at, read_at`,
      [id, authentication.accountId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiErrorException(
        'NOTIFICATION_NOT_FOUND',
        'The notification was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return mapMessage(row);
  }
}

function mapMessage(row: NotificationRow): NotificationMessage {
  return {
    channel: row.channel,
    createdAt: row.created_at.toISOString(),
    deliveredAt: row.delivered_at.toISOString(),
    id: row.id,
    payload: row.payload,
    ...(row.read_at ? { readAt: row.read_at.toISOString() } : {}),
    templateKey: row.template_key,
    templateVersion: row.template_version,
  };
}
