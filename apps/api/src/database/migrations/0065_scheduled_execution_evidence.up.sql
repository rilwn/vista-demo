-- These markers were inserted only AFTER the named domain call fulfilled.
-- Preserve immutable event content and retain every genuine unhandled handoff.
-- Do not infer completion for notification-only, generic reports or backup jobs.
CREATE TABLE integration.scheduled_execution_status_repairs (
  event_id uuid PRIMARY KEY REFERENCES integration.outbox_events(id) ON DELETE RESTRICT,
  repaired_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO integration.scheduled_execution_status_repairs (event_id)
SELECT event.id FROM integration.outbox_events event
WHERE event.aggregate_type = 'scheduled_job' AND event.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM integration.outbox_deliveries delivery WHERE delivery.event_id = event.id
  )
  AND (
    event.event_type IN (
      'scheduler.sales.subscription-invoice.generate.requested',
      'scheduler.finance.payment-status.detect.requested',
      'scheduler.service.inspection-reminder.prepare.requested',
      'scheduler.service.plan-visit.generate.requested',
      'scheduler.crm.warranty-expiration.prepare.requested',
      'scheduler.crm.sla.evaluate.requested'
    )
    OR (event.event_type = 'scheduler.report.generate.requested'
        AND jsonb_typeof(event.payload->'input'->'exportId') = 'string')
  );

UPDATE integration.outbox_events event
SET status = 'completed', completed_at = event.occurred_at
FROM integration.scheduled_execution_status_repairs repair
WHERE repair.event_id = event.id;
