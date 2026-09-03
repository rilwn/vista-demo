CREATE FUNCTION pos.reject_loyalty_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Loyalty ledger entries are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER pos_loyalty_ledger_append_only
BEFORE UPDATE OR DELETE ON pos.loyalty_points_ledger
FOR EACH ROW EXECUTE FUNCTION pos.reject_loyalty_ledger_mutation();

COMMENT ON FUNCTION pos.reject_loyalty_ledger_mutation() IS
  'Prevents mutation of posted loyalty activity; corrections require compensating entries.';
