# Vista Integrated Information System — Remaining Implementation Plan

Status date: 2026-09-02
Project: `BG16RFPR001-1.012-1324-C01`

[`AGENTS.md`](AGENTS.md) is authoritative. This file contains only unfinished
mandatory work, its dependencies, acceptance criteria, and unresolved decisions.
Implementation evidence belongs in the requirement traceability, tests, and
relevant technical documentation—not here.

## Delivery controls

- Keep the system runnable after every milestone.
- For each remaining feature, deliver the data model, protected API,
  authorization, audit trail, retry/idempotency and concurrency behavior,
  OpenAPI/contracts, responsive user interface, tests, documentation, and
  traceability together.
- User-facing workflows must have clear loading, empty, validation, failure,
  success, and return-navigation states on desktop, tablet, and phone viewports.
- Do not enable fiscal, hardware, provider, retention, destructive, or other
  decision-controlled behavior until its recorded decision is approved.
- Optional FIFO, customer portal, kiosk, backup router, electronic shelf labels,
  and e-commerce fiscalization remain disabled unless selected.

## Delivery order

1. Phase 0 runs continuously and unblocks irreversible decisions.
2. Complete the remaining shared platform services before depending on them in
   ERP, CRM, POS, or Backup workflows.
3. Close the remaining ERP/finance/logistics requirements before cross-module
   CRM and POS completion.
4. Deliver POS online operation before offline operation.
5. Complete Backup/DR against the approved inventory and hardware, then harden,
   deploy, and hand over the whole system.

## Phase 0 — Decisions, backup plan, and traceability

**Remaining**

- Obtain approved answers, or an owner and target date, for every open business,
  provider, hardware, security, backup, and deployment decision.
- Complete the inventory of approved backup sources; classify them as Critical,
  Important, or Standard; define RPO/RTO; and obtain management approval for the
  Information Backup Plan.
- Maintain architecture decisions and full requirement traceability through
  handover.

**Depends on:** business owners, management, finance, operations, vendors, and
infrastructure/security owners.

**Accept when:** controlling decisions are approved or explicitly owned; the
backup plan is management-approved before retention or destructive behavior is
enabled; every requirement remains traceable.

## Phase 1 — Complete platform foundations

**Remaining**

- Apply approved role assignments, password-policy values, and
  non-administrator 2FA policy.
- Deliver approved AD, LDAP, Entra ID, SAML, and OAuth/OIDC adapters and group
  mapping.
- Complete the approved production storage, encryption, retention, malware-scan,
  and quarantine policy, plus managed attachments for financial documents and
  other remaining approved record types.
- Deliver approved email and backup-SMS adapters, notification preferences,
  retry/reconciliation behavior, monitoring, alert hooks, and operational
  runbooks.

**Depends on:** IAM-001, IAM-002, IAM-003, FILE-001, INT-001, and DEP-001.

**Accept when:** shared controls are backend-enforced and audited; adapter
failure/retry/idempotency tests pass; production configuration contains no
development-only credentials or behavior.

## Phase 2 — Close ERP master-data and warehouse gaps

**Remaining**

- Deliver the approved controlled partner duplicate-resolution process, including
  authority, evidence, field precedence, linked-record migration, and source
  record retention. Never silently merge records.
- Apply approved production organization, location, warehouse, operator, cash
  register, category, unit, product-code, barcode, and tracking-policy data
  without inventing client rules.
- Enable FIFO only if selected, with separate valuation, migration, concurrency,
  and reporting acceptance.

**Depends on:** BUS-001, BUS-002, CAT-001, CRM-002, OPT-001, and the approved
costing policy.

**Accept when:** ERP remains the authoritative shared master-data source;
duplicate, stock, reservation, and valuation invariants are proven under
concurrency; no production topology or tracking rule is inferred.

## Phase 3 — Complete finance, documents, logistics, and ERP reporting

**Remaining**

- Complete approved legal financial-document issuance: official invoices,
  proforma conversion, official credit/debit notes, scoped numbering, legally
  required states and fields, approved VAT/accounting treatment, automatic BNB
  rates, fiscal/POS links, PDF with approved logo/signature, and email delivery.
- Complete approved bank statement format adapters, payment reversal,
  period-close cash controls, accounting posting, and provider-backed email
  delivery for payment reminders.
- Approve and complete official sales/purchase journal and VAT filing outputs
  from the operational review foundation; deliver structured accounting exports,
  user-configurable controlled report definitions, and the required revenue,
  Service, warranty, and receivables dashboard KPIs. Extend asynchronous exports
  to every required module report.
- Connect the approved Econt and Speedy booking, label, tracking, return,
  retry, and reconciliation adapters. Keep both providers unavailable until
  INT-002 supplies the selected products, credentials, environments, and
  operating rules.

**Depends on:** FIN-001, FIN-002, FIN-003, DOC-001, INT-001, INT-002, BUS-002,
and the approved business timezone.

