# API Documentation

The NestJS application exposes versioned routes below `/api/v1` and interactive
OpenAPI at `/api/docs`. The raw document is served at `/api/docs-json`.

Generate the same document without opening a network listener:

```sh
npm run openapi:generate -w @vista/api
```

The generated `apps/api/openapi.json` is a build artifact and is intentionally
ignored. CI regenerates it to catch metadata/configuration failures. Published
API compatibility and generated clients will be added as versioned domain
operations begin.

Every HTTP response carries `x-correlation-id`; a valid inbound identifier is
preserved. Errors use the shared stable envelope and code vocabulary, including
`RATE_LIMITED` for HTTP 429. Health routes are deliberately excluded from request
throttling so orchestrator probes remain available.

All other current endpoints are assigned a configurable public, read, write, or
sensitive tier. Production uses shared Redis counters across API replicas and
fails protected requests closed with `RATE_LIMIT_UNAVAILABLE` if that store is
unavailable. Limits, response headers, proxy configuration, and deployment rules
are documented in
[`../architecture/rate-limiting.md`](../architecture/rate-limiting.md).

Request-completion logs are JSON and contain method, path without query string,
status, duration, and correlation identifier. Bodies, query values, cookies,
authorization headers, and client card/PIN data are not request-log fields.

## Authentication foundation

- `POST /api/v1/auth/login` accepts email/password and an optional six-digit TOTP
  code. It returns an opaque bearer token only after Redis session creation,
  PostgreSQL lifecycle recording, and audit capture succeed.
- `POST /api/v1/auth/logout` revokes the current session in PostgreSQL and Redis.
- `GET /api/v1/auth/me` returns the authenticated employee/session context.
- `GET /api/v1/auth/me/permissions` demonstrates backend enforcement of the
  controlled `platform:view` permission.

Routes are protected by default. Health, platform identification, and login are
explicitly public; future controllers must use the public marker deliberately or
receive a valid bearer session. Administrative accounts cannot create or resolve
a session without a verified second factor. TOTP enrollment/provisioning and
password reset/change APIs remain pending and are not implied by these endpoints.

The ERP/CRM browser uses these routes through a same-origin `/api/v1` client by
default; local Vite development proxies `/api` to the NestJS server. A deployment
may set the build-time `VITE_API_BASE_URL` override. The client uses stable error
codes for recovery text, shows a shortened correlation reference for support, and
never treats permission-aware navigation as a replacement for backend guards.

## Security administration

The protected `/api/v1/platform/security` surface provides:

- paginated employee-account reads and idempotent account creation;
- role reads and idempotent creation from the controlled module/action vocabulary;
- version-checked, idempotent account role replacement and reversible
  disable/reactivate commands;
- active and historical session reads plus administrator-initiated revocation;
- filtered, paginated audit-event reads and a full audit-chain integrity check.

Reads require `platform:view`, creation requires `platform:create`, and access or
session changes require `platform:approve`. Administrative-role creation or
assignment additionally requires an administrative actor whose current session
verified 2FA. The target employee must already have an enabled factor before an
administrative role can be assigned. The last active administrator cannot be
disabled or stripped of administrative access, and an actor cannot disable their
own account. Disabling an account revokes all of its current PostgreSQL/Redis
sessions.

Account and session responses never contain password hashes, bearer-token
digests, or factor secrets. Material changes are appended to the audit chain.
Password change/reset and factor enrollment/recovery remain intentionally absent
until their remaining policy decisions and recovery controls are implemented.

## In-system notifications

- `GET /api/v1/notifications` returns the authenticated employee's delivered
  in-system notifications and unread count. It never exposes another account's
  delivery work.
- `POST /api/v1/notifications/:id/read` marks one of that employee's delivered
  notifications as read. Repeating the request is safe and preserves the original
  read timestamp.

Notification delivery is queued through Redis with stable job identifiers,
transactional PostgreSQL claims, bounded exponential retry, stale-claim recovery,
and terminal failure codes. In-system delivery is active. Email and SMS messages
remain failed/observable until their approved adapters and provider credentials
are configured; they are never reported as delivered without an actual provider.

## Protected background-job operations

- `GET /api/v1/platform/jobs/metrics` requires `platform:view` and returns
  queue counts, paused state, and measurement time.
