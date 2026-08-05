# Database Schema Baseline

PostgreSQL migrations live in `apps/api/src/database/migrations`. Applied
migrations are checksummed in `platform.schema_migrations` and serialized with a
PostgreSQL advisory lock.

The Phase 1 baseline creates these schemas:

- `identity`: employees, user accounts, authentication factors, and session
  lifecycle metadata. Live session state belongs in Redis.
- `iam`: roles, module/action permissions, grants, and employee account roles.
- `audit`: append-only material-action events with correlation and hash-chain
  fields. Application database roles must not own this schema in production.
- `files`: versioned file metadata, quarantine state, checksum, issuer, and parent
  authorization reference.
- `notifications`: idempotent in-system, email, and SMS delivery work.
- `integration`: reliable outbox events and consumer inbox receipts.
- `backup`: four-eyes approval primitives for destructive critical actions.
- `platform`: migration history and cross-cutting idempotency keys.

The migration does not create users, assignments, organizations, tax settings,
warehouses, document sequences, or hardware configuration because those require
the decisions listed in the decision register.

## Commands

```sh
npm run db:migrate
npm run db:rollback
```

Rollback is intended for migration verification before release. Posted business,
fiscal, inventory, service, or backup data must use reversal, cancellation, or
versioning rather than migration rollback or record deletion.
