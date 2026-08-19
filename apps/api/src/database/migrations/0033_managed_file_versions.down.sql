DROP INDEX IF EXISTS files.file_version_group_idx;

ALTER TABLE files.objects
  DROP CONSTRAINT IF EXISTS file_rejection_code_not_blank,
  DROP CONSTRAINT IF EXISTS file_inspection_method_not_blank,
  DROP CONSTRAINT IF EXISTS file_replacement_not_self,
  DROP CONSTRAINT IF EXISTS file_version_group_version_unique,
  DROP COLUMN IF EXISTS rejection_code,
  DROP COLUMN IF EXISTS inspection_method,
  DROP COLUMN IF EXISTS replaces_object_id,
  DROP COLUMN IF EXISTS version_group_id;
