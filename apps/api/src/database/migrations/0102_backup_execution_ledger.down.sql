DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM backup.execution_runs)
    OR EXISTS (SELECT 1 FROM backup.execution_events) THEN
    RAISE EXCEPTION 'Backup execution evidence exists; restore a verified backup instead of dropping it';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS backup_execution_events_append_only ON backup.execution_events;
DROP FUNCTION IF EXISTS backup.prevent_execution_event_mutation();
DROP TABLE IF EXISTS backup.execution_events;
DROP TABLE IF EXISTS backup.execution_runs;
