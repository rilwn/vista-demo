ALTER TABLE notifications.messages
  ADD COLUMN processing_started_at timestamptz,
  ADD COLUMN read_at timestamptz;

ALTER TABLE notifications.messages
  ADD CONSTRAINT notification_read_after_delivery
  CHECK (read_at IS NULL OR delivered_at IS NOT NULL);

CREATE INDEX notification_recipient_in_system_idx
  ON notifications.messages (recipient_account_id, read_at, delivered_at DESC, id DESC)
  WHERE channel = 'in_system' AND status = 'delivered';

CREATE INDEX notification_processing_recovery_idx
  ON notifications.messages (processing_started_at)
  WHERE status = 'processing';
