ALTER TABLE logistics.deliveries
  ADD COLUMN courier_booking_status varchar(24) NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN courier_external_reference varchar(120),
  ADD COLUMN courier_provider_status varchar(255),
  ADD COLUMN courier_last_checked_at timestamptz,
  ADD COLUMN courier_last_error varchar(1000),
  ADD COLUMN courier_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN courier_attempt_started_at timestamptz,
  ADD COLUMN courier_recipient_name varchar(255),
  ADD COLUMN courier_recipient_phone varchar(30),
  ADD COLUMN courier_parcel_count integer,
  ADD COLUMN courier_weight_kg numeric(12, 3);

UPDATE logistics.deliveries
SET courier_booking_status = 'needs_review'
WHERE delivery_method IN ('econt', 'speedy');

ALTER TABLE logistics.deliveries
  ADD CONSTRAINT logistics_delivery_courier_status_valid CHECK (
    courier_booking_status IN ('not_applicable', 'pending', 'booking', 'booked', 'failed', 'needs_review')
  ),
  ADD CONSTRAINT logistics_delivery_courier_method_status_valid CHECK (
    (delivery_method = 'company_transport' AND courier_booking_status = 'not_applicable')
    OR (delivery_method IN ('econt', 'speedy') AND courier_booking_status <> 'not_applicable')
  ),
  ADD CONSTRAINT logistics_delivery_courier_attempts_nonnegative CHECK (courier_attempt_count >= 0),
  ADD CONSTRAINT logistics_delivery_courier_parcels_valid CHECK (
    courier_parcel_count IS NULL OR courier_parcel_count BETWEEN 1 AND 100
  ),
  ADD CONSTRAINT logistics_delivery_courier_weight_valid CHECK (
    courier_weight_kg IS NULL OR courier_weight_kg > 0
  );

CREATE TABLE logistics.delivery_courier_tracking_events (
  id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES logistics.deliveries(id) ON DELETE RESTRICT,
  event_key char(64) NOT NULL,
  provider_status varchar(255) NOT NULL,
  description varchar(1000) NOT NULL,
  place varchar(255),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logistics_delivery_courier_event_key_unique UNIQUE (delivery_id, event_key),
  CONSTRAINT logistics_delivery_courier_event_status_nonempty CHECK (
    provider_status = btrim(provider_status) AND char_length(provider_status) > 0
  ),
  CONSTRAINT logistics_delivery_courier_event_description_nonempty CHECK (
    description = btrim(description) AND char_length(description) > 0
  )
);

CREATE INDEX logistics_delivery_courier_events_timeline_idx
  ON logistics.delivery_courier_tracking_events (delivery_id, occurred_at DESC, id DESC);

COMMENT ON TABLE logistics.delivery_courier_tracking_events IS
  'Idempotently recorded carrier tracking scans for Econt and Speedy delivery bookings.';
