# Background-job architecture

Vista uses one BullMQ queue and one worker router. Producers enqueue a stable job
name, correlation identifier, idempotency key, and JSON payload. The queue hashes
the job name and idempotency key into the Redis job identifier, retains terminal
state for operations review, and applies bounded exponential retry.

The worker unwraps the queue envelope, resolves exactly one registered handler,
and gives that handler the current attempt, maximum attempts, and whether another
retry remains. Unknown job names are terminal configuration errors. They are not
retried as if they were temporary failures.

## Registered responsibilities

| Job name                               | Required responsibility                       | Owning delivery phase |
| -------------------------------------- | --------------------------------------------- | --------------------- |
| `finance.payment-status.detect`        | Upcoming and overdue payment detection        | Phase 3               |
| `finance.payment-notification.prepare` | Payment reminders                             | Phase 3               |
| `sales.subscription-invoice.generate`  | Recurring subscription invoices               | Phase 3               |
| `service.inspection-reminder.prepare`  | Fiscal-device and scale inspection reminders  | Phase 4               |
| `service.plan-visit.generate`          | Upcoming visits from service plans            | Phase 4               |
| `crm.warranty-expiration.prepare`      | Warranty-expiration reminders                 | Phases 4–5            |
| `crm.sla.evaluate`                     | SLA risk monitoring and escalation            | Phase 5               |
| `report.generate`                      | Scheduled and asynchronous reports            | Phases 3–8            |
| `backup.execute`                       | Backup execution                              | Phase 8               |
| `backup.verify`                        | Backup verification                           | Phase 8               |
| `backup.missed-detect`                 | Missed-backup detection                       | Phase 8               |
| `backup.plan-review.remind`            | Annual backup-plan review reminder            | Phase 8               |
| `backup.dr-test.remind`                | Annual disaster-recovery test reminder        | Phase 8               |
| `notification.dispatch`                | Delivery of a previously created notification | Phase 1               |

`notification.dispatch` is an active domain handler. It uses a transactional
PostgreSQL claim, records attempts and terminal failures, recovers stale claims,
and currently delivers only in-system notifications. Email and SMS remain
observable failures until their provider adapters are delivered.

The other named handlers form the durable boundary for domains delivered in later
ordered phases. A successful handler writes one deterministic
`scheduler.<job-name>.requested` event to the transactional outbox. Replaying the
same logical run cannot create a second event. Success therefore means that the
requested work is durably handed to its owning domain; it does not claim that an
invoice, reminder, report, backup, or other domain result already exists. Each
owning phase must add its consumer, business rules, schedules, audit behavior, and
end-to-end tests before that SRS responsibility is complete.

## Producer rules

- Use one idempotency key for one logical occurrence and reuse it for every retry.
- Include the intended execution time or source record identifiers in the payload;
  never place secrets, credentials, card data, or authentication tokens there.
- Use a new idempotency key for the next legitimate schedule occurrence.
- Do not enable a recurring cadence until its business policy and timezone are
  approved or represented by configurable domain data.
- Do not publish directly to the outbox from a scheduler. Enqueue through
  `JobQueueService` so retry state and operational telemetry remain available.

Tests cover stable queue identifiers, handler registration, nested payload
routing, retry versus terminal attempts, unknown handlers, deterministic outbox
events, and live PostgreSQL replay deduplication for every named responsibility.