- `GET /api/v1/platform/jobs/:id` requires the same permission and returns a
  payload-free lifecycle summary (name, state, attempts, and timestamps).

These endpoints intentionally never return job payloads, correlation identifiers,
or failure text because queued work may contain protected business data. They are
observability endpoints, not a permission to modify, replay, pause, or delete
background work.

The worker routes the complete scheduled-job inventory through registered
handlers. Stable job and outbox identifiers make replay safe. Scheduled work owned
by later business modules is first handed off through one deterministic outbox
event; its business result is not reported as complete until that owning module
processes the event. Handler names, ownership, and producer rules are documented
in [`../architecture/background-jobs.md`](../architecture/background-jobs.md).

## Organization topology

The empty, configurable operating structure is exposed through:

- `GET /api/v1/organization/topology` and `/members`, requiring
  `platform.organization:view`.
- `POST /api/v1/organization/legal-entities`.
- `POST /api/v1/organization/legal-entities/:entityId/branches`.
- `POST /api/v1/organization/branches/:branchId/locations`.
- `POST /api/v1/organization/locations/:locationId/operators`.
- `POST /api/v1/organization/locations/:locationId/registers`.

Every create route requires `platform.organization:create` and an
`Idempotency-Key`. Codes and business identifiers are normalized, parents must be
active, and an operator must reference an active employee account. Register
assignments only accept active operators from the same business location. Each
successful command, parent version update, audit-chain event, outbox event, and
idempotency result commits in one transaction.

The topology deliberately contains no assumed Vista sites, registers, or
operators. Warehouse creation may optionally reference a configured business
location; a technician warehouse may also reference an operator at that same
location. Document number formats, reset behavior, fiscal hardware identities,
and client-specific topology remain governed by `BUS-001`, `BUS-002`, and
`POS-001`.

## Partner master data

The ERP-owned canonical partner registry currently exposes:

- `GET /api/v1/master-data/partners` with page/page-size, search, role, type,
  sort-field, and direction parameters. It requires `crm:view`.
- `GET /api/v1/master-data/partners/:id` for one immutable partner identifier. It
  requires `crm:view`.
- `GET /api/v1/master-data/partners/:id/profile` for the canonical partner plus
  its active addresses, contacts, and bank accounts. It requires `crm:view`.
- `GET /api/v1/master-data/partners/duplicates` for exact normalized legal-name
  or UIC candidates. It warns only and never merges records.
- `POST /api/v1/master-data/partners` for legal entities or individuals with one
  or more customer/supplier/business-partner roles. It requires `crm:create` and
  an `Idempotency-Key` header of 8–128 safe characters.
- `PUT /api/v1/master-data/partners/:id` to update type, name, identifiers,
  representative, and roles. It requires `crm:edit`, an `Idempotency-Key`, and
  the current `expectedVersion`.
- `POST /api/v1/master-data/partners/:id/deactivate` and `/reactivate` provide a
  reversible lifecycle. Deactivation requires `crm:delete`; reactivation
  requires `crm:edit`; both require an idempotency key and `expectedVersion`.
  Deactivation is rejected while the partner owns an active customer location.
- `POST /api/v1/master-data/partners/:id/addresses`, `/contacts`, and
  `/bank-accounts` to add profile records. Each requires `crm:edit` and the same
  idempotency-header contract. Contacts require an email or telephone; bank
  accounts validate IBAN, optional BIC, and globally reject a duplicate IBAN.
- `GET /api/v1/master-data/partners/:partnerId/locations` for the customer's
  active and inactive locations and installed-equipment history. It requires
  `crm:view` and a partner carrying the customer role; the history remains
  readable when that partner is inactive.
- `POST /api/v1/master-data/partners/:partnerId/locations` to add a named,
  typed customer location with a real address and optional responsible contact.
  The contact must belong to the same customer. It requires `crm:edit` and an
  `Idempotency-Key`.
- `POST /api/v1/master-data/partners/:partnerId/locations/:locationId/equipment`
  to register an active, under-repair, or retired device with a globally unique
  serial number, purchase date, and warranty period. It requires `crm:edit` and
  an `Idempotency-Key`.
