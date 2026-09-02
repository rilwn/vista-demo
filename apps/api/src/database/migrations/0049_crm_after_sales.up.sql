ALTER TABLE master_data.products
  ADD COLUMN warranty_months integer;

UPDATE master_data.products product
SET warranty_months = 24
FROM master_data.product_categories category
WHERE category.id = product.category_id
  AND category.tracking_mode = 'serial';

ALTER TABLE master_data.products
  ADD CONSTRAINT product_warranty_months_valid CHECK (
    warranty_months IS NULL OR warranty_months BETWEEN 1 AND 120
  );

CREATE TABLE crm.warranty_cards (
  id uuid PRIMARY KEY,
  card_number varchar(40) NOT NULL UNIQUE,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_location_id uuid NOT NULL,
  customer_equipment_id uuid NOT NULL UNIQUE,
  handover_certificate_id uuid REFERENCES sales.handover_certificates(id) ON DELETE RESTRICT,
  warranty_starts_on date NOT NULL,
  warranty_ends_on date NOT NULL,
  offer_status varchar(20) NOT NULL DEFAULT 'not_offered',
  issued_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_warranty_card_location_customer_fk
    FOREIGN KEY (customer_location_id, customer_partner_id)
    REFERENCES master_data.customer_locations(id, partner_id) ON DELETE RESTRICT,
  CONSTRAINT crm_warranty_card_equipment_location_fk
    FOREIGN KEY (customer_equipment_id, customer_location_id)
    REFERENCES master_data.customer_equipment(id, customer_location_id) ON DELETE RESTRICT,
  CONSTRAINT crm_warranty_card_period_valid CHECK (warranty_ends_on >= warranty_starts_on),
  CONSTRAINT crm_warranty_card_offer_status_valid CHECK (
    offer_status IN ('not_offered', 'offered', 'interested', 'declined')
  )
);

CREATE INDEX crm_warranty_cards_customer_idx
  ON crm.warranty_cards (customer_partner_id, warranty_ends_on, id);
CREATE INDEX crm_warranty_cards_expiry_idx
  ON crm.warranty_cards (warranty_ends_on, id);

CREATE TABLE crm.customer_surveys (
  id uuid PRIMARY KEY,
  survey_number varchar(40) NOT NULL UNIQUE,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_location_id uuid NOT NULL,
  source_kind varchar(20) NOT NULL,
  handover_certificate_id uuid REFERENCES sales.handover_certificates(id) ON DELETE RESTRICT,
  service_work_order_id uuid REFERENCES service.work_orders(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL DEFAULT 'awaiting_response',
  score integer,
  comment text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_customer_survey_location_customer_fk
    FOREIGN KEY (customer_location_id, customer_partner_id)
    REFERENCES master_data.customer_locations(id, partner_id) ON DELETE RESTRICT,
  CONSTRAINT crm_customer_survey_source_valid CHECK (
    (source_kind = 'delivery' AND handover_certificate_id IS NOT NULL
      AND service_work_order_id IS NULL)
    OR
    (source_kind = 'service' AND service_work_order_id IS NOT NULL
      AND handover_certificate_id IS NULL)
  ),
  CONSTRAINT crm_customer_survey_status_valid CHECK (
    status IN ('awaiting_response', 'responded')
  ),
  CONSTRAINT crm_customer_survey_response_valid CHECK (
    (status = 'awaiting_response' AND score IS NULL AND responded_at IS NULL)
    OR
    (status = 'responded' AND score BETWEEN 0 AND 10 AND responded_at IS NOT NULL)
  ),
  CONSTRAINT crm_customer_survey_comment_nonempty CHECK (
    comment IS NULL OR (comment = btrim(comment) AND char_length(comment) > 0)
  )
);

CREATE UNIQUE INDEX crm_customer_surveys_handover_unique
  ON crm.customer_surveys (handover_certificate_id)
  WHERE handover_certificate_id IS NOT NULL;
CREATE UNIQUE INDEX crm_customer_surveys_service_unique
  ON crm.customer_surveys (service_work_order_id)
  WHERE service_work_order_id IS NOT NULL;
CREATE INDEX crm_customer_surveys_customer_idx
  ON crm.customer_surveys (customer_partner_id, sent_at DESC, id DESC);

CREATE TABLE crm.referrals (
  id uuid PRIMARY KEY,
  referral_number varchar(40) NOT NULL UNIQUE,
  referring_customer_partner_id uuid NOT NULL
    REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  organization_name varchar(255) NOT NULL,
  contact_name varchar(255) NOT NULL,
  telephone varchar(100),
  email varchar(320),
  notes text,
  lead_id uuid NOT NULL UNIQUE REFERENCES crm.leads(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_referral_organization_nonempty CHECK (
    organization_name = btrim(organization_name) AND char_length(organization_name) > 0
  ),
  CONSTRAINT crm_referral_contact_nonempty CHECK (
    contact_name = btrim(contact_name) AND char_length(contact_name) > 0
  ),
  CONSTRAINT crm_referral_contact_channel_present CHECK (telephone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT crm_referral_email_normalized CHECK (email IS NULL OR email = lower(email)),
  CONSTRAINT crm_referral_notes_nonempty CHECK (
    notes IS NULL OR (notes = btrim(notes) AND char_length(notes) > 0)
  )
);

CREATE INDEX crm_referrals_customer_idx
  ON crm.referrals (referring_customer_partner_id, created_at DESC, id DESC);

COMMENT ON COLUMN master_data.products.warranty_months IS
  'Default warranty term applied when serialised equipment is accepted by its customer.';
COMMENT ON TABLE crm.warranty_cards IS
  'One warranty record per installed device, issued automatically from an accepted serialised handover.';
COMMENT ON TABLE crm.customer_surveys IS
  'Post-delivery and post-service NPS responses with an immutable source record.';
COMMENT ON TABLE crm.referrals IS
  'Referring-customer link to the prospect lead created from the referral.';
