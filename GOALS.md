# Vista — Temporary Delivery Goals

This is a short-lived execution backlog for the remaining core work. It is a
navigation aid only: [AGENTS.md](AGENTS.md) is the authoritative specification,
and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) is the permanent delivery,
decision, evidence, and acceptance record.

## Rules for using this file

- Every bullet below is pending work. Completed work must not remain here.
- Work strictly from the first actionable bullet in the earliest phase. Phase 0
  governance continues in parallel and does not block reversible work that is not
  controlled by an unresolved decision.
- A later item may be taken first only when the user explicitly reprioritizes it.
  Record that exception in `IMPLEMENTATION_PLAN.md`, then return to the first
  actionable bullet.
- Treat each bullet as one end-to-end vertical slice: include its API/database,
  UI/UX, authorization, audit/outbox, documentation, and tests where applicable.
- Once a bullet meets the permanent plan's acceptance criteria, record its
  evidence and unresolved decisions in `IMPLEMENTATION_PLAN.md`, then delete the
  bullet from this file immediately. Delete an empty phase heading as well.
- Optional requirements remain disabled unless selected. Decisions that control
  irreversible legal, financial, security, hardware, retention, or merge behavior
  remain in the permanent decision register.

## 0. Continuous discovery and decisions

- Obtain approved answers or owners/target dates for topology, tax/numbering,
  timezone, accounting/bank formats, SLA/warranty/subscription rules, identity,
  integrations, fiscal/PIN-pad/scanner hardware, deployment, and backup/DR
  inventory and hardware.
- Obtain management approval for the Information Backup Plan, classifications,
  RPO/RTO, retention, storage, verification, annual review, and change-review
  procedures before enabling destructive backup/retention behavior.
- Maintain architecture decisions and the traceability matrix.

## 1. Finish platform foundations

### API and platform

- Generate and version API contract clients for the frontend applications.
- Deliver employee password change end to end.
- Deliver controlled password reset end to end.
- Deliver protected 2FA enrollment and provisioning end to end.
- Deliver protected 2FA recovery end to end.
- Add approved production role seeds and password/security policy values after
  `IAM-001` and `IAM-002` are resolved.
- Add approved central-identity adapters after `IAM-001` and `IAM-002` are
  resolved.
- Deliver secure file upload with type/size validation, quarantine/scanning hooks,
  versioned metadata, and inherited parent authorization.
- Deliver authorized file preview and download.
- Deliver queued email through an approved retryable, observable, idempotent
  provider adapter.
- Deliver queued backup SMS through an approved retryable, observable, idempotent
  provider adapter.
- Add production metrics and monitoring/alerting hooks.
- Complete platform operating runbooks.

### UI/UX

- Keep responsive, keyboard-accessible loading, empty, validation, error, and
  recovery states complete as each remaining workflow is delivered.

## 2. Finish ERP master data and warehouse

- Implement controlled partner duplicate resolution only after the permanent
  `CRM-002` authority/evidence/precedence decision; never silently merge or hard
  delete records.
- Keep FIFO costing disabled unless selected; if selected, implement its rules,
  accounting effects, migrations, UI, and tests before enabling it.
- Extend lifecycle and integrity coverage as later documents link to master data,
  preserving immutable identifiers, audit history, and source evidence.

## 3. Procurement, sales, finance, logistics, and reporting

### API and database

- Deliver the supplier register and supplier evaluation.
- Deliver purchase orders and partial/full goods receipts with automatic warehouse
  receipts.
- Deliver ordered-versus-delivered-versus-invoiced comparison.
- Deliver supplier claims and supplier invoices with complete delivery history.
- Deliver quotations with validity and line/overall discounts.
- Deliver confirmed sales orders and quantity/serial reservations.
- Deliver shipments and equipment handover/acceptance certificates.
- Deliver price lists, promotions, customer-group pricing, and individual pricing.
- Deliver service subscription contracts and recurring invoices.
- Deliver VAT-compliant sales invoices and proformas with conversion after payment.
- Deliver linked credit notes, debit notes, POS/fiscal receipts, and source-document
  relationships.
