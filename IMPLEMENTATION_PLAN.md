# Vista Integrated Information System — Implementation Plan

Status date: 2026-08-14
Authoritative specification: [`AGENTS.md`](AGENTS.md)  
Project: `BG16RFPR001-1.012-1324-C01`

## 1. Plan governance

This is the living delivery plan for the ERP, CRM, POS, and custom backup and
disaster-recovery system. `AGENTS.md` remains authoritative: a plan entry may
sequence a requirement but may not narrow, reinterpret, or remove it.

Rules for maintaining this file:

- Update milestone status, evidence, risks, and decisions in the same change as
  implementation.
- Do not mark a requirement complete until its executable behavior (or an
  explicitly required documentation/hardware deliverable), authorization,
  audit behavior, tests, API/schema documentation, and traceability are present.
- Keep unclear business behavior in the decision register and backlog. Do not
  encode a permanent default before approval.
- Keep the system runnable at every completed milestone.
- Optional scope remains disabled behind feature flags until selected.

Status vocabulary: `not started`, `in progress`, `blocked by decision`,
`implemented`, and `accepted`. Only `accepted` means the corresponding
acceptance evidence has been reviewed by the project authority.

## 2. Current baseline

The repository initially contained only `AGENTS.md`; it had no source code,
package manifest, migrations, tests, CI/CD, documentation tree, or usable Git
worktree. The implementation therefore starts from the default monorepo layout
mandated by Section 3.3.

Current delivery status:

| Phase                                     | Status      | Current milestone                                                             |
| ----------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| 0. Discovery and decisions                | in progress | Plan, decision register, and traceability baseline                            |
| 1. Platform foundation                    | in progress | Versioned generated API clients and contract drift control verified           |
| 2. ERP master data and warehouse          | in progress | Inventory operations and customer asset registers implemented and verified    |
| 3. Procurement, sales, finance, logistics | in progress | Sales, procurement, and collection-payment foundation verified                |
| 4. Service                                | in progress | Scoped request-to-completion core verified; remaining mandatory work retained |
| 5. CRM                                    | not started | Depends on shared master data, identity, service correlation, and outbox      |
| 6. POS                                    | not started | Depends on catalog, inventory, pricing, finance, identity, and adapters       |
| 7. POS offline mode                       | not started | Depends on a stable online POS protocol and target fiscal-device behavior     |
| 8. Backup and disaster recovery           | not started | Discovery proceeds in Phase 0; build depends on approved plan and hardware    |
| 9. Hardening and handover                 | not started | Depends on all mandatory functional phases                                    |

## 3. Cross-phase dependencies

1. Phase 0 decisions and traceability run continuously; irreversible behavior
   cannot pass acceptance while a controlling business decision is unresolved.
2. Phase 1 supplies identity, authorization, audit, configuration, persistence,
   queues, files, notifications, observability, shared contracts, and UI
   primitives to all later phases.
3. Phase 2 establishes ERP-owned master data and transactional inventory before
   procurement, sales, service, CRM synchronization, or POS posting.
4. Phase 3 establishes legal/commercial documents, payments, and logistics
   required by service billing and POS/CRM financial integration.
5. Phase 4 establishes service workflows used by CRM ticket correlation,
   warranties, reverse logistics, and technician views.
6. Phase 5 consumes the ERP source of truth and must use the reliable outbox and
   stable correlation identifiers rather than duplicate master records.
7. Phase 6 requires certified hardware adapters, but CI uses test doubles.
8. Phase 7 begins only after online POS idempotency and fiscalization recovery
   semantics are stable; final offline readiness requires target-hardware tests.
9. Phase 8 discovery, policy, and hardware selection start early, while final
   restore acceptance depends on deployed sources and signed DR-test evidence.
10. Phase 9 includes the final SRS traceability review; no deferred mandatory
    requirement can disappear from the matrix.

## 4. Phased delivery plan

### Phase 0 — Discovery and decisions

Status: `in progress`

Scope:

- Confirm business locations, warehouses, operators, document sequences, tax
  settings, initial roles, SLA rules, accounting export formats, Bulgarian bank
  formats, fiscal-device models, PIN pad, Econt/Speedy credentials, backup
  sources, hardware, RPO/RTO, and deployment target.
- Inventory every physical/virtual server, workstation, laptop, tablet, company
  phone, database, file share, email resource, cloud service, and other approved
  source; classify each as Critical, Important, or Standard.
- Produce and obtain approval for the Information Backup Plan, including scope,
  frequency, full/incremental/differential strategy, retention, locations,
  responsible persons, verification, annual review, and infrastructure-change
  review.
- Maintain architecture decision records and the requirement traceability matrix.

Dependencies: business owners, finance/accounting authority, service and retail
operators, selected vendors, infrastructure/security owners, and management.

Acceptance criteria:

- Every discovery item has an approved answer or an owner and target date.
- The traceability matrix maps all requirement groups to planned modules,
  migrations, APIs, UI, documentation, and tests.
- The backup inventory, classifications, RPO/RTO values, and plan have management
  approval before destructive or retention behavior is enabled.
- Architecture decisions that affect data integrity, legal documents, security,
  hardware, or deployment are recorded before implementation.

### Phase 1 — Platform foundation

Status: `in progress`

Milestones:

#### P1.1 Runnable monorepo and delivery baseline

Status: `implemented`, awaiting project acceptance.

- npm workspaces for `apps/*` and `packages/*` using TypeScript throughout.
- NestJS API; separate React/Vite ERP-CRM, POS, and backup-control applications.
- Shared contracts, UI, authorization, configuration, and domain packages.
- Reproducible format, lint, typecheck, test, and build commands.
- Docker Compose services for PostgreSQL, Redis, S3-compatible development
  storage, and development email capture.
- The local startup command waits only on long-running healthy services and runs
  the successful one-shot MinIO bucket initializer separately, so Compose's
  expected initializer exit cannot prevent the API and frontend processes from
  launching.
- Secret-free environment examples, startup validation, one-command local start,
  and CI validation.

Acceptance criteria:

- A clean install produces a lockfile and all workspace builds pass.
- Local infrastructure has health checks and no committed credentials intended
  for production use.
- Every frontend is independently buildable and visibly identifies its module.
- CI runs formatting verification, linting, type checking, tests, and builds.

#### P1.2 API operational foundation

Status: `implemented`, awaiting project acceptance.

Implemented in the current slices: fail-fast shared environment validation;
versioned API routes; runtime and build-time OpenAPI generation; correlation IDs;
stable error envelopes; CORS and development/production HSTS behavior; structured
redacted request/event logging; configurable public/read/write/sensitive endpoint
limits with atomic Redis counters shared across production replicas;
separate liveness and PostgreSQL/Redis/private-bucket readiness; checksummed
advisory-lock migration runner with tested rollback; initial platform schemas;
and a Redis queue abstraction with stable idempotent job IDs, bounded retry,
exponential backoff, retained results, safe event logs, and state telemetry. The
first real worker lifecycle now transactionally claims and delivers in-system
notifications, recovers stale claims, records terminal failures, and exposes
recipient-safe notification reads. A unified worker now routes the complete named
job inventory, exposes retry state to handlers, rejects unknown work terminally,
and hands later-domain responsibilities to one deterministic transactional-outbox
event per logical run. Platform operators can inspect payload-free queue metrics
and known job lifecycle state. The OpenAPI document now produces one committed,
versioned, formatted TypeScript client shared by ERP/CRM, POS, and backup-control.
All existing ERP/CRM requests are compiled against generated paths and payloads;
CI fails on contract drift or incomplete path/success-response metadata.

The transactional outbox is now an active delivery path rather than passive
evidence. A polling publisher claims supported event types with `SKIP LOCKED`,
recovers abandoned publication claims, creates stable queue work, and preserves
originating business transactions when publication fails. Per-consumer delivery
records and durable inbox receipts prevent duplicate effects. Events are ordered
within the explicit aggregate, event-type, and consumer stream; an unresolved
predecessor blocks later events in that stream. Bounded failures become visible
dead letters, while an authorized, version-checked, idempotent replay preserves
completed consumers and resets only incomplete deliveries. Low-stock notification
creation is the first production consumer. Operators have a responsive,
payload-free System activity view for telemetry, delivery state, and audited
replay; unregistered later-phase event types remain pending until their owning
domain consumers are delivered.

