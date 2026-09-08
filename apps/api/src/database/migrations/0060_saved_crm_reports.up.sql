CREATE TABLE reporting.saved_crm_reports (
  id uuid PRIMARY KEY,
  owner_account_id uuid NOT NULL REFERENCES identity.user_accounts(id),
  name varchar(100) NOT NULL CHECK (length(trim(name)) > 0),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
  request_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_crm_reports_owner_idx
  ON reporting.saved_crm_reports(owner_account_id, created_at DESC, id);
