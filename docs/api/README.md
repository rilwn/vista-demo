# API Documentation

The NestJS application exposes versioned routes below `/api/v1` and interactive
OpenAPI at `/api/docs`. The raw document is served at `/api/docs-json`.

Generate the OpenAPI document and the versioned TypeScript client without
opening a network listener:

```sh
npm run openapi:generate
```

The generated `apps/api/openapi.json` is a build artifact and is intentionally
ignored. The versioned client in
`packages/contracts/src/generated/v1.ts` is committed and exported through
`@vista/contracts`. Do not edit it by hand. `npm run openapi:check` regenerates
the document, validates operation IDs, path parameters, and success responses,
then fails when the committed client is stale. The repository validation and CI
run that drift check before compilation.

All three browser applications create their client through
`createVistaApiClientV1`. Existing ERP/CRM requests use the generated path,
query, header, body, response, and error types. POS and backup-control have the
same client entry point ready for their connected workflows. The helper accepts
the established `VITE_API_BASE_URL` value with or without a terminal `/api/v1`
and never duplicates the version prefix.

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
- `GET /api/v1/auth/me/password-policy` returns the signed-in employee's active
  complexity, expiration, and recent-password requirements.
- `POST /api/v1/auth/me/password` verifies the current password, applies the
  active policy and history rule, updates the password atomically, retains the
  current session, revokes every other session, and returns no credential data.
- `POST /api/v1/auth/recovery/complete` accepts an employee email, an
  administrator-issued one-time recovery code, and a replacement password. It
  closes all active sessions and removes existing factors. Administrative
  accounts must immediately complete the recovery-only TOTP enrollment and
  verification endpoints before they can sign in.
- `POST /api/v1/auth/recovery/totp/enrollment` and
  `POST /api/v1/auth/recovery/totp/enrollment/:enrollmentId/verify` are public
  only because possession of the short-lived recovery code is required. They do
  not reveal account state without that code.

Routes are protected by default. Health, platform identification, login, and the
recovery-code endpoints are explicitly public; future controllers must use the
public marker deliberately or receive a valid bearer session. Administrative
accounts cannot create or resolve a session without a verified second factor.
The one-time initial-administrator provisioning command is separate from the API
and refuses to run once any administrative assignment exists.

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
- an idempotent recovery-handoff command, available only to an administrative
  actor whose current session has verified 2FA;
- active and historical session reads plus administrator-initiated revocation;
- filtered, paginated audit-event reads and a full audit-chain integrity check.

Reads require `platform:view`, creation requires `platform:create`, and access or
session changes require `platform:approve`. Administrative-role creation or
assignment additionally requires an administrative actor whose current session
verified 2FA. The target employee must already have an enabled factor before an
administrative role can be assigned. The last active administrator cannot be
disabled or stripped of administrative access, and an actor cannot disable their
own account. Disabling an account revokes all of its current PostgreSQL/Redis
sessions. A recovery handoff returns its code only at issue time, logs neither
the code nor a password, replaces all target sessions/factors on completion, and
requires a fresh factor before an administrative target can sign in.

Account and session responses never contain password hashes, bearer-token
digests, or factor secrets. Material changes are appended to the audit chain.
Employee password change is available through the authenticated self-service
route above. Password reset and factor enrollment/recovery remain intentionally
absent until their recovery controls are implemented.

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

## Integration event operations

- `GET /api/v1/platform/integrations/metrics` requires `platform:view` and
  returns event lifecycle counts, failed-delivery count, and the age reference for
  the oldest unfinished event.
- `GET /api/v1/platform/integrations/events` requires `platform:view` and returns
  a paginated, optionally status/event-type-filtered event summary.
- `GET /api/v1/platform/integrations/events/:id` requires `platform:view` and
  returns the event and its consumer delivery lifecycle.
- `POST /api/v1/platform/integrations/events/:id/replay` requires
  `platform:edit`, an `Idempotency-Key`, and the current `expectedReplayCount`.
  Only failed work is eligible; a successful command is audited.

These responses deliberately omit event payloads and consumer results. Replay
does not mutate the original event content or repeat a consumer that already
completed. The ERP/CRM System activity page provides the corresponding protected
operator workflow. Lifecycle, ordering, and recovery behavior are documented in
[`../architecture/background-jobs.md`](../architecture/background-jobs.md).

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

## Managed partner files

The first shared managed-file parent is the canonical partner record:

- `GET /api/v1/files?parentType=partner&parentId=<uuid>` returns only the latest
  immutable version of each logical file with bounded pagination.
