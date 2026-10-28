CREATE TABLE pos.datecs_unp_leases (
  unique_sale_id varchar(21) PRIMARY KEY,
  device_serial varchar(8) NOT NULL,
  operator_identifier varchar(4) NOT NULL,
  cash_register_id uuid NOT NULL
    REFERENCES organization.cash_registers(id) ON DELETE RESTRICT,
  reserved_by_account_id uuid NOT NULL
    REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  claimed_by_transaction_id uuid UNIQUE,
  fiscal_preparation_id uuid UNIQUE
    REFERENCES pos.fiscal_sale_preparations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT datecs_unp_lease_device_valid CHECK (
    device_serial ~ '^[A-Z0-9]{8}$'
  ),
  CONSTRAINT datecs_unp_lease_operator_valid CHECK (
    operator_identifier ~ '^[A-Z0-9]{4}$'
  ),
  CONSTRAINT datecs_unp_lease_identifier_valid CHECK (
    unique_sale_id ~ '^[A-Z0-9]{8}-[A-Z0-9]{4}-[0-9]{7}$'
    AND unique_sale_id = device_serial || '-' || operator_identifier || '-'
      || substring(unique_sale_id from 15 for 7)
  ),
  CONSTRAINT datecs_unp_lease_claim_lifecycle_valid CHECK (
    (claimed_by_transaction_id IS NULL AND fiscal_preparation_id IS NULL)
    OR (claimed_by_transaction_id IS NOT NULL AND fiscal_preparation_id IS NOT NULL)
  )
);

CREATE INDEX datecs_unp_lease_available_idx
  ON pos.datecs_unp_leases (
    reserved_by_account_id, cash_register_id, device_serial,
    operator_identifier, substring(unique_sale_id from 15 for 7)
  )
  WHERE claimed_by_transaction_id IS NULL;

COMMENT ON TABLE pos.datecs_unp_leases IS
  'Durable, one-use DATECS sale identifiers reserved while online for later offline receipt issuance.';
