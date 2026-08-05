CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS files;
CREATE SCHEMA IF NOT EXISTS notifications;
CREATE SCHEMA IF NOT EXISTS integration;
CREATE SCHEMA IF NOT EXISTS backup;

CREATE TABLE identity.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_number varchar(100) NOT NULL UNIQUE,
  display_name varchar(255) NOT NULL,
  email varchar(320) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employees_email_normalized CHECK (email = lower(email))
);

CREATE UNIQUE INDEX employees_email_unique ON identity.employees (email);

CREATE TABLE identity.user_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL UNIQUE REFERENCES identity.employees(id),
  password_hash text NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  password_expires_at timestamptz,
  status varchar(30) NOT NULL DEFAULT 'active',
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  two_factor_enrolled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_accounts_status_valid CHECK (status IN ('active', 'locked', 'disabled')),
  CONSTRAINT user_accounts_failed_logins_non_negative CHECK (failed_login_count >= 0)
);

CREATE TABLE identity.authentication_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.user_accounts(id),
  factor_type varchar(30) NOT NULL,
  encrypted_secret bytea,
  credential_identifier text,
  enabled boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT authentication_factor_type_valid CHECK (factor_type IN ('totp', 'webauthn', 'recovery_code')),
  CONSTRAINT authentication_factor_material_present CHECK (
    encrypted_secret IS NOT NULL OR credential_identifier IS NOT NULL
  )
);

CREATE TABLE identity.session_records (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.user_accounts(id),
  redis_key_digest char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_address inet,
  user_agent text,
  CONSTRAINT session_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE TABLE iam.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(100) NOT NULL UNIQUE,
  name varchar(255) NOT NULL,
  description text,
  is_administrative boolean NOT NULL DEFAULT false,
  is_system_role boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_code_normalized CHECK (code = lower(code))
);

CREATE TABLE iam.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module varchar(100) NOT NULL,
  action varchar(20) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permission_action_valid CHECK (action IN ('view', 'create', 'edit', 'delete', 'approve')),
  CONSTRAINT permission_module_action_unique UNIQUE (module, action)
);

CREATE TABLE iam.role_permissions (
  role_id uuid NOT NULL REFERENCES iam.roles(id),
  permission_id uuid NOT NULL REFERENCES iam.permissions(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES identity.user_accounts(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE iam.account_roles (
  account_id uuid NOT NULL REFERENCES identity.user_accounts(id),
  role_id uuid NOT NULL REFERENCES iam.roles(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES identity.user_accounts(id),
  PRIMARY KEY (account_id, role_id)
);

CREATE TABLE audit.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_account_id uuid REFERENCES identity.user_accounts(id),
  action varchar(150) NOT NULL,
  target_type varchar(150) NOT NULL,
  target_id uuid,
  correlation_id varchar(128) NOT NULL,
  source_ip inet,
  user_agent text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_event_hash char(64),
  event_hash char(64) NOT NULL UNIQUE
);

CREATE INDEX audit_events_target_idx ON audit.events (target_type, target_id, occurred_at DESC);
CREATE INDEX audit_events_actor_idx ON audit.events (actor_account_id, occurred_at DESC);
CREATE INDEX audit_events_correlation_idx ON audit.events (correlation_id);

CREATE FUNCTION audit.reject_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit.events
FOR EACH ROW EXECUTE FUNCTION audit.reject_event_mutation();

CREATE TABLE files.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type varchar(150) NOT NULL,
  parent_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE,
  bucket varchar(255) NOT NULL,
  original_name varchar(1024) NOT NULL,
  media_type varchar(255) NOT NULL,
  byte_size bigint NOT NULL,
  checksum_sha256 char(64) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status varchar(30) NOT NULL DEFAULT 'quarantined',
  issuer_account_id uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  scanned_at timestamptz,
  CONSTRAINT file_size_positive CHECK (byte_size > 0),
  CONSTRAINT file_version_positive CHECK (version > 0),
  CONSTRAINT file_status_valid CHECK (status IN ('quarantined', 'available', 'rejected', 'deleted'))
);

CREATE INDEX file_parent_idx ON files.objects (parent_type, parent_id, version DESC);

CREATE TABLE notifications.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_account_id uuid REFERENCES identity.user_accounts(id),
  channel varchar(20) NOT NULL,
  template_key varchar(255) NOT NULL,
  template_version integer NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key varchar(255) NOT NULL UNIQUE,
  status varchar(30) NOT NULL DEFAULT 'pending',
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  CONSTRAINT notification_channel_valid CHECK (channel IN ('in_system', 'email', 'sms')),
  CONSTRAINT notification_status_valid CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'cancelled')),
  CONSTRAINT notification_attempt_non_negative CHECK (attempt_count >= 0)
);

