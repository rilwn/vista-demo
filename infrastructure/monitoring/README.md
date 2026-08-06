# Monitoring

The API exposes process liveness at `/api/v1/health/live` and dependency
readiness at `/api/v1/health/ready`. Readiness probes PostgreSQL, Redis, and the
configured private S3-compatible bucket concurrently; failures return a generic
degraded result without leaking dependency credentials or error details.

Runtime logs are newline-delimited JSON with service, environment, version,
timestamp, event, and correlation fields. HTTP completion events deliberately do
not record request bodies, queries, authorization headers, cookies, PINs, or card
data. Queue telemetry exposes waiting, active, delayed, completed, failed, and
paused state through the internal job service; a protected operations endpoint
and metrics exporter remain to be implemented.

The final metrics/log backend, distributed rate-limit store, dashboards,
notification routes, retention, and alert thresholds depend on deployment and
operations decision `DEP-001`.
