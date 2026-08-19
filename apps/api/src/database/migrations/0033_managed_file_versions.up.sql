ALTER TABLE files.objects
  ADD COLUMN version_group_id uuid,
  ADD COLUMN replaces_object_id uuid REFERENCES files.objects(id) ON DELETE RESTRICT,
  ADD COLUMN inspection_method varchar(100),
  ADD COLUMN rejection_code varchar(100);

UPDATE files.objects
SET version_group_id = id
WHERE version_group_id IS NULL;

ALTER TABLE files.objects
  ALTER COLUMN version_group_id SET NOT NULL,
  ADD CONSTRAINT file_version_group_version_unique UNIQUE (version_group_id, version),
  ADD CONSTRAINT file_replacement_not_self CHECK (replaces_object_id IS NULL OR replaces_object_id <> id),
  ADD CONSTRAINT file_inspection_method_not_blank CHECK (
    inspection_method IS NULL OR char_length(btrim(inspection_method)) > 0
  ),
  ADD CONSTRAINT file_rejection_code_not_blank CHECK (
    rejection_code IS NULL OR char_length(btrim(rejection_code)) > 0
  );

CREATE INDEX file_version_group_idx
  ON files.objects (version_group_id, version DESC, created_at DESC);

COMMENT ON COLUMN files.objects.version_group_id IS
  'Stable logical-file identity shared by immutable replacement versions.';
COMMENT ON COLUMN files.objects.inspection_method IS
  'Inspection adapter result. structural-signature validates declared type; production malware scanning remains separately configurable.';
