ALTER TABLE service.requests
  DROP CONSTRAINT service_request_source_channel_valid;

ALTER TABLE service.requests
  ADD CONSTRAINT service_request_source_channel_valid CHECK (
    source_channel IN ('telephone', 'email', 'customer_portal', 'on_site', 'service_plan')
  );

CREATE TABLE service.warranty_claims (
  id uuid PRIMARY KEY,
  claim_number varchar(40) NOT NULL UNIQUE,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_location_id uuid NOT NULL,
  customer_equipment_id uuid NOT NULL,
  service_request_id uuid REFERENCES service.requests(id) ON DELETE RESTRICT,
  description text NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'received',
  decision_note text,
  received_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_warranty_claim_location_customer_fk
    FOREIGN KEY (customer_location_id, customer_partner_id)
    REFERENCES master_data.customer_locations(id, partner_id) ON DELETE RESTRICT,
  CONSTRAINT service_warranty_claim_equipment_location_fk
    FOREIGN KEY (customer_equipment_id, customer_location_id)
    REFERENCES master_data.customer_equipment(id, customer_location_id) ON DELETE RESTRICT,
  CONSTRAINT service_warranty_claim_status_valid CHECK (
    status IN ('received', 'under_review', 'approved', 'rejected', 'closed')
  ),
  CONSTRAINT service_warranty_claim_description_nonempty CHECK (
    description = btrim(description) AND char_length(description) > 0
  ),
  CONSTRAINT service_warranty_claim_decision_note_nonempty CHECK (
    decision_note IS NULL OR (
      decision_note = btrim(decision_note) AND char_length(decision_note) > 0
    )
  ),
  CONSTRAINT service_warranty_claim_closed_state_valid CHECK (
    (status = 'closed' AND closed_at IS NOT NULL)
    OR (status <> 'closed' AND closed_at IS NULL)
  ),
  CONSTRAINT service_warranty_claim_version_positive CHECK (version > 0)
);

CREATE INDEX service_warranty_claims_equipment_idx
  ON service.warranty_claims (customer_equipment_id, received_at DESC, id DESC);
CREATE INDEX service_warranty_claims_status_idx
  ON service.warranty_claims (status, received_at DESC, id DESC);

CREATE TABLE service.warranty_claim_status_history (
  id uuid PRIMARY KEY,
  warranty_claim_id uuid NOT NULL REFERENCES service.warranty_claims(id) ON DELETE RESTRICT,
  previous_status varchar(30),
  next_status varchar(30) NOT NULL,
  note text,
  changed_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_warranty_claim_history_status_valid CHECK (
    (previous_status IS NULL OR previous_status IN ('received', 'under_review', 'approved', 'rejected', 'closed'))
    AND next_status IN ('received', 'under_review', 'approved', 'rejected', 'closed')
  ),
  CONSTRAINT service_warranty_claim_history_note_nonempty CHECK (
    note IS NULL OR (note = btrim(note) AND char_length(note) > 0)
  )
);

CREATE INDEX service_warranty_claim_status_history_idx
  ON service.warranty_claim_status_history (warranty_claim_id, changed_at DESC, id DESC);

CREATE TABLE service.equipment_inspection_plans (
  id uuid PRIMARY KEY,
  customer_equipment_id uuid NOT NULL REFERENCES master_data.customer_equipment(id) ON DELETE RESTRICT,
  inspection_type varchar(30) NOT NULL,
  interval_months integer NOT NULL,
  next_due_date date NOT NULL,
  reminder_lead_days integer NOT NULL,
  last_completed_on date,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_equipment_inspection_type_valid CHECK (
    inspection_type IN ('technical', 'metrological')
  ),
  CONSTRAINT service_equipment_inspection_interval_valid CHECK (
    interval_months BETWEEN 1 AND 120
  ),
  CONSTRAINT service_equipment_inspection_reminder_valid CHECK (
    reminder_lead_days BETWEEN 0 AND 365
  ),
  CONSTRAINT service_equipment_inspection_version_positive CHECK (version > 0),
  UNIQUE (customer_equipment_id, inspection_type)
);

CREATE INDEX service_equipment_inspection_plans_due_idx
  ON service.equipment_inspection_plans (next_due_date, id) WHERE active;

CREATE TABLE service.equipment_inspection_records (
  id uuid PRIMARY KEY,
  inspection_plan_id uuid NOT NULL REFERENCES service.equipment_inspection_plans(id) ON DELETE RESTRICT,
  due_date date NOT NULL,
  completed_on date NOT NULL,
  outcome varchar(30) NOT NULL,
  notes text NOT NULL,
  completed_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_equipment_inspection_outcome_valid CHECK (
    outcome IN ('passed', 'attention_required')
  ),
  CONSTRAINT service_equipment_inspection_notes_nonempty CHECK (
    notes = btrim(notes) AND char_length(notes) > 0
  ),
  UNIQUE (inspection_plan_id, due_date)
);

CREATE INDEX service_equipment_inspection_records_idx
  ON service.equipment_inspection_records (inspection_plan_id, completed_on DESC, id DESC);

CREATE TABLE service.subscription_visit_generations (
  id uuid PRIMARY KEY,
  subscription_contract_id uuid NOT NULL
    REFERENCES sales.service_subscription_contracts(id) ON DELETE RESTRICT,
  customer_equipment_id uuid NOT NULL
    REFERENCES master_data.customer_equipment(id) ON DELETE RESTRICT,
  planned_date date NOT NULL,
  service_request_id uuid NOT NULL UNIQUE REFERENCES service.requests(id) ON DELETE RESTRICT,
  source_job_id varchar(128) NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_contract_id, customer_equipment_id, planned_date)
);

CREATE INDEX service_subscription_visit_generations_plan_idx
  ON service.subscription_visit_generations (planned_date DESC, subscription_contract_id, id);

COMMENT ON TABLE service.warranty_claims IS
  'Audited warranty-claim register with an explicit received-to-closed workflow.';
COMMENT ON TABLE service.equipment_inspection_plans IS
  'Client-configurable technical and metrological inspection cadence per registered device.';
COMMENT ON TABLE service.subscription_visit_generations IS
  'Retry-safe link between a subscription visit occurrence and its generated Service request.';
