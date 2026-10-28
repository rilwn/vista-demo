CREATE TABLE backup.protected_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_code varchar(80) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  source_type varchar(30) NOT NULL,
  data_classification varchar(20) NOT NULL,
  location varchar(255) NOT NULL,
  owner_employee_id uuid REFERENCES identity.employees(id) ON DELETE RESTRICT,
  data_steward_employee_id uuid REFERENCES identity.employees(id) ON DELETE RESTRICT,
  dependencies text NOT NULL DEFAULT '',
  estimated_size_gib numeric(12, 2),
  annual_growth_percent numeric(6, 2),
  credential_custody text NOT NULL DEFAULT '',
  encrypted_at_source boolean NOT NULL DEFAULT false,
  restore_prerequisites text NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backup_source_type_valid CHECK (
    source_type IN (
      'database', 'file', 'server', 'workstation', 'mobile_device',
      'email', 'file_share', 'cloud_service', 'object_storage', 'other'
    )
  ),
  CONSTRAINT backup_source_classification_valid CHECK (
    data_classification IN ('critical', 'important', 'standard')
  ),
  CONSTRAINT backup_source_status_valid CHECK (status IN ('active', 'inactive')),
  CONSTRAINT backup_source_size_non_negative CHECK (
    estimated_size_gib IS NULL OR estimated_size_gib >= 0
  ),
  CONSTRAINT backup_source_growth_non_negative CHECK (
    annual_growth_percent IS NULL OR annual_growth_percent >= 0
  ),
  CONSTRAINT backup_source_version_positive CHECK (version > 0),
  CONSTRAINT backup_source_code_trimmed CHECK (
    source_code = btrim(source_code) AND char_length(source_code) > 0
  ),
  CONSTRAINT backup_source_name_trimmed CHECK (
    name = btrim(name) AND char_length(name) > 0
  )
);

CREATE INDEX backup_sources_classification_idx
  ON backup.protected_sources (data_classification, status, name, id);

CREATE TABLE backup.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code varchar(80) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  backup_type varchar(30) NOT NULL,
  frequency varchar(20) NOT NULL,
  run_time_local time,
  day_of_week smallint,
  day_of_month smallint,
  retention_daily_copies integer NOT NULL DEFAULT 35,
  retention_monthly_copies integer NOT NULL DEFAULT 12,
  rpo_minutes integer NOT NULL,
  rto_minutes integer NOT NULL,
  compression_enabled boolean NOT NULL DEFAULT true,
  encryption_required boolean NOT NULL DEFAULT true,
  verification_required boolean NOT NULL DEFAULT true,
  status varchar(20) NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backup_policy_type_valid CHECK (
    backup_type IN ('full', 'incremental', 'differential', 'database_snapshot', 'system_image')
  ),
  CONSTRAINT backup_policy_frequency_valid CHECK (
    frequency IN ('hourly', 'daily', 'weekly', 'monthly')
  ),
  CONSTRAINT backup_policy_schedule_valid CHECK (
    (frequency = 'hourly' AND run_time_local IS NULL AND day_of_week IS NULL AND day_of_month IS NULL)
    OR (frequency = 'daily' AND run_time_local IS NOT NULL AND day_of_week IS NULL AND day_of_month IS NULL)
    OR (frequency = 'weekly' AND run_time_local IS NOT NULL AND day_of_week IS NOT NULL AND day_of_week BETWEEN 0 AND 6 AND day_of_month IS NULL)
    OR (frequency = 'monthly' AND run_time_local IS NOT NULL AND day_of_week IS NULL AND day_of_month IS NOT NULL AND day_of_month BETWEEN 1 AND 28)
  ),
  CONSTRAINT backup_policy_daily_retention_positive CHECK (retention_daily_copies > 0),
  CONSTRAINT backup_policy_monthly_retention_positive CHECK (retention_monthly_copies > 0),
  CONSTRAINT backup_policy_rpo_positive CHECK (rpo_minutes > 0),
  CONSTRAINT backup_policy_rto_positive CHECK (rto_minutes > 0),
  CONSTRAINT backup_policy_status_valid CHECK (status IN ('draft', 'active', 'paused')),
  CONSTRAINT backup_policy_version_positive CHECK (version > 0),
  CONSTRAINT backup_policy_code_trimmed CHECK (
    policy_code = btrim(policy_code) AND char_length(policy_code) > 0
  ),
  CONSTRAINT backup_policy_name_trimmed CHECK (
    name = btrim(name) AND char_length(name) > 0
  )
);

CREATE INDEX backup_policies_status_idx
  ON backup.policies (status, name, id);

CREATE TABLE backup.policy_sources (
  policy_id uuid NOT NULL REFERENCES backup.policies(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES backup.protected_sources(id) ON DELETE RESTRICT,
  linked_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, source_id)
);

CREATE INDEX backup_policy_sources_source_idx
  ON backup.policy_sources (source_id, policy_id);

COMMENT ON TABLE backup.protected_sources IS
  'Inventory of systems and data protected by Vista backup policies; credentials are never stored here.';
COMMENT ON TABLE backup.policies IS
  'Versioned backup schedules and recovery objectives. New policies begin as drafts.';
COMMENT ON TABLE backup.policy_sources IS
  'Protected sources assigned to backup policies.';
