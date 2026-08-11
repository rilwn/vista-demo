DROP INDEX IF EXISTS integration.inbox_reconciliation_idx;
DROP INDEX IF EXISTS integration.inbox_event_consumer_idx;

ALTER TABLE integration.inbox_receipts
  DROP CONSTRAINT IF EXISTS inbox_replay_non_negative,
  DROP CONSTRAINT IF EXISTS inbox_cycle_attempt_non_negative,
  DROP CONSTRAINT IF EXISTS inbox_attempt_non_negative,
  DROP CONSTRAINT IF EXISTS inbox_status_valid,
  DROP COLUMN IF EXISTS last_error_code,
  DROP COLUMN IF EXISTS dead_lettered_at,
  DROP COLUMN IF EXISTS failed_at,
  DROP COLUMN IF EXISTS processing_started_at,
  DROP COLUMN IF EXISTS replay_count,
  DROP COLUMN IF EXISTS cycle_attempt_count,
  DROP COLUMN IF EXISTS attempt_count,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS event_id;

UPDATE integration.inbox_receipts
SET processed_at = now()
WHERE processed_at IS NULL;

ALTER TABLE integration.inbox_receipts
  ALTER COLUMN processed_at SET DEFAULT now(),
  ALTER COLUMN processed_at SET NOT NULL;

DROP INDEX IF EXISTS integration.outbox_delivery_reconciliation_idx;
DROP TABLE IF EXISTS integration.outbox_deliveries;

DROP INDEX IF EXISTS integration.outbox_reconciliation_idx;
DROP INDEX IF EXISTS integration.outbox_processing_recovery_idx;
DROP INDEX IF EXISTS integration.outbox_pending_idx;

DROP TRIGGER IF EXISTS outbox_content_immutable ON integration.outbox_events;
DROP FUNCTION IF EXISTS integration.reject_outbox_content_mutation();
DROP TRIGGER IF EXISTS outbox_assign_sequence ON integration.outbox_events;
DROP FUNCTION IF EXISTS integration.assign_outbox_sequence();
DROP TABLE IF EXISTS integration.aggregate_sequences;

ALTER TABLE integration.outbox_events
  DROP CONSTRAINT IF EXISTS outbox_aggregate_sequence_unique,
  DROP CONSTRAINT IF EXISTS outbox_replay_non_negative,
  DROP CONSTRAINT IF EXISTS outbox_publication_attempt_non_negative,
  DROP CONSTRAINT IF EXISTS outbox_sequence_positive,
  DROP CONSTRAINT IF EXISTS outbox_status_valid,
  DROP COLUMN IF EXISTS last_replayed_at,
  DROP COLUMN IF EXISTS replay_count,
  DROP COLUMN IF EXISTS publication_attempt_count,
  DROP COLUMN IF EXISTS dead_lettered_at,
  DROP COLUMN IF EXISTS completed_at,
  DROP COLUMN IF EXISTS processing_started_at,
  DROP COLUMN IF EXISTS sequence_number,
  DROP COLUMN IF EXISTS status;

CREATE INDEX outbox_pending_idx
  ON integration.outbox_events (available_at, occurred_at)
  WHERE published_at IS NULL;
