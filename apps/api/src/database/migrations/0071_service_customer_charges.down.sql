ALTER TABLE service.work_order_part_usages
  DROP CONSTRAINT service_work_order_part_customer_price_nonnegative,
  DROP COLUMN customer_total_charge_eur,
  DROP COLUMN customer_unit_price_eur;

ALTER TABLE service.work_orders
  DROP CONSTRAINT service_work_order_customer_charge_recorded_valid,
  DROP CONSTRAINT service_work_order_customer_charges_nonnegative,
  DROP COLUMN total_customer_charge_eur,
  DROP COLUMN customer_charge_recorded,
  DROP COLUMN customer_transport_charge_eur,
  DROP COLUMN customer_parts_charge_eur,
  DROP COLUMN customer_labor_charge_eur;
