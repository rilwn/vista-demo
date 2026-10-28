CREATE TABLE backup.missed_schedule_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES backup.policies(id) ON DELETE RESTRICT,
  scheduled_for timestamptz NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backup_missed_schedule_slot_unique UNIQUE (policy_id, scheduled_for)
);

CREATE INDEX backup_missed_schedule_history_idx
  ON backup.missed_schedule_events (detected_at DESC, policy_id);
