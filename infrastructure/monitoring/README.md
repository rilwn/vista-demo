# Monitoring

The API exposes process liveness at `/api/v1/health/live` and dependency
readiness at `/api/v1/health/ready`. Readiness probes PostgreSQL, Redis, and the
configured private S3-compatible bucket concurrently; failures return a generic
degraded result without leaking dependency credentials or error details.

Runtime logs are newline-delimited JSON with service, environment, version,
timestamp, event, and correlation fields. HTTP completion events deliberately do
not record request bodies, queries, authorization headers, cookies, PINs, or card
data. Queue telemetry exposes waiting, active, delayed, completed, failed, and
paused state through the internal job service and protected JSON endpoint
`GET /api/v1/platform/jobs/metrics`. Operations staff can inspect these counts
under **Administration → System activity → Background processing**. Refresh is
manual; a failed check clears previous counts rather than presenting stale health.

## Metrics collection

`GET /api/v1/platform/jobs/metrics/prometheus` returns Prometheus text format 0.0.4.
Both routes require an authenticated account with `platform:view`, use the read
rate limit and return `Cache-Control: no-store`. An expired or unauthorized session
cannot scrape metrics. No public scrape endpoint or new service identity is added.

- `vista_jobs{state="waiting|active|delayed|completed|failed"}`: gauges for retained
  queue entries, not lifetime counters. Retention can lower these values.
- `vista_jobs_paused`: 1 if paused, otherwise 0. This is not worker liveness.
- Labels are fixed; no job IDs, customer payloads, error messages or credentials
  are exported. JSON also reports the check timestamp.
- Queue errors and checks exceeding five seconds return a generic 503 with code
  `JOB_MONITORING_UNAVAILABLE`, not zero counts. The timeout bounds the HTTP wait;
  it does not cancel an already submitted Redis command. The browser stops waiting
  after eight seconds. Configure production scrape frequency within the read limit.

## Local troubleshooting

1. Check dependency readiness first. If Redis is down, restore its connection and
   refresh processing status; do not flush Redis or remove queue entries.
2. If jobs are waiting while the queue is not paused, inspect the worker process
   and structured logs. Queue counts alone cannot prove a worker is alive or stuck.
3. For failed exports/reminders, inspect their originating workflow and its retry
   controls. Monitoring does not expose generic retry/delete/pause commands.
4. A delayed job may be scheduled or waiting for retry; it is not necessarily a fault.

Executable checks: `jobs.controller.test.ts` covers timeout, sanitized failure,
recovery and metric formatting; `JobMonitor.test.tsx` covers refresh/failure and
invalid responses; the background-job test in `partners.integration.test.ts`
checks authenticated JSON/text access and payload exclusion using a real queue.

The final metrics/log backend, production dashboards,
notification routes, retention, and alert thresholds depend on deployment and
operations decision `DEP-001`.
