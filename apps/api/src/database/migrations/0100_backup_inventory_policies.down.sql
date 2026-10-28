DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM backup.policy_sources)
    OR EXISTS (SELECT 1 FROM backup.policies)
    OR EXISTS (SELECT 1 FROM backup.protected_sources) THEN
    RAISE EXCEPTION 'Backup inventory rollback is blocked when protected sources or policies exist';
  END IF;
END;
$$;

DROP TABLE backup.policy_sources;
DROP TABLE backup.policies;
DROP TABLE backup.protected_sources;