- `PUT /api/v1/master-data/partners/:partnerId/locations/:locationId` and the
  nested `/equipment/:equipmentId` route update mutable location/device details
  with `crm:edit`, an idempotency key, and `expectedVersion`. Equipment identity
  remains fixed: its serial number and linked product cannot be changed.
- `POST` to a location or nested equipment `/deactivate` or `/reactivate` route
  provides reversible lifecycle control. Deactivation requires `crm:delete` and
  reactivation requires `crm:edit`. A location cannot be deactivated while it
  contains active equipment.

Create replays return the original response when the same normalized command and
key are retried. Reusing a key for a different command returns
`IDEMPOTENCY_KEY_CONFLICT`. Exact normalized legal-company names or UICs return
`PARTNER_DUPLICATE_CANDIDATE` with existing record references; there is no
override or merge endpoint in this slice. Successful creation,
its audit event, and `master_data.partner.created` outbox event commit in one
PostgreSQL transaction.

The profile child commands use a partner-and-resource-specific idempotency scope,
so a retry returns the original child record without creating another audit or
outbox event. Each successful command increments the parent partner version and
commits its `master_data.partner.address.created`, `.contact.created`, or
`.bank_account.created` event with the audit record. These routes only create new
profile records. Partner update and reversible lifecycle commands are separately
version-checked, audited, and outbox-backed. Hard deletion, child-record editing,
duplicate resolution, and merge remain unavailable until their controlling
policy is approved.

Location names are normalized and unique among the customer's active locations;
location type is configurable rather than a hard-coded business enum. Equipment
may optionally reference a catalog product. When its exact serial already exists
in the inventory serial register, the API links that immutable serial record and
validates any supplied product reference. Legacy or externally acquired devices
remain visibly unlinked rather than receiving fabricated inventory history.
Location/equipment creation and maintenance, parent-version updates, audit-chain
records, outbox events, and idempotency results commit transactionally. Update
and lifecycle responses use optimistic versions and preserve inactive history.
Hard deletion, equipment moves, serial/product identity changes, and merges are
not exposed.

## Product category master data

The catalog hierarchy currently exposes:

- `GET /api/v1/master-data/product-categories`, requiring `erp.warehouse:view`.
- `POST /api/v1/master-data/product-categories`, requiring `erp.warehouse:create`
  and an `Idempotency-Key`. A category has a name and optional existing active
  parent UUID.

Names are whitespace-normalized and unique within the selected parent. The command
is transactionally paired with an audit event and
`master_data.product_category.created` outbox event. It is deliberately an empty
configuration hierarchy: the system does not seed assumed Vista categories
or stock data.

## Product and unit master data

The authorized catalog routes are:

- `GET /api/v1/master-data/catalog/units`, requiring `erp.warehouse:view`.
- `POST /api/v1/master-data/catalog/units`, requiring `erp.warehouse:create` and an
  `Idempotency-Key`.
- `GET /api/v1/master-data/catalog/products`, requiring `erp.warehouse:view`.
- `POST /api/v1/master-data/catalog/products`, requiring `erp.warehouse:create` and an
  `Idempotency-Key`.

Unit codes and product codes are whitespace-normalized and uppercased. A product
requires an active category and unit; its category policy is returned on reads.
Each supplied barcode has an explicit type and is globally unique. A successful
unit or product command writes its audit event and respective
`master_data.unit.created` or `master_data.product.created` outbox event in the
same transaction, and an identical retry returns the original resource without
duplicating those side effects. Duplicate unit/product codes and barcode values
return stable conflict codes.

The catalog routes establish product identity. Pricing and all stock-changing
workflows other than the controlled receipt below remain separate operations.

## Warehouse inventory

The first inventory routes are:

- `GET` and `POST /api/v1/warehouse/warehouses`, requiring
  `erp.warehouse:view` and `erp.warehouse:create` respectively.
- `GET /api/v1/warehouse/stock-balances`, requiring `erp.warehouse:view`.
- `POST /api/v1/warehouse/stock-receipts`, requiring `erp.warehouse:create` and
  an `Idempotency-Key`.
- `POST /api/v1/warehouse/stock-issues`, requiring `erp.warehouse:create` and
  an `Idempotency-Key`.
- `POST /api/v1/warehouse/stock-transfers`, requiring `erp.warehouse:create` and
  an `Idempotency-Key`.
