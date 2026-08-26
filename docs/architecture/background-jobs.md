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

`finance.payment-status.detect` is also an active domain handler. Startup
upserts its stable daily schedule using `FINANCE_PAYMENT_STATUS_CRON` in
`BUSINESS_TIMEZONE`. For each occurrence it locks due collection records,
transitions an outstanding record to `overdue` once, appends status/audit/outbox
evidence in the same transaction, and returns no further update on replay. It
also creates idempotent in-system upcoming/overdue reminders for eligible
operational Finance users. Provider-backed email delivery remains pending
approval and adapter configuration.

`sales.subscription-invoice.generate` remains an active domain handler. Its
stable daily schedule creates exactly one review draft for each due
location/device subscription period and advances the next billing date in the
same transaction. The resulting draft follows the separate Finance collection
and legal-issuance workflows.

`service.inspection-reminder.prepare`, `crm.warranty-expiration.prepare`, and
`service.plan-visit.generate` are active Service-care handlers with stable daily
schedules. Inspection reminders use each plan's lead time; warranty reminders
use `SERVICE_WARRANTY_REMINDER_LEAD_DAYS`; planned visits use
`SERVICE_PLAN_VISIT_HORIZON_DAYS`. Notification and occurrence uniqueness keys,
transaction locks, and persisted generation links make retries return no new
work. Generated visits enter the normal Service request register with their
planned date and cannot be created through manual intake.

`crm.sla.evaluate` is an active recurring handler. Startup upserts its stable
schedule using `CRM_SLA_EVALUATION_CRON` in `BUSINESS_TIMEZONE`. Each run locks
eligible open tickets, evaluates the retained response and resolution targets,
and creates one near-deadline or past-deadline notification per ticket, timer,
and state. Notification correlation and SLA-event uniqueness make retries and
overlapping runs return no duplicate work.

`report.generate` is active for the controlled Finance aging, turnover, Sales
journal, Purchase journal, and VAT review catalogue and for the Service request,
technician-performance, and cost reports. Finance and Service use separate
permission-protected catalogues and account-scoped lists while sharing the same
recovery-safe worker. The API saves an owner-scoped export before dispatch. A short database
poll recovers requests that could not reach Redis, while the stable queue key and
a PostgreSQL advisory lock prevent simultaneous or replayed execution from
creating two outputs. Retried attempts update the same lifecycle record and
deterministic private object; completed replays return the saved result. CSV,
Excel, and PDF files retain checksum, size, row-count, and audit evidence.

The remaining later-phase handlers form the durable boundary for domains
delivered in later ordered phases. A successful handler writes one deterministic
`scheduler.<job-name>.requested` event to the transactional outbox. Replaying the
same logical run cannot create a second event. Success therefore means that the
requested work is durably handed to its owning domain; it does not claim that an
invoice, reminder, backup, or other undelivered domain result already exists. Each
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

## Transactional outbox and durable inbox

Business commands write their domain state and `integration.outbox_events` in the
same PostgreSQL transaction. The publisher only claims event types with a
registered consumer. This keeps later-phase events durable and pending rather
than falsely marking unsupported work complete.

For a supported event, the publisher:

1. recovers a `publishing` claim that exceeded the configured processing timeout;
2. claims available rows with `FOR UPDATE SKIP LOCKED` in a short transaction;
3. creates one delivery row per registered consumer;
4. enqueues `integration.event.consume` with a stable event-and-replay identifier;
5. records publication or returns the event to a delayed retry; and
6. moves an event to `dead_letter` after the bounded publication attempts are
   exhausted.

The consumer locks one aggregate/consumer stream, validates a canonical payload
hash, and writes its business effect, inbox receipt, and delivery completion in
one database transaction. A repeated queue delivery sees the completed inbox
receipt and cannot repeat the business effect. The first active consumer converts
`inventory.low_stock.detected` events into idempotent in-system notification work.

Ordering is guaranteed within one aggregate type, aggregate identifier, event
type, and consumer. An earlier incomplete sequence blocks a later event in that
stream. Ordering between unrelated aggregates or different event types is
deliberately not asserted, allowing safe parallel processing.

## Operations and recovery

Users with `platform:view` can inspect payload-free counts, event lifecycle, and
consumer delivery state at `/operations`. The API never returns event payloads or
stored consumer results. Users with `platform:edit` can retry an event only after
explicit confirmation. Replay requires an idempotency key and the event's current
replay count, appends an audit event, retains completed consumers, and resets only
failed or dead-lettered delivery work.

For recovery:

- investigate the stable error code and dependent service health first;
- correct the consumer or infrastructure fault without editing outbox content;
- use the protected retry command once; repeated submission with the same key is
  safe;
- confirm all delivery rows and the parent event reach `completed`; and
- escalate recurring poison messages instead of repeatedly replaying them.

Outbox identity, aggregate identity, event type, version, sequence, correlation,
payload, and occurrence time are database-protected from update. Operators must
not bypass the replay workflow with direct SQL.
