# AGENTS.md

## 1. Purpose

This file is the authoritative implementation guide for AI coding agents working on the Vista Service integrated information system under Project No. `BG16RFPR001-1.012-1324-C01`.

The system serves Vista Service Ltd., Vratsa, a company that distributes and services:

- Electronic cash registers with fiscal memory
- Electronic weighing scales
- Fuel sales reporting systems
- Related consumables and spare parts

The complete scope consists of four interconnected deliverables:

1. ERP system
2. CRM system
3. POS system
4. Custom information backup and disaster-recovery system

The SRS is the source of truth. Do not omit, weaken, reinterpret, or contradict a documented requirement. When a requirement is unclear, preserve it in the backlog, record the ambiguity, and ask for a business decision before implementing irreversible behavior.

## 2. Development Environment

Primary local environment:

- OS: Linux, Parrot OS
- Project root: `/home/rilwanu/Documents/projects/vista`
- Project memory: `/home/rilwanu/Documents/projects/vista/AGENTS.md`

Use Linux-compatible scripts, paths, tooling, containers, and documentation. Do not assume Windows-only development tools.

## 3. Non-Negotiable Technology and Architecture

### 3.1 Required stack

- Backend: Node.js, NestJS, TypeScript
- Frontend: React, Vite, TypeScript
- Primary database: PostgreSQL
- Cache and transient data: Redis for sessions, baskets, and temporary data
- Optional object/file storage: S3-compatible storage such as MinIO or approved cloud storage
- API documentation: OpenAPI
- Source control: Git repository owned by Vista Service
- CI/CD: GitHub Actions, GitLab CI, or an equivalent pipeline with automated tests and deployment

TypeScript is mandatory across backend and frontend code.

### 3.2 Architectural principles

- Use a modular architecture.
- Keep ERP, CRM, POS, and backup capabilities as separate but integrated modules or services.
- Use an API-first approach.
- Separate backend and frontend using a headless architecture.
- Provide browser-based responsive interfaces for desktop, tablet, and POS terminal usage.
- Use unified integration points and shared master data.
- Keep the platform vendor-independent, maintainable, scalable, and suitable for future development by Vista Service or another team.
- Host on client-owned infrastructure and/or an approved cloud provider such as AWS, Azure, Google Cloud, Hetzner, or StorPool.

### 3.3 Default repository layout

Use the following monorepo layout unless the repository already establishes an equivalent structure:

```text
vista/
├── AGENTS.md
├── apps/
│   ├── api/                    # NestJS API and scheduled jobs
│   ├── erp-crm-web/            # React + Vite ERP and CRM interface
│   ├── pos-web/                # React + Vite POS interface with offline support
│   └── backup-control/         # Backup policy, orchestration, monitoring, and restore UI
├── packages/
│   ├── contracts/              # Shared API types, schemas, enums, and generated clients
│   ├── ui/                     # Shared UI components and design tokens
│   ├── auth/                   # Shared authorization helpers
│   ├── config/                 # Shared TypeScript, lint, test, and build configuration
│   └── domain/                 # Shared domain rules with no framework coupling
├── infrastructure/
│   ├── docker/
│   ├── deployment/
│   ├── backup/
│   └── monitoring/
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── database/
│   ├── deployment/
│   ├── backup/
│   ├── disaster-recovery/
│   └── user-guides/
└── tests/
    ├── integration/
    ├── e2e/
    ├── offline-sync/
    └── disaster-recovery/
```

The ERP and CRM may share one React application because they are closely integrated. The POS must remain a distinct application because it has cashier-specific workflows, hardware integration, and offline requirements. Technician mobile functions must be responsive web views unless a native application is separately approved.

### 3.4 Local development defaults

Unless the repository defines another standard:

- Use a workspace-aware package manager.
- Provide one-command local startup.
- Run PostgreSQL, Redis, optional MinIO, and supporting services through containers.
- Provide `.env.example` files without secrets.
- Validate environment variables at startup.
- Use database migrations and seed scripts.
- Make all build, test, lint, migration, and deployment commands reproducible from the repository.

## 4. Cross-System Rules

### 4.1 Master data and source of truth

The ERP is the primary operational data source for CRM and POS.

Use unified master data for:

- Products
- Product categories
- Business partners
- Customer and supplier records
- Business locations
- Equipment and serial numbers
- Prices and promotions
- Warehouses
- Documents
- Payments

CRM and POS must synchronize with ERP in real time where required. Avoid creating separate conflicting records in each system.

### 4.2 Shared identity and authorization

- One account per employee.
- Unified role-based access control across ERP, CRM, POS, and backup.
- Permissions must support module-level and action-level control:
  - View
  - Create
  - Edit
  - Delete
  - Approve
