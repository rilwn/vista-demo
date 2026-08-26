CREATE SCHEMA IF NOT EXISTS crm;

CREATE TABLE crm.internal_document_sequences (
  document_type varchar(40) PRIMARY KEY,
  next_value bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_internal_document_sequence_positive CHECK (next_value > 0)
);

CREATE TABLE crm.ticket_categories (
  id uuid PRIMARY KEY,
  code varchar(50) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_ticket_category_code_valid CHECK (code ~ '^[a-z0-9_]+$'),
  CONSTRAINT crm_ticket_category_name_nonempty CHECK (
    name = btrim(name) AND char_length(name) > 0
  )
);

CREATE TABLE crm.sla_policies (
  id uuid PRIMARY KEY,
  name varchar(160) NOT NULL,
  customer_partner_id uuid REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  service_subscription_contract_id uuid
    REFERENCES sales.service_subscription_contracts(id) ON DELETE RESTRICT,
  priority varchar(20),
  response_minutes integer NOT NULL,
  resolution_minutes integer NOT NULL,
  risk_threshold_percent integer NOT NULL DEFAULT 80,
  escalation_account_id uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_sla_policy_name_nonempty CHECK (
    name = btrim(name) AND char_length(name) > 0
  ),
  CONSTRAINT crm_sla_policy_priority_valid CHECK (
    priority IS NULL OR priority IN ('low', 'normal', 'high', 'urgent')
  ),
  CONSTRAINT crm_sla_policy_response_positive CHECK (response_minutes > 0),
  CONSTRAINT crm_sla_policy_resolution_after_response CHECK (
    resolution_minutes >= response_minutes
  ),
  CONSTRAINT crm_sla_policy_risk_threshold_valid CHECK (
    risk_threshold_percent BETWEEN 1 AND 99
  ),
  CONSTRAINT crm_sla_policy_version_positive CHECK (version > 0)
);

CREATE INDEX crm_sla_policies_match_idx
  ON crm.sla_policies (
    customer_partner_id,
    service_subscription_contract_id,
    priority,
    active
  );

CREATE TABLE crm.tickets (
  id uuid PRIMARY KEY,
  ticket_number varchar(40) NOT NULL UNIQUE,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_location_id uuid,
  customer_equipment_id uuid,
  service_subscription_contract_id uuid
    REFERENCES sales.service_subscription_contracts(id) ON DELETE RESTRICT,
  category_id uuid NOT NULL REFERENCES crm.ticket_categories(id) ON DELETE RESTRICT,
  channel varchar(30) NOT NULL,
  priority varchar(20) NOT NULL,
  subject varchar(255) NOT NULL,
  description text NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'new',
  assigned_to_account_id uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  sla_policy_id uuid NOT NULL REFERENCES crm.sla_policies(id) ON DELETE RESTRICT,
  sla_policy_name varchar(160) NOT NULL,
  sla_response_minutes integer NOT NULL,
  sla_resolution_minutes integer NOT NULL,
  sla_risk_threshold_percent integer NOT NULL,
  response_due_at timestamptz NOT NULL,
  resolution_due_at timestamptz NOT NULL,
  responded_at timestamptz,
  resolved_at timestamptz,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_ticket_location_customer_fk
    FOREIGN KEY (customer_location_id, customer_partner_id)
    REFERENCES master_data.customer_locations(id, partner_id) ON DELETE RESTRICT,
  CONSTRAINT crm_ticket_equipment_location_fk
    FOREIGN KEY (customer_equipment_id, customer_location_id)
    REFERENCES master_data.customer_equipment(id, customer_location_id) ON DELETE RESTRICT,
  CONSTRAINT crm_ticket_equipment_requires_location CHECK (
    customer_equipment_id IS NULL OR customer_location_id IS NOT NULL
  ),
  CONSTRAINT crm_ticket_channel_valid CHECK (
    channel IN ('telephone', 'email', 'customer_portal', 'on_site', 'chat')
  ),
  CONSTRAINT crm_ticket_priority_valid CHECK (
    priority IN ('low', 'normal', 'high', 'urgent')
  ),
  CONSTRAINT crm_ticket_status_valid CHECK (
    status IN ('new', 'in_progress', 'waiting_customer', 'resolved', 'closed', 'cancelled')
  ),
  CONSTRAINT crm_ticket_subject_nonempty CHECK (
    subject = btrim(subject) AND char_length(subject) > 0
  ),
  CONSTRAINT crm_ticket_description_nonempty CHECK (
    description = btrim(description) AND char_length(description) > 0
  ),
  CONSTRAINT crm_ticket_sla_response_positive CHECK (sla_response_minutes > 0),
  CONSTRAINT crm_ticket_sla_resolution_after_response CHECK (
    sla_resolution_minutes >= sla_response_minutes
  ),
  CONSTRAINT crm_ticket_sla_risk_threshold_valid CHECK (
    sla_risk_threshold_percent BETWEEN 1 AND 99
  ),
  CONSTRAINT crm_ticket_due_order_valid CHECK (resolution_due_at >= response_due_at),
  CONSTRAINT crm_ticket_resolution_state_valid CHECK (
    (status IN ('resolved', 'closed') AND resolved_at IS NOT NULL)
    OR (status NOT IN ('resolved', 'closed') AND resolved_at IS NULL)
  ),
  CONSTRAINT crm_ticket_version_positive CHECK (version > 0)
);

