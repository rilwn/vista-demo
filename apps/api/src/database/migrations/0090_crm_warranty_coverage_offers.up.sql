CREATE TABLE crm.warranty_coverage_offers (
  id uuid PRIMARY KEY,
  offer_number varchar(40) NOT NULL UNIQUE,
  warranty_card_id uuid NOT NULL REFERENCES crm.warranty_cards(id) ON DELETE RESTRICT,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_equipment_id uuid NOT NULL REFERENCES master_data.customer_equipment(id) ON DELETE RESTRICT,
  customer_name varchar(255) NOT NULL,
  device_name varchar(255) NOT NULL,
  serial_number varchar(120) NOT NULL,
  current_warranty_ends_on date NOT NULL,
  offer_type varchar(30) NOT NULL,
  coverage_starts_on date NOT NULL,
  duration_months integer NOT NULL,
  visit_frequency_months integer,
  quoted_amount numeric(14,2) NOT NULL,
  currency_code char(3) NOT NULL DEFAULT 'EUR',
  terms text NOT NULL,
  valid_until date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_warranty_coverage_offer_type_valid
    CHECK (offer_type IN ('extended_warranty', 'service_plan')),
  CONSTRAINT crm_warranty_coverage_offer_duration_valid
    CHECK (duration_months BETWEEN 1 AND 120),
  CONSTRAINT crm_warranty_coverage_offer_frequency_valid
    CHECK (
      (offer_type = 'service_plan'
        AND visit_frequency_months BETWEEN 1 AND duration_months)
      OR (offer_type = 'extended_warranty' AND visit_frequency_months IS NULL)
    ),
  CONSTRAINT crm_warranty_coverage_offer_amount_valid CHECK (quoted_amount > 0),
  CONSTRAINT crm_warranty_coverage_offer_currency_valid CHECK (currency_code = 'EUR'),
  CONSTRAINT crm_warranty_coverage_offer_terms_valid
    CHECK (terms = btrim(terms) AND char_length(terms) BETWEEN 10 AND 2000),
  CONSTRAINT crm_warranty_coverage_offer_start_valid
    CHECK (
      offer_type = 'service_plan'
      OR (offer_type = 'extended_warranty' AND coverage_starts_on > current_warranty_ends_on)
    ),
  CONSTRAINT crm_warranty_coverage_offer_status_valid
    CHECK (status IN ('draft', 'offered', 'accepted', 'declined'))
);

CREATE INDEX crm_warranty_coverage_offers_card_idx
  ON crm.warranty_coverage_offers (warranty_card_id, created_at DESC, id DESC);
CREATE INDEX crm_warranty_coverage_offers_status_idx
  ON crm.warranty_coverage_offers (status, valid_until, id);

CREATE FUNCTION crm.prevent_warranty_coverage_offer_snapshot_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    NEW.offer_number,
    NEW.warranty_card_id,
    NEW.customer_partner_id,
    NEW.customer_equipment_id,
    NEW.customer_name,
    NEW.device_name,
    NEW.serial_number,
    NEW.current_warranty_ends_on,
    NEW.offer_type,
    NEW.coverage_starts_on,
    NEW.duration_months,
    NEW.visit_frequency_months,
    NEW.quoted_amount,
    NEW.currency_code,
    NEW.terms,
    NEW.valid_until,
    NEW.created_by,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.offer_number,
    OLD.warranty_card_id,
    OLD.customer_partner_id,
    OLD.customer_equipment_id,
    OLD.customer_name,
    OLD.device_name,
    OLD.serial_number,
    OLD.current_warranty_ends_on,
    OLD.offer_type,
    OLD.coverage_starts_on,
    OLD.duration_months,
    OLD.visit_frequency_months,
    OLD.quoted_amount,
    OLD.currency_code,
    OLD.terms,
    OLD.valid_until,
    OLD.created_by,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Warranty coverage offer terms are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER crm_warranty_coverage_offer_snapshot_immutable
  BEFORE UPDATE ON crm.warranty_coverage_offers
  FOR EACH ROW EXECUTE FUNCTION crm.prevent_warranty_coverage_offer_snapshot_change();

COMMENT ON TABLE crm.warranty_coverage_offers IS
  'Immutable, EUR-priced customer offers for extended warranty or a Service plan; outcomes are tracked separately from issued finance documents and active contracts.';