- Administrative roles require 2FA.
- 2FA may be enabled for other roles.
- Password controls must support complexity requirements and expiration policies.
- Backup roles must be separated into backup operator, backup administrator, and security officer.
- Apply the four-eyes principle to critical backup operations.

Never authorize sensitive actions using frontend checks alone. Enforce permissions in the backend.

### 4.3 Auditability

Keep tamper-resistant audit records for material actions, including:

- User
- Date and time
- Action
- Target object
- Document creation, modification, and deletion
- Serial-number movements
- System logins
- Backup and restore operations
- Policy deletion or modification
- Approval actions

Ordinary users must not be able to delete backup audit logs.

### 4.4 Time, money, tax, and numbering

- Store monetary values using fixed-precision decimal types, never floating point.
- Accounting is maintained in BGN.
- Support multiple currencies using automatic Bulgarian National Bank exchange rates.
- Store the rate, rate date, source, and converted BGN amount used for every posted document.
- Support VAT treatments: 20%, 9%, 0%, exempt, and intra-community acquisition.
- Preserve links between source, correction, fiscal, accounting, and payment documents.
- Use separate automatic numbering sequences by branch/location, cash register, and operator.
- Number allocation must be concurrency-safe and auditable.
- Store timestamps consistently and display them in the business timezone.
- Never silently recalculate posted financial documents after rates, prices, or tax settings change.

### 4.5 Documents and files

- Generate printable PDF documents with the company logo and signature where required.
- Support email delivery of applicable documents.
- Store document metadata, version, issuer, timestamps, source links, and status.
- Use secure object storage or controlled filesystem storage.
- Validate file type and size.
- Scan or quarantine untrusted uploads where infrastructure permits.
- Attachments must inherit the authorization rules of their parent record.

### 4.6 Notifications

Support in-system and email notifications where specified. Backup notifications must support email and SMS.

Notification processing must be queued, retryable, observable, and idempotent.

### 4.7 External integrations

Implement integrations behind adapters with explicit error handling, retries, idempotency, logs, and reconciliation:

- Bulgarian National Bank exchange rates
- Bulgarian bank statement formats
- Email
- Econt
- Speedy
- Fiscal devices certified under Bulgarian Ordinance H-18
- PIN pad/card terminal
- Barcode scanners
- Optional Electronic Shelf Labels
- Optional e-commerce fiscalization
- Central identity services:
  - Active Directory
  - LDAP
  - Azure AD/Entra ID
  - SAML
  - OAuth 2.0/OIDC
- External enterprise systems through APIs

Do not hardcode a single vendor protocol into domain logic.

## 5. Core Domain Model

Design the schema around explicit entities and relationships. At minimum, cover:

- User, role, permission, employee, authentication factor, login session
- Branch, business location, cash register, operator
- Customer, supplier, partner, legal entity, individual, contact person, address, bank account
- Customer location, responsible contact, contract, SLA
- Product, category, unit, barcode, serialised item, batch, expiration date
- Warehouse, technician warehouse, stock balance, stock movement, reservation, stocktake
- Supplier evaluation, purchase order, goods receipt, supplier claim, supplier invoice
- Quotation, sales order, shipment, handover certificate, price list, promotion
- Invoice, proforma invoice, credit note, debit note, fiscal receipt, VAT line, currency rate
- Payment, payment allocation, cash voucher, bank statement, bank transaction, advance, offset
- Device, warranty, warranty card, warranty claim, inspection, service plan
- Service request, service work order, technician assignment, time entry, part usage, photo, signature
- Delivery, courier shipment, return, reverse logistics record, route plan
- Interaction, call, email, chat, visit, task, reminder, attachment, customer timeline
- Lead, lead source, opportunity, pipeline stage
- Ticket, category, priority, escalation, SLA timer
- Survey, survey response, NPS score, referral
- POS shift, sale, sale line, split payment, return, loyalty account, points ledger
- Report definition, dashboard configuration, export job
- Backup source, data classification, backup policy, schedule, job, snapshot, copy, storage target
- Restore request, approval, restore job, DR test, incident role, audit event

Use immutable identifiers. Do not use customer names, serial numbers, or document numbers as primary keys.

## 6. ERP Requirements

### 6.1 Finance

#### Document issuance

Implement:

- Sales invoices for goods and services compliant with the Bulgarian VAT Act and Accounting Act.
- Proforma invoices that can be converted automatically into official invoices after payment.
- Credit notes and debit notes linked to the original document.
- Separate automatic numbering sequences by branch/location, cash register, and operator.
- PDF printing and email sending with the company logo and signature.
- Invoice creation from an existing POS/fiscal receipt with bidirectional linkage.
- VAT treatments of 20%, 9%, 0%, exempt, and intra-community acquisition.
- Multi-currency documents with automatic Bulgarian National Bank rates while accounting remains in BGN.

