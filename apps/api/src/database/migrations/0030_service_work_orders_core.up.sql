CREATE SCHEMA IF NOT EXISTS service;

CREATE TABLE service.internal_document_sequences (
  document_type varchar(40) PRIMARY KEY,
  next_value bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_internal_document_sequence_positive CHECK (next_value > 0)
);

CREATE TABLE service.requests (
  id uuid PRIMARY KEY,
  request_number varchar(40) NOT NULL UNIQUE,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_location_id uuid NOT NULL,
  customer_equipment_id uuid NOT NULL,
  subscription_contract_id uuid
    REFERENCES sales.service_subscription_contracts(id) ON DELETE RESTRICT,
  source_channel varchar(30) NOT NULL,
  service_type varchar(30) NOT NULL,
  priority varchar(20) NOT NULL DEFAULT 'normal',
  problem_description text NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'new',
  cancellation_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_request_location_customer_fk
    FOREIGN KEY (customer_location_id, customer_partner_id)
    REFERENCES master_data.customer_locations(id, partner_id) ON DELETE RESTRICT,
  CONSTRAINT service_request_equipment_location_fk
    FOREIGN KEY (customer_equipment_id, customer_location_id)
    REFERENCES master_data.customer_equipment(id, customer_location_id) ON DELETE RESTRICT,
  CONSTRAINT service_request_source_channel_valid CHECK (
    source_channel IN ('telephone', 'email', 'customer_portal', 'on_site')
  ),
  CONSTRAINT service_request_type_valid CHECK (
    service_type IN ('warranty', 'out_of_warranty', 'subscription')
  ),
  CONSTRAINT service_request_priority_valid CHECK (
    priority IN ('low', 'normal', 'high', 'critical')
  ),
  CONSTRAINT service_request_status_valid CHECK (
    status IN ('new', 'scheduled', 'in_progress', 'completed', 'cancelled')
  ),
  CONSTRAINT service_request_problem_nonempty CHECK (
    problem_description = btrim(problem_description) AND char_length(problem_description) > 0
  ),
  CONSTRAINT service_request_subscription_link_valid CHECK (
    (service_type = 'subscription' AND subscription_contract_id IS NOT NULL)
    OR (service_type <> 'subscription' AND subscription_contract_id IS NULL)
  ),
  CONSTRAINT service_request_cancellation_state_valid CHECK (
    (status = 'cancelled' AND cancellation_reason IS NOT NULL AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
    OR (status <> 'cancelled' AND cancellation_reason IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL)
  ),
  CONSTRAINT service_request_version_positive CHECK (version > 0)
);

CREATE INDEX service_requests_customer_status_idx
  ON service.requests (customer_partner_id, status, created_at DESC, id DESC);
CREATE INDEX service_requests_equipment_idx
  ON service.requests (customer_equipment_id, created_at DESC, id DESC);
CREATE INDEX service_requests_subscription_idx
  ON service.requests (subscription_contract_id)
  WHERE subscription_contract_id IS NOT NULL;

CREATE TABLE service.work_orders (
  id uuid PRIMARY KEY,
  work_order_number varchar(40) NOT NULL UNIQUE,
  service_request_id uuid NOT NULL UNIQUE REFERENCES service.requests(id) ON DELETE RESTRICT,
  assigned_technician_account_id uuid
    REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  technician_warehouse_id uuid
    REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  status varchar(30) NOT NULL DEFAULT 'scheduled',
  completion_notes text,
  labor_minutes integer NOT NULL DEFAULT 0,
  labor_cost_bgn numeric(18, 4) NOT NULL DEFAULT 0,
  parts_cost_bgn numeric(18, 4) NOT NULL DEFAULT 0,
  transport_cost_bgn numeric(18, 4) NOT NULL DEFAULT 0,
  total_cost_bgn numeric(18, 4) NOT NULL DEFAULT 0,
  signer_name varchar(255),
  signature_media_type varchar(30),
  signature_data bytea,
  signature_sha256 char(64),
  signed_at timestamptz,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_work_order_status_valid CHECK (
    status IN ('scheduled', 'in_progress', 'completed', 'cancelled')
  ),
  CONSTRAINT service_work_order_schedule_valid CHECK (
    scheduled_start IS NULL OR scheduled_end IS NULL OR scheduled_end > scheduled_start
  ),
  CONSTRAINT service_work_order_assignment_complete CHECK (
    (assigned_technician_account_id IS NULL AND technician_warehouse_id IS NULL)
    OR (assigned_technician_account_id IS NOT NULL AND technician_warehouse_id IS NOT NULL)
  ),
  CONSTRAINT service_work_order_completion_state_valid CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND completion_notes IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  ),
  CONSTRAINT service_work_order_signature_complete CHECK (
    (status = 'completed' AND signer_name IS NOT NULL AND signature_media_type = 'image/png'
      AND signature_data IS NOT NULL AND signature_sha256 IS NOT NULL AND signed_at IS NOT NULL)
    OR (status <> 'completed' AND signer_name IS NULL AND signature_media_type IS NULL
      AND signature_data IS NULL AND signature_sha256 IS NULL AND signed_at IS NULL)
  ),
  CONSTRAINT service_work_order_completion_notes_nonempty CHECK (
    completion_notes IS NULL OR (
      completion_notes = btrim(completion_notes) AND char_length(completion_notes) > 0
    )
  ),
  CONSTRAINT service_work_order_signer_nonempty CHECK (
    signer_name IS NULL OR (signer_name = btrim(signer_name) AND char_length(signer_name) > 0)
  ),
  CONSTRAINT service_work_order_labor_minutes_nonnegative CHECK (labor_minutes >= 0),
  CONSTRAINT service_work_order_costs_nonnegative CHECK (
    labor_cost_bgn >= 0 AND parts_cost_bgn >= 0 AND transport_cost_bgn >= 0 AND total_cost_bgn >= 0
  ),
  CONSTRAINT service_work_order_total_reconciles CHECK (
    total_cost_bgn = round(labor_cost_bgn + parts_cost_bgn + transport_cost_bgn, 4)
  ),
  CONSTRAINT service_work_order_signature_size_valid CHECK (
    signature_data IS NULL OR octet_length(signature_data) BETWEEN 1 AND 100000
  ),
  CONSTRAINT service_work_order_version_positive CHECK (version > 0)
);

