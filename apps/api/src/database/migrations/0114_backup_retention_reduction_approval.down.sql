DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM backup.retention_reduction_requests) THEN
    RAISE EXCEPTION 'Cannot roll back backup retention-reduction approval history';
  END IF;
END;
$$;

DROP TABLE backup.retention_reduction_requests;