**Accept when:** posted documents are immutable and linked; sequences,
allocations, taxes, rates, exports, and integration recovery are tested; the
procurement-to-accounting and quotation-to-payment scenarios pass end to end.

## Phase 5 — Complete CRM

**Remaining**

- Deliver the customer portal only if selected.
- Deliver the approved external enterprise CRM APIs and reconciliation adapters.

**Depends on:** SLA-001, CRM-001, CRM-002, KPI-001, SVC-001, and the established
Service correlation rules.

**Accept when:** CRM does not create conflicting ERP-owned records; selected
optional and approved enterprise API paths pass.

## Phase 6 — Complete online POS

**Remaining**

- Connect approved fiscal, PIN-pad, and scanner hardware; issue certified H-18
  fiscal receipts; and deliver direct invoice creation from the linked receipt.
- Deliver PIN-pad card, corporate on-account, split, advance, and remaining-
  balance payments with recoverable payment/fiscal/document/stock coordination.
- Deliver linked returns, fiscal reversal, eligible stock/service routing,
  authorized manual discounts, approved bundle/quantity rules, and the loyalty
  points ledger.
- Complete shift, cashier, X/Z, product, category, payment, period, location,
  and cross-location reports with Excel, CSV, and PDF export.
- Keep unselected optional hardware and features disabled behind configuration.

**Depends on:** POS-001, POS-003, BUS-001, BUS-002, Phase 3 finance/documents,
and the established canonical ERP/CRM customer identity.

**Accept when:** no sale, fiscal effect, serial movement, payment, or integration
event can double-post; returns and discounts are authorized/audited; simulator
and target-hardware acceptance pass.

## Phase 7 — Complete POS offline operation

**Remaining**

- Deliver durable local transaction storage, stable client transaction IDs,
  outbound queueing, reconnect synchronization, idempotent server handling,
  reconciliation UI, and visible offline/unsynchronized state.
- Deliver approved conflict behavior for price, stock, customers, serials,
  promotions, numbering, and fiscal operation, with retry and reconciliation
  audit trails.

**Depends on:** stable online POS behavior, POS-002, and target fiscal hardware.

**Accept when:** reconnect, interruption, duplicate replay, stale price,
unavailable serial, server rejection, and reconciliation tests pass; no offline
readiness claim is made before certified target-hardware fiscal testing.

## Phase 8 — Complete Backup and disaster recovery

**Remaining**

- Build the custom centralized backup system for every approved source:
  databases, files, configurations, servers, workstations, mobile devices,
  email, file shares, cloud services, and other approved sources.
- Deliver policies, schedules, full/incremental/differential/image backups,
  snapshots, copies, retention, compression/deduplication, verification,
  notifications, journaling, restore-point state, and missed-backup detection.
- Deliver encryption, ransomware and air-gap protection, separate backup
  identity, MFA, role separation, critical-action four-eyes approval,
  centralized identity integration, and protected emergency access where
  approved.
- Deliver granular and bare-metal restore workflows, DR procedures, annual
  reminders, physical storage/tape integration, and a signed implementation-time
  DR test.

**Depends on:** BAK-001, BAK-002, BAK-003, BAK-004, BAK-005, IAM-002, IAM-003,
INT-001, DEP-001, and selected storage/tape hardware.

**Accept when:** backup/restore audit and critical-action controls are immutable;
all restore classes are documented and tested; the signed DR protocol proves RPO,
RTO, evidence, corrective actions, and actual hardware compatibility.

## Phase 9 — Hardening, deployment, and handover

**Remaining**

- Complete mandatory unit, integration, end-to-end, concurrency, simulator,
  hardware, recovery, performance, migration-rehearsal, and security tests.
- Complete TLS/HSTS deployment controls, dependency/container scanning,
  monitoring and alerting, deployment/rollback procedures, and client-owned
  infrastructure handover.
- Complete required architecture, API, database, environment, integration,
  hardware, backup, DR, operations, user-guide, built-in-help, training, and
  handover deliverables.
- Perform the final requirement-traceability review and explicitly record each
  optional feature as implemented or not selected.

**Depends on:** all mandatory phases, approved deployment target, and business
and hardware acceptance.

**Accept when:** all mandatory requirements and ten required end-to-end scenarios
are accepted; hardware/recovery evidence is complete; documentation, training,
and ownership handover are complete.

## Unresolved decisions

Full decision detail is maintained in
[`docs/architecture/decisions/README.md`](docs/architecture/decisions/README.md).

- Organization and master data: BUS-001, BUS-002, CAT-001, CRM-002, OPT-001.
- Finance, documents, and logistics: FIN-001, FIN-002, FIN-003, DOC-001,
  INT-002.
- Identity, files, providers, and deployment: IAM-001, IAM-002, IAM-003,
  FILE-001, INT-001, DEP-001.
- Service and CRM: SLA-001, CRM-001, KPI-001, SVC-001.
- POS: POS-001, POS-002, POS-003, OPT-001.
- Backup/DR: BAK-001, BAK-002, BAK-003, BAK-004, BAK-005.
- Formalize or supersede ADR-0001.