- Versioned `/api/v1` endpoints and generated OpenAPI documentation.
- Configuration validation, correlation IDs, stable error envelopes, structured
  redacted logging, CORS policy, rate limiting, HSTS in production, and health
  checks for process, PostgreSQL, Redis, and object storage where configured.
- Migration runner with up/down support where feasible and initial schemas for
  identity, authorization, sessions, audit, files, notifications, idempotency,
  and outbox processing.
- Queue/job abstraction with retry, observability, and idempotency hooks.

Acceptance criteria:

- Invalid required configuration fails before the API begins listening.
- Liveness and readiness distinguish process health from dependency health.
- Every response carries a correlation identifier and API errors use stable codes.
- Initial migrations apply to an empty database; rollback is tested where the
  migration tool supports it.
- OpenAPI is generated and checked into or reproducibly emitted by the build.
- A changed API contract deterministically regenerates the shared versioned
  client, and stale generated output fails repository validation.
- Fault-injection tests prove outbox publication recovery, inbox deduplication,
  declared ordering, poison-message dead-lettering, and authorized replay without
  duplicating an already completed consumer effect.

#### P1.3 Identity, RBAC, 2FA, and audit vertical slice

Status: `in progress`.

Implemented in the current slices: controlled module/action permission vocabulary
and wildcard evaluation tests; configurable complexity/expiration policy;
versioned salted scrypt password hashes; failed-login lockout; Redis-backed opaque
sessions with digest-only PostgreSQL metadata and revocation; login/logout/current
account/effective-permission endpoints; a Redis-backed sensitive-login limiter;
default-deny backend session and permission enforcement; encrypted TOTP factor
verification with mandatory administrative 2FA; initial identity/RBAC/factor/
session/four-eyes schemas; and a serialized append-only SHA-256 audit writer and
chain-enforcement trigger. Protected account creation and reversible status
control, role creation/assignment, session administration/revoke-all behavior,
filtered audit querying, and recomputed integrity verification are now connected
to the ERP/CRM security page. Administrative-role operations require an
administrative actor with a 2FA-verified session and an enrolled target; the last
active administrator and self-disable paths are protected. Integration tests
cover failed/successful login, lockout, expiration, targeted and account-wide
session revocation, permission denial, administrative TOTP, access administration,
audit capture/query/integrity, chain linkage, mutation rejection, and requester
self-approval rejection. Employees can now change their own password after
current-credential verification. The API enforces the configured complexity,
expiration, and recent-password history policy, retains only the configured
number of prior hashes, revokes every other active session, keeps the verified
current session, and appends successful and rejected attempts to the audit chain.
The responsive My access drawer reads the active policy instead of hard-coding
client values and provides field-level, loading, failure, and completion states.
Still required: protected factor enrollment/provisioning and recovery, controlled
password reset, approved role seeds and policy values, and approved central
identity adapters after `IAM-001`/`IAM-002` decisions. A
development-only, non-administrative seed command provisions a local employee
account and the UI-workflow permissions needed to exercise the current browser
slices; it requires the operator to supply the password and refuses
`NODE_ENV=production`.

- One employee account; secure password hashing; configurable complexity and
  expiration; login sessions in Redis; 2FA mandatory for administrator roles and
  optional for other roles.
- Backend-enforced module/action permissions for View, Create, Edit, Delete, and
  Approve; backup operator, administrator, and security-officer roles are distinct.
- Tamper-resistant material-action audit events for actor, time, action, target,
  correlation, and relevant before/after metadata; ordinary users cannot delete
  backup audit records.
- Four-eyes primitives for critical backup actions.

Acceptance criteria:

- Unit and integration tests prove authentication failure/success, session
  revocation, admin 2FA enforcement, backend permission denial, and audit capture.
- Sensitive values are never logged; secrets are stored outside source control.
- No protected endpoint relies only on frontend authorization.

#### P1.4 Files, email, notifications, UI, and monitoring

Status: `in progress`.

Implemented in the current slices: a restrained responsive design-token and control
system; externalized application text; an API-backed ERP/CRM login and focused TOTP
challenge; opaque-session restore, expiry, revocation, and safe error states;
protected client routing; permission-aware navigation; workspace, effective-access,
not-found, and honest module-empty pages; mobile navigation; keyboard focus and skip
navigation; separate ERP/CRM, POS, and backup-control builds; initial versioned/
quarantined file metadata and idempotent notification schema; local Mailpit; and
deterministic creation/readiness validation of a private local MinIO bucket. The
in-system notification worker and recipient notification-centre UI are now
connected, with retry/backoff, stale-claim recovery, visible terminal failures,
and read acknowledgement. No file upload/download adapter, scanning, approved
email/SMS adapter, parent-authorization, metrics exporter, production monitoring
adapter, or backend-integrated POS/backup operational UI is yet claimed complete.
The responsive security page now connects employee accounts, role and
permission composition, account lifecycle, session revocation, 2FA posture, and
audit integrity with permission-aware commands and explicit loading, empty,
failure, and success states. Password and factor self-service states remain tied
to their pending backend workflows.
The first domain-backed ERP/CRM workflow, the shared partner registry, is
implemented under Phase 2.

The UI-only architecture pass now also provides complete navigable screen designs
for the documented ERP/CRM workflows, a task-first POS terminal, and a separate
backup/DR control console. These screens deliberately display no invented business
records. Actions remain unavailable until their APIs, database schemas, hardware
adapters, audit behavior, and acceptance tests are implemented in the corresponding
phases.

The project authority explicitly reprioritized a cross-application UI quality pass
on 2026-08-10. It simplified the security page while retaining its right-side
drawer, corrected shared token compatibility, aligned controls and icons, removed
implementation language from visible content, and checked ERP/CRM, POS, and backup
layouts at desktop and narrow viewport sizes. The temporary pending-work queue
was retired on 2026-08-11 at the project authority's direction because its
delivery slices had become more granular than the core specification requires.
Remaining work is now governed directly by `AGENTS.md` and this plan.

The 2026-08-12 stabilization pass audited the current implemented route families
with realistic populated and empty states at desktop, tablet, and phone widths.
It repaired previously undefined compatibility tokens, removed page-level mobile
overflow, kept the active item visible in horizontally scrollable navigation,
converted compressed phone tables and grids into readable cards, corrected module
labels in the compact top bar, and standardized Back/close controls on nested
forms and right-side panels. Procurement's five registers retain one consistent
opaque content surface and preview structure; POS remains a cashier-first terminal
and backup remains a separate recovery console. Business-facing copy was reviewed
to remove implementation and integration terminology where it appeared on normal
workflow screens.

- S3-compatible file adapter with type/size validation, quarantine/scan hook,
  versioned metadata, and inherited parent authorization.
- Queued, retryable, observable, idempotent in-system notifications; email and
  backup SMS remain behind approved provider adapters.
- Shared accessible, responsive UI primitives, externalized UI text, loading,
  empty, success, validation, and failure states.
- Metrics, logs, alert hooks, and operational runbooks.

Acceptance criteria:

- Adapter contract tests cover failures, retries, and idempotent replay.
- Notification duplicate delivery is prevented by idempotency key.
- Accessibility checks cover labels, focus order, and keyboard navigation.

### Phase 2 — ERP master data and warehouse

Status: `in progress`

Implemented in the current vertical slice: ERP-owned canonical partner records
with immutable UUIDs; legal-entity and individual types; simultaneous customer,
supplier, and business-partner roles; normalized UIC/VAT data; exact normalized
legal-name/UIC duplicate blocking without silent merge; searchable, filterable,
sortable pagination; `crm:view`/`crm:create` backend authorization; stable
idempotent creation; transactional audit-chain and outbox events; schema scaffolds
for partner addresses, contacts, and bank accounts; and a responsive registry,
profile drawer, create workflow, empty/loading/failure states, and controlled
duplicate warning. Address, contact, and bank-account creation requires
`crm:edit`, has scoped idempotent replay, and atomically updates the canonical
partner version with its audit-chain and outbox event. Customer locations and
their installed-equipment registers are also connected end to end: configurable
location type/address/responsible contact, globally unique equipment serial,
purchase and warranty dates, active/under-repair/retired status, optional catalog
product, and safe linking to an existing inventory serial without fabricating
legacy custody. Both commands are `crm:edit` protected, retry-safe, audited, and
outbox-backed. Partner, customer-location, and installed-equipment maintenance is
now connected end to end with optimistic version checks, stable retry keys,
before/after audit evidence, and outbox events. Deactivation is reversible rather
than destructive: active locations block partner deactivation and active
equipment blocks location deactivation. Equipment serial/product identity is
immutable. In-system low-stock alerts now dispatch through the Phase 1 worker and
appear in each recipient's notification centre. Remaining Phase 2 scope is
controlled duplicate resolution; provider-backed notification channels remain
under Phase 1. Optional FIFO remains disabled until selected. Hard
delete and merge behavior remain unimplemented pending the controlled-resolution
policy, so records cannot be silently merged or erased.