- `GET /api/v1/files/:id/versions` returns the retained version history.
- `GET /api/v1/files/:id/content` returns authorized private content with
  `no-store`, attachment, and `nosniff` headers after size and SHA-256 verification.
- `POST /api/v1/files` accepts multipart `parentType`, `parentId`, and `file`.
- `POST /api/v1/files/:id/versions` appends a replacement without overwriting the
  prior object.

Listing, history, and download inherit `crm:view` from the partner; upload and
replacement inherit `crm:edit`. Both commands require an `Idempotency-Key` and
an exact retry returns the original metadata without writing another object,
audit event, or outbox event. The configurable allowlist currently supports PDF,
JPEG, PNG, and WebP, with a 10 MB development default and 25 MB hard ceiling.
Declared media type must match the file signature. Content stays in private
S3-compatible storage while PostgreSQL retains metadata and checksums only.

There is deliberately no delete endpoint before the approved retention policy.
The current `structural-signature` inspection rejects disguised content but is
not a malware scan; the approved production scanner/quarantine adapter and the
remaining attachment parents stay pending.

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

## Procurement purchase orders and receiving

The first connected procurement workflow exposes:

- `GET /api/v1/procurement/reference-data` for active suppliers, products, and
  warehouses permitted in purchase and receipt commands.
- `GET /api/v1/procurement/purchase-orders` with pagination plus optional status
  and supplier filters.
- `GET /api/v1/procurement/purchase-orders/:id` for lines, cumulative delivery
  comparison, and receipt history.
- `POST /api/v1/procurement/purchase-orders`, requiring
  `erp.procurement:create` and an `Idempotency-Key`.
- `POST /api/v1/procurement/purchase-orders/:id/receipts`, requiring the same
  permission and idempotency header.

Reads require `erp.procurement:view`. An order accepts one or more unique product
lines, fixed-precision quantity and unit price, a three-letter currency, and an
expected delivery date. A receipt accepts any remaining quantity from one or more
lines and updates the order to partially received or received from committed
line totals. Over-receipt is rejected while concurrent receipts are serialized.

Receiving uses the warehouse ledger in the same PostgreSQL transaction. Serial,
batch, and expiry requirements come from the product category and cannot be
bypassed. BGN purchase prices become the default BGN inventory cost. A
foreign-currency order requires an explicit BGN receipt cost until the approved
BNB exchange-rate snapshot workflow is implemented; the API never guesses a
conversion. Supplier invoice quantities now feed the comparison only when linked
invoice evidence has actually been recorded.

The remaining core procurement operations are available:

- `GET /api/v1/procurement/suppliers` and `/suppliers/:id` return canonical active
  contacts, versioned payment/delivery terms, and evaluation history.
- `PUT /api/v1/procurement/suppliers/:id/commercial-profile` requires
  `erp.procurement:edit`, an idempotency key, and the current version (zero when
  terms have never been set).
- `POST /api/v1/procurement/suppliers/:id/evaluations` appends an immutable 1–5
  overall assessment and optional notes with the same edit permission.
- `GET` and `POST /api/v1/procurement/supplier-invoices` read or record
  supplier-provided invoice evidence against purchase-order lines.
- `GET` and `POST /api/v1/procurement/supplier-claims` read or open a damaged or
  non-conforming claim against one goods-receipt line.
- `POST /api/v1/procurement/supplier-claims/:id/status` performs the next
  version-checked open → submitted → resolved → closed transition and appends its
  status event.

Invoice and claim creation require `erp.procurement:create`; reads require view.
Invoice numbers are case-insensitively unique within a supplier. Invoice
quantities are retained even when they differ from ordered or delivered amounts,
so the discrepancy remains visible for review. Claims cannot cumulatively exceed
the received line quantity. Every command is transactional, idempotent, audited,
and outbox-backed. Supplier invoices are procurement evidence only; accounting,
VAT, payment, and correction posting belong to the finance document workflow.

## Sales workflow

The connected commercial chain exposes:

- `GET /api/v1/sales/reference-data` for active customers, products, warehouses,
  available serialized items, and stocked batches.
- `GET /api/v1/sales/workflows` and `/workflows/:id` for the complete linked
  quotation, order, shipment, and invoice-draft view.
- `POST /api/v1/sales/quotations` for a dated quotation with fixed-precision
  prices, line discounts, overall discount, and VAT treatment.
- `POST /api/v1/sales/quotations/:id/confirm` to validate the quotation and reserve
  its stock, including exact serial numbers where required.
- `POST /api/v1/sales/orders/:id/shipments` to consume the reservation and issue
  the stock, requiring a valid batch for batch-tracked products, and prepare the
  linked equipment handover certificate from the shipped product/serial evidence.