CREATE INDEX crm_tickets_queue_idx
  ON crm.tickets (status, priority, resolution_due_at, created_at DESC, id DESC);
CREATE INDEX crm_tickets_customer_idx
  ON crm.tickets (customer_partner_id, created_at DESC, id DESC);
CREATE INDEX crm_tickets_assignee_idx
  ON crm.tickets (assigned_to_account_id, status, resolution_due_at)
  WHERE status NOT IN ('closed', 'cancelled');

CREATE TABLE crm.ticket_history (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES crm.tickets(id) ON DELETE RESTRICT,
  event_type varchar(30) NOT NULL,
  status varchar(30) NOT NULL,
  note text,
  changed_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_ticket_history_type_valid CHECK (
    event_type IN ('created', 'response', 'status_change', 'service_link')
  ),
  CONSTRAINT crm_ticket_history_status_valid CHECK (
    status IN ('new', 'in_progress', 'waiting_customer', 'resolved', 'closed', 'cancelled')
  ),
  CONSTRAINT crm_ticket_history_note_nonempty CHECK (
    note IS NULL OR (note = btrim(note) AND char_length(note) > 0)
  )
);

CREATE INDEX crm_ticket_history_timeline_idx
  ON crm.ticket_history (ticket_id, changed_at DESC, id DESC);

CREATE TABLE crm.ticket_service_links (
  ticket_id uuid PRIMARY KEY REFERENCES crm.tickets(id) ON DELETE RESTRICT,
  service_request_id uuid NOT NULL UNIQUE REFERENCES service.requests(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm.sla_events (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES crm.tickets(id) ON DELETE RESTRICT,
  timer_type varchar(20) NOT NULL,
  event_type varchar(20) NOT NULL,
  recipient_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  notification_id uuid NOT NULL UNIQUE REFERENCES notifications.messages(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_sla_event_timer_valid CHECK (timer_type IN ('response', 'resolution')),
  CONSTRAINT crm_sla_event_type_valid CHECK (event_type IN ('at_risk', 'breached')),
  UNIQUE (ticket_id, timer_type, event_type, recipient_account_id)
);

COMMENT ON TABLE crm.sla_policies IS
  'Configurable customer, service-contract, priority, or general SLA rules; tickets retain immutable timing snapshots.';
COMMENT ON TABLE crm.ticket_service_links IS
  'One-to-one, correlation-stable bridge preventing duplicate CRM ticket and ERP Service request loops.';