- Deliver concurrency-safe numbering by branch/location, register, and operator.
- Deliver BGN accounting and stored BNB currency-rate snapshots.
- Deliver printable PDFs and authorized email delivery with logo/signature support.
- Deliver partial payment allocation, outstanding balances, overdue state, and
  upcoming/overdue notifications.
- Deliver cash receipt/payment vouchers and daily cash reports.
- Deliver Bulgarian bank statement import/manual entry and transaction matching.
- Deliver advances, compensation/offsets, and payment allocation to accounting
  items.
- Deliver receivables, payables, aging, turnover, sales/purchase journals, VAT
  reports, and accounting exports.
- Deliver company-transport and courier deliveries.
- Deliver Econt and Speedy shipment adapters after providers are approved.
- Deliver reverse logistics with stable service-request correlation.
- Deliver calendar route planning for technicians and deliveries.
- Deliver controlled asynchronous Excel, CSV, and PDF exports.

### ERP/CRM UI/UX

- Connect each Phase 3 workflow to its existing ERP/CRM screen as its vertical
  slice is delivered; replace disabled affordances with authorized working states.
- Complete standard and configurable report screens with filters, reproducible
  definitions, queued downloads, responsive layouts, and recovery states.

## 4. Service module

### API and database

- Deliver service intake for telephone, email, portal, and on-site channels.
- Deliver service work orders with customer, location, device/serial, problem, and
  warranty/out-of-warranty/subscription service type.
- Deliver technician assignment, scheduling, calendar, and workload management.
- Deliver technician time, part usage, photo, and customer-signature capture.
- Deliver automatic technician-warehouse deduction and labor/parts/transport cost
  calculation with payment-document links.
- Deliver full serial-number service history.
- Deliver warranty monitoring and warranty-claim history.
- Deliver periodic fiscal-device and scale inspection scheduling/reminders.
- Deliver subscription-generated visits and route planning.
- Complete reverse-logistics integration with service requests.

### UI/UX

- Connect the service intake, work-order, dispatch, calendar, and workload screens.
- Connect responsive technician screens for assigned/completed work, parts, time,
  photos, and customer signatures.
- Connect device history, warranty, inspection, and subscription screens.

## 5. CRM completion

### API and database

- Deliver customer/location timelines for calls, email, chat, visits, and tasks.
- Deliver assigned tasks, reminders, due dates, priorities, and authorized
  interaction attachments.
- Deliver lead registration, qualification, and conversion to customer/opportunity.
- Deliver opportunities, pipeline stages, and audited backend-validated Kanban
  transitions.
- Deliver tickets with generated numbers, channels, priorities, and categories.
- Deliver customer/contract SLA timers, risk alerts, and escalation procedures.
- Deliver idempotent two-way CRM ticket/ERP service-request correlation.
- Deliver automatic warranty cards, expiry reminders, and extended-warranty or
  subscription offers.
- Deliver warranty claims with photos/documents and the required status workflow.
- Deliver post-service/delivery surveys, NPS trends, and referrals.
- Deliver reproducible CRM analytics with documented formulas, windows, filters,
  and sources.
- Deliver ERP/CRM synchronization for partners, locations, equipment, documents,
  and payments.
- Deliver POS customer recognition and purchase-history enrichment.
- Deliver protected APIs for approved external enterprise systems.

### UI/UX

- Connect customer timelines and task/reminder screens.
- Connect lead and opportunity Kanban screens.
- Connect ticket desk and SLA risk/escalation screens.
- Connect warranty, feedback, referral, analytics, dashboard, and export screens.
- Customer portal only if selected and approved.

## 6. POS online terminal

### API, hardware, and synchronization

- Deliver real-time ERP/POS catalog, stock, price, and promotion synchronization.
- Deliver POS/CRM customer recognition and purchase-history synchronization.
- Deliver barcode-scanner, certified fiscal-device, and PIN-pad adapters with CI
  test doubles.