- `POST /api/v1/sales/handover-certificates/:id/accept` to record the customer
  representative, acceptance timestamp, and optional note with optimistic
  version protection.
- `POST /api/v1/sales/orders/:id/invoice-draft` to prepare the invoice snapshot
  after shipment.

Reads require `erp.sales:view`; commands require `erp.sales:create` and an
`Idempotency-Key`. Commands are transactional, retry-safe, audited, and
outbox-backed. Expired quotations, incomplete line submissions, unavailable
stock, duplicate serial selection, and invalid batches are rejected before the
workflow advances.

The final operation creates an invoice draft, not a legally issued invoice.
Finance can now prepare a structured financial-document draft from that Sales
record. Official issuance, automatic BNB retrieval, accounting/fiscal posting,
and PDF/email delivery remain controlled later work. Internal workflow references
must not be presented as fiscal or accounting document numbers.

## Structured financial-document drafts

The protected `/api/v1/finance/financial-documents` surface provides:

- `GET /reference-data` for active issuing scopes, customers, products, eligible
  Sales drafts, and original invoice drafts available for a correction;
- paginated `GET /` with status, type, customer, and date filters, plus `GET /:id`;
- idempotent `POST /` for an invoice, proforma, credit note, or debit note from a
  prepared Sales draft or controlled manual lines; and
- version-checked, reasoned `POST /:id/cancel` for an unissued draft.

Each draft snapshots the issuer, customer, line prices and discounts, VAT
treatment, currency rate/date/source, BGN equivalent, source Sales record, and
correction link. Fixed-point domain calculation supports 20%, 9%, 0%, exempt,
and explicitly rated intra-community acquisition lines. Internal `DINV`, `DPRO`,
`DCN`, and `DDN` references are allocated transactionally per issuing location,
optional register/operator, document type, and year; concurrent requests cannot
receive the same reference. Commands are permission-protected, idempotent,
audited, and outbox-backed.

These records remain drafts. `officialNumber` is not assigned, and the API does
not perform legal issuance, proforma conversion, accounting/VAT posting,
automatic BNB retrieval, fiscal/POS linkage, PDF/signature generation, or email
delivery until FIN-001, FIN-002, BUS-002, and DOC-001 are approved.

## Finance collection records

The current Finance slice provides an auditable BGN collection workflow, not a
legal, fiscal, or accounting-document workflow:

- `GET /api/v1/finance/reference-data` returns eligible BGN Sales invoice drafts
  not already added to collections.
- `GET /api/v1/finance/documents`, `/documents/:id`, and `/summary` return the
  collection register, its payment/status history, and balance summary.
- `POST /api/v1/finance/documents` adds exactly one Sales invoice draft to a
  collection record with a due date.
- `POST /api/v1/finance/documents/:id/payments` records one partial payment
  allocation using cash, bank transfer, POS terminal, card, or compensation/
  offset. The amount cannot exceed the remaining balance.
- `POST /api/v1/finance/documents/:id/cancel` performs a version-checked,
  reasoned cancellation only before a payment exists.

Reads require `erp.finance:view`; add/payment commands require
`erp.finance:create`; cancellation requires `erp.finance:edit`. Each command
requires an `Idempotency-Key`, commits its data, audit event, and outbox event in
one transaction, and preserves status history. `finance.payment-status.detect`
is scheduled daily by `FINANCE_PAYMENT_STATUS_CRON` in `BUSINESS_TIMEZONE`; it
marks an unpaid outstanding record overdue only once when its due date has
passed, and is safe to retry.

These records use internal `FIN-REV` and `PAY` references only. They do not
perform legal/fiscal issuance, official branch/register/operator numbering, VAT
or accounting posting, BNB conversion, PDF/email delivery, customer advances,
notifications, or statutory reporting; those remain subsequent Finance work.

## Finance bank reconciliation

The protected manual BGN reconciliation surface provides:

- paginated `GET /api/v1/finance/bank-statements` and detailed
  `GET /api/v1/finance/bank-statements/:id`;
- idempotent `POST /api/v1/finance/bank-statements` for a balanced statement and
  its immutable incoming or outgoing transaction lines;
- `GET /api/v1/finance/bank-transactions/:id/match-candidates` for ranked open
  customer-collection suggestions; and
- version-checked, idempotent
  `POST /api/v1/finance/bank-transactions/:id/match` for a user-confirmed
  incoming match;
- `GET /api/v1/finance/bank-transactions/:id/supplier-match-candidates` for open
  supplier payables ranked by exact reference, amount, and due date; and