#### Payment tracking

Invoice statuses:

- Unpaid
- Partially Paid
- Paid
- Overdue
- Cancelled

Payment methods:

- Cash
- Bank transfer
- POS terminal
- Card payment
- Compensation/offset

Implement:

- Multiple partial payments against one invoice.
- Automatic outstanding-balance calculation.
- Automatic overdue status after the due date.
- Email and in-system notifications for upcoming and overdue payments.
- Manual and automatic matching of incoming bank transactions to invoices using payment references.

#### Cash and bank

Implement:

- Cash receipt vouchers.
- Cash payment vouchers.
- Daily cash reports.
- Import of standard Bulgarian bank statement formats.
- Manual bank statement entry.
- Allocation of payments to invoices, advance payments, and other accounting items.

#### Registers and reports

Provide:

- Customer receivables register.
- Supplier payables register.
- Aging buckets:
  - 0 to 30 days
  - 31 to 60 days
  - 61 to 90 days
  - Over 90 days
- Customer turnover reports by selected period.
- Supplier turnover reports by selected period.
- Sales journals.
- Purchase journals.
- Export to structured accounting software formats.
- VAT reports for collected and deductible VAT by selected period.

### 6.2 Procurement management

Implement:

- Supplier register with contact information, payment terms, delivery terms, and supplier evaluation.
- Purchase orders with line items, quantities, prices, and expected delivery dates.
- Partial or full receipt of deliveries.
- Automatic warehouse receipt generation.
- Comparison of ordered, delivered, and invoiced quantities.
- Supplier claims for non-conforming or damaged goods with status tracking.
- Complete delivery history linked to supplier invoices and goods receipt documents.

### 6.3 Warehouse management

Support unlimited warehouses, including:

- Central warehouse
- Vratsa warehouse
- Service warehouse
- Mobile technician warehouses

Product categories must support a hierarchy, including:

- Fiscal devices
- Electronic scales
- Fuel management systems
- Consumables
- Spare parts

Implement:

- Mandatory unique serial-number tracking for fiscal devices, electronic scales, and fuel management modules.
- Batch tracking for consumables and spare parts.
- Expiration dates where applicable.
- Goods receipt.
- Goods issue for sales, repairs, and write-offs.
- Warehouse transfers.
- Stocktaking.
- Automatic weighted-average cost.
- Optional FIFO costing.
- Minimum stock levels.
- Automatic low-stock alerts.
- Purchase recommendations.
- Quantity reservations for orders, quotations, and service requests.
- Complete serial-number traceability showing supplier, delivery date, customer sold to, and technician who repaired the item.

All stock movements must be transactional, auditable, and protected against negative or double-counted inventory.

### 6.4 Sales management

Implement the workflow:

`Quotation -> Confirmed Order -> Shipment -> Invoice`

Quotations must support:

- Validity period
- Line-item discounts
- Overall discounts

Price lists must support:

- Customer group
- Individual customer
- Time period
- Promotional campaigns

Service subscription contracts must specify:

- Customer location
- Devices
- Visit frequency
- Included services
- Pricing

Also implement:

- Automatic recurring invoices for subscription agreements.
- Reservation of specific serial numbers during equipment sales.
- Equipment handover/acceptance certificates upon sale.

### 6.5 Service module

Service requests may originate from:

- Telephone
- Email
- Customer portal
- On-site visit

Each service work order must include:

- Customer
- Business location
- Device and serial number
- Problem description
- Service type:
  - Warranty
  - Out-of-warranty
  - Subscription

Implement:

- Technician scheduling and assignment.
- Calendar view.
- Workload management.
- Responsive technician access to:
  - Assigned jobs
  - Completed work
  - Consumed spare parts
  - Working time
  - Photo upload
  - Customer signature capture
- Automatic deduction of used spare parts from the technician warehouse.
- Repair-cost calculation for labor, parts, and transportation.
- Payment-document issuance.
- Full service history by serial number, including:
  - Sale
  - Service visits
  - Repairs
  - Services performed
  - Parts used
  - Assigned technician
  - Service dates
- Warranty monitoring:
  - Remaining warranty period
  - Number of warranty claims
  - Service history
- Periodic inspection scheduling and reminders for mandatory technical or metrological inspections of fiscal devices and electronic scales.
- Automatic generation of upcoming service visits from subscription service plans.

### 6.6 Logistics

Implement:

- Customer deliveries using company transport or courier services.
- Econt shipment creation and tracking.
- Speedy shipment creation and tracking.
- Reverse logistics for returned or repairable devices.
- Automatic service-request creation from applicable reverse-logistics flows.
- Calendar-based planning for technician routes and deliveries.

### 6.7 Reports, KPIs, and dashboards

Main dashboard KPIs:

- Revenue for selected period
- Number of active service requests
- Warranties nearing expiration
- Overdue receivables

Also provide:

- Standard reports for every module.
- Configurable filtering.
- Export to Excel, CSV, and PDF.
- User-configurable reports that do not require software development.

Design report execution so large exports can run asynchronously and be downloaded when ready.

### 6.8 Users, roles, and audit

Implement:

- Individual account per employee.
- Detailed RBAC by module and action.
- Audit log fields and events defined in Section 4.3.
- Password complexity.
- Password expiration.
- 2FA, mandatory for administrative roles and available for other roles.

## 7. CRM Requirements

### 7.1 Unified partner registry

Maintain one real-time synchronized database of customers, partners, and suppliers.

Support legal entities and individuals with:

- Company Registration Number (UIC)
- VAT number
- Company representative
- Bank accounts
- Registered address
- Billing addresses
- Delivery addresses

Support:

- Multiple customer locations under one customer account.
- Stores, fuel stations, retail outlets, and other locations.
- Address and responsible contact per location.
- Multiple contact persons per customer.
- Contact job title, telephone, email, and role such as owner, accountant, or technical contact.
- Equipment register per customer location with device, serial number, purchase date, warranty period, and status:
  - Active
  - Under repair
  - Retired
- Automatic duplicate detection by UIC or company name when creating a partner.

Duplicate detection must warn and support controlled resolution. It must not merge records silently.

### 7.2 Communication history

Record a chronological history of:

- Incoming phone calls
- Outgoing phone calls
- Emails
- On-site visits
- Chat conversations
- Tasks

Support attachments to interactions, including:

- Reports
- Quotations
- Photographs

Implement:

- Tasks and reminders assigned to employees.
- Due dates.
- Priorities.
- Unified chronological timelines for each customer and each business location.

### 7.3 Lead and opportunity management

Lead sources include:

- Telephone
- Referral
- Website
- Trade exhibition

Implement:

- Lead registration.
- Lead qualification.
- Conversion to customer.
- Conversion to sales opportunity.
- Opportunity stages:
  - New
  - Qualified
  - Quotation Sent
  - Negotiation
  - Won
  - Lost
- Estimated revenue.
- Probability of success.
- Visual Kanban pipeline.
- Drag-and-drop stage movement with backend validation and audit logging.

### 7.4 Ticketing and customer service

Each ticket must include:

- Automatically generated ticket number
- Submission channel
- Priority
- Category

Implement two-way integration with the ERP Service Module:

- CRM tickets can create service requests.
- ERP service requests can create CRM tickets.
- Prevent duplicate loops through stable correlation identifiers and idempotent processing.

SLA management must support:

- Customer-specific or contract-specific SLA.
- Response time.
- Resolution time.
- Automatic monitoring.
- Alerts when an SLA violation is at risk.
- Escalation procedures for overdue tickets.

Optional customer portal:

- Submit requests.
- Track request status.

### 7.5 After-sales service

#### Warranty cards

Implement:

- Automatic warranty-card generation upon sale.
- Link each warranty card to the device serial number.
- Central warranty-card register.
- Current warranty status.
- Remaining warranty period.
- Expiration reminders.
- Options to offer extended warranty or a service subscription contract.

#### Warranty claims

Capture:

- Description
- Photos
- Supporting documents
- Device
- Serial number

Workflow:

`Received -> Under Review -> Approved or Rejected -> Closed`

Provide complete warranty-claim history for each customer and device.

#### Feedback and referrals

Implement:

- Customer satisfaction surveys after service completion or delivery.
- NPS measurement and trend tracking.
- Referral register linking existing customers to referred prospects.

### 7.6 Analytics

Analyze:

- Purchase frequency
- Average transaction value
- Preferred products and services
- Customer retention by selected period
- Customer churn by selected period
- Customer Lifetime Value
- Pipeline conversion by stage
- Employee performance:
  - Requests processed
  - Tickets resolved
  - Sales completed
- Revenue by:
  - Product
  - Service
  - Customer
  - Region
  - Responsible employee

Provide configurable dashboards and export for all reports.

Document formulas, date windows, status filters, and data sources for every KPI so results are reproducible.

### 7.7 CRM integration

Two-way synchronization with ERP must include:

- Business partners
- Business locations
- Equipment
- Documents
- Payments

POS integration must:

- Use a unified customer profile during sales.
- Auto-populate customer information for invoices.
- Enrich customer purchase history after each transaction.

Provide APIs for other enterprise systems.

## 8. POS Requirements

### 8.1 Retail sales

Support item entry through:

- 1D/2D barcode scanning
- Product-name search
- Product-code search
- Quick-access panel

Synchronize with ERP in real time for:

- Stock availability
- Prices
- Promotions

Implement:

- Fiscal receipt issuance through an integrated fiscal device compliant with Bulgarian Ordinance H-18.
- Direct invoice issuance from a POS terminal based on a fiscal receipt.
- Multiple cash registers.
- Multiple operators within the same business location.

### 8.2 Serial-number management

Require serial-number entry or scanning when selling:

- Fiscal devices
- Electronic scales
- Fuel management modules

Automatically associate:

- Serial number
- Customer
- Sale date
- Warranty period

Also:

- Generate and print warranty cards at sale.
- Transfer related information to CRM and ERP in real time.
- Block completion of a serialised sale without a valid, available serial number.

### 8.3 Payments

Support:

- Cash
- Bank card through PIN pad integration
- On-account payment for contracted corporate customers
- Split payment using multiple methods
- Advance payment
- Remaining balance
- Automatic cash-change calculation

Payment completion, fiscalization, invoice creation, and stock deduction must be designed as recoverable, idempotent operations.

### 8.4 Returns and warranty claims

Implement:

- Product returns.
- Automatic reversal in the fiscal report.
- Link to original fiscal receipt or invoice.
- Automatic return of eligible products to inventory.
- Transfer of repairable items to the service warehouse.

Do not allow unlinked returns where the business process requires an original document unless an authorized exception workflow is approved and audited.

### 8.5 Discounts, promotions, and loyalty

Implement:

- Manual percentage discount.
- Manual fixed-amount discount.
- Role-based restrictions for manual discounts.
- Automatic bundle pricing.
- Automatic quantity discounts.
- Loyalty customer identification/cards.
- Points accumulation.
- Points redemption.
- Individual corporate pricing inherited from ERP contracts.

Use an auditable loyalty points ledger. Never store only a mutable points total.

### 8.6 Offline operation

The POS must:

- Continue operating during temporary central-server outages.
- Store transactions locally.
- Synchronize automatically after connectivity returns.
- Guarantee fiscal receipt issuance while offline.

Offline design requirements:

- Use a durable local transaction store.
- Assign stable client-generated transaction IDs.
- Queue outbound changes.
- Make server synchronization idempotent.
- Define conflict rules for prices, stock, customer data, serial numbers, promotions, and document numbering.
- Preserve an audit trail of retries, conflicts, and reconciliation.
- Prevent the same transaction from being posted twice.
- Clearly display offline status and unsynchronized transaction count.
- Test reconnect, interrupted sync, duplicate replay, stale prices, unavailable serial numbers, and server rejection.
- Do not claim offline readiness until certified fiscal-device behavior has been tested on the target hardware.

### 8.7 POS reports

Provide:

- Shift reports
- Cashier reports
- X Report
- Z Report
- Reports by product
- Reports by category
- Reports by payment method
- Reports by time period
- Reports by business location
- Comparative analysis between locations
- Export to Excel, CSV, and PDF

### 8.8 Mandatory POS hardware

Minimum hardware scope:

- Dedicated POS terminal integrated with warehouse-management software.
- 1D/2D barcode scanner.
- Fiscal device certified under Bulgarian Ordinance H-18 and integrated with POS software.

Hardware abstractions must support test doubles so automated tests do not require physical devices.

### 8.9 Optional POS hardware and integrations

Additional evaluation items, not minimum mandatory software scope:

- Self-service customer kiosk.
- Communication router with backup Internet connectivity.
- Electronic Shelf Label system synchronized with ERP pricing.
- Automatic fiscalization for online-store sales integrating POS, e-commerce platform, and fiscal device.

Keep optional features disabled behind configuration or feature flags until approved.

### 8.10 POS integration

Two-way ERP integration must provide:

- Unified product catalog
- Inventory synchronization
- Price synchronization
- Document synchronization
- Accounting synchronization

CRM integration must provide:

- Customer recognition during sales.
- Automatic enrichment of purchase history after every transaction.

Provide APIs for other enterprise systems.

## 9. Information Backup and Disaster-Recovery System

The backup system is custom-developed for Vista Service and integrated with ERP, CRM, POS, and other sources in the approved backup plan.

It must back up and restore:

- Databases
- Files
- Configurations
- Servers
- Workstations
- Mobile devices
- Email
- File shares
- Cloud services
- Other approved information sources

Do not treat this scope as a simple database dump script.

### 9.1 Backup analysis and plan

Inventory:

- Physical servers
- Virtual servers
- Workstations
- Laptops
- Tablets
- Company phones
- Databases
- File shares
- Email
- Cloud services

Classify data as:

- Critical
- Important
- Standard

Define for each category:

- Backup policy
- RPO
- RTO

Produce a written Information Backup Plan covering:

- Scope
- Frequency
- Backup type:
  - Full
  - Incremental
  - Differential
- Retention periods
- Storage locations
- Responsible persons
- Verification procedures

The plan requires management approval, review at least annually, and update whenever infrastructure changes.

### 9.2 Automatic backup

Provide centralized backup software with scheduled automatic execution.

Support:

- Physical and virtual servers
- Employee workstations
- Mobile devices
- ERP, CRM, and POS databases
- Email resources
- File resources
- Full backup
- Incremental backup
- Differential backup
- Database snapshots
- Image-based whole-system backup
- Deduplication
- Compression
- Email notifications
- SMS notifications
- Success alerts
- Failure alerts
- Missed-backup alerts
- Journaling
- Non-deletable-by-ordinary-user backup and restore audit logs

Backup jobs must expose status, start/end times, protected source, restore points, retention, verification state, and error details.

### 9.3 Ransomware and cyberattack protection

Implement or integrate:

- Built-in ransomware protection.
- Air-gapped backup storage, physically or logically isolated.
- Tape-removal or separate-network-segment workflows where applicable.
- Separate domain/account structure for backup infrastructure.
- Protection against compromise of primary Active Directory.
- MFA for backup-console access.
- MFA for policy deletion or modification.
- Role separation:
  - Backup operator
  - Backup administrator
  - Security officer
- Four-eyes approval for critical operations.

Deletion of restore points, retention-policy reduction, disabling of jobs, and destructive restore operations must be treated as critical actions.

### 9.4 Centralized access management

Support integration, where available, with:

- Active Directory
- LDAP
- Azure AD/Entra ID
- SAML
- OAuth 2.0/OIDC

Map backup roles to groups and policies in the centralized directory.

Local emergency access, if implemented, must be protected, audited, and documented.

### 9.5 Restore procedures and test restore

Write Disaster Recovery Procedures covering:

- Individual file restore
- Database restore
- Entire server restore
- Entire infrastructure restore

Define responsibilities for:

- Who initiates a restore
- Who approves a restore
- Who informs management
- Who informs customers

Support:

- Granular restore of an individual database record, email, or file without restoring the full backup.
- Bare-metal restore of an entire operating system to different hardware.

Perform at least one implementation-time Disaster Recovery Test and document it with a signed protocol covering:

- Successful restore evidence
- RTO compliance
- RPO compliance
- Identified non-conformities
- Corrective actions

Plan subsequent test restores at least annually.

### 9.6 Mandatory backup hardware

Minimum hardware scope:

- Physical information-storage server
- Tape drive or tape library

The implementation must document capacity, retention assumptions, tape rotation, off-site or air-gapped handling, encryption, hardware ownership, maintenance, and restore compatibility once the actual hardware is selected.

## 10. Security Requirements

Apply security throughout design, coding, deployment, and operations.

Mandatory controls:

- HTTPS/TLS for all connections.
- HSTS.
- Unified RBAC.
- 2FA for administrative roles.
- Material-action audit logging.
- Secure password storage.
- Least privilege.
- Input validation.
- Output encoding.
- CSRF protection where cookie authentication is used.
- Secure CORS configuration.
- Rate limiting for sensitive and public endpoints.
- Secret management outside source control.
- Encryption of sensitive backup data in transit and at rest.
- Dependency and container vulnerability scanning in CI where supported.
- Safe handling of personal, financial, device, and customer information.
- Database backups must not expose production secrets in logs or test environments.

Never log passwords, authentication tokens, PIN data, full card data, or unmasked secrets.

## 11. API and Integration Standards

- Use versioned APIs.
- Generate and maintain OpenAPI documentation.
- Validate request and response schemas.
- Use stable error codes and correlation IDs.
- Make externally retried commands idempotent.
- Use transactions for atomic domain changes.
- Use an outbox or equivalent reliable mechanism for cross-module events.
- Reconcile asynchronous integrations.
- Paginate large lists.
- Support filtering, sorting, and date ranges where reports or registers require them.
- Use background jobs for email, exports, scheduled reminders, synchronization, backup tasks, and other long-running work.
- Record integration failures without losing the originating business transaction.
- Protect webhook endpoints with signatures or equivalent verification where supported.

