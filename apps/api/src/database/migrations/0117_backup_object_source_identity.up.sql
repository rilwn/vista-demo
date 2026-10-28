ALTER TABLE backup.execution_runs
  ADD COLUMN source_bucket_snapshot varchar(255),
  ADD COLUMN source_identity_snapshot char(64);

-- Before this migration every registered object-storage source referred to
-- Vista's managed file store, regardless of its source code. Keep those exact
-- existing registrations working without treating new, unconfigured sources
-- as the managed bucket.
CREATE TABLE backup.legacy_managed_object_sources (
  source_id uuid PRIMARY KEY REFERENCES backup.protected_sources(id) ON DELETE RESTRICT,
  source_code_snapshot varchar(80) NOT NULL
);
INSERT INTO backup.legacy_managed_object_sources(source_id,source_code_snapshot)
SELECT id,source_code FROM backup.protected_sources WHERE source_type='object_storage';

CREATE TRIGGER backup_legacy_managed_object_sources_append_only
BEFORE UPDATE OR DELETE ON backup.legacy_managed_object_sources
FOR EACH ROW EXECUTE FUNCTION backup.prevent_execution_event_mutation();

-- Existing verified object archives already contain the bucket checked at
-- verification time. Keep it available even if the original source is gone.
UPDATE backup.execution_runs
SET source_bucket_snapshot = source_manifest->>'sourceBucket'
WHERE source_type = 'object_storage'
  AND jsonb_typeof(source_manifest->'sourceBucket') = 'string'
  AND length(source_manifest->>'sourceBucket') BETWEEN 1 AND 255;

ALTER TABLE backup.execution_runs
  ADD CONSTRAINT backup_execution_object_source_identity_valid CHECK (
    (source_bucket_snapshot IS NULL AND source_identity_snapshot IS NULL)
    OR (
      source_type = 'object_storage'
      AND (source_bucket_snapshot IS NULL OR length(source_bucket_snapshot) > 0)
      AND (source_identity_snapshot IS NULL OR source_identity_snapshot ~ '^[0-9a-f]{64}$')
    )
  );

CREATE FUNCTION backup.prevent_object_source_snapshot_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_bucket_snapshot IS DISTINCT FROM NEW.source_bucket_snapshot
     OR OLD.source_identity_snapshot IS DISTINCT FROM NEW.source_identity_snapshot THEN
    RAISE EXCEPTION 'backup object source snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER backup_object_source_snapshot_immutable
BEFORE UPDATE ON backup.execution_runs
FOR EACH ROW EXECUTE FUNCTION backup.prevent_object_source_snapshot_change();

COMMENT ON COLUMN backup.execution_runs.source_bucket_snapshot IS
  'Original object-store bucket for independent archive verification and recovery.';
COMMENT ON COLUMN backup.execution_runs.source_identity_snapshot IS
  'Non-secret SHA-256 of source endpoint, region and bucket; prevents deltas crossing source changes.';