- version-checked, idempotent
  `POST /api/v1/finance/bank-transactions/:id/supplier-match` to allocate an
  outgoing line to a supplier payable or retain it as an explicit advance.

An incoming line is matched automatically only when its payment reference
identifies exactly one eligible open collection and its amount fits the remaining
balance. All other incoming lines remain in **Needs review**; name and amount
similarity rank candidates but never allocate money without confirmation. A match
creates the bank-transfer payment, allocation, balance/status history, audit event,
and outbox event transactionally. A payment or bank line cannot be matched twice.
Outgoing lines are never auto-posted: a Finance employee must confirm a supplier
payable or deliberately keep the transfer as an unallocated supplier advance.

Reads require `erp.finance:view`, statement entry requires `erp.finance:create`,
and manual matching requires `erp.finance:edit`. This surface is BGN-only and does
not claim support for approved Bulgarian statement-file formats or accounting
posting.

## Finance supplier subledger

The protected supplier Finance surface provides:

- `GET /api/v1/finance/supplier-reference-data` for unregistered BGN supplier
  invoices, supplier choices, bilateral open customer balances, and the business
  date;
- paginated supplier payable, advance, and offset registers plus detailed
  `GET /api/v1/finance/supplier-payables/:id`;
- idempotent payable creation from one Procurement supplier invoice and
  idempotent partial supplier-payment allocation;
- idempotent unallocated supplier advances and version-checked allocation to an
  open payable for the same supplier; and
- an atomic bilateral offset that reduces one customer receivable and one
  supplier payable belonging to the same canonical partner.

`SP`, `SPAY`, `SADV`, and `OFF` are concurrency-safe operational references.
Every command locks the affected balance/version, rejects over-allocation and
cross-supplier allocation, and commits payment evidence, balance history, audit,
and outbox records together. Exact idempotency replays return the original result;
a bank transaction, supplier invoice, payment, or offset cannot post twice.

Reads require `erp.finance:view`, creation/payment/advance/offset commands require
`erp.finance:create`, and advance or outgoing-bank allocation requires
`erp.finance:edit`. The current subledger is BGN-only. It is operational payment
control, not legal supplier-invoice issuance, deductible-VAT or general-ledger
posting, or a replacement for an approved accounting export.

## Finance cash operations

The protected `/api/v1/finance/cash` surface provides:

- `GET /reference-data` for active cash registers, their assigned operators,
  known partners, open BGN customer collections, and the business date;
- paginated `GET /vouchers`, detailed `GET /vouchers/:id`, and
  `GET /daily-report` for one cash register and date;
- idempotent `POST /vouchers` for BGN cash receipt and payment vouchers; and
- version-checked, reasoned `POST /vouchers/:id/cancel` for an independent
  voucher that has not created a customer payment allocation.

Numbers are allocated transactionally by business location, cash register,
operator, direction, and year. A receipt can be linked to one open customer
collection; issuance then creates its cash payment, allocation, balance/status
history, voucher, audit event, and outbox event in the same transaction. The
receipt cannot exceed the outstanding balance. Linked receipts require a future
approved payment-reversal workflow and are therefore not cancelled by the simple
voucher cancellation command.

The daily report calculates opening balance, issued receipts, issued payments,
and closing balance from the voucher register. Cancelled vouchers remain visible
for audit review but do not contribute to totals. This is an operational daily
cash report, not a statutory posting or finalized day-close. Reads require
`erp.finance:view`, issuance requires `erp.finance:create`, and cancellation
requires `erp.finance:edit`.

The surface does not yet implement opening-float approval, negative-cash policy,
formal day closing, linked-payment reversal, direct cash-voucher allocation to a
supplier payable, or accounting posting.

## Service subscriptions

The subscription API exposes:

- `GET /api/v1/sales/subscriptions/reference-data` for canonical active customers,
  their active locations, and non-retired installed equipment.
- `GET /api/v1/sales/subscriptions` and `/subscriptions/:id` for contracts and
  their recurring invoice-draft history.
- `POST /api/v1/sales/subscriptions` for a location-bound contract containing one
  or more installed devices, included services, visit frequency, validity,
  recurring amount/currency, billing frequency, and next invoice date.
- `PUT /api/v1/sales/subscriptions/:id` for version-checked maintenance and
  reversible active/inactive state.

Reads require `erp.sales:view`; creation and maintenance require the corresponding
create/edit permission and an `Idempotency-Key`. Composite foreign keys prevent a
device or location from crossing customer boundaries. The
`sales.subscription-invoice.generate` background responsibility locks due
contracts, creates one fixed snapshot per contract/billing date, publishes audit
and outbox evidence, advances the next date in the same transaction, and safely
returns no duplicate on replay. API startup upserts one stable BullMQ scheduler,
so multiple instances or restarts do not create parallel schedules. It runs from
`SALES_SUBSCRIPTION_INVOICE_CRON` in `BUSINESS_TIMEZONE`; each occurrence receives
a distinct retry-stable command scope. These generated records are Finance review
drafts, not legally issued accounting or fiscal invoices.

