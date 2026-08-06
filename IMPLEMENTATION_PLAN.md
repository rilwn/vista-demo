# Vista Integrated Information System — Implementation Plan

Status date: 2026-08-06
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

| Phase                                     | Status      | Current milestone                                                          |
| ----------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| 0. Discovery and decisions                | in progress | Plan, decision register, and traceability baseline                         |
| 1. Platform foundation                    | in progress | P1.4 authenticated UI and first domain workflow verified                   |
| 2. ERP master data and warehouse          | in progress | Canonical partner registry vertical slice implemented and verified         |
| 3. Procurement, sales, finance, logistics | not started | Depends on Phase 2 master data and stock integrity                         |
| 4. Service                                | not started | Depends on partners, equipment, warehouse, finance, and notifications      |
| 5. CRM                                    | not started | Depends on shared master data, identity, service correlation, and outbox   |
| 6. POS                                    | not started | Depends on catalog, inventory, pricing, finance, identity, and adapters    |
| 7. POS offline mode                       | not started | Depends on a stable online POS protocol and target fiscal-device behavior  |
| 8. Backup and disaster recovery           | not started | Discovery proceeds in Phase 0; build depends on approved plan and hardware |
| 9. Hardening and handover                 | not started | Depends on all mandatory functional phases                                 |

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
- Secret-free environment examples, startup validation, one-command local start,
  and CI validation.

Acceptance criteria:

- A clean install produces a lockfile and all workspace builds pass.
- Local infrastructure has health checks and no committed credentials intended
  for production use.
- Every frontend is independently buildable and visibly identifies its module.
- CI runs formatting verification, linting, type checking, tests, and builds.

#### P1.2 API operational foundation

Status: `in progress`.

Implemented in the current slices: fail-fast shared environment validation;
versioned API routes; runtime and build-time OpenAPI generation; correlation IDs;
stable error envelopes; CORS and development/production HSTS behavior; structured
redacted request/event logging; configuration-driven in-process rate limiting;
separate liveness and PostgreSQL/Redis/private-bucket readiness; checksummed
advisory-lock migration runner with tested rollback; initial platform schemas;
and a lazy Redis queue abstraction with stable idempotent job IDs, bounded retry,
exponential backoff, retained results, safe event logs, and state telemetry. Still
required before this milestone is complete: worker execution/handler lifecycle,
protected operations metrics, a deployment-selected distributed throttling store,
generated contract clients, and broader endpoint-specific controls.

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
chain-enforcement trigger. Integration tests cover failed/successful login,
lockout, expiration, session revocation, permission denial, administrative TOTP,
audit capture, chain linkage, mutation rejection, and requester self-approval
rejection. Still required: protected factor enrollment/provisioning and recovery,
password change/reset, account/role administration and approved role seeds,
session-administration/revoke-all behavior, audit query/integrity-verification
services, central identity adapters, and factor/account administration UI after
`IAM-001`/`IAM-002` decisions. API-backed login, TOTP challenge, session, and
effective-access views are implemented.

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
deterministic creation/readiness validation of a private local MinIO bucket. No file
upload/download adapter, scanning, email, SMS, job handler, parent-authorization,
metrics exporter, production monitoring adapter, POS operational UI, or backup
operational UI is yet claimed complete. The first domain-backed ERP/CRM workflow,
the shared partner registry, is implemented under Phase 2.

- S3-compatible file adapter with type/size validation, quarantine/scan hook,
  versioned metadata, and inherited parent authorization.
- Queued, retryable, observable, idempotent in-system and email notifications;
  SMS capability is included for backup alerts behind an adapter.
- Shared accessible, responsive UI primitives, externalized UI text, loading,
  empty, success, validation, and failure states.
- Metrics, logs, alert hooks, and operational runbooks.

Acceptance criteria:

- Adapter contract tests cover failures, retries, and idempotent replay.
- Unauthorized attachment reads fail in the backend.
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
detail drawer, create workflow, empty/loading/failure states, and controlled
duplicate warning. Remaining Phase 2 scope includes the full partner detail
relationships, locations, branches, products, equipment, warehouses, inventory,
costing, reservations, alerts, recommendations, and serial traceability. Partner
edit/delete/merge behavior remains unimplemented pending controlled-resolution
policy; the current API cannot silently merge or delete records.

Scope: unified partners/customers/suppliers, legal entities and individuals,
contacts, addresses, bank accounts, customer locations, branches, products,
hierarchical categories, units, barcodes, equipment/devices, unlimited warehouses
including technician warehouses, serialised items, batches, expiration dates,
stock balances/movements, receipts/issues/transfers/write-offs, reservations,
stocktake, weighted-average and optional FIFO valuation, minimum stock, alerts,
purchase recommendations, and end-to-end serial traceability.

Dependencies: Phase 1, approved location/warehouse model, category/serialization
rules, costing policy, and initial access roles.

Acceptance criteria:

- ERP is the single operational source for shared master data; duplicate partner
  detection warns on UIC/company name and never silently merges.
- Constraints and transactions prevent duplicate serials, a serial sold twice,
  negative/double-counted inventory, or movements missing source, warehouse,
  quantity, actor, or timestamp.
