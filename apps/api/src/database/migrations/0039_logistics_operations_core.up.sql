CREATE SCHEMA IF NOT EXISTS logistics;

CREATE TABLE logistics.internal_document_sequences (
  document_type varchar(30) PRIMARY KEY,
  next_value bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logistics_sequence_type_valid CHECK (
    document_type IN ('delivery', 'reverse_return', 'route_plan')
  ),
  CONSTRAINT logistics_sequence_value_positive CHECK (next_value > 0)
);

CREATE TABLE logistics.deliveries (
  id uuid PRIMARY KEY,
  delivery_number varchar(40) NOT NULL UNIQUE,
  shipment_id uuid NOT NULL UNIQUE REFERENCES sales.shipments(id) ON DELETE RESTRICT,
  handover_certificate_id uuid NOT NULL UNIQUE
    REFERENCES sales.handover_certificates(id) ON DELETE RESTRICT,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_location_id uuid NOT NULL,
  delivery_method varchar(30) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'planned',
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz NOT NULL,
  address_line_1 varchar(255) NOT NULL,
  address_line_2 varchar(255),
  city varchar(150) NOT NULL,
  postal_code varchar(30),
  country_code char(2) NOT NULL,
  instructions varchar(2000),
  recipient_name varchar(255),
  delivered_at timestamptz,
  proof_notes varchar(2000),
  exception_reason varchar(1000),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logistics_delivery_location_customer_fk
    FOREIGN KEY (customer_location_id, customer_partner_id)
    REFERENCES master_data.customer_locations(id, partner_id) ON DELETE RESTRICT,
  CONSTRAINT logistics_delivery_method_valid CHECK (
    delivery_method IN ('company_transport', 'econt', 'speedy')
  ),
  CONSTRAINT logistics_delivery_status_valid CHECK (
    status IN ('planned', 'in_transit', 'delivered', 'exception', 'cancelled')
  ),
  CONSTRAINT logistics_delivery_schedule_valid CHECK (scheduled_end > scheduled_start),
  CONSTRAINT logistics_delivery_address_nonempty CHECK (
    address_line_1 = btrim(address_line_1) AND char_length(address_line_1) > 0
    AND city = btrim(city) AND char_length(city) > 0
    AND country_code = upper(country_code)
  ),
  CONSTRAINT logistics_delivery_completion_valid CHECK (
    (status = 'delivered' AND recipient_name IS NOT NULL AND delivered_at IS NOT NULL)
    OR (status <> 'delivered' AND recipient_name IS NULL AND delivered_at IS NULL)
  ),
  CONSTRAINT logistics_delivery_exception_valid CHECK (
    (status = 'exception' AND exception_reason IS NOT NULL)
    OR (status <> 'exception' AND exception_reason IS NULL)
  ),
  CONSTRAINT logistics_delivery_version_positive CHECK (version > 0)
);

CREATE INDEX logistics_deliveries_schedule_idx
  ON logistics.deliveries (scheduled_start, status, id);
CREATE INDEX logistics_deliveries_customer_idx
  ON logistics.deliveries (customer_partner_id, created_at DESC, id DESC);

CREATE TABLE logistics.delivery_status_history (
  id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES logistics.deliveries(id) ON DELETE RESTRICT,
  previous_status varchar(30),
  next_status varchar(30) NOT NULL,
  note varchar(1000),
  changed_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logistics_delivery_history_status_valid CHECK (
    (previous_status IS NULL OR previous_status IN ('planned', 'in_transit', 'delivered', 'exception', 'cancelled'))
    AND next_status IN ('planned', 'in_transit', 'delivered', 'exception', 'cancelled')
  )
);

CREATE INDEX logistics_delivery_history_idx
  ON logistics.delivery_status_history (delivery_id, changed_at, id);

CREATE TABLE logistics.reverse_returns (
  id uuid PRIMARY KEY,
  return_number varchar(40) NOT NULL UNIQUE,
  original_shipment_id uuid NOT NULL REFERENCES sales.shipments(id) ON DELETE RESTRICT,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_location_id uuid NOT NULL,
  transport_method varchar(30) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'registered',
  scheduled_pickup_at timestamptz,
  reason varchar(2000) NOT NULL,
  received_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  received_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logistics_return_location_customer_fk
    FOREIGN KEY (customer_location_id, customer_partner_id)
    REFERENCES master_data.customer_locations(id, partner_id) ON DELETE RESTRICT,
  CONSTRAINT logistics_return_transport_valid CHECK (
    transport_method IN ('company_transport', 'customer_dropoff', 'econt', 'speedy')
  ),
  CONSTRAINT logistics_return_status_valid CHECK (
    status IN ('registered', 'received', 'cancelled')
  ),
  CONSTRAINT logistics_return_reason_nonempty CHECK (
    reason = btrim(reason) AND char_length(reason) > 0
  ),
  CONSTRAINT logistics_return_receipt_valid CHECK (
    (status = 'received' AND received_at IS NOT NULL AND received_by IS NOT NULL)
    OR (status <> 'received' AND received_at IS NULL AND received_by IS NULL)
  ),
  CONSTRAINT logistics_return_version_positive CHECK (version > 0)
);

CREATE INDEX logistics_returns_customer_idx
  ON logistics.reverse_returns (customer_partner_id, created_at DESC, id DESC);
CREATE INDEX logistics_returns_pickup_idx
  ON logistics.reverse_returns (scheduled_pickup_at, status, id)
  WHERE scheduled_pickup_at IS NOT NULL;

