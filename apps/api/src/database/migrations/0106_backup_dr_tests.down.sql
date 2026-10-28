DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM backup.dr_test_records) THEN
    RAISE EXCEPTION 'Cannot remove disaster-recovery test records while plans or signed evidence exist';
  END IF;
END;
$$;

DROP TABLE backup.dr_test_events;
DROP TABLE backup.dr_test_records;
DROP FUNCTION backup.prevent_dr_test_event_mutation();
DROP FUNCTION backup.prevent_recorded_dr_test_mutation();
