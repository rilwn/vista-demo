ALTER TABLE integration.outbox_events
  ADD COLUMN status varchar(30) NOT NULL DEFAULT 'pending',
  ADD COLUMN sequence_number bigint,
  ADD COLUMN processing_started_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN dead_lettered_at timestamptz,
  ADD COLUMN publication_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN replay_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_replayed_at timestamptz;

UPDATE integration.outbox_events
SET status = CASE WHEN published_at IS NULL THEN 'pending' ELSE 'published' END;

WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY aggregate_type, aggregate_id
      ORDER BY occurred_at, id
    ) AS sequence_number
  FROM integration.outbox_events
)
UPDATE integration.outbox_events event
SET sequence_number = ranked.sequence_number
FROM ranked
WHERE ranked.id = event.id;

ALTER TABLE integration.outbox_events
  ALTER COLUMN sequence_number SET NOT NULL,
  ADD CONSTRAINT outbox_status_valid
    CHECK (status IN ('pending', 'publishing', 'published', 'completed', 'dead_letter')),
  ADD CONSTRAINT outbox_sequence_positive CHECK (sequence_number > 0),
  ADD CONSTRAINT outbox_publication_attempt_non_negative
    CHECK (publication_attempt_count >= 0),
  ADD CONSTRAINT outbox_replay_non_negative CHECK (replay_count >= 0),
  ADD CONSTRAINT outbox_aggregate_sequence_unique
    UNIQUE (aggregate_type, aggregate_id, sequence_number);

CREATE TABLE integration.aggregate_sequences (
  aggregate_type varchar(150) NOT NULL,
  aggregate_id uuid NOT NULL,
  next_sequence bigint NOT NULL,
  PRIMARY KEY (aggregate_type, aggregate_id),
  CONSTRAINT aggregate_next_sequence_positive CHECK (next_sequence > 0)
);

INSERT INTO integration.aggregate_sequences (aggregate_type, aggregate_id, next_sequence)
SELECT aggregate_type, aggregate_id, max(sequence_number) + 1
FROM integration.outbox_events
GROUP BY aggregate_type, aggregate_id;

CREATE FUNCTION integration.assign_outbox_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  assigned bigint;
BEGIN
  IF NEW.sequence_number IS NULL THEN
    INSERT INTO integration.aggregate_sequences (aggregate_type, aggregate_id, next_sequence)
    VALUES (NEW.aggregate_type, NEW.aggregate_id, 2)
    ON CONFLICT (aggregate_type, aggregate_id)
    DO UPDATE SET next_sequence = integration.aggregate_sequences.next_sequence + 1
    RETURNING next_sequence - 1 INTO assigned;
    NEW.sequence_number := assigned;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_assign_sequence
BEFORE INSERT ON integration.outbox_events
FOR EACH ROW EXECUTE FUNCTION integration.assign_outbox_sequence();

CREATE FUNCTION integration.reject_outbox_content_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type
    OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.event_version IS DISTINCT FROM OLD.event_version
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
    OR NEW.sequence_number IS DISTINCT FROM OLD.sequence_number
  THEN
    RAISE EXCEPTION 'outbox event content is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_content_immutable
BEFORE UPDATE ON integration.outbox_events
FOR EACH ROW EXECUTE FUNCTION integration.reject_outbox_content_mutation();

DROP INDEX integration.outbox_pending_idx;
CREATE INDEX outbox_pending_idx
  ON integration.outbox_events (available_at, occurred_at, id)
  WHERE status = 'pending';
CREATE INDEX outbox_processing_recovery_idx
  ON integration.outbox_events (processing_started_at)
  WHERE status = 'publishing';
CREATE INDEX outbox_reconciliation_idx
  ON integration.outbox_events (status, occurred_at DESC, id DESC);

CREATE TABLE integration.outbox_deliveries (
  event_id uuid NOT NULL REFERENCES integration.outbox_events(id) ON DELETE RESTRICT,
  consumer varchar(150) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  cycle_attempt_count integer NOT NULL DEFAULT 0,
  replay_count integer NOT NULL DEFAULT 0,
  processing_started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  dead_lettered_at timestamptz,
  last_error_code varchar(100),
  result jsonb,
  PRIMARY KEY (event_id, consumer),
  CONSTRAINT outbox_delivery_status_valid
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  CONSTRAINT outbox_delivery_attempt_non_negative CHECK (attempt_count >= 0),
  CONSTRAINT outbox_delivery_cycle_attempt_non_negative CHECK (cycle_attempt_count >= 0),
  CONSTRAINT outbox_delivery_replay_non_negative CHECK (replay_count >= 0)
);

CREATE INDEX outbox_delivery_reconciliation_idx
  ON integration.outbox_deliveries (status, failed_at DESC, event_id);

ALTER TABLE integration.inbox_receipts
  ALTER COLUMN processed_at DROP NOT NULL,
  ALTER COLUMN processed_at DROP DEFAULT,
  ADD COLUMN event_id uuid REFERENCES integration.outbox_events(id) ON DELETE RESTRICT,
  ADD COLUMN status varchar(30) NOT NULL DEFAULT 'completed',
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN cycle_attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN replay_count integer NOT NULL DEFAULT 0,
  ADD COLUMN processing_started_at timestamptz,
  ADD COLUMN failed_at timestamptz,
  ADD COLUMN dead_lettered_at timestamptz,
  ADD COLUMN last_error_code varchar(100),
  ADD CONSTRAINT inbox_status_valid
    CHECK (status IN ('processing', 'completed', 'failed', 'dead_letter')),
  ADD CONSTRAINT inbox_attempt_non_negative CHECK (attempt_count >= 0),
  ADD CONSTRAINT inbox_cycle_attempt_non_negative CHECK (cycle_attempt_count >= 0),
  ADD CONSTRAINT inbox_replay_non_negative CHECK (replay_count >= 0);

CREATE UNIQUE INDEX inbox_event_consumer_idx
  ON integration.inbox_receipts (event_id, consumer)
  WHERE event_id IS NOT NULL;
CREATE INDEX inbox_reconciliation_idx
  ON integration.inbox_receipts (status, failed_at DESC, consumer);
