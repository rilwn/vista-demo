-- Undo only this migration's repairs, not subsequently executed jobs.
UPDATE integration.outbox_events event
SET status = 'pending', completed_at = NULL
FROM integration.scheduled_execution_status_repairs repair
WHERE repair.event_id = event.id AND event.status = 'completed'
  AND event.completed_at = event.occurred_at
  AND event.replay_count = 0;

DROP TABLE integration.scheduled_execution_status_repairs;
