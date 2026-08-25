CREATE SCHEMA IF NOT EXISTS reporting;

CREATE TABLE reporting.report_definitions (
  id uuid PRIMARY KEY,
  definition_key varchar(100) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  description varchar(500) NOT NULL,
  implementation_key varchar(100) NOT NULL UNIQUE,
  available_formats varchar(10)[] NOT NULL,
  filter_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reporting_definition_key_valid CHECK (
    definition_key ~ '^[a-z][a-z0-9.-]{2,99}$'
  ),
  CONSTRAINT reporting_definition_formats_valid CHECK (
    cardinality(available_formats) > 0
    AND available_formats <@ ARRAY['csv', 'xlsx', 'pdf']::varchar[]
  )
);

INSERT INTO reporting.report_definitions (
  id, definition_key, name, description, implementation_key, available_formats, filter_schema
) VALUES
  (
    '8f2a09d3-824d-4a8d-a249-153902bd17f1',
    'finance.receivables-aging',
    'Customer receivables',
    'Open customer balances grouped by due-date age.',
    'finance.receivables-aging.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"properties":{}}'::jsonb
  ),
  (
    '19fdbbe8-bc6b-4be7-8d9a-a88a244753ee',
    'finance.supplier-payables-aging',
    'Supplier payables',
    'Open supplier balances grouped by due-date age.',
    'finance.supplier-payables-aging.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"properties":{}}'::jsonb
  ),
  (
    'f05ab456-b06a-4360-972a-e868c9800d44',
    'finance.customer-turnover',
    'Customer turnover',
    'Customer document turnover for a selected period.',
    'finance.customer-turnover.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  ),
  (
    '072d9261-9694-4337-9e2e-cf612b818e29',
    'finance.supplier-turnover',
    'Supplier turnover',
    'Supplier document turnover for a selected period.',
    'finance.supplier-turnover.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  );

CREATE TABLE reporting.export_jobs (
  id uuid PRIMARY KEY,
  report_definition_id uuid NOT NULL
    REFERENCES reporting.report_definitions(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  export_format varchar(10) NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_idempotency_key varchar(255) NOT NULL,
  request_hash char(64) NOT NULL,
  correlation_id varchar(128) NOT NULL,
  queue_job_id varchar(100),
  status varchar(20) NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  file_name varchar(255),
  media_type varchar(120),
  storage_key varchar(1024),
  checksum_sha256 char(64),
  byte_size bigint,
  row_count integer,
  error_code varchar(100),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reporting_export_request_unique UNIQUE (requested_by, request_idempotency_key),
  CONSTRAINT reporting_export_format_valid CHECK (export_format IN ('csv', 'xlsx', 'pdf')),
  CONSTRAINT reporting_export_status_valid CHECK (
    status IN ('queued', 'processing', 'completed', 'failed')
  ),
  CONSTRAINT reporting_export_attempt_count_valid CHECK (attempt_count >= 0),
  CONSTRAINT reporting_export_byte_size_valid CHECK (byte_size IS NULL OR byte_size >= 0),
  CONSTRAINT reporting_export_row_count_valid CHECK (row_count IS NULL OR row_count >= 0),
  CONSTRAINT reporting_export_completed_state_valid CHECK (
    status <> 'completed' OR (
      file_name IS NOT NULL AND media_type IS NOT NULL AND storage_key IS NOT NULL
      AND checksum_sha256 IS NOT NULL AND byte_size IS NOT NULL
      AND row_count IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NULL
    )
  )
);

CREATE INDEX reporting_export_jobs_owner_created_idx
  ON reporting.export_jobs (requested_by, requested_at DESC, id DESC);
CREATE INDEX reporting_export_jobs_pending_idx
  ON reporting.export_jobs (requested_at, id)
  WHERE status IN ('queued', 'processing');

COMMENT ON TABLE reporting.report_definitions IS
  'Controlled report catalogue. Each implementation key is backed by reviewed application code; end users never provide SQL.';
COMMENT ON TABLE reporting.export_jobs IS
  'Auditable asynchronous report exports with request ownership, retry state, and stored-file integrity metadata.';
