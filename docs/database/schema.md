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
relationships and are exposed through canonical profile read/create operations.
They preserve parent deletion restrictions; child records are active-state scoped
for future controlled deactivation, not direct deletion. Profile writes update the
parent version and commit an audit-chain event, an outbox event, and idempotency
record in the same transaction. Partner/child update, deactivation, merge, and
delete semantics remain absent until `CRM-002` is approved.

Migration `0004_product_category_master_data` adds an empty, ERP-owned,
immutable-identifier product-category hierarchy. A category can only refer to an
existing parent and parent deletion is restrictive; normalized names are unique
within each parent. The API currently supports authorized read/create only, so a
cycle cannot be introduced through the available workflow. No production catalog
seed data is embedded in the migration. Units, product identity, and typed
barcodes are available through authorized master-data commands; client-specific
initial values remain configurable.

Migration `0005_catalog_tracking_policy` makes traceability a configurable
category-level policy (`none`, `serial`, or `batch`) and permits expiry only for a
batch-tracked category. It also creates independent unit master data rather than
embedding an irreversible unit enum. Existing category rows retain the compatible
`none`/no-expiry default; client-specific policies can be changed through a later,
audited configuration workflow before inventory posting is enabled.

Migration `0006_product_master` adds ERP-owned products with immutable product
codes, required category/unit references, and restrictive deletion. Barcode values
are globally unique and retain their type (`ean13`, `ean8`, `upca`, `code128`, or
`other`). The authorized unit/product read-create API is backed by this migration;
the schema intentionally separates product identity from future stock, serial, and
batch ledgers.
