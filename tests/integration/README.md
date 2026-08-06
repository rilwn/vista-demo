# Integration Tests

Cross-module and database-backed integration suites belong here when they span
multiple workspaces. Module-local integration tests may remain beside their
module. Required coverage is tracked in the traceability matrix.

API infrastructure tests are enabled with `RUN_DATABASE_TESTS=true` and
`RUN_INFRASTRUCTURE_TESTS=true`. They verify append-only/four-eyes database
constraints, Redis job replay deduplication, and access to the configured private
S3-compatible bucket. The authentication suite creates a uniquely named temporary
PostgreSQL database, applies all migrations, verifies login/session/RBAC/TOTP/
audit behavior, validates the temporary name, and drops only that isolated
database. CI enables both flags and provisions all dependencies.