Current executable evidence: API integration test proves authorization,
normalization, idempotent replay, shared-profile read, duplicate IBAN rejection,
and exactly-once audit/outbox writes for all three profile child types. Browser
tests prove profile loading, the `crm:edit` contact command flow, customer
location/equipment creation, versioned edits, and reversible lifecycle controls.
The live customer-assets test additionally proves same-customer contact
enforcement, exact date preservation, serial uniqueness, safe retry, stale-write
rejection, dependency guards, and exactly-once audit/outbox evidence. Final phase
acceptance still awaits the remaining Phase 2 requirements and project-authority
review.

The internal organization topology is now also implemented without client data:
legal business entities, branches, addressed operating locations, employee-backed
operators, cash registers, and same-location register/operator assignments.
`platform.organization:view/create` is enforced in the backend; every create is
idempotent, audited, and outbox-backed. Warehouse setup can reference a business
location and a same-location technician operator. The connected Administration
page guides users through parent dependencies and retains explicit empty/error
states. Client-specific values and document/fiscal numbering remain unresolved
under `BUS-001`, `BUS-002`, and `POS-001`; no values were inferred or seeded.

The next safe catalog increment is also implemented: an empty ERP-owned
product-category hierarchy with immutable UUIDs, parent restrictions,
per-parent normalized-name uniqueness, `erp.warehouse:view`/`create` backend
authorization, retry-safe creation, and atomic audit/outbox writes. The Warehouse
navigation now opens a responsive category-tree screen rather than an empty
placeholder. It intentionally has no assumed Vista categories, products, units,
barcodes, serial/batch policy, or warehouse assignments. Those require the
recorded `CAT-001` and `BUS-001` decisions. Live integration tests prove root and
child creation, authorization denial, normalized duplicate blocking, replay, and
audit/outbox evidence; browser tests prove the hierarchy and create command.

Following the project direction to keep unspecified details configurable, catalog
tracking is represented as an explicit category policy: `none`, `serial`, or
`batch`, with expiry only permitted for batch tracking. The policy defaults to
`none` so existing categories remain compatible. Units are separate master data
rather than an enum, so client terminology and future conversions do not alter
posted data.
The category creation drawer now makes this policy explicit, shows expiry only
for batch tracking, and displays the saved policy in the hierarchy.

The product catalog vertical slice is implemented: authorized list/create
operations for units, products, and globally unique typed barcodes; immutable
product identity; category/unit reference validation; idempotent retries; and
atomic audit/outbox records. The ERP Warehouse hub now exposes an API-backed
product catalog with real empty, error, and prerequisite states plus retry-safe
unit/product creation drawers. No product or category seed data is inserted.
Pricing remains a later commercial increment; valuation, replenishment, and the
inventory-controlled portion of serial traceability are now implemented.

The first warehouse-inventory increment is now verified: empty configurable
standard/technician warehouses, append-only receipt movements, aggregate stock
balances, batch balances, and globally unique serialised items. The receipt
command is authorized, retry-safe, audited, and outbox-backed in one transaction.
It enforces category-driven serial, batch, and expiry requirements and returns
four-decimal quantities. No client warehouse, location, product, or stock balance
is seeded. Stock issues are now a distinct protected ledger command for sale,
repair, or write-off. It atomically prevents a negative aggregate or batch balance
and moves selected serials from available to issued, blocking a second issue of
the same serial. Linked returns now restore batch/serial custody and original BGN
valuation only through the immutable source issue, while preventing cumulative
over-return. Fiscal, invoice, payment, and source-document orchestration remain
separate pending workflows.

Warehouse transfers are now paired outbound/inbound movements in one atomic,
idempotent, audited, outbox-backed command. Source balance, batch balance, and
available serials are protected; balance locks use a deterministic order to avoid
opposing-transfer deadlocks.

Stocktake is now an approval-controlled workflow for ordinary, serial, and batch
stock. Opening a count transactionally freezes warehouse movements; every stocked
product and batch needs physical evidence; serial evidence quarantines missing
items; completion creates adjustment movements, updates balances, and records
audit/outbox evidence. Active reservations cannot be invalidated by a count.

Quantity reservations are now concurrency-protected for sales orders, quotations,
and service requests. They distinguish physical from available stock, support
partial issue consumption and explicit release, protect reserved stock from
unrelated issues/transfers, and require specific serials for serial-tracked
products. Optional FIFO and full source-document orchestration remain pending.

Automatic weighted-average valuation is now implemented in fixed-precision BGN.
Receipts blend their unit cost into the warehouse/product average; issues and
stocktake adjustments preserve the current average; transfers carry source cost
and blend it into the destination. Existing pre-valuation stock is explicitly
initialized at BGN 0.0000 rather than assigned a fabricated historical cost.
Per-warehouse/product minimum and target quantities now drive a live
reservation-aware low-stock register and purchase recommendation quantity.
Explicit employee subscriptions now queue one idempotent in-system message per
low-stock transition cycle; stock recovery resets the cycle without deleting its
history. Optional FIFO and source-document orchestration remain pending.

Serial traceability now exposes one chronological custody timeline from supplier
receipt through warehouse transfers to customer sale/repair issue and linked return, including the
recording employee, linked technician, reference, cost, current warehouse, and
available/issued/missing state. Party links are validated against active roles
and accounts. The ERP Reservations & serial trace route now provides a connected
scan/search experience. Source workflows must supply party links; missing legacy
evidence remains visibly absent and is never inferred.

The warehouse operator workspace is now connected to the inventory APIs rather
than presentation-only workflow cards. Permission-aware screens cover warehouse
creation; physical/reserved/available balances and weighted-average valuation;
minimum/target settings and purchase recommendations; serial/batch-aware receipt,
issue, and transfer commands; count evidence and separate stocktake approval;
sales-order/quotation/service reservations with release; and embedded serial
traceability. Every mutation sends a stable idempotency key, and the UI renders
server errors instead of predicting or bypassing inventory rules.

Scope: unified partners/customers/suppliers, legal entities and individuals,
contacts, addresses, bank accounts, customer locations, branches, products,
hierarchical categories, units, barcodes, equipment/devices, unlimited warehouses
including technician warehouses, serialised items, batches, expiration dates,
stock balances/movements, receipts/issues/transfers/write-offs, reservations,
stocktake, weighted-average and optional FIFO valuation, minimum stock, alerts,
purchase recommendations, and end-to-end serial traceability.

Dependencies: Phase 1, approved location/warehouse model (`BUS-001`), category/
serialization rules (`CAT-001`), costing policy, and initial access roles.

Acceptance criteria:

- ERP is the single operational source for shared master data; duplicate partner
  detection warns on UIC/company name and never silently merges.
- Constraints and transactions prevent duplicate serials, a serial sold twice,
  negative/double-counted inventory, or movements missing source, warehouse,
  quantity, actor, or timestamp.
- Reservations for orders, quotations, and service requests are concurrency-safe.
- Traceability reports show supplier, receipt date, customer sale, and repair
  technician; all material changes are authorized and audited.
- Weighted-average behavior has executable tests; FIFO behavior must have tests
  before the optional costing mode can be enabled.

### Phase 3 — Procurement, sales, finance, and logistics

Status: `in progress`

Implemented in the current slices: the complete core procurement chain of active
supplier contacts, versioned payment/delivery terms, immutable evaluation history,
authorized purchase-order creation and registers, fixed-precision multi-product
lines, expected-delivery dates, partial/full receiving, transactional warehouse
entry, supplier-provided invoice evidence, ordered/delivered/invoiced comparison,
supplier-scoped invoice-reference protection, damaged/non-conforming claims, and
controlled claim status history. Purchase orders expose their receipt and invoice
history, while claim records retain exact receipt-line linkage. Serial, batch,
expiry, weighted-average, permissions, idempotency, audit, and outbox controls run
through the chain. The connected ERP workspace provides navigable registers,
record previews with clear back controls, and focused right-side forms without
sample operational data. Procurement evidence does not claim accounting posting;
that remains in the finance workflow.

