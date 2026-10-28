CREATE TABLE backup.plan_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_code varchar(40) NOT NULL UNIQUE,
  reviewed_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  next_review_due_at timestamptz NOT NULL,
  outcome varchar(24) NOT NULL,
  summary text NOT NULL,
  corrective_actions text NOT NULL DEFAULT '',
  protected_source_count integer NOT NULL,
  policy_count integer NOT NULL,
  plan_snapshot jsonb NOT NULL,
  snapshot_sha256 char(64) NOT NULL,
  CONSTRAINT backup_plan_review_outcome_valid CHECK (outcome IN ('approved','changes_required')),
  CONSTRAINT backup_plan_review_summary_valid CHECK (
    summary=btrim(summary) AND char_length(summary) BETWEEN 10 AND 2000
  ),
  CONSTRAINT backup_plan_review_actions_required CHECK (
    outcome <> 'changes_required' OR char_length(btrim(corrective_actions)) BETWEEN 10 AND 4000
  ),
  CONSTRAINT backup_plan_review_counts_nonnegative CHECK (
    protected_source_count >= 0 AND policy_count >= 0
  ),
  CONSTRAINT backup_plan_review_snapshot_object CHECK (
    jsonb_typeof(plan_snapshot)='object'
    AND jsonb_typeof(plan_snapshot->'protectedSources')='array'
    AND jsonb_typeof(plan_snapshot->'policies')='array'
  ),
  CONSTRAINT backup_plan_review_fingerprint_valid CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT backup_plan_review_due_after_review CHECK (next_review_due_at > reviewed_at)
);

CREATE INDEX backup_plan_reviews_latest_idx
  ON backup.plan_reviews (reviewed_at DESC,id DESC);

CREATE FUNCTION backup.prevent_plan_review_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'backup plan review evidence is immutable';
END;
$$;

CREATE TRIGGER backup_plan_reviews_immutable
BEFORE UPDATE OR DELETE ON backup.plan_reviews
FOR EACH ROW EXECUTE FUNCTION backup.prevent_plan_review_mutation();

CREATE TRIGGER backup_plan_reviews_no_truncate
BEFORE TRUNCATE ON backup.plan_reviews
FOR EACH STATEMENT EXECUTE FUNCTION backup.prevent_plan_review_mutation();