CREATE TABLE logistics.reverse_return_lines (
  id uuid PRIMARY KEY,
  reverse_return_id uuid NOT NULL
    REFERENCES logistics.reverse_returns(id) ON DELETE RESTRICT,
  shipment_line_id uuid NOT NULL REFERENCES sales.shipment_lines(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL,
  disposition varchar(20) NOT NULL,
  destination_warehouse_id uuid NOT NULL
    REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  customer_equipment_id uuid REFERENCES master_data.customer_equipment(id) ON DELETE RESTRICT,
  service_type varchar(30),
  serial_numbers text[] NOT NULL DEFAULT '{}',
  inventory_return_movement_id uuid UNIQUE
    REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  service_request_id uuid UNIQUE REFERENCES service.requests(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logistics_return_line_unique UNIQUE (reverse_return_id, shipment_line_id),
  CONSTRAINT logistics_return_line_quantity_positive CHECK (quantity > 0),
  CONSTRAINT logistics_return_line_disposition_valid CHECK (
    disposition IN ('restock', 'service')
  ),
  CONSTRAINT logistics_return_line_service_valid CHECK (
    (
      disposition = 'service'
      AND customer_equipment_id IS NOT NULL
      AND service_type IN ('warranty', 'out_of_warranty')
    )
    OR (
      disposition = 'restock'
      AND customer_equipment_id IS NULL
      AND service_type IS NULL
    )
  )
);

CREATE INDEX logistics_return_lines_return_idx
  ON logistics.reverse_return_lines (reverse_return_id, id);

CREATE TABLE logistics.route_plans (
  id uuid PRIMARY KEY,
  route_number varchar(40) NOT NULL UNIQUE,
  route_date date NOT NULL,
  title varchar(255) NOT NULL,
  assigned_account_id uuid NOT NULL
    REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'planned',
  notes varchar(2000),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logistics_route_title_nonempty CHECK (
    title = btrim(title) AND char_length(title) > 0
  ),
  CONSTRAINT logistics_route_status_valid CHECK (
    status IN ('planned', 'in_progress', 'completed', 'cancelled')
  ),
  CONSTRAINT logistics_route_version_positive CHECK (version > 0)
);

CREATE INDEX logistics_route_plans_date_idx
  ON logistics.route_plans (route_date, assigned_account_id, id);

CREATE TABLE logistics.route_stops (
  id uuid PRIMARY KEY,
  route_plan_id uuid NOT NULL REFERENCES logistics.route_plans(id) ON DELETE RESTRICT,
  position integer NOT NULL,
  stop_type varchar(20) NOT NULL,
  delivery_id uuid REFERENCES logistics.deliveries(id) ON DELETE RESTRICT,
  service_work_order_id uuid REFERENCES service.work_orders(id) ON DELETE RESTRICT,
  planned_arrival timestamptz NOT NULL,
  planned_duration_minutes integer NOT NULL,
  label varchar(255) NOT NULL,
  address_line varchar(500) NOT NULL,
  city varchar(150) NOT NULL,
  CONSTRAINT logistics_route_stop_position_unique UNIQUE (route_plan_id, position),
  CONSTRAINT logistics_route_stop_source_unique
    UNIQUE NULLS NOT DISTINCT (route_plan_id, delivery_id, service_work_order_id),
  CONSTRAINT logistics_route_stop_position_positive CHECK (position > 0),
  CONSTRAINT logistics_route_stop_type_valid CHECK (stop_type IN ('delivery', 'service')),
  CONSTRAINT logistics_route_stop_source_valid CHECK (
    (stop_type = 'delivery' AND delivery_id IS NOT NULL AND service_work_order_id IS NULL)
    OR (stop_type = 'service' AND delivery_id IS NULL AND service_work_order_id IS NOT NULL)
  ),
  CONSTRAINT logistics_route_stop_duration_valid CHECK (
    planned_duration_minutes BETWEEN 5 AND 1440
  ),
  CONSTRAINT logistics_route_stop_label_nonempty CHECK (
    label = btrim(label) AND char_length(label) > 0
    AND address_line = btrim(address_line) AND char_length(address_line) > 0
    AND city = btrim(city) AND char_length(city) > 0
  )
);

CREATE INDEX logistics_route_stops_plan_idx
  ON logistics.route_stops (route_plan_id, position, id);
CREATE INDEX logistics_route_stops_delivery_idx
  ON logistics.route_stops (delivery_id) WHERE delivery_id IS NOT NULL;
CREATE INDEX logistics_route_stops_service_idx
  ON logistics.route_stops (service_work_order_id) WHERE service_work_order_id IS NOT NULL;

INSERT INTO iam.permissions (module, action, description)
VALUES
  ('erp.logistics', 'create', 'Plan deliveries, register returns, and create route plans'),
  ('erp.logistics', 'edit', 'Progress deliveries and receive registered returns')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
JOIN iam.permissions permission
  ON permission.module = 'erp.logistics' AND permission.action IN ('create', 'edit')
WHERE role.code = 'development.manager'
ON CONFLICT DO NOTHING;

COMMENT ON SCHEMA logistics IS
  'Customer delivery, reverse-logistics, and calendar route planning linked to Sales, Warehouse, and Service records.';
COMMENT ON TABLE logistics.deliveries IS
  'One versioned delivery plan per completed Sales shipment. Address fields are immutable planning snapshots of the selected customer location.';
COMMENT ON TABLE logistics.reverse_returns IS
  'Linked reverse-logistics intake. Receiving is retry-safe and preserves Warehouse return and applicable Service-request links per line.';
COMMENT ON TABLE logistics.route_plans IS
  'Dated delivery and Service stop plans. Route optimization and live courier behavior remain provider- and policy-controlled.';
