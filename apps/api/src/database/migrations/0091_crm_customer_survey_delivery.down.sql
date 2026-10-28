ALTER TABLE crm.customer_surveys
  DROP CONSTRAINT IF EXISTS crm_customer_survey_public_delivery_complete,
  DROP COLUMN IF EXISTS email_notification_id,
  DROP COLUMN IF EXISTS recipient_email,
  DROP COLUMN IF EXISTS response_expires_at,
  DROP COLUMN IF EXISTS response_token_hash;
