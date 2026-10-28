DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM backup.plan_reviews) THEN
    RAISE EXCEPTION 'Cannot remove signed backup plan review evidence';
  END IF;
END;
$$;

DROP TABLE backup.plan_reviews;
DROP FUNCTION backup.prevent_plan_review_mutation();