The connected sales slice now carries a quotation through confirmed order,
shipment, and invoice draft. It enforces validity, line and overall discounts,
fixed-precision VAT totals, inventory availability, exact serial reservations,
batch evidence, atomic stock issue, idempotency, audit, and outbox publication.
The ERP workspace exposes one continuous preview with a visible stage timeline
and Back navigation. The invoice is intentionally a draft snapshot: official
Vista numbering, BNB posting, fiscal/accounting issuance, PDF, email, payment,
and correction controls remain in the finance workflow and cannot be completed
until their controlling decisions are approved.

Scoped future pricing is now connected end to end. Active price lists can target
all customers, one reusable customer group, or one customer; carry an effective
period, currency, priority, optional promotional campaign, and fixed-precision
product prices; and remain reversibly active/inactive with optimistic versioning.
The resolver is currency- and date-specific and deterministically selects by
priority, then customer specificity, then stable record identity. Quotation lines
can deliberately apply that resolved customer price while remaining editable
before confirmation. The responsive Prices & promotions workspace maintains
groups, campaigns, lists, and a visible price checker through focused right-side
drawers.

Service subscriptions now bind the canonical customer, one active customer
location, one or more installed devices, visit and billing frequencies, included
services, a fixed-precision recurring price, validity, and the next billing date.
They are versioned and reversibly active. The named recurring-billing job creates
one immutable review draft per due period, advances the schedule transactionally,
and safely returns no duplicate on replay. A stable timezone-aware BullMQ schedule
is upserted on application startup, preventing duplicate schedules across replicas
or restarts while giving every occurrence a distinct retry-stable identity. Every
completed sales shipment also prepares a handover/acceptance certificate from the
actual shipped product and serial evidence; authorized employees record the
accepting representative and optional note in the same continuous Sales preview.

Finance now has a deliberately limited collection foundation. A BGN sales invoice
draft may be added once to a customer collection record, which carries an
auditable internal reference, a due date, fixed-precision total/allocated/
outstanding amounts, and unpaid, partially paid, paid, overdue, or cancelled
status. Authorized employees can add a partial cash, bank-transfer, POS-terminal,
card, or compensation/offset payment up to the remaining balance. Every command
uses a transaction, idempotency key, audit event, and outbox event; payment
records cannot be silently removed and paid records cannot be cancelled. A
timezone-aware daily job transitions outstanding records past their due date to
overdue once and safely tolerates replay. The Finance workspace provides
navigable invoice-draft and payment-allocation registers, responsive status
summary, focused right-side preview/payment panels, validation and failure
states, and clear Back controls. These are collection-review records only:
legal/fiscal issuance, VAT/accounting posting, BNB rates, PDF/email delivery,
credit/debit/proforma, bank import/matching, cash vouchers, notifications,
advances, registers, reports, and logistics remain pending.

Scope:

- Supplier register/evaluation, purchase orders, partial/full goods receipts,
  automatic warehouse receipts, ordered/delivered/invoiced comparison, supplier
  claims, supplier invoices, and complete delivery history.
- Quotation → confirmed order → shipment → invoice, validity and discounts, price
  lists by customer group/customer/period/campaign, subscription contracts,
  recurring invoices, serial reservations, and handover certificates.
- VAT-compliant sales/proforma/correction documents, POS/fiscal links, BGN
  accounting, BNB rates with immutable posting snapshots, concurrency-safe
  sequences per branch/location/register/operator, PDF/logo/signature, and email.
- Unpaid/part-paid/paid/overdue/cancelled states, partial allocations, cash/bank/
  terminal/card/offset methods, reminders, matching, cash vouchers/reports, bank
  import/manual entry, advances, and offsets.
- Receivable/payable aging, turnover, journals, VAT reports, structured accounting
  exports, customer/company/courier delivery, Econt/Speedy, returns/reverse
  logistics, service-request creation, and calendar route planning.
- Standard and user-configurable reports with controlled definitions, access,
  reproducible formulas, filtering, and asynchronous Excel/CSV/PDF export.

Dependencies: Phase 2; approved tax, numbering, bank/accounting, BNB, document,
notification, courier, and business-timezone decisions.

Acceptance criteria:

- Posted money uses fixed precision and never changes silently when rates, prices,
  or taxes change; links among source/correction/fiscal/accounting/payment documents
  remain intact.
- Transactions and constraints prevent duplicate numbers, orphaned corrections or
  allocations, over-allocation except explicit advance/offset, and silent deletion.
- Required reports reproduce documented formulas and buckets (0–30, 31–60,
  61–90, over 90 days) and export in every required format.
- Integrations have adapters, timeouts, retry, idempotency, logs, and reconciliation.
- Procurement and quotation-to-payment end-to-end scenarios pass.

### Phase 4 — Service

Status: `in progress — scoped Service core implemented; remaining mandatory Service requirements retained below.`

Scope: telephone/email/portal/on-site requests; work orders with customer,
location, serialised device, problem, and warranty/out-of-warranty/subscription
type; technician assignment, calendar and workload; responsive technician views;
parts, time, photos, signatures; transactional technician stock deduction; labor,
parts, transport costing; payment documents; full serial service history; warranty
period/claim monitoring; mandatory technical/metrological inspection reminders;
subscription-generated visits; route planning and reverse-logistics integration.

Dependencies: Phases 1–3 and approved labor/transport costing, warranty,
inspection, subscription, signature, and scheduling rules.

Current implemented slice:

- Authorized, audited intake records the selected telephone, email, customer
  portal, or on-site source; canonical customer, active location, active device,
  serial number, priority, problem, and warranty/out-of-warranty/subscription
  coverage are validated before creation.
- Dispatchers assign or reschedule a work order to an active technician and that
  technician's mapped warehouse. A responsive schedule and personal assigned-work
  view expose the recorded appointments.
- Technicians can start assigned work, upload and later retrieve controlled photo
  evidence, record working time, completion notes, fixed-precision labor/parts/
  transport costs, and a customer signature. Completion atomically issues used
  parts from the technician warehouse using the existing serial/batch inventory
  rules.
- Commands are permission-backed, version-checked, idempotent, audited, and
  outbox-backed. A device cannot enter two concurrent active repairs. Cancelled
  pre-start requests retain a reason. Service-only history remains reviewable by
  serial number, including retired equipment.

Still required before Phase 4 can be accepted:

- payment-document issuance and service-to-finance linkage;
- full sale/supplier-to-service serial lifecycle history;
- real calendar/capacity/overlap and route planning, not only a date-grouped
  schedule;
- warranty cards, claims, remaining-period/claim monitoring, expiry reminders,
  inspections, and subscription-visit generation;
- CRM ticket correlation/SLA/notifications, reverse logistics, service reports,
  exports, and the remaining mobile/accessibility verification.

Acceptance criteria:

- The scoped Service core has live integration evidence for authorization,
  idempotent replay, cancellation, competing-repair prevention, stock deduction,
  evidence retrieval, signature, and retired-equipment history; it is not Phase
  4 acceptance evidence for the omitted mandatory behavior.
- Phase acceptance remains pending until authorized, audited workflows preserve
  sale, visits, repairs, work, parts, technician, and dates for each serial
  number; required schedules are idempotent and retry-safe; payment documents
  are issued; and the complete scenario passes on desktop and mobile viewports.

### Phase 5 — CRM

Status: `not started`

Scope: unified ERP-backed partner registry, customer locations/contacts/equipment;
chronological customer/location timelines for calls, emails, visits, chats, tasks,
reminders, and attachments; leads and sources; qualification/conversion;
opportunities and audited backend-validated Kanban stages; ticket numbering,
channels, priority and categories; bidirectional ticket/service correlation without
loops; customer/contract SLA monitoring and escalation; optional portal; warranty
cards/claims; surveys, NPS, referrals; documented/reproducible analytics; ERP/POS
two-way integration and external APIs.

Dependencies: Phases 1–4; approved SLA, pipeline, customer portal, warranty,
survey/NPS, retention/churn/CLV, and employee KPI definitions.

Acceptance criteria:

