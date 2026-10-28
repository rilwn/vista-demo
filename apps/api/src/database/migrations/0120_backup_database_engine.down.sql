DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM backup.execution_runs WHERE database_engine = 'mariadb'
  ) THEN
    RAISE EXCEPTION 'Cannot remove database engine metadata while MariaDB backup evidence exists';
  END IF;
END;
$$;

ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_database_engine_valid;

DROP TRIGGER backup_execution_database_engine_immutable ON backup.execution_runs;
DROP FUNCTION backup.prevent_execution_database_engine_change();

ALTER TABLE backup.execution_runs
  DROP COLUMN database_engine;
