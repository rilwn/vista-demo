DROP INDEX IF EXISTS notifications.notification_processing_recovery_idx;
DROP INDEX IF EXISTS notifications.notification_recipient_in_system_idx;

ALTER TABLE notifications.messages
  DROP CONSTRAINT IF EXISTS notification_read_after_delivery,
  DROP COLUMN IF EXISTS read_at,
  DROP COLUMN IF EXISTS processing_started_at;
