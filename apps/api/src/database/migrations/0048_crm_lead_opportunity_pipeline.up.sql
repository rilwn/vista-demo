CREATE TABLE crm.leads (
  id uuid PRIMARY KEY,
  lead_number varchar(40) NOT NULL UNIQUE,
  organization_name varchar(255) NOT NULL,
  contact_name varchar(255) NOT NULL,
  telephone varchar(100),
  email varchar(320),
  source varchar(30) NOT NULL,
  source_details varchar(500),
  notes text,
  status varchar(20) NOT NULL DEFAULT 'new',
  owner_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  qualified_at timestamptz,
  converted_at timestamptz,
  converted_customer_partner_id uuid REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_lead_organization_nonempty CHECK (
    organization_name = btrim(organization_name) AND char_length(organization_name) > 0
  ),
  CONSTRAINT crm_lead_contact_nonempty CHECK (
    contact_name = btrim(contact_name) AND char_length(contact_name) > 0
  ),
  CONSTRAINT crm_lead_contact_channel_present CHECK (telephone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT crm_lead_email_normalized CHECK (email IS NULL OR email = lower(email)),
  CONSTRAINT crm_lead_source_valid CHECK (
    source IN ('telephone', 'referral', 'website', 'trade_exhibition')
  ),
  CONSTRAINT crm_lead_status_valid CHECK (status IN ('new', 'qualified', 'converted')),
  CONSTRAINT crm_lead_lifecycle_valid CHECK (
    (status = 'new' AND qualified_at IS NULL AND converted_at IS NULL
      AND converted_customer_partner_id IS NULL)
    OR (status = 'qualified' AND qualified_at IS NOT NULL AND converted_at IS NULL
      AND converted_customer_partner_id IS NULL)
    OR (status = 'converted' AND qualified_at IS NOT NULL AND converted_at IS NOT NULL
      AND converted_customer_partner_id IS NOT NULL)
  ),
  CONSTRAINT crm_lead_version_positive CHECK (version > 0)
);

CREATE INDEX crm_leads_work_queue_idx
  ON crm.leads (status, updated_at DESC, id DESC);
CREATE INDEX crm_leads_owner_idx
  ON crm.leads (owner_account_id, status, updated_at DESC);

CREATE TABLE crm.lead_history (
  id uuid PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE RESTRICT,
  event_type varchar(20) NOT NULL,
  status varchar(20) NOT NULL,
  note text,
  changed_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_lead_history_type_valid CHECK (
    event_type IN ('created', 'qualified', 'converted')
  ),
  CONSTRAINT crm_lead_history_status_valid CHECK (status IN ('new', 'qualified', 'converted')),
  CONSTRAINT crm_lead_history_note_nonempty CHECK (
    note IS NULL OR (note = btrim(note) AND char_length(note) > 0)
  )
);

CREATE INDEX crm_lead_history_timeline_idx
  ON crm.lead_history (lead_id, changed_at DESC, id DESC);

CREATE TABLE crm.opportunities (
  id uuid PRIMARY KEY,
  opportunity_number varchar(40) NOT NULL UNIQUE,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  source_lead_id uuid UNIQUE REFERENCES crm.leads(id) ON DELETE RESTRICT,
  title varchar(255) NOT NULL,
  description text,
  estimated_revenue_bgn numeric(18, 2) NOT NULL,
  probability_percent integer NOT NULL,
  stage varchar(30) NOT NULL DEFAULT 'new',
  expected_close_on date,
  owner_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  closed_at timestamptz,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_opportunity_title_nonempty CHECK (
    title = btrim(title) AND char_length(title) > 0
  ),
  CONSTRAINT crm_opportunity_description_nonempty CHECK (
    description IS NULL OR (description = btrim(description) AND char_length(description) > 0)
  ),
  CONSTRAINT crm_opportunity_revenue_positive CHECK (estimated_revenue_bgn > 0),
  CONSTRAINT crm_opportunity_stage_valid CHECK (
    stage IN ('new', 'qualified', 'quotation_sent', 'negotiation', 'won', 'lost')
  ),
  CONSTRAINT crm_opportunity_probability_lifecycle_valid CHECK (
    (stage = 'won' AND probability_percent = 100 AND closed_at IS NOT NULL)
    OR (stage = 'lost' AND probability_percent = 0 AND closed_at IS NOT NULL)
    OR (stage NOT IN ('won', 'lost') AND probability_percent BETWEEN 1 AND 99
      AND closed_at IS NULL)
  ),
  CONSTRAINT crm_opportunity_version_positive CHECK (version > 0)
);

CREATE INDEX crm_opportunities_pipeline_idx
  ON crm.opportunities (stage, expected_close_on, updated_at DESC, id DESC);
CREATE INDEX crm_opportunities_customer_idx
  ON crm.opportunities (customer_partner_id, updated_at DESC, id DESC);
CREATE INDEX crm_opportunities_owner_idx
  ON crm.opportunities (owner_account_id, stage, expected_close_on);

CREATE TABLE crm.opportunity_history (
  id uuid PRIMARY KEY,
  opportunity_id uuid NOT NULL REFERENCES crm.opportunities(id) ON DELETE RESTRICT,
  event_type varchar(30) NOT NULL,
  previous_stage varchar(30),
  next_stage varchar(30) NOT NULL,
  probability_percent integer NOT NULL,
  note text,
  changed_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_opportunity_history_type_valid CHECK (
    event_type IN ('created', 'stage_changed', 'quotation_linked')
  ),
  CONSTRAINT crm_opportunity_history_previous_stage_valid CHECK (
    previous_stage IS NULL OR previous_stage IN (
      'new', 'qualified', 'quotation_sent', 'negotiation', 'won', 'lost'
    )
  ),
  CONSTRAINT crm_opportunity_history_next_stage_valid CHECK (
    next_stage IN ('new', 'qualified', 'quotation_sent', 'negotiation', 'won', 'lost')
  ),
  CONSTRAINT crm_opportunity_history_probability_valid CHECK (
    probability_percent BETWEEN 0 AND 100
  ),
  CONSTRAINT crm_opportunity_history_note_nonempty CHECK (
    note IS NULL OR (note = btrim(note) AND char_length(note) > 0)
  )
);

CREATE INDEX crm_opportunity_history_timeline_idx
  ON crm.opportunity_history (opportunity_id, changed_at DESC, id DESC);

CREATE TABLE crm.opportunity_quotation_links (
  opportunity_id uuid NOT NULL REFERENCES crm.opportunities(id) ON DELETE RESTRICT,
  quotation_id uuid NOT NULL UNIQUE REFERENCES sales.quotations(id) ON DELETE RESTRICT,
  linked_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (opportunity_id, quotation_id)
);

CREATE INDEX crm_opportunity_quotation_links_opportunity_idx
  ON crm.opportunity_quotation_links (opportunity_id, linked_at DESC, quotation_id);

COMMENT ON TABLE crm.leads IS
  'Registered sales prospects retained through qualification and controlled conversion to ERP-owned customers.';
COMMENT ON TABLE crm.opportunities IS
  'Auditable CRM sales pipeline with fixed-precision BGN value and explicit probability.';
COMMENT ON TABLE crm.opportunity_quotation_links IS
  'Bidirectional evidence linking CRM opportunities to Sales quotations for the same customer.';