CREATE INDEX service_work_orders_technician_schedule_idx
  ON service.work_orders (assigned_technician_account_id, scheduled_start, id)
  WHERE status IN ('scheduled', 'in_progress');
CREATE INDEX service_work_orders_status_schedule_idx
  ON service.work_orders (status, scheduled_start, id);

CREATE TABLE service.work_order_status_history (
  id uuid PRIMARY KEY,
  work_order_id uuid NOT NULL REFERENCES service.work_orders(id) ON DELETE RESTRICT,
  previous_status varchar(30),
  next_status varchar(30) NOT NULL,
  reason varchar(100) NOT NULL,
  changed_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_work_order_history_status_valid CHECK (
    (previous_status IS NULL OR previous_status IN ('scheduled', 'in_progress', 'completed', 'cancelled'))
    AND next_status IN ('scheduled', 'in_progress', 'completed', 'cancelled')
  ),
  CONSTRAINT service_work_order_history_reason_nonempty CHECK (
    reason = btrim(reason) AND char_length(reason) > 0
  )
);

CREATE INDEX service_work_order_status_history_idx
  ON service.work_order_status_history (work_order_id, changed_at DESC, id DESC);

CREATE TABLE service.work_order_time_entries (
  id uuid PRIMARY KEY,
  work_order_id uuid NOT NULL REFERENCES service.work_orders(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  minutes integer NOT NULL,
  note varchar(1000),
  recorded_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_work_order_time_minutes_positive CHECK (minutes > 0 AND minutes <= 1440),
  CONSTRAINT service_work_order_time_note_trimmed CHECK (
    note IS NULL OR (note = btrim(note) AND char_length(note) > 0)
  )
);

CREATE INDEX service_work_order_time_entries_idx
  ON service.work_order_time_entries (work_order_id, work_date, id);

CREATE TABLE service.work_order_part_usages (
  id uuid PRIMARY KEY,
  work_order_id uuid NOT NULL REFERENCES service.work_orders(id) ON DELETE RESTRICT,
  stock_issue_movement_id uuid NOT NULL UNIQUE
    REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  batch_id uuid REFERENCES inventory.batches(id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL,
  unit_cost_bgn numeric(18, 4) NOT NULL,
  total_cost_bgn numeric(18, 4) NOT NULL,
  recorded_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_work_order_part_quantity_positive CHECK (quantity > 0),
  CONSTRAINT service_work_order_part_cost_nonnegative CHECK (
    unit_cost_bgn >= 0 AND total_cost_bgn >= 0
  ),
  CONSTRAINT service_work_order_part_cost_reconciles CHECK (
    total_cost_bgn = round(quantity * unit_cost_bgn, 4)
  )
);

CREATE INDEX service_work_order_part_usages_idx
  ON service.work_order_part_usages (work_order_id, recorded_at, id);

CREATE TABLE service.work_order_part_serials (
  part_usage_id uuid NOT NULL REFERENCES service.work_order_part_usages(id) ON DELETE RESTRICT,
  serialized_item_id uuid NOT NULL REFERENCES inventory.serialized_items(id) ON DELETE RESTRICT,
  PRIMARY KEY (part_usage_id, serialized_item_id),
  CONSTRAINT service_work_order_part_serial_item_unique UNIQUE (serialized_item_id, part_usage_id)
);

CREATE TABLE service.work_order_photos (
  id uuid PRIMARY KEY,
  work_order_id uuid NOT NULL REFERENCES service.work_orders(id) ON DELETE RESTRICT,
  file_name varchar(255) NOT NULL,
  media_type varchar(30) NOT NULL,
  size_bytes integer NOT NULL,
  content_sha256 char(64) NOT NULL,
  content bytea NOT NULL,
  captured_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_work_order_photo_name_nonempty CHECK (
    file_name = btrim(file_name) AND char_length(file_name) > 0
  ),
  CONSTRAINT service_work_order_photo_media_valid CHECK (
    media_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  CONSTRAINT service_work_order_photo_size_valid CHECK (
    size_bytes BETWEEN 1 AND 5242880 AND octet_length(content) = size_bytes
  )
);

CREATE INDEX service_work_order_photos_idx
  ON service.work_order_photos (work_order_id, captured_at, id);

COMMENT ON SCHEMA service IS
  'Auditable Service work execution. Images are access-controlled operational evidence stored in the controlled database during this initial core release.';
COMMENT ON TABLE service.requests IS
  'Customer service intake. A request keeps one immutable customer/location/equipment identity and is completed through one linked work order.';
COMMENT ON TABLE service.work_orders IS
  'Technician execution record. Completion preserves time, costs, parts, customer signature, and status history; no delete workflow is provided.';
