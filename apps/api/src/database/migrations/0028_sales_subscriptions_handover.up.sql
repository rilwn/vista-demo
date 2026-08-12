ALTER TABLE sales.internal_document_sequences
  DROP CONSTRAINT sales_internal_sequence_type_valid;

ALTER TABLE sales.internal_document_sequences
  ADD CONSTRAINT sales_internal_sequence_type_valid CHECK (
    document_type IN (
      'quotation', 'order', 'shipment', 'invoice_draft',
      'service_contract', 'subscription_invoice_draft', 'handover'
    )
  );

ALTER TABLE master_data.customer_locations
  ADD CONSTRAINT customer_locations_id_partner_unique UNIQUE (id, partner_id);

ALTER TABLE master_data.customer_equipment
  ADD CONSTRAINT customer_equipment_id_location_unique UNIQUE (id, customer_location_id);

CREATE TABLE sales.service_subscription_contracts (
  id uuid PRIMARY KEY,
  contract_number varchar(40) NOT NULL UNIQUE,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_location_id uuid NOT NULL REFERENCES master_data.customer_locations(id) ON DELETE RESTRICT,
  valid_from date NOT NULL,
  valid_to date,
  visit_frequency_months integer NOT NULL,
  billing_frequency_months integer NOT NULL,
  next_invoice_date date NOT NULL,
  currency_code char(3) NOT NULL,
  billing_amount numeric(18, 4) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_subscription_dates_valid CHECK (
    valid_to IS NULL OR valid_to >= valid_from
  ),
  CONSTRAINT service_subscription_next_invoice_valid CHECK (
    next_invoice_date >= valid_from
  ),
  CONSTRAINT service_subscription_visit_frequency_valid CHECK (
    visit_frequency_months BETWEEN 1 AND 120
  ),
  CONSTRAINT service_subscription_billing_frequency_valid CHECK (
    billing_frequency_months BETWEEN 1 AND 120
  ),
  CONSTRAINT service_subscription_currency_uppercase CHECK (
    currency_code = upper(currency_code)
  ),
  CONSTRAINT service_subscription_amount_nonnegative CHECK (billing_amount >= 0),
  CONSTRAINT service_subscription_version_positive CHECK (version > 0),
  CONSTRAINT service_subscription_location_customer_fk
    FOREIGN KEY (customer_location_id, customer_partner_id)
    REFERENCES master_data.customer_locations(id, partner_id) ON DELETE RESTRICT
);

CREATE INDEX service_subscription_customer_idx
  ON sales.service_subscription_contracts (customer_partner_id, active, valid_from DESC, id);
CREATE INDEX service_subscription_due_idx
  ON sales.service_subscription_contracts (next_invoice_date, id)
  WHERE active;