- Reservations for orders, quotations, and service requests are concurrency-safe.
- Traceability reports show supplier, receipt date, customer sale, and repair
  technician; all material changes are authorized and audited.
- Weighted-average behavior and optional FIFO behavior have executable tests.

### Phase 3 — Procurement, sales, finance, and logistics

Status: `not started`

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

Status: `not started`

Scope: telephone/email/portal/on-site requests; work orders with customer,
location, serialised device, problem, and warranty/out-of-warranty/subscription
type; technician assignment, calendar and workload; responsive technician views;
parts, time, photos, signatures; transactional technician stock deduction; labor,
parts, transport costing; payment documents; full serial service history; warranty
period/claim monitoring; mandatory technical/metrological inspection reminders;
subscription-generated visits; route planning and reverse-logistics integration.

Dependencies: Phases 1–3 and approved labor/transport costing, warranty,
inspection, subscription, signature, and scheduling rules.

Acceptance criteria:

- Authorized, audited workflows preserve sale, visits, repairs, work, parts,
  technician, and dates for each serial number.
- Parts consumption atomically updates the correct technician warehouse.
- Required schedules are idempotent and retry-safe.
- The complete service end-to-end scenario passes on desktop and mobile viewports.

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

| Date       | Milestone                | Evidence                                                                                                                                   | Result                             |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| 2026-08-05 | Repository baseline      | Only `AGENTS.md`; no usable Git worktree or implementation files                                                                           | confirmed                          |
| 2026-08-05 | Specification read       | All 1,320 lines of `AGENTS.md` reviewed before implementation                                                                              | confirmed                          |
| 2026-08-05 | Phase 0 baseline         | Living plan, decision register, ADR-0001, and full section-level traceability                                                              | implemented                        |
| 2026-08-05 | P1.1 monorepo            | Lockfile, NestJS, three Vite apps, five shared packages, Compose, CI, and foundation docs                                                  | implemented, not accepted          |
| 2026-08-05 | P1.2 API slice           | Live readiness reported PostgreSQL/Redis up; OpenAPI emitted; API E2E passed                                                               | implemented, incomplete            |
| 2026-08-05 | P1.2 migration           | Foundation migration applied; invariants passed; down succeeded; up reapplied                                                              | verified                           |
| 2026-08-05 | Repository validation    | Format, lint, all typechecks, 18 tests, and all production builds passed                                                                   | passed                             |
| 2026-08-05 | Dependency audit         | `js-yaml` advisory remediated with 5.2.3 override; production audit reports zero findings                                                  | passed                             |
| 2026-08-06 | P1.2 runtime controls    | Redaction unit test, request logging, throttling E2E, safe 429 envelope                                                                    | verified                           |
| 2026-08-06 | P1.2 storage/jobs        | Private MinIO bucket probe and Redis stable-ID replay/deduplication integration tests                                                      | verified, worker pending           |
| 2026-08-06 | P1.2 dependency health   | Live readiness reported PostgreSQL, Redis, and private object storage up                                                                   | verified                           |
| 2026-08-06 | Repository validation    | Format, lint, all typechecks, 25 tests including infrastructure, and all builds passed                                                     | passed                             |
| 2026-08-06 | Reproducibility checks   | OpenAPI emitted; migration down/up passed; production dependency audit found zero issues                                                   | passed                             |
| 2026-08-06 | P1.3 authentication      | Scrypt, lockout/expiry, Redis sessions, RBAC denial, admin TOTP, and logout E2E                                                            | verified, admin APIs pending       |
| 2026-08-06 | P1.3 audit chain         | Serialized writer, chain-head trigger, linked-event and append-only integration tests                                                      | verified, query service pending    |
| 2026-08-06 | P1.3 validation          | Format, lint, all typechecks, 44 tests including live infrastructure, and all builds                                                       | passed                             |
| 2026-08-06 | P1.3 reproducibility     | Opaque-bearer OpenAPI emitted; migration 0002 down/up passed; production audit found zero                                                  | passed                             |
| 2026-08-06 | P1.4 ERP/CRM UI          | Login/TOTP, session restore/logout, protected routes, permission navigation, responsive QA                                                 | verified, domain pages next        |
| 2026-08-06 | P1.4 validation          | Format, lint, all typechecks/builds, 48 tests with infrastructure, and zero production audit findings                                      | passed                             |
| 2026-08-06 | P2 partner API           | Migration 0003; authorized list/get/create; duplicate blocking; idempotency; atomic audit/outbox; 7 live integration tests                 | verified, detail relations pending |
| 2026-08-06 | P2 partner UI            | Real `/partners` registry, filters, responsive table/cards, detail/create drawers, duplicate and recovery states; 8 browser-behavior tests | verified                           |
| 2026-08-06 | P2 responsive QA         | Chromium screenshots at 1440×1000 and 390×844 using isolated non-persistent API fixtures                                                   | passed                             |
| 2026-08-06 | P2 reproducibility       | Migration 0003 rollback/reapply passed; OpenAPI includes filters, create body, retry header, and response schemas                          | passed                             |
| 2026-08-06 | P2 repository validation | Format, lint, all typechecks, 58 tests including live infrastructure/database invariants, and all production builds                        | passed                             |
| 2026-08-06 | P2 dependency audit      | Production dependency audit reported zero vulnerabilities                                                                                  | passed                             |
