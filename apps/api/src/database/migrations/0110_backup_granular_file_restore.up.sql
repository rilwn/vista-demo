ALTER TABLE backup.restore_requests
  ADD COLUMN restore_object_key varchar(1024),
  ADD CONSTRAINT backup_restore_object_key_valid CHECK (
    restore_object_key IS NULL OR (
      char_length(restore_object_key) > 0
      AND octet_length(restore_object_key) <= 1024
    )
  );

COMMENT ON COLUMN backup.restore_requests.restore_object_key IS
  'Optional exact file-store object key selected from the verified restore point; recovery still targets an isolated prefix.';
