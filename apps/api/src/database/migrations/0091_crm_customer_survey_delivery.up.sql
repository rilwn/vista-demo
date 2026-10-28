ALTER TABLE crm.customer_surveys
  ADD COLUMN response_token_hash char(64),
  ADD COLUMN response_expires_at timestamptz,
  ADD COLUMN recipient_email varchar(320),
  ADD COLUMN email_notification_id uuid REFERENCES notifications.messages(id) ON DELETE RESTRICT;

ALTER TABLE crm.customer_surveys
  ADD CONSTRAINT crm_customer_survey_public_delivery_complete CHECK (
    (response_token_hash IS NULL AND response_expires_at IS NULL
      AND recipient_email IS NULL AND email_notification_id IS NULL)
    OR
    (response_token_hash IS NOT NULL AND response_expires_at IS NOT NULL
      AND recipient_email IS NOT NULL AND email_notification_id IS NOT NULL)
  );

CREATE UNIQUE INDEX crm_customer_surveys_response_token_unique
  ON crm.customer_surveys (response_token_hash)
  WHERE response_token_hash IS NOT NULL;

CREATE UNIQUE INDEX crm_customer_surveys_email_notification_unique
  ON crm.customer_surveys (email_notification_id)
  WHERE email_notification_id IS NOT NULL;

COMMENT ON COLUMN crm.customer_surveys.response_token_hash IS
  'One-time public response token stored only as a SHA-256 hash; the raw token is delivered by email.';
