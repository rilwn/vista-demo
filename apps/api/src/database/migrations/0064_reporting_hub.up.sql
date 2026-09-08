CREATE VIEW reporting.library_views AS
SELECT id, owner_account_id, name, configuration, created_at, 'finance'::text AS scope FROM reporting.saved_finance_reports
UNION ALL SELECT id, owner_account_id, name, configuration, created_at, 'service' FROM reporting.saved_service_reports
UNION ALL SELECT id, owner_account_id, name, configuration, created_at, 'crm' FROM reporting.saved_crm_reports
UNION ALL SELECT id, owner_account_id, name, configuration, created_at, 'pos' FROM reporting.saved_pos_reports
UNION ALL SELECT id, owner_account_id, name, configuration, created_at, scope FROM reporting.saved_erp_reports;

CREATE TABLE reporting.report_schedules (
 id uuid PRIMARY KEY, owner_account_id uuid NOT NULL REFERENCES identity.user_accounts(id),
 view_id uuid NOT NULL, scope text NOT NULL CHECK(scope IN ('finance','procurement','warehouse','sales','logistics','service','crm','pos')),
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object'),
 cadence text NOT NULL CHECK(cadence IN ('daily','weekly','monthly')),
 period text NOT NULL CHECK(period IN ('saved_dates','previous_day','previous_7_days','previous_month','current')),
 first_run_local timestamp NOT NULL, timezone text NOT NULL, next_run_at timestamptz NOT NULL,
 occurrence integer NOT NULL DEFAULT 0 CHECK(occurrence>=0), enabled boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 0, error_code text, request_hash char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_schedules_due_idx ON reporting.report_schedules(next_run_at,id) WHERE enabled;
CREATE INDEX report_schedules_owner_idx ON reporting.report_schedules(owner_account_id,created_at DESC,id);
CREATE TABLE reporting.report_schedule_runs (
 id uuid PRIMARY KEY, schedule_id uuid NOT NULL REFERENCES reporting.report_schedules(id),
 scheduled_for timestamptz NOT NULL, export_id uuid NOT NULL UNIQUE REFERENCES reporting.export_jobs(id),
 UNIQUE(schedule_id,scheduled_for)
);
CREATE TABLE reporting.dashboard_preferences (
 owner_account_id uuid NOT NULL REFERENCES identity.user_accounts(id),
 scope text NOT NULL CHECK(scope IN ('finance','service','crm','pos')),
 hidden_cards jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(hidden_cards)='array'),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0), PRIMARY KEY(owner_account_id,scope)
);
