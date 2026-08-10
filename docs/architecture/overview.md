# Architecture Overview

Vista is a TypeScript, API-first modular monorepo. The ERP is the operational
source of shared master data. CRM and POS consume the same stable identifiers and
integrate through versioned APIs and reliable outbox/inbox processing.

## Applications

- `apps/api`: NestJS API, database migrations, scheduled jobs, and integration
  workers. Domain modules remain separate even while deployed in one process.
- `apps/erp-crm-web`: shared back-office React application with distinct ERP and
  CRM module routes. It uses an API-backed two-step sign-in, validates opaque
  sessions on reload, and derives visible navigation from current backend-issued
  permissions. Client routing improves the experience but is not an authorization
  boundary.
- `apps/pos-web`: separate cashier React application so hardware, fiscalization,
  and offline behavior can be deployed and verified independently.
- `apps/backup-control`: backup policy, operation, approval, monitoring, restore,
  and DR evidence interface. It is not a database-dump utility.

## Shared packages

- `contracts`: API types, schemas, enums, and generated clients.
- `ui`: accessible components and design tokens; applications own localized text.
- `auth`: framework-neutral module/action permission vocabulary and helpers.
- `config`: validated environment and feature configuration.
- `domain`: framework-neutral invariants and value objects.

## Reliability boundaries

- PostgreSQL transactions protect authoritative state and concurrency-sensitive
  workflows.
- Redis stores live sessions, POS baskets, and other transient state. PostgreSQL
  may retain security lifecycle metadata, not live session content.
- Request throttling assigns every non-health endpoint a configurable risk tier.
  Production uses atomic Redis counters shared by all API replicas and fails
  closed if that protection is unavailable.
- Authentication uses opaque random bearer tokens, digest-only PostgreSQL
  metadata, Redis TTL state, current database-backed role evaluation, and a
  default-deny backend guard. Administrative sessions require verified TOTP.
- The ERP/CRM browser keeps the opaque token in tab-scoped session storage, checks
  it with `/auth/me` before restoring protected routes, removes it on expiry or
  logout, and does not persist passwords or TOTP codes. A later cookie-based model
  would require explicit CSRF controls and an approved authentication change.
- Redis-backed jobs use stable hashed identifiers derived from the command name
  and idempotency key. Retry attempts use bounded exponential backoff, job state
  is queryable, and records are retained pending an approved retention policy. A
  single worker registry routes the complete named job inventory; scheduled
  domain triggers cross the transactional outbox once per logical run. The
  detailed ownership and replay rules are in
  [`background-jobs.md`](background-jobs.md).
- Cross-module and external changes use transactional outbox, idempotency keys,
  inbox receipts, retries, and reconciliation.
- ERP-owned partner master data uses immutable UUIDs and one canonical record for
  simultaneous customer/supplier/business-partner roles. Creation is authorized
  in the backend and atomically extends the audit chain and outbox. Exact
  normalized legal-name/UIC duplicates are blocked for review; no silent merge
  path exists.
- S3-compatible storage readiness verifies access to the configured private
  bucket; local Compose initializes that bucket deterministically.
- File access is evaluated through the parent record's backend authorization.
- Material login and revocation events extend a serialized SHA-256 audit chain;
  database triggers reject mutation and inserts that do not extend the current
  chain head.
- Hardware and vendor behavior stays behind adapters with CI test doubles.

The production hosting topology, identity providers, storage, hardware, and
integration vendors are unresolved decisions; local containers do not select
those production technologies.
