DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM backup.restore_requests)
    OR EXISTS (SELECT 1 FROM backup.restore_events) THEN
    RAISE EXCEPTION 'Backup restore evidence exists; preserve it before rolling back this migration';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS backup_restore_events_append_only ON backup.restore_events;
DROP FUNCTION IF EXISTS backup.prevent_restore_event_mutation();
DROP TABLE IF EXISTS backup.restore_events;
DROP TABLE IF EXISTS backup.restore_requests;
