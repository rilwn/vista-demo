ALTER TABLE sales.quotations
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN cancellation_reason text,
  DROP CONSTRAINT sales_quotation_status_valid,
  ADD CONSTRAINT sales_quotation_status_valid CHECK (
    status IN ('draft', 'confirmed', 'shipped', 'invoiced', 'cancelled')
  ),
  ADD CONSTRAINT sales_quotation_version_positive CHECK (version > 0),
  ADD CONSTRAINT sales_quotation_cancellation_consistent CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
    OR (status <> 'cancelled' AND cancelled_at IS NULL AND cancelled_by IS NULL
      AND cancellation_reason IS NULL)
  );

CREATE TABLE sales.quotation_revisions (
  id uuid PRIMARY KEY,
  quotation_id uuid NOT NULL REFERENCES sales.quotations(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_quotation_revision_version_positive CHECK (version > 0),
  CONSTRAINT sales_quotation_revision_unique UNIQUE (quotation_id, version)
);

INSERT INTO sales.quotation_revisions (
  id, quotation_id, version, snapshot, changed_by, changed_at
)
SELECT
  gen_random_uuid(), quotation.id, quotation.version,
  jsonb_build_object(
    'createdAt', quotation.created_at,
    'currencyCode', quotation.currency_code,
    'customerName', customer.display_name,
    'customerPartnerId', quotation.customer_partner_id,
    'id', quotation.id,
    'lines', coalesce(lines.items, '[]'::jsonb),
    'number', quotation.quotation_number,
    'overallDiscountPercent', quotation.overall_discount_percent::text,
    'status', quotation.status,
    'subtotal', quotation.subtotal::text,
    'total', quotation.total::text,
    'validUntil', quotation.valid_until::text,
    'vatTotal', quotation.vat_total::text,
    'version', quotation.version,
    'warehouseId', quotation.warehouse_id,
    'warehouseName', warehouse.name
  ), quotation.created_by, quotation.created_at
FROM sales.quotations quotation
JOIN master_data.partners customer ON customer.id = quotation.customer_partner_id
JOIN master_data.warehouses warehouse ON warehouse.id = quotation.warehouse_id
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
    'discountPercent', line.discount_percent::text,
    'id', line.id,
    'lineTotal', line.line_total::text,
    'productId', line.product_id,
    'productName', product.name,
    'quantity', line.quantity::text,
    'trackingMode', category.tracking_mode,
    'unitPrice', line.unit_price::text,
    'vatTreatment', line.vat_treatment
  ) ORDER BY line.id) AS items
  FROM sales.quotation_lines line
  JOIN master_data.products product ON product.id = line.product_id
  JOIN master_data.product_categories category ON category.id = product.category_id
  WHERE line.quotation_id = quotation.id
) lines ON true;

CREATE INDEX sales_quotation_revisions_history_idx
  ON sales.quotation_revisions (quotation_id, version DESC);

COMMENT ON TABLE sales.quotation_revisions IS
  'Immutable snapshots of each customer quotation version for revision review and audit.';