- CRM does not create conflicting partner/location/equipment/document/payment data.
- Stable correlation and idempotency prevent ticket/service duplicate loops.
- SLA risk and escalation jobs are idempotent and auditable.
- Analytics document formulas, dates, statuses, and sources and export in all
  required formats.
- Lead and ticket/service end-to-end scenarios pass.

### Phase 6 — POS

Status: `not started`

Scope: separate responsive cashier application; 1D/2D scan, name/code search and
quick access; real-time ERP stock/price/promotion; certified Ordinance H-18 fiscal
adapter; fiscal-receipt invoice linkage; multiple registers/operators; mandatory
valid serial capture and warranty card/customer linkage; cash, PIN-pad card,
on-account, split, advance, balance, and change; recoverable/idempotent payment,
fiscalization, invoice, and stock posting; linked returns and fiscal reversal;
discount authorization, bundles, quantity pricing, loyalty ledger and corporate
pricing; shifts, X/Z and all specified comparative reports; ERP/CRM/external APIs.

Optional kiosk, backup router, ESL, and e-commerce fiscalization remain disabled
behind configuration until selected.

Dependencies: Phases 1–5; approved terminal/register/operator topology, fiscal
device, PIN pad, scanner, loyalty, return-exception, and optional-scope decisions.

Acceptance criteria:

- Serialized sale cannot complete without an available unique serial; completion
  cannot double-post fiscal, inventory, accounting, or integration effects.
- Returns require their source document unless an authorized, audited exception is
  approved; eligible stock and service-warehouse routing are atomic.
- Loyalty uses an immutable points ledger, and manual discounts require backend
  permission.
- CI adapters use test doubles; target fiscal device, scanner, and PIN pad pass
  hardware acceptance tests before production approval.

### Phase 7 — POS offline mode

Status: `not started`

Scope: durable local transaction store, stable client IDs, outbound queue,
automatic reconnect, idempotent server sync, conflict policies for price, stock,
customer, serial, promotion and numbering, retry/conflict/reconciliation audit,
duplicate prevention, visible offline/unsynchronized state, and fiscal issuance
while disconnected.

Dependencies: Phase 6 and approved conflict/fiscal-offline rules plus target
hardware access.

Acceptance criteria:

- Automated suites cover reconnect, interrupted sync, duplicate replay, stale
  prices, unavailable serials, server rejection, and reconciliation.
- Fiscal receipts continue offline on target certified hardware.
- The product makes no offline-readiness claim until target-hardware behavior is
  tested and accepted.

### Phase 8 — Backup and disaster recovery

Status: `not started` (discovery begins in Phase 0)

Scope: custom centralized control integrated with every approved database, file,
configuration, server, workstation, mobile, email, file share, cloud, and other
source; full/incremental/differential, snapshots and image backups;
deduplication/compression; email/SMS success/failure/missed alerts; journaling;
restore points, retention and verification; ransomware protection, encryption,
air gap/tape/network isolation, separate accounts/domain, primary-AD compromise
protection, MFA, distinct roles and four-eyes critical actions; centralized AD,
LDAP, Entra, SAML, OAuth/OIDC integration where available; protected emergency
access if selected; granular record/email/file restore and bare-metal restoration
to different hardware; written DR procedures and annual tests/reminders.

Dependencies: approved backup inventory/plan, classifications, RPO/RTO, owners,
identity topology, deployment design, physical storage server, tape drive/library,
capacity, retention, rotation, off-site/air-gap, encryption, ownership, maintenance,
and restore-compatibility decisions.

Acceptance criteria:

- Ordinary users cannot delete audit logs; restore-point deletion, retention
  reduction, job disablement, and destructive restore require MFA, authorization,
  four-eyes approval, and immutable audit evidence.
- Jobs expose source, status, times, points, retention, verification, and errors;
  missed/failed/success notification behavior is tested.
- File, database, full-server, and infrastructure restore procedures identify who
  initiates, approves, informs management, and informs customers.
- At least one implementation-time DR test produces a signed protocol with restore
  evidence, RTO/RPO results, non-conformities, and corrective actions; subsequent
  tests are scheduled at least annually.
- Actual storage server and tape hardware pass restore testing; a backup-only test
  is insufficient.

### Phase 9 — Hardening and handover

Status: `not started`

Scope: full end-to-end, performance, concurrency, security, vulnerability,
migration-rehearsal, monitoring and alerting validation; deployment, environment,
integration, hardware, backup, DR, runbook, user-manual, built-in-help, training,
and handover deliverables; final traceability and optional-scope disposition.

Dependencies: all mandatory implementation phases and business/hardware acceptance.

Acceptance criteria:

- All ten mandatory end-to-end scenarios and applicable hardware/recovery tests in
  Section 15 pass, with concurrency tests for stock, serials, sequences, payments,
  POS/integration idempotency, and backup approvals.
- Security review confirms TLS/HSTS, least privilege, unified RBAC, admin 2FA,
  audit, validation/encoding, applicable CSRF, CORS, rate limits, secret handling,
  backup encryption, and log redaction.
- CI includes supported dependency/container vulnerability scanning.
- All documentation in Section 18 is current; training and handover are complete.
- Every mandatory matrix row is accepted and every optional item is explicitly
  implemented or not selected.

## 5. Scheduled-job inventory

All jobs use stable idempotency keys, retry safely, expose progress/failure, and
produce audit or operational telemetry as applicable:

- upcoming/overdue payment detection and notifications;
- recurring subscription invoices;
- fiscal-device and scale inspection reminders;
- upcoming visits generated from service plans;
- warranty-expiration reminders;
- SLA-risk monitoring and escalation;
- scheduled and asynchronous report generation;
- backup execution, verification, and missed-backup detection;
- annual backup-plan review and DR-test reminders.

The Phase 1 worker and named-handler registry cover the complete inventory. The
active notification handler owns its full PostgreSQL delivery lifecycle. Other
handlers publish one deterministic transactional-outbox trigger for their later
domain owner; their business effects and configurable schedules remain acceptance
work in Phases 3–8 and are not represented as completed results. See
`docs/architecture/background-jobs.md`.

## 6. Required test inventory

- Unit: tax/totals, currency, outstanding balance, aging, discounts, loyalty,
  warranty, SLA, repair cost, stock valuation, reservations, and RPO/RTO.
- Integration: migrations/transactions, RBAC, numbering concurrency, stock/serial
  traceability, allocations, proforma conversion, fiscal-to-invoice link, ERP/CRM
  and ERP/POS sync, ticket/service correlation, all named external adapters, and
  backup scheduling/retention/audit.
- End to end: all ten flows listed in `AGENTS.md` Section 15.3.
- Hardware/recovery: simulators in CI plus real fiscal device, scanner, PIN pad,
  tape hardware, and any selected optional POS hardware before acceptance.

## 7. Unresolved decisions

The detailed decision register is in
[`docs/architecture/decisions/README.md`](docs/architecture/decisions/README.md).
The following categories currently block only the behavior they control, not the
reversible foundation scaffold:

- organization, business location, branch, warehouse, register, operator, and
  document-sequence topology;
- effective tax configuration, business timezone, legal document presentation,
  company logo/signature, currencies, and BNB-rate operating policy;
- initial role assignments, password policy values, identity provider(s), 2FA
  mechanism, backup group mapping, and emergency-access policy;
- partner duplicate-resolution authority, evidence, merge precedence, linked-data
  migration, and source-record retention;
- customer/contract SLA values, escalation rules, warranty/inspection rules,
  subscription rules, and analytics formula windows/status filters;
- accounting export products/formats and Bulgarian bank statement formats;
- email/SMS, object storage, malware scanning, and integration providers/credentials;
- Econt/Speedy contracts and credentials;
- fiscal device, PIN pad, scanner, POS terminals/registers, and certified offline
  fiscal behavior;
- optional customer portal, FIFO, kiosk, router, ESL, and e-commerce fiscalization;
- infrastructure inventory, backup classification/RPO/RTO/retention, physical
  storage server, tape hardware/rotation/off-site handling, and deployment target.

## 8. Milestone evidence log

