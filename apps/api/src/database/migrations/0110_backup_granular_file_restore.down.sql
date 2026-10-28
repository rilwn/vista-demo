ALTER TABLE backup.restore_requests
  DROP CONSTRAINT backup_restore_object_key_valid,
  DROP COLUMN restore_object_key;