## 12. Scheduled Jobs

Use scheduled tasks for at least:

- Upcoming and overdue payment detection.
- Payment notifications.
- Recurring subscription invoices.
- Fiscal-device and scale inspection reminders.
- Upcoming service visits from subscription plans.
- Warranty-expiration reminders.
- SLA-risk monitoring and escalation.
- Report generation where scheduled.
- Backup execution.
- Backup verification.
- Missed-backup detection.
- Annual review and DR-test reminders where operationally applicable.

Scheduled tasks must be idempotent and safe to retry.

## 13. Reporting and Export Standards

Every module requiring reports must support:

- Configurable filters.
- Access control.
- Reproducible calculation logic.
- Excel export.
- CSV export.
- PDF export.

User-configurable reporting must not require source-code changes. Use a controlled report-definition model rather than arbitrary SQL entered by end users.

## 14. Implementation Order

Work incrementally. Keep the system runnable after every phase.

### Phase 0: Discovery and decisions

- Confirm business locations, warehouses, operators, document sequences, tax settings, initial roles, SLA rules, accounting export formats, Bulgarian bank formats, fiscal-device models, PIN pad, Econt/Speedy credentials, backup sources, hardware, RPO/RTO, and deployment target.
- Record unresolved decisions in `docs/architecture/decisions/`.
- Build a traceability matrix from SRS requirements to modules, migrations, APIs, UI screens, and tests.

### Phase 1: Platform foundation

- Monorepo and CI/CD.
- Environment validation.
- PostgreSQL migrations.
- Redis.
- Authentication.
- RBAC.
- 2FA for administrators.
- Audit logging.
- File storage.
- Email and notification infrastructure.
- OpenAPI.
- Shared UI and contracts.
- Health checks, logging, and monitoring.

### Phase 2: ERP master data and warehouse

- Partners, locations, products, categories, warehouses, serial numbers, batches, stock movements, reservations, stocktake, valuation, minimum-stock alerts, and traceability.

### Phase 3: Procurement, sales, finance, and logistics

- Purchase orders, deliveries, supplier claims, quotations, orders, shipments, invoices, corrections, payments, cash/bank, reports, recurring invoicing, handover certificates, couriers, and reverse logistics.

### Phase 4: Service

- Service requests, work orders, scheduling, technician views, parts usage, cost calculation, signatures, warranties, inspections, and service history.

### Phase 5: CRM

- Partner timeline, contacts, equipment register, interactions, leads, opportunities, tickets, SLA, warranty claims, surveys, NPS, referrals, analytics, and optional portal.

### Phase 6: POS

- Retail sale flow, barcode and quick access, customer recognition, serial numbers, fiscal device, PIN pad, payments, discounts, promotions, loyalty, returns, shifts, reports, and ERP/CRM synchronization.

### Phase 7: POS offline mode

- Durable local data store, transaction queue, synchronization, conflict handling, fiscal operation, reconciliation UI, and dedicated offline test suite.

### Phase 8: Backup and disaster recovery

- Approved backup plan, source inventory, policies, scheduled jobs, storage targets, air gap, role separation, MFA, centralized identity, restore workflows, hardware integration, written DR procedures, and documented test restore.

### Phase 9: Hardening and handover

- Full end-to-end tests.
- Performance and concurrency tests.
- Security review.
- Data migration rehearsal where applicable.
- Monitoring and alerting.
- Deployment documentation.
- User documentation.
- Built-in help.
- Training and handover.
- Final requirement traceability review.

A phase may be split into smaller releases, but no SRS item may disappear because it is deferred.

## 15. Testing Requirements

Write tests at the level where the behavior can fail.

### 15.1 Unit tests

Cover domain rules such as:

- Taxes and totals
- Currency conversion
- Outstanding balance
- Aging buckets
- Discounts
- Loyalty points
- Warranty periods
- SLA deadlines
- Cost calculation
- Stock valuation
- Reservation rules
- RPO/RTO evaluation

### 15.2 Integration tests

Cover:

- Database transactions and migrations
- RBAC enforcement
- Number sequence concurrency
- Stock movement and serial traceability
- Payment allocation
- Proforma conversion
- Fiscal receipt to invoice linkage
- CRM and ERP two-way synchronization
- POS and ERP synchronization
- Ticket and service-request correlation
- Courier, bank, BNB, email, and identity adapters
- Backup scheduling, retention, and audit

### 15.3 End-to-end tests

At minimum, automate:

1. Quotation to order to shipment to invoice to payment.
2. Purchase order to partial/full receipt to supplier invoice comparison.
3. Serialised POS sale to fiscal receipt to invoice to warranty card to CRM history.
4. Service request to technician assignment to parts consumption to customer signature to payment document.
5. Return linked to original sale with fiscal reversal and stock/service-warehouse update.
6. Lead to opportunity to quotation to won/lost.
7. Ticket to ERP service request and reverse creation without duplication.
8. Offline POS sale, reconnect, synchronization, and reconciliation.
9. Backup job to verified restore point.
10. File, database, server, and disaster-recovery restore procedures where test infrastructure permits.

### 15.4 Hardware and recovery tests

Use simulators in CI and test real target hardware before acceptance for:

- Fiscal device
- Barcode scanner
- PIN pad
- Tape drive/library
- Optional kiosk, ESL, router, and online fiscalization

A successful backup is not sufficient. Restore must be tested.

## 16. Data Integrity and Concurrency

Protect critical workflows with database constraints and transactions.

Required guarantees include:

- Unique UIC where business rules permit, with duplicate-detection support.
- Unique serial number per physical item.
- No sale of the same serial number twice.
- No double posting of POS or integration transactions.
- No duplicate document number in the relevant sequence.
- No invalid payment allocation beyond permitted balance without explicit advance/offset handling.
- No stock movement without source, warehouse, quantity, actor, and timestamp.
- No orphaned correction note, return, warranty, service event, or payment allocation.
- No silent deletion of posted financial, fiscal, stock, service, or backup records.
- Use reversal, cancellation, or versioning where legal or audit history must be preserved.

## 17. User Experience Rules

- Optimize back-office screens for desktop and tablet.
- Optimize POS screens for speed, keyboard/scanner use, touch, clear totals, and minimal cashier steps.
- Make technician views usable on mobile-sized screens.
- Make offline POS state obvious.
- Show validation errors next to the relevant field.
- Preserve work where possible after recoverable failures.
- Use confirmation and authorization for destructive or legally significant actions.
- Provide accessible labels, focus order, and keyboard navigation.
- Keep UI text externalized for localization. Do not hardcode language-specific strings throughout the codebase.
- Provide built-in help materials as required.

## 18. Documentation Deliverables

Maintain:

- Architecture documentation.
- Architecture decision records.
- OpenAPI documentation.
- Database schema and relationship documentation.
- Deployment instructions.
- Environment variable reference.
- Integration setup and troubleshooting.
- Fiscal-device and hardware setup.
- Backup Policy.
- Disaster Recovery Procedures.
- DR test protocol.
- User manuals.
- Built-in help content.
- Operational runbooks.
- Requirement traceability matrix.

Documentation must be updated in the same change that alters behavior.

## 19. Agent Working Rules

Before coding:

1. Read this file.
2. Inspect existing code, migrations, documentation, and tests.
3. Identify the exact SRS requirement being implemented.
4. Check whether it crosses ERP, CRM, POS, or backup boundaries.
5. Write or update tests and documentation with the implementation.

While coding:

- Prefer small, reviewable changes.
- Reuse shared contracts and domain rules.
- Do not duplicate master data.
- Do not bypass authorization, audit, or synchronization layers.
- Do not hardcode production identifiers, credentials, rates, tax rules, warehouses, document sequences, or hardware addresses.
- Do not silently invent business decisions.
- Keep optional requirements behind explicit configuration.
- Use feature flags for incomplete integrations.
- Preserve backward compatibility for published APIs unless a versioned migration is provided.
- Add database migrations for schema changes.
- Make jobs and synchronization idempotent.
- Leave the repository buildable and testable.

After coding:

1. Run formatting, linting, type checking, unit tests, integration tests, and affected end-to-end tests.
2. Verify migrations both up and down where rollback is supported.
3. Update OpenAPI, schema docs, user docs, and traceability.
4. Report completed requirements, remaining work, assumptions, and known risks.
5. Never mark a requirement complete without executable behavior or an explicitly accepted documentation/hardware deliverable.

## 20. Definition of Done

A feature is done only when:

- The SRS behavior is implemented without contradiction.
- Backend authorization is enforced.
- Audit events are recorded where material.
- Validation and failure behavior are defined.
- Tests cover the critical path.
- Integration retry and idempotency behavior is handled where relevant.
- UI states include loading, empty, success, validation, and failure cases.
- Documentation and OpenAPI are updated.
- Database migrations are included.
- No secrets or environment-specific values are committed.
- The feature works in the Linux development environment.
- The requirement traceability matrix is updated.

The entire project is done only when all mandatory ERP, CRM, POS, backup, security, integration, hardware, documentation, test-restore, and handover requirements are satisfied. Optional items must be clearly marked as either implemented or not selected.
