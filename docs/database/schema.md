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
- `master_data`: ERP-owned canonical partners and partner roles, with relationship
  scaffolds for addresses, contacts, and bank accounts.

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

Migration `0002_authentication_audit_chain` adds active-session and enabled-factor
indexes plus a serialized audit-chain insert trigger. Application audit writes
take the same transaction-scoped advisory lock, calculate a canonical SHA-256
event hash, reference the current head, and then insert. Update/delete triggers
remain append-only. Production database roles must still ensure application and
ordinary user roles do not own or bypass these controls.

Migration `0003_partner_master_data` adds immutable UUID partner records for
legal entities and individuals. One record can carry multiple customer,
supplier, and business-partner roles. UIC uniqueness is case/whitespace
normalized; a generated normalized-name column supports deterministic legal-name
duplicate detection. The API uses advisory transaction locks so concurrent
creates cannot bypass the pre-insert duplicate check, then writes the partner,
roles, audit-chain event, outbox event, and idempotency result atomically.

Addresses, contacts, and bank-account tables establish the required explicit
relationships but are not exposed as completed workflows yet. The migration
uses restrictive parent deletion; partner merge/delete semantics remain absent
until `CRM-002` is approved.
