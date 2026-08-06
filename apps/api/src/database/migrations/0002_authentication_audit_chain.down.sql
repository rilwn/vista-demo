DROP INDEX IF EXISTS identity.authentication_factors_account_enabled_idx;
DROP INDEX IF EXISTS identity.session_records_account_active_idx;
DROP TRIGGER IF EXISTS audit_events_chain_integrity ON audit.events;
DROP FUNCTION IF EXISTS audit.enforce_event_chain();