| Date       | Milestone                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Result                                |
| ---------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 2026-08-14 | P4 scoped Service core             | Migration 0030, protected Service APIs, generated contracts/client, and the connected ERP Service workspace provide request intake, technician assignment/rescheduling, responsive personal work, time/parts/cost capture, controlled photo/signature evidence, atomic technician-warehouse deduction, cancellation, and service-only serial history including retired devices. Live PostgreSQL/Redis integration coverage verifies authorization, idempotent replay, stock integrity, concurrent-repair prevention, evidence retrieval, and retired-history access; the browser flow verifies sidebar-to-intake navigation. Payment documents, full sale/supplier history, warranty/inspection/SLA/route behavior, ticket correlation, reporting, and mobile/accessibility acceptance remain pending. | verified foundation                   |
| 2026-08-05 | Repository baseline                | Only `AGENTS.md`; no usable Git worktree or implementation files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | confirmed                             |
| 2026-08-05 | Specification read                 | All 1,320 lines of `AGENTS.md` reviewed before implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | confirmed                             |
| 2026-08-05 | Phase 0 baseline                   | Living plan, decision register, ADR-0001, and full section-level traceability                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | implemented                           |
| 2026-08-05 | P1.1 monorepo                      | Lockfile, NestJS, three Vite apps, five shared packages, Compose, CI, and foundation docs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | implemented, not accepted             |
| 2026-08-05 | P1.2 API slice                     | Live readiness reported PostgreSQL/Redis up; OpenAPI emitted; API E2E passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | implemented, incomplete               |
| 2026-08-05 | P1.2 migration                     | Foundation migration applied; invariants passed; down succeeded; up reapplied                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | verified                              |
| 2026-08-05 | Repository validation              | Format, lint, all typechecks, 18 tests, and all production builds passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | passed                                |
| 2026-08-05 | Dependency audit                   | `js-yaml` advisory remediated with 5.2.3 override; production audit reports zero findings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | passed                                |
| 2026-08-06 | P1.2 runtime controls              | Redaction unit test, request logging, throttling E2E, safe 429 envelope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | verified                              |
| 2026-08-06 | P1.2 storage/jobs                  | Private MinIO bucket probe and Redis stable-ID replay/deduplication integration tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | verified, worker pending              |
| 2026-08-06 | P1.2 dependency health             | Live readiness reported PostgreSQL, Redis, and private object storage up                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | verified                              |
| 2026-08-06 | Repository validation              | Format, lint, all typechecks, 25 tests including infrastructure, and all builds passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | passed                                |
| 2026-08-06 | Reproducibility checks             | OpenAPI emitted; migration down/up passed; production dependency audit found zero issues                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | passed                                |
| 2026-08-06 | P1.3 authentication                | Scrypt, lockout/expiry, Redis sessions, RBAC denial, admin TOTP, and logout E2E                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | verified, admin APIs pending          |
| 2026-08-06 | P1.3 audit chain                   | Serialized writer, chain-head trigger, linked-event and append-only integration tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | verified, query service pending       |
| 2026-08-06 | P1.3 validation                    | Format, lint, all typechecks, 44 tests including live infrastructure, and all builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | passed                                |
| 2026-08-06 | P1.3 reproducibility               | Opaque-bearer OpenAPI emitted; migration 0002 down/up passed; production audit found zero                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | passed                                |
| 2026-08-06 | P1.4 ERP/CRM UI                    | Login/TOTP, session restore/logout, protected routes, permission navigation, responsive QA                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | verified, domain pages next           |
| 2026-08-06 | P1.4 validation                    | Format, lint, all typechecks/builds, 48 tests with infrastructure, and zero production audit findings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | passed                                |
| 2026-08-06 | P2 partner API                     | Migration 0003; authorized list/get/create; duplicate blocking; idempotency; atomic audit/outbox; 7 live integration tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | verified, detail relations pending    |
| 2026-08-06 | P2 partner UI                      | Real `/partners` registry, filters, responsive table/cards, detail/create drawers, duplicate and recovery states; 8 browser-behavior tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | verified                              |
| 2026-08-06 | P2 responsive QA                   | Chromium screenshots at 1440×1000 and 390×844 using isolated non-persistent API fixtures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | passed                                |
| 2026-08-06 | P2 reproducibility                 | Migration 0003 rollback/reapply passed; OpenAPI includes filters, create body, retry header, and response schemas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | passed                                |
| 2026-08-06 | P2 repository validation           | Format, lint, all typechecks, 58 tests including live infrastructure/database invariants, and all production builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | passed                                |
| 2026-08-06 | P2 dependency audit                | Production dependency audit reported zero vulnerabilities                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | passed                                |
| 2026-08-07 | Local startup reliability          | `npm run infra:up` returned 0 after healthy PostgreSQL/Redis/MinIO/Mailpit and successful MinIO initialization; `npm run dev` started all four apps; curls returned 200 for ports 5173, 5174, 5175, API liveness, and OpenAPI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | passed                                |
| 2026-08-07 | Development browser access         | `npm run db:seed:dev` provisioned `dev@vista.local` with non-administrative CRM/warehouse permissions; API seed completed successfully; password is supplied by the operator and is not stored in the repository                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | verified                              |
| 2026-08-07 | UI architecture pass               | 40+ navigable ERP/CRM workflow designs; task-first POS terminal and POS registers; backup/DR control screens; no fabricated operational data; frontend typechecks, tests, and production builds passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | verified, API wiring pending          |
| 2026-08-07 | Workspace shell refinement         | ERP/CRM uses the available dashboard canvas with a leaner navigation rail and secured-session topbar; backup/DR has a refined recovery-control header and rail; both frontend typechecks, tests, and builds passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | verified                              |
| 2026-08-07 | P2 catalog master data             | Migration 0006-backed units/products/typed barcode API with authorization, normalization, idempotency, audit/outbox; API integration suite (10 tests), ERP catalog browser suite (11 tests), typechecks and production build                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | verified, inventory slice pending     |
| 2026-08-07 | P2 catalog validation              | OpenAPI generated with the four catalog routes; full repository `npm run validate` passed; live PostgreSQL integration suite passed all 10 catalog/partner tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | passed                                |
| 2026-08-10 | P2 receipt foundation              | Migration 0007 applied locally; warehouse/receipt/balance APIs enforce normalized topology, idempotency, atomic audit/outbox, serial-per-unit validation, and fixed-scale quantities; live PostgreSQL integration suite passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | verified, inventory workflows pending |
| 2026-08-10 | P2 stock-issue control             | Migration 0008 applied locally; protected sale/repair/write-off issues reject insufficient aggregate/batch stock and double-issued serials; live PostgreSQL integration suite passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | verified, transfer/stocktake pending  |
| 2026-08-10 | P2 transfer control                | Migration 0009 applied locally; paired transfer movements relocate stock, batches, and available serials transactionally with deterministic locking; live PostgreSQL integration suite passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | verified, stocktake pending           |
| 2026-08-10 | P2 stocktake control               | Migrations 0010–0012 applied locally; warehouse freeze, ordinary/serial/batch evidence, approve-only adjustments, missing-serial quarantine, reservation safeguard, audit/outbox, and replay passed live PostgreSQL tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | verified                              |
| 2026-08-10 | P2 reservation control             | Migration 0013 applied locally; sales-order/quotation/service reservations support partial consumption, release, specific serial protection, and available-stock enforcement; live PostgreSQL integration suite passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | verified, valuation/alerts next       |
| 2026-08-10 | P2 inventory validation            | OpenAPI regenerated; live PostgreSQL suite passed all 10 combined partner/catalog/inventory scenarios; repository-wide format, lint, typechecks, unit/E2E tests, and all production builds passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | passed                                |
| 2026-08-10 | P2 valuation/replenishment         | Migration 0014 applied locally; fixed-precision BGN weighted average flows through receipts/issues/transfers/stocktake; reservation-aware thresholds, low-stock state, and purchase recommendations passed live PostgreSQL tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | verified, FIFO/notifications pending  |
| 2026-08-10 | P2 valuation validation            | OpenAPI regenerated; repository-wide format, lint, every workspace typecheck/test, NestJS build, and all three Vite production builds passed after the valuation and replenishment changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | passed                                |
| 2026-08-10 | P2 serial traceability             | Migration 0015 applied locally; supplier receipt, transfer custody, customer repair issue, technician identity, status, unknown-serial handling, and chronological API passed live PostgreSQL tests; connected ERP UI passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | verified                              |
| 2026-08-10 | P2 traceability validation         | OpenAPI regenerated; repository-wide formatting, lint, every workspace typecheck/test, NestJS build, and all three Vite production builds passed after the serial-traceability API and connected ERP workflow were added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | passed                                |
| 2026-08-10 | P2 warehouse operations UI         | Five permission-aware connected workflows cover warehouses, stock/valuation/replenishment, serial/batch movements, approval-separated stocktakes, reservations/releases, and serial trace; 15 ERP browser tests pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | verified                              |
| 2026-08-10 | P2 warehouse UI validation         | Repository-wide format, lint, every workspace typecheck/test, NestJS build, and all three Vite production builds passed with the connected warehouse operator workspace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | passed                                |
| 2026-08-10 | P2 customer assets                 | Migration 0016, three protected APIs, shared contracts, and connected customer-profile UI cover multiple locations, responsible contacts, installed devices, status, purchase/warranty dates, unique serials, and inventory serial links                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | verified                              |
| 2026-08-10 | P2 customer-assets tests           | Live PostgreSQL partner/master-data suite passed all 11 scenarios, including authorization, date fidelity, idempotent replay, global serial uniqueness, audit/outbox evidence; ERP browser suite passed all 16 tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | passed                                |
| 2026-08-10 | P2 customer-assets validation      | OpenAPI regenerated with all three routes; repository-wide formatting, strict lint, every workspace typecheck/test, NestJS build, and all three Vite production builds passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | passed                                |
| 2026-08-10 | P2 organization topology           | Migration 0017 and seven protected endpoints cover internal legal entities, branches, addressed locations, employee operators, registers, same-location assignments, and optional warehouse/operator ownership without seed data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | verified                              |
| 2026-08-10 | P2 organization tests              | Live PostgreSQL suite passed all 12 master-data scenarios; connected dependency-aware Administration workflow brought the ERP browser suite to 17 passing tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | passed                                |
| 2026-08-10 | P2 organization validation         | OpenAPI regenerated with all seven topology routes and extended warehouse schemas; repository-wide format, lint, typechecks, unit/E2E tests, NestJS build, and all Vite production builds passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | passed                                |
| 2026-08-10 | P2 linked inventory returns        | Migration 0018 and protected return API/UI require an immutable original issue, prevent cumulative over-return, restore batch/serial custody and original BGN cost, append serial trace events, and retain fiscal/POS reversal boundaries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | verified                              |
| 2026-08-10 | P2 low-stock alert queue           | Migration 0019 adds explicit active-account subscriptions and transactional transition state; live PostgreSQL proves one message per recipient/cycle, no duplicates while low, recovery reset, a second shortage cycle, and later dispatch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | verified                              |
| 2026-08-10 | P2 returns/alerts validation       | Migrations 0019 down/up passed; OpenAPI regenerated; live API suite passed all 12 scenarios; ERP browser suite passed 18 tests; full repository validation passed 44 standard tests, lint, typechecks, NestJS and all Vite production builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | passed                                |
| 2026-08-10 | P2 partner/assets maintenance      | Nine protected update/lifecycle routes, shared versioned contracts, and connected profile controls provide retry-safe edits and reversible deactivation for partners, customer locations, and equipment without hard delete or identity mutation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | verified                              |
| 2026-08-10 | P2 maintenance tests               | Live PostgreSQL/Redis suite passed all 13 partner/master-data scenarios including stale versions, dependency guards, idempotent replay, reactivation, and audit/outbox evidence; ERP browser suite passed all 19 workflows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | passed                                |
| 2026-08-10 | P2 maintenance validation          | OpenAPI regenerated with all nine maintenance routes; repository-wide formatting, strict lint, every workspace typecheck, 45 standard tests, NestJS build, and all three Vite production builds passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | passed                                |
| 2026-08-10 | P1 notification dispatch           | Migration 0020; Redis worker/poller, transactional claim, bounded retry, stale-claim recovery, terminal errors, recipient-safe list/read APIs, and ERP/CRM notification centre deliver low-stock alerts without pretending email/SMS succeeded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | verified                              |
| 2026-08-10 | P1 notification tests              | Live PostgreSQL/Redis suite passed all 13 scenarios including delivered/read low-stock evidence; ERP browser suite passed all 20 workflows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | passed                                |
| 2026-08-10 | P1 notification validation         | Migration 0020 applied locally; OpenAPI regenerated; full repository validation passed format, lint, strict typechecks, 46 standard tests, NestJS, and every Vite production build                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | passed                                |
| 2026-08-10 | P1 protected job operations        | `platform:view` queue metrics and payload-free job lifecycle APIs; OpenAPI emitted; live PostgreSQL/Redis suite passed all 14 scenarios including authorization, non-disclosure, lifecycle, and missing-job behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | verified                              |
| 2026-08-10 | P1 operations validation           | Full repository validation passed formatting, lint, strict typechecks, 46 standard tests, NestJS, and every Vite production build                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | passed                                |
| 2026-08-10 | P1 security administration         | Migration 0021 and eleven protected endpoints connect account creation/lifecycle, controlled roles and grants, active-session revocation, filtered activity history, and recomputed integrity to the responsive ERP/CRM security page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | verified, recovery flows pending      |
| 2026-08-10 | P1 security controls/tests         | Live PostgreSQL/Redis authentication suite passed all 13 scenarios, including idempotent account/role commands, administrative 2FA boundaries, session revocation, login denial, self/last-admin protection, non-disclosure, and audit integrity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | passed                                |
| 2026-08-10 | P1 security validation             | Migration 0021 down/up passed; OpenAPI emitted all security routes; ERP browser suite passed 21 workflows; full validation passed formatting, lint, strict typechecks, 47 standard tests and all builds; production dependency audit found zero                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | passed                                |
| 2026-08-10 | Cross-app UI quality pass          | Simplified security structure and drawer, shared token repair, icon/control alignment, plain business-facing copy, Chromium checks at 1440×1000 and 390×844, and full validation with 49 standard tests and all production builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | passed                                |
| 2026-08-10 | Temporary-goals governance         | A temporary pending-only queue was introduced to sequence remaining work and was subsequently retired on 2026-08-11 when it became more granular than the core delivery path required                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | superseded                            |
| 2026-08-10 | P1 named job handlers              | Unified BullMQ worker registry; corrected nested-payload routing; bounded retry context; terminal unknown-handler behavior; all 13 remaining named responsibilities registered with deterministic transactional-outbox handoff and explicit P3–P8 ownership                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | verified                              |
| 2026-08-10 | P1 named-job tests                 | Eight focused lifecycle tests passed; live PostgreSQL/Redis suite passed all 15 scenarios and proved one durable event after two executions of each named handler; full validation passed 56 standard tests and all production builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | passed                                |
| 2026-08-10 | P1 distributed rate limits         | All 68 non-health endpoints have configurable public/read/write/sensitive policies; atomic Redis counters span replicas, production rejects memory storage, dependency failure is closed/stable, and trusted proxy hops are explicit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | verified                              |
| 2026-08-10 | P1 rate-limit validation           | Six focused policy/storage/coverage tests, configuration tests, stable-header/429 API E2E, and live two-instance Redis sharing/expiry passed; OpenAPI regenerated; full validation passed 63 standard tests and all production builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | passed                                |
| 2026-08-11 | Pending-scope audit                | The temporary queue was reconciled with the specification, permanent plan, decisions, traceability, and evidence before being retired; the authoritative specification and permanent implementation plan retain the required scope and decision register                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | retained in permanent plan            |
| 2026-08-11 | P1 generated API client            | Committed formatted v1 client generated from OpenAPI; shared runtime and app entry points cover ERP/CRM, POS, and backup-control; every existing ERP/CRM request now compiles against generated paths, parameters, bodies, responses, and errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | verified                              |
| 2026-08-11 | P1 contract-drift validation       | OpenAPI metadata guard and deterministic regeneration fail stale client output before compilation; shared transport tests and all 21 connected ERP/CRM browser workflows pass; full validation passes 65 standard tests and every production build                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | passed                                |
| 2026-08-11 | P1 reliable event path             | Migration 0022 activates ordered outbox publication, per-consumer delivery state, durable inbox deduplication, stale-claim recovery, bounded dead letters, and audited idempotent replay; low-stock notification creation is the first real consumer; the protected payload-free System activity page exposes lifecycle and recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | verified                              |
| 2026-08-11 | P1 event-path validation           | Migration 0022 down/up and 16 live PostgreSQL/Redis scenarios passed, including duplicate dispatch, ordering, stale publication recovery, poison handling, authorization, audit, and replay; OpenAPI/client drift, formatting, lint, all typechecks, 66 standard tests, NestJS and all three Vite production builds passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | passed                                |
| 2026-08-11 | P1 employee password change        | Migration 0023 adds bounded recent-password history; authenticated policy and change endpoints enforce current-credential verification, configured complexity/reuse/expiration, sensitive throttling, other-session revocation, and secret-free audit evidence; the connected My access drawer supplies complete recovery states                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | verified                              |
| 2026-08-11 | P1 password-change validation      | Migration 0023 rollback/reapply and all 14 live PostgreSQL/Redis authentication scenarios passed, including incorrect-current rejection, password reuse prevention, current-session continuity, other-session revocation, relogin, history pruning, and audit evidence; ERP/CRM passed 23 browser workflows; full repository validation passed OpenAPI/client drift, formatting, strict lint, all typechecks, 69 standard tests, NestJS and all three Vite production builds                                                                                                                                                                                                                                                                                                                           | passed                                |
| 2026-08-11 | P3 procurement receiving           | Migration 0024 and five protected API operations connect multiple-line purchase orders to partial/full goods receipts and atomic warehouse stock entry, including serial/batch/expiry evidence, BGN valuation, idempotency, audit, and outbox records; the ERP procurement workspace exposes order, comparison, and receipt workflows                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | verified foundation                   |
| 2026-08-11 | P3 procurement validation          | Migration 0024 rollback/reapply and two isolated live PostgreSQL scenarios verified permissions, references, idempotent ordering/receiving, partial/full status, over-receipt rejection, ordinary and serial inventory entry, linkage, audit, and outbox evidence; the ERP/CRM browser suite passed 24 workflows; full repository validation passed contract drift, formatting, strict lint, all typechecks, 70 standard tests, NestJS, and all three Vite production builds                                                                                                                                                                                                                                                                                                                           | passed                                |
| 2026-08-11 | P3 supplier procurement            | Migration 0025 adds versioned commercial terms, immutable 1–5 evaluation history, supplier-scoped invoice evidence and lines, receipt-line claims, and append-only claim status history; nine protected API operations and a navigable preview-first ERP workspace complete supplier register, three-way quantity comparison, claims, and linked delivery evidence                                                                                                                                                                                                                                                                                                                                                                                                                                     | verified                              |
| 2026-08-11 | P3 supplier procurement tests      | Migration 0025 rollback/reapply and three isolated live PostgreSQL/Redis scenarios verify authorization, versioning, idempotency, partial/full receipts, invoice matching, duplicate protection, over-claim rejection, status transitions, audit, and outbox evidence; the ERP/CRM browser suite passes 25 workflows including visible hub navigation, preview/back, term editing, and invoice entry                                                                                                                                                                                                                                                                                                                                                                                                   | passed                                |
| 2026-08-11 | P3 supplier procurement validation | Full repository validation passed OpenAPI/generated-client drift, formatting, strict lint, every workspace typecheck, 71 standard tests, the NestJS production build, and all three Vite production builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | passed                                |
| 2026-08-12 | Cross-app record-panel review      | ERP/CRM record drawers, forms, actions, copy, responsive behavior, and preview/back patterns were audited; every nested workspace page now has a consistent module-aware previous-page control with a safe direct-entry fallback; the supplier register and preview were simplified with a narrower readable panel, calm sections, aligned fields, stable actions, and mobile stacking; POS and backup retain their separate purpose-specific navigation                                                                                                                                                                                                                                                                                                                                               | verified                              |
| 2026-08-12 | Cross-app UI stabilization         | Shared token aliases, responsive navigation, mobile table/card layouts, module labels, plain business copy, and Back/close controls were repaired across the current ERP/CRM, POS, and backup route families; populated and empty-state Chromium gates at desktop, tablet, and phone widths found no page overflow or clipped drawer controls; full validation passed OpenAPI/client drift, formatting, strict lint, every typecheck, 72 standard tests, NestJS, and all three Vite builds                                                                                                                                                                                                                                                                                                             | passed                                |
| 2026-08-12 | P3 connected sales chain           | Migration 0026, seven protected Sales API operations, generated contracts/client, and a connected ERP workflow carry quotation through confirmed order, shipment, and invoice draft with validity, line/overall discount, fixed VAT totals, exact serial reservation, batch-aware stock issue, idempotency, audit, outbox, continuous preview, stage timeline, and Back navigation; legal Finance issuance remains explicitly pending                                                                                                                                                                                                                                                                                                                                                                  | verified foundation                   |
| 2026-08-12 | P3 sales-chain validation          | Migration 0026 rollback/reapply and two isolated live PostgreSQL/Redis scenarios passed authorization, reference data, retry replay, reservation/serial/batch/stock integrity, totals, audit, and outbox checks; all 95 non-health endpoints have audited throttling policies; the ERP browser suite passed 26 workflows; full validation passed OpenAPI/client drift, formatting, strict lint, all typechecks, 72 standard tests, NestJS, and all three Vite builds                                                                                                                                                                                                                                                                                                                                   | passed                                |
| 2026-08-12 | P3 sales pricing                   | Migration 0027, eleven protected pricing operations, generated contracts/client, and the responsive Prices & promotions workspace connect reusable customer groups, promotional periods, all/group/customer price lists, optimistic maintenance, and deterministic date/currency/priority/specificity resolution; quotations can explicitly apply the result without locking commercial edits                                                                                                                                                                                                                                                                                                                                                                                                          | verified                              |
| 2026-08-12 | P2 category-policy UI              | Product-category creation now captures quantity-only, unique-serial, or batch tracking policy; expiry is available only for batches and the saved hierarchy exposes the policy, closing the catalog-to-inventory setup gap without introducing client-specific defaults                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | verified                              |
| 2026-08-12 | P3 pricing validation              | Migration 0027 rollback/reapply and three isolated live PostgreSQL/Redis sales scenarios passed permission, idempotent replay, version conflict, precedence, inactive campaign fallback, currency isolation, audit, and outbox checks; all 106 non-health endpoints have explicit risk policies; the ERP browser suite passed 27 workflows; Chromium inspection at 1440×900 and 390×844 found no page, list, line, or drawer overflow; full validation passed OpenAPI/client drift, formatting, strict lint, all typechecks, 73 standard tests, NestJS, and all three Vite builds                                                                                                                                                                                                                      | passed                                |
| 2026-08-12 | P3 subscriptions and handover      | Migration 0028, five protected subscription operations, shipment-derived handover certificates, customer acceptance, and a production-registered timezone-aware recurring-billing schedule connect customer locations and installed equipment to visit coverage, fixed recurring prices, immutable billing drafts, serial evidence, audit, and outbox records; the responsive Sales workspace provides create, edit, preview, Back, and billing-history flows                                                                                                                                                                                                                                                                                                                                          | verified                              |
| 2026-08-12 | P3 subscriptions validation        | Migration 0028 rollback/reapply and four isolated live PostgreSQL/Redis sales scenarios passed authorization, command replay, optimistic conflict, recurring draft generation and replay deduplication, price snapshots, schedule advancement, shipment/serial/stock integrity, handover acceptance, audit, and outbox checks; a two-scenario live Redis queue suite proved replayed schedule registration creates one scheduler and each run has a retry-stable scope; all 112 non-health endpoints have explicit risk policies; the ERP browser suite passed 28 workflows; Chromium inspection at 1440×900 and 390×844 found no page or drawer overflow; full validation passed OpenAPI/client drift, formatting, strict lint, all typechecks, 77 standard tests, NestJS, and all three Vite builds  | passed                                |
| 2026-08-14 | P3 finance collection foundation   | Migration 0029, seven protected Finance endpoints, generated OpenAPI/client, BGN collection records, exact partial allocations, internal payment references, cancellation protection, audit/outbox evidence, and a timezone-aware overdue scheduler provide a bounded collection workflow from an existing Sales invoice draft. The connected Finance workspace carries normal navigation through add-to-collections, record preview, payment entry, Back, and payment allocations. Legal/fiscal issuance, BNB/VAT/accounting posting, bank matching/import, notifications, vouchers, reports, and exports remain explicitly pending.                                                                                                                                                                  | verified foundation                   |
