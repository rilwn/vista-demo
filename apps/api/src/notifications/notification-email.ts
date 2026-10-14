import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export interface QueueEmailInput {
  attachment?: { content: Buffer; fileName: string; mediaType: string };
  idempotencyKey: string;
  recipient: string;
  subject: string;
  text: string;
}

export async function queueEmailMessage(
  client: PoolClient,
  input: QueueEmailInput,
): Promise<{ id: string; created: boolean }> {
  const id = randomUUID();
  const messageId = createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 32);
  const result = await client.query<{ id: string }>(
    `INSERT INTO notifications.messages (
       id, recipient_account_id, channel, template_key, template_version, payload,
       idempotency_key, status
     ) VALUES ($1, NULL, 'email', 'document.delivery', 1, $2, $3, 'pending')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      id,
      {
        to: input.recipient,
        subject: input.subject,
        text: input.text,
        messageId: `${messageId}@vista.local`,
        ...(input.attachment
          ? {
              attachment: {
                fileName: input.attachment.fileName,
                mediaType: input.attachment.mediaType,
                contentBase64: input.attachment.content.toString('base64'),
              },
            }
          : {}),
      },
      `email:${createHash('sha256').update(input.idempotencyKey).digest('hex')}`,
    ],
  );
  if (result.rows[0]) return { created: true, id: result.rows[0].id };
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM notifications.messages WHERE idempotency_key = $1',
    [`email:${createHash('sha256').update(input.idempotencyKey).digest('hex')}`],
  );
  const existingId = existing.rows[0]?.id;
  if (!existingId) throw new Error('The queued email could not be confirmed.');
  return { created: false, id: existingId };
}