CREATE INDEX notification_delivery_queue_idx
  ON notifications.messages (available_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE platform.idempotency_keys (
  scope varchar(150) NOT NULL,
  idempotency_key varchar(255) NOT NULL,
  request_hash char(64) NOT NULL,
  status varchar(30) NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, idempotency_key),
  CONSTRAINT idempotency_status_valid CHECK (status IN ('processing', 'completed', 'failed')),
  CONSTRAINT idempotency_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE TABLE integration.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type varchar(150) NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type varchar(255) NOT NULL,
  event_version integer NOT NULL,
  correlation_id varchar(128) NOT NULL,
  idempotency_key varchar(255) NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code varchar(100),
  CONSTRAINT outbox_event_version_positive CHECK (event_version > 0),
  CONSTRAINT outbox_attempt_non_negative CHECK (attempt_count >= 0)
);

CREATE INDEX outbox_pending_idx
  ON integration.outbox_events (available_at, occurred_at)
  WHERE published_at IS NULL;

CREATE TABLE integration.inbox_receipts (
  consumer varchar(150) NOT NULL,
  message_id varchar(255) NOT NULL,
  payload_hash char(64) NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  result jsonb,
  PRIMARY KEY (consumer, message_id)
);

CREATE TABLE backup.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  critical_action varchar(100) NOT NULL,
  target_type varchar(150) NOT NULL,
  target_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'pending',
  justification text NOT NULL,
  correlation_id varchar(128) NOT NULL,
  CONSTRAINT backup_critical_action_valid CHECK (
    critical_action IN (
      'delete_restore_point',
      'reduce_retention',
      'disable_job',
      'destructive_restore',
      'modify_policy',
      'delete_policy'
    )
  ),
  CONSTRAINT backup_approval_status_valid CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'executed')),
  CONSTRAINT backup_approval_expiry_after_request CHECK (expires_at > requested_at)
);

CREATE TABLE backup.approvals (
  request_id uuid NOT NULL REFERENCES backup.approval_requests(id),
  approver_account_id uuid NOT NULL REFERENCES identity.user_accounts(id),
  decision varchar(20) NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  comment text,
  PRIMARY KEY (request_id, approver_account_id),
  CONSTRAINT backup_approval_decision_valid CHECK (decision IN ('approve', 'reject'))
);

CREATE FUNCTION backup.reject_self_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM backup.approval_requests request
    WHERE request.id = NEW.request_id
      AND request.requested_by = NEW.approver_account_id
  ) THEN
    RAISE EXCEPTION 'critical backup actions require a different approver';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER backup_approval_four_eyes
BEFORE INSERT OR UPDATE ON backup.approvals
FOR EACH ROW EXECUTE FUNCTION backup.reject_self_approval();

COMMENT ON TABLE audit.events IS 'Append-only material-action audit log. Application roles must not own this table.';
COMMENT ON TABLE identity.session_records IS 'Security/audit metadata only; live session state is stored in Redis.';
COMMENT ON TABLE backup.approval_requests IS 'Four-eyes workflow primitive; authorization and MFA are additionally enforced by the API.';
