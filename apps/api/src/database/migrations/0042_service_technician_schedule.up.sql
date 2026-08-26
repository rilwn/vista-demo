CREATE TABLE service.technician_schedule_policies (
  technician_account_id uuid PRIMARY KEY
    REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_technician_schedule_policy_version_positive CHECK (version > 0)
);

CREATE TABLE service.technician_schedule_windows (
  technician_account_id uuid NOT NULL
    REFERENCES service.technician_schedule_policies(technician_account_id) ON DELETE CASCADE,
  weekday smallint NOT NULL,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  capacity_minutes integer NOT NULL,
  max_visits integer NOT NULL,
  PRIMARY KEY (technician_account_id, weekday),
  CONSTRAINT service_technician_schedule_weekday_valid CHECK (weekday BETWEEN 1 AND 7),
  CONSTRAINT service_technician_schedule_window_valid CHECK (ends_at > starts_at),
  CONSTRAINT service_technician_schedule_capacity_valid CHECK (
    capacity_minutes > 0
    AND capacity_minutes <= extract(epoch FROM (ends_at - starts_at)) / 60
  ),
  CONSTRAINT service_technician_schedule_max_visits_valid CHECK (
    max_visits > 0 AND max_visits <= 100
  )
);

CREATE INDEX service_technician_schedule_window_lookup_idx
  ON service.technician_schedule_windows (weekday, technician_account_id);

COMMENT ON TABLE service.technician_schedule_policies IS
  'Dispatcher-managed technician working policy. No production hours are inferred; each active day is configured explicitly and changes are audited by the Service command layer.';
COMMENT ON TABLE service.technician_schedule_windows IS
  'Weekly business-time windows and workload limits used to prevent out-of-hours, overlapping, and over-capacity Service assignments.';