- Complete target-hardware acceptance tests for scanner, fiscal device, and PIN
  pad after hardware selection.
- Deliver multiple registers/operators and concurrency-safe POS document sequences.
- Deliver fiscal receipts and invoice-from-receipt with bidirectional links.
- Deliver mandatory available-serial capture, sale association, and warranty-card
  generation/printing.
- Deliver recoverable idempotent payment, fiscalization, inventory, document, and
  accounting posting.
- Deliver cash, bank-card, on-account, split, advance, balance, and change handling.
- Deliver linked returns, fiscal reversal, inventory return, and service-warehouse
  routing with authorized exceptions only if approved.
- Deliver role-controlled manual discounts, bundle/quantity pricing, and ERP
  corporate pricing.
- Deliver loyalty identification, cards, points accrual/redemption, and an auditable
  points ledger.
- Deliver POS shift, cashier, X/Z, product/category/payment/time/location, and
  comparative reports with controlled exports.

### POS UI/UX

- Connect the keyboard/touch cashier terminal for scan/search/quick access, basket,
  customer, serial capture, split payment, change, and receipt completion.
- Connect shift open/close, cash count, returns, loyalty/corporate payment, and POS
  reports.
- Connect clear hardware and synchronization status with actionable recovery states.

## 7. POS offline operation

- Deliver the durable local transaction store and stable client-generated IDs.
- Deliver the outbound queue, automatic reconnect synchronization, and duplicate
  replay protection.
- Deliver explicit reconciliation rules for price, stock, customer, serial,
  promotion, and numbering conflicts.
- Connect offline/unsynchronized indicators, reconciliation queue, actionable
  rejections, and cashier recovery guidance.
- Test reconnect, interrupted sync, duplicate replay, stale prices, unavailable
  serials, and server rejection.
- Test and certify offline fiscal behavior on the selected target hardware before
  claiming offline readiness.

## 8. Backup and disaster recovery

### API, infrastructure, and security

- Deliver the approved source inventory, classification, RPO/RTO, policy, schedule,
  retention, storage-target, responsibility, and verification model.
- Deliver full, incremental, differential, database-snapshot, and image-based job
  orchestration for approved sources.
- Deliver deduplication, compression, job journaling, restore-point state,
  verification, and success/failure/missed-backup alerts.
- Deliver encryption and ransomware protection with approved air-gap, tape, or
  separate-network handling.
- Deliver separate backup identities, MFA, operator/administrator/security-officer
  roles, and directory mapping where available.
- Deliver four-eyes approval for restore-point deletion, retention reduction, job
  disabling, and destructive restores.
- Deliver restore requests, approval, execution, audit, and evidence workflows.
- Deliver granular database-record, email, and file restore.
- Deliver database, entire-server, bare-metal-to-different-hardware, and entire-
  infrastructure restore procedures and execution.
- Perform and document the implementation-time DR test with signed evidence, RTO/
  RPO results, non-conformities, and corrective actions.
- Deliver annual plan-review and DR-test reminders.
- Validate actual storage-server/tape capacity, rotation, off-site/air-gap handling,
  encryption, ownership, maintenance, and restore compatibility after selection.

### Backup-control UI/UX

- Connect source inventory, classification, policy, schedule, storage, and retention
  screens.
- Connect job, snapshot, verification, error, alert, and audit screens.
- Connect restore request, approval, execution, and evidence screens.
- Connect DR test, incident role, compliance, annual review, and access-management
  screens.

## 9. Hardening, deployment, and handover

- Complete SRS end-to-end and concurrency test suites.
- Complete performance, security, migration, and external-integration test suites.
- Complete fiscal-device, PIN-pad, scanner, backup, tape, and disaster-recovery
  acceptance tests.
- Complete production deployment with TLS/HSTS, secret handling, monitoring, and
  vulnerability scanning.
- Complete the security review and remediate findings.
- Complete operating runbooks, user guides, and built-in help.
- Complete user training and project handover.
- Reconcile every mandatory `AGENTS.md` requirement in the traceability matrix.
- Record the approved disposition of every optional feature.