CREATE TABLE sales.service_subscription_devices (
  contract_id uuid NOT NULL
    REFERENCES sales.service_subscription_contracts(id) ON DELETE RESTRICT,
  customer_equipment_id uuid NOT NULL
    REFERENCES master_data.customer_equipment(id) ON DELETE RESTRICT,
  customer_location_id uuid NOT NULL,
  PRIMARY KEY (contract_id, customer_equipment_id),
  CONSTRAINT service_subscription_device_location_fk
    FOREIGN KEY (customer_equipment_id, customer_location_id)
    REFERENCES master_data.customer_equipment(id, customer_location_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX service_subscription_active_device_unique
  ON sales.service_subscription_devices (customer_equipment_id, contract_id);

CREATE TABLE sales.service_subscription_services (
  id uuid PRIMARY KEY,
  contract_id uuid NOT NULL
    REFERENCES sales.service_subscription_contracts(id) ON DELETE RESTRICT,
  position integer NOT NULL,
  description varchar(500) NOT NULL,
  CONSTRAINT service_subscription_service_position_unique UNIQUE (contract_id, position),
  CONSTRAINT service_subscription_service_position_positive CHECK (position > 0),
  CONSTRAINT service_subscription_service_description_trimmed CHECK (
    description = btrim(description) AND char_length(description) > 0
  )
);

CREATE TABLE sales.subscription_invoice_drafts (
  id uuid PRIMARY KEY,
  draft_number varchar(40) NOT NULL UNIQUE,
  contract_id uuid NOT NULL
    REFERENCES sales.service_subscription_contracts(id) ON DELETE RESTRICT,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_location_id uuid NOT NULL REFERENCES master_data.customer_locations(id) ON DELETE RESTRICT,
  billing_date date NOT NULL,
  service_period_start date NOT NULL,
  service_period_end date NOT NULL,
  currency_code char(3) NOT NULL,
  amount numeric(18, 4) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  source_job_id varchar(255),
  generated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_invoice_draft_period_unique UNIQUE (contract_id, billing_date),
  CONSTRAINT subscription_invoice_draft_period_valid CHECK (
    service_period_end >= service_period_start
  ),
  CONSTRAINT subscription_invoice_draft_currency_uppercase CHECK (
    currency_code = upper(currency_code)
  ),
  CONSTRAINT subscription_invoice_draft_amount_nonnegative CHECK (amount >= 0),
  CONSTRAINT subscription_invoice_draft_status_valid CHECK (status = 'draft')
);

CREATE INDEX subscription_invoice_drafts_contract_idx
  ON sales.subscription_invoice_drafts (contract_id, billing_date DESC, id);

CREATE TABLE sales.handover_certificates (
  id uuid PRIMARY KEY,
  certificate_number varchar(40) NOT NULL UNIQUE,
  order_id uuid NOT NULL UNIQUE REFERENCES sales.orders(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL UNIQUE REFERENCES sales.shipments(id) ON DELETE RESTRICT,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'prepared',
  accepted_by_name varchar(255),
  accepted_at timestamptz,
  acceptance_notes varchar(2000),
  version integer NOT NULL DEFAULT 1,
  prepared_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT handover_certificate_status_valid CHECK (status IN ('prepared', 'accepted')),
  CONSTRAINT handover_certificate_acceptance_complete CHECK (
    (status = 'prepared' AND accepted_by_name IS NULL AND accepted_at IS NULL)
    OR
    (status = 'accepted' AND accepted_by_name IS NOT NULL AND accepted_at IS NOT NULL)
  ),
  CONSTRAINT handover_certificate_acceptor_trimmed CHECK (
    accepted_by_name IS NULL OR (
      accepted_by_name = btrim(accepted_by_name) AND char_length(accepted_by_name) > 0
    )
  ),
  CONSTRAINT handover_certificate_notes_trimmed CHECK (
    acceptance_notes IS NULL OR (
      acceptance_notes = btrim(acceptance_notes) AND char_length(acceptance_notes) > 0
    )
  ),
  CONSTRAINT handover_certificate_version_positive CHECK (version > 0)
);

CREATE TABLE sales.handover_certificate_lines (
  id uuid PRIMARY KEY,
  certificate_id uuid NOT NULL
    REFERENCES sales.handover_certificates(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  product_name varchar(255) NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  serial_numbers text[] NOT NULL DEFAULT '{}',
  CONSTRAINT handover_certificate_line_product_unique UNIQUE (certificate_id, product_id),
  CONSTRAINT handover_certificate_line_quantity_positive CHECK (quantity > 0),
  CONSTRAINT handover_certificate_line_name_trimmed CHECK (
    product_name = btrim(product_name) AND char_length(product_name) > 0
  )
);

COMMENT ON TABLE sales.service_subscription_contracts IS
  'Versioned service agreements tied to one customer location, installed devices, visit frequency, included services, and recurring price.';
COMMENT ON TABLE sales.subscription_invoice_drafts IS
  'Retry-safe recurring billing snapshots. These are review drafts, not legally issued accounting or fiscal documents.';
COMMENT ON TABLE sales.handover_certificates IS
  'Equipment handover and customer-acceptance evidence prepared from a completed sales shipment.';
