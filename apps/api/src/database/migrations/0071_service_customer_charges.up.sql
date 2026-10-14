ALTER TABLE service.work_orders
  ADD COLUMN customer_labor_charge_eur numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN customer_parts_charge_eur numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN customer_transport_charge_eur numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN customer_charge_recorded boolean NOT NULL DEFAULT false,
  ADD COLUMN total_customer_charge_eur numeric(18, 4)
    GENERATED ALWAYS AS (
      round(customer_labor_charge_eur + customer_parts_charge_eur + customer_transport_charge_eur, 4)
    ) STORED,
  ADD CONSTRAINT service_work_order_customer_charges_nonnegative CHECK (
    customer_labor_charge_eur >= 0
    AND customer_parts_charge_eur >= 0
    AND customer_transport_charge_eur >= 0
  ),
  ADD CONSTRAINT service_work_order_customer_charge_recorded_valid CHECK (
    customer_charge_recorded = false OR status = 'completed'
  );

ALTER TABLE service.work_order_part_usages
  ADD COLUMN customer_unit_price_eur numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN customer_total_charge_eur numeric(18, 4)
    GENERATED ALWAYS AS (round(quantity * customer_unit_price_eur, 4)) STORED,
  ADD CONSTRAINT service_work_order_part_customer_price_nonnegative
    CHECK (customer_unit_price_eur >= 0);

COMMENT ON COLUMN service.work_orders.customer_charge_recorded IS
  'True only when staff explicitly recorded the customer charge separately from internal repair costs.';
COMMENT ON COLUMN service.work_order_part_usages.customer_unit_price_eur IS
  'Customer billable unit price, distinct from stock valuation cost.';
