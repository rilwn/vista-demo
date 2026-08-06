CREATE FUNCTION audit.enforce_event_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_previous_hash char(64);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('vista.audit.events.chain'));

  SELECT event_hash
    INTO expected_previous_hash
    FROM audit.events
   ORDER BY occurred_at DESC, id DESC
   LIMIT 1;

  IF expected_previous_hash IS NULL THEN
    IF NEW.previous_event_hash IS NOT NULL THEN
      RAISE EXCEPTION 'first audit event cannot reference a previous event';
    END IF;
  ELSIF NEW.previous_event_hash IS DISTINCT FROM expected_previous_hash THEN
    RAISE EXCEPTION 'audit event must extend the current hash chain';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_chain_integrity
BEFORE INSERT ON audit.events
FOR EACH ROW EXECUTE FUNCTION audit.enforce_event_chain();

CREATE INDEX session_records_account_active_idx
  ON identity.session_records (account_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX authentication_factors_account_enabled_idx
  ON identity.authentication_factors (account_id, factor_type)
  WHERE enabled = true;

COMMENT ON FUNCTION audit.enforce_event_chain() IS
  'Serializes audit inserts and requires every new event to reference the current chain head.';
