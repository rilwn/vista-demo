ALTER TABLE backup.execution_runs
  ADD COLUMN database_engine varchar(20);

UPDATE backup.execution_runs
SET database_engine = 'postgresql'
WHERE source_type = 'database';

ALTER TABLE backup.execution_runs
  ADD CONSTRAINT backup_execution_database_engine_valid CHECK (
    (source_type = 'database' AND database_engine IS NOT NULL
      AND database_engine IN ('postgresql', 'mariadb'))
    OR (source_type <> 'database' AND database_engine IS NULL)
  );

CREATE FUNCTION backup.prevent_execution_database_engine_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.database_engine IS DISTINCT FROM NEW.database_engine THEN
    RAISE EXCEPTION 'backup database engine is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER backup_execution_database_engine_immutable
BEFORE UPDATE ON backup.execution_runs
FOR EACH ROW EXECUTE FUNCTION backup.prevent_execution_database_engine_change();

COMMENT ON COLUMN backup.execution_runs.database_engine IS
  'Immutable engine identity for database archives; lets verification and recovery work without the original source credentials.';
