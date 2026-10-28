DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pos.fiscal_sale_preparations)
    OR EXISTS (
      SELECT 1 FROM inventory.stock_reservations
      WHERE reference_type = 'pos_fiscal_preparation'
    )
  THEN
    RAISE EXCEPTION 'Cannot roll back DATECS sale preparation while unresolved or retained preparations exist';
  END IF;
END $$;

DROP TABLE IF EXISTS pos.fiscal_preparation_loyalty_reservations;
DROP INDEX IF EXISTS pos_discount_authorization_fiscal_hold_unique;
ALTER TABLE pos.discount_authorizations
  DROP COLUMN reserved_by_fiscal_preparation_id;
DROP TABLE IF EXISTS pos.datecs_unp_sequences;
DROP TABLE IF EXISTS pos.fiscal_sale_preparations;

ALTER TABLE inventory.batch_stock_balances
  DROP CONSTRAINT batch_stock_reserved_quantity_valid,
  DROP COLUMN reserved_quantity;

ALTER TABLE inventory.stock_reservations
  DROP CONSTRAINT stock_reservation_reference_type_valid,
  ADD CONSTRAINT stock_reservation_reference_type_valid CHECK (
    reference_type IN ('sales_order', 'quotation', 'service_request')
  );