## Sales pricing

The connected pricing API exposes:

- `GET /api/v1/sales/pricing/reference-data` for active customers and products,
  plus current customer groups and campaigns.
- `GET|POST /api/v1/sales/customer-groups` and
  `PUT /api/v1/sales/customer-groups/:id` for reusable customer membership.
- `GET|POST /api/v1/sales/promotional-campaigns` and
  `PUT /api/v1/sales/promotional-campaigns/:id` for effective promotional periods.
- `GET|POST /api/v1/sales/price-lists` and `PUT /api/v1/sales/price-lists/:id`
  for all-customer, group, or individual-customer prices.
- `GET /api/v1/sales/prices/resolve` with customer, product, date, and currency
  query values for the one deterministic applicable price.

Reads require `erp.sales:view`; maintenance requires `erp.sales:create` or
`erp.sales:edit` as appropriate. Commands require an `Idempotency-Key`, use
optimistic versions for edits, and commit audit and outbox evidence atomically.
Resolution checks active state and effective periods for the list, group, and
campaign; orders matches by priority and customer specificity; and never mutates
the quotation or a saved document.

## Service operations

The current Service API is an authorized request-to-completion core. It does not
claim to issue a payment document or provide warranty, inspection, CRM-ticket,
route, or full sales-lifecycle behavior.

- `GET /api/v1/service/reference-data` returns the shared customer/location
  choices, active technicians with their mapped technician warehouses, available
  parts, matching active subscriptions, the configured business timezone, and
  equipment for both request eligibility and historical review. Retired or
  inactive equipment stays visible for history but cannot be used to open a new
  request.
- `GET /api/v1/service/requests` accepts bounded `page`/`pageSize` values and an
  optional status; it returns numeric page metadata and summary counts; `GET /api/v1/service/requests/:id` returns one request.
- `GET /api/v1/service/work-orders`, `/work-orders/my`, and
  `/work-orders/:id` expose paged dispatcher and assigned-technician records.
  The list routes support bounded `page`/`pageSize` values and an optional
  status.
- `GET /api/v1/service/equipment/:id/history` returns the service-only timeline
  for one serial: work orders, service outcome, technician, dates, and used
  parts. It intentionally does not yet join sales, supplier, or handover events.
- `POST /api/v1/service/requests` records one selected telephone, email,
  customer-portal, or on-site source with a canonical customer/location/device,
  problem, priority, and warranty/out-of-warranty/subscription coverage type.
- `POST /api/v1/service/requests/:id/assign` creates or reschedules one work
  order for a valid technician/warehouse pairing; `POST /api/v1/service/requests/:id/cancel` records a reasoned pre-completion
  cancellation.
- `POST /api/v1/service/work-orders/:id/start`, `/photos`, and `/complete`
  start assigned work, accept one image evidence file, and finish a work order
  with notes, time, optional serial/batch-aware parts, labor/transport costs,
  customer representative, and PNG signature; `GET /api/v1/service/work-orders/:id/photos/:photoId` and
  `GET /api/v1/service/work-orders/:id/signature` return only
  access-controlled binary evidence with private/no-store response headers.

All reads require `erp.service:view`. An account without
`erp.service:approve` is scoped to its own assigned work: registers, direct
request/work-order reads, evidence, equipment history, and reference data do
not expose another technician's records. Request creation requires
`erp.service:create`; dispatch, rescheduling, and cancellation require
`erp.service:approve`. Starting, uploading evidence, and completion require
`erp.service:edit` from the assigned technician or `erp.service:approve` as an
authorized override. Every write requires an `Idempotency-Key`, applies an
optimistic version where the record is mutable, commits its audit event and
outbox event with the business change, and returns the prior response on an
exact retry. Work start rejects a second active repair for the same device.
Completion issues parts from the assigned technician warehouse within the same
PostgreSQL transaction, so a failed inventory issue rolls back the work
completion.

Request and appointment display use `BUSINESS_TIMEZONE`. The implementation is
currently a date-grouped schedule, not capacity/overlap enforcement, route
planning, or a complete calendar. Payment-document issuance, warranty cards and
claims, inspection reminders, subscription-generated visits, CRM ticket
correlation/SLA, reports/exports, and a complete sale-to-service serial timeline
remain pending.