- `POST /api/v1/warehouse/stock-returns`, requiring `erp.warehouse:create` and an
  `Idempotency-Key`.
- `POST /api/v1/warehouse/stocktakes` and
  `POST /api/v1/warehouse/stocktakes/:id/counts`, requiring
  `erp.warehouse:create` and an `Idempotency-Key`.
- `POST /api/v1/warehouse/stocktakes/:id/complete`, requiring
  `erp.warehouse:approve` and an `Idempotency-Key`.
- `POST /api/v1/warehouse/stock-reservations`, requiring
  `erp.warehouse:create` and an `Idempotency-Key`.
- `POST /api/v1/warehouse/stock-reservations/:id/release`, requiring
  `erp.warehouse:edit` and an `Idempotency-Key`.
- `POST /api/v1/warehouse/stock-settings`, requiring `erp.warehouse:edit` and an
  `Idempotency-Key`.
- `GET /api/v1/warehouse/replenishment`, requiring `erp.warehouse:view`.
- `GET /api/v1/warehouse/serial-traceability/:serialNumber`, requiring
  `erp.warehouse:view`.

Warehouse code and name are normalized; no Vista location or warehouse is seeded.
A stock receipt is an atomic, auditable ledger command that creates its movement,
updates the aggregate balance, and writes a reliable outbox event. Quantities use
four fixed decimal places. For a serial-tracked category, the receipt must include
one unique serial number for every whole unit. For a batch-tracked category, it
must include a batch; an expiry date is mandatory when the category requires one.
The command is retry-safe. A stock issue records one controlled reason (`sale`,
`repair`, or `writeoff`), atomically reduces the available warehouse balance, and
rejects insufficient stock. Serial-tracked issues require available serials and
transition them to `issued`; a serial cannot be issued a second time. Batch-tracked
issues require a selected batch and protect that batch balance independently.
An issue can consume an active matching reservation by its UUID. Unreserved
issues and transfers use available quantity (physical balance less active
reservations), so committed stock cannot be taken by another workflow.

A transfer uses paired outbound/inbound movements in one transaction. It rejects
the same source and destination, locks balance keys in deterministic order, and
cannot complete unless the source has sufficient aggregate (and, where relevant,
batch) stock. Available serials move to the destination warehouse with a durable
serial-transfer history record.

Opening a stocktake freezes stock-changing commands for that warehouse until an
approver completes the count. Every stocked product requires a count. Serial
products require one available serial per counted unit; missing serials are moved
to the explicit `missing` state. Batch products require per-batch quantities and
expiry evidence where configured. Completion writes fixed-precision adjustment
movements and cannot reduce stock below active reservations.

Reservations accept only `sales_order`, `quotation`, and `service_request`
sources. Serial-tracked reservations identify the exact available serials. A
reservation can be partially consumed by stock issue or explicitly released;
both operations preserve history and audit/outbox evidence.

A return must identify one original issue, an explicit destination warehouse,
quantity, disposition (`restock` or `service`), and the required serial evidence.
The command locks the source issue, prevents cumulative over-return, restores the
original batch and BGN valuation, and appends serial custody history. It does not
pretend that warehouse return posting reverses a fiscal receipt, invoice, or
payment; those later workflows must link to the same business return explicitly.

Receipts accept an optional fixed-precision `unitCostBgn`; omitted cost is
explicitly BGN 0.0000. Warehouse balances expose physical, reserved, and available
quantity plus weighted-average unit cost and inventory value. Issues carry the
current warehouse average. Transfers carry source cost and blend it into the
destination average. Stock settings define minimum and target quantity per
warehouse/product; the replenishment endpoint derives low-stock state and the
quantity needed to reach target from current reservation-aware availability.
Stock settings may explicitly subscribe active employee account IDs. Each stock
or reservation change reconciles threshold state transactionally and queues one
pending in-system notification per recipient and low-stock cycle, with a stable
idempotency key. Recovery followed by a later shortage creates a new cycle.
Provider dispatch and optional FIFO remain later workflows.

Serial receipts may link an active supplier partner; issues may link an active
customer and technician account. The traceability route returns current custody
and a chronological receipt/transfer/issue/stocktake timeline with actors,
references, costs, and available party evidence. Missing links are not guessed.
Unknown serials return the stable `SERIAL_NOT_FOUND` code.
