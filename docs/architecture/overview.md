# Architecture Overview

Vista is a TypeScript, API-first modular monorepo. The ERP is the operational
source of shared master data. CRM and POS consume the same stable identifiers and
integrate through versioned APIs and reliable outbox/inbox processing.

## Applications

- `apps/api`: NestJS API, database migrations, scheduled jobs, and integration
  workers. Domain modules remain separate even while deployed in one process.
- `apps/erp-crm-web`: shared back-office React application with distinct ERP and
  CRM module routes.
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
- Cross-module and external changes use transactional outbox, idempotency keys,
  inbox receipts, retries, and reconciliation.
- File access is evaluated through the parent record's backend authorization.
- Hardware and vendor behavior stays behind adapters with CI test doubles.

The production hosting topology, identity providers, storage, hardware, and
integration vendors are unresolved decisions; local containers do not select
those production technologies.
