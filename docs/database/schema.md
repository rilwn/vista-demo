# Database Schema Baseline

Migration `0063_erp_operational_reports` registers ten controlled Procurement,
Warehouse, Sales and Logistics report definitions and adds
`reporting.saved_erp_reports`. Each saved view has an immutable UUID, account,
module scope, name, filters/columns/format, normalized request hash and creation
time. A scope/account index supports private pagination. Concurrent identical
saves produce one row and audit event; changed content with the same UUID fails.
Preview/export queries never accept caller SQL. Existing export jobs and object
storage provide asynchronous generation and integrity-checked downloads.
Rollback removes these definitions and saved views, but is blocked by the
existing foreign key if any export still references a definition. It does not
cascade-delete exports or business records.

Migration `0062_overview_preferences` stores an account-owned hidden-card list and
revision in `reporting.overview_preferences`. Writes lock the owning row, compare
the revision and audit changes in the same transaction. Identical retries are
no-ops; stale differing saves return 409. Rollback removes preferences only.

Migration `0061_saved_pos_reports` adds private, immutable date-range POS report
options in `reporting.saved_pos_reports`. Each UUID belongs to an account, with a
nonblank name, normalized configuration/hash, timestamp and owner pagination index.
Options include dates, optional location/register/cashier, columns and format.
Save and audit insertion share a transaction with UUID replay/conflict checks.
Rollback removes saved POS options only, not sales, shifts or export files.

Migration `0060_saved_crm_reports` adds private, immutable CRM report options in
`reporting.saved_crm_reports`, with an owning-account foreign key, nonblank name,
JSON configuration, request hash and creation timestamp. The owner/date/id index
supports pagination. UUID replay is checked against normalized content, and
creation shares a transaction with its audit event. Rollback drops only saved CRM
options, not customer records or export files.

Migration `0059_saved_service_reports` adds private, immutable Service report
configurations in `reporting.saved_service_reports`: UUID, owning account FK,
nonblank name, JSON configuration, normalized request hash and creation timestamp.
The owner/date/id index supports stable pagination. Saves and their audit event
share a transaction; UUID collisions with changed content are rejected. Rollback
drops only this saved-options table, not Service records or generated exports.

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
- `notifications`: idempotent in-system, email, and SMS delivery work, including
  processing claims, retry/failure state, delivery timestamp, and in-system read
  timestamp.
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

Migration `0007_warehouse_inventory_foundation` adds empty, configurable
warehouses (`standard` or `technician`) plus an append-only receipt movement
ledger, aggregate stock balances, batch balances, and globally unique serialised
items. Positive quantities and restrictive references are database constraints.
The currently available command is a receipt only: it atomically writes the
movement and all resulting balances/serial or batch records. The schema does not
seed locations, warehouses, products, or inventory, and it intentionally defers
issues, transfers, stocktake, reservations, costing, and later traceability links.

Migration `0008_inventory_stock_issues` adds the issue movement type and an
issued-movement reference/state to serialised items. The issue command locks and
decrements aggregate stock (and the selected batch stock where applicable), so a
negative balance cannot be posted. A serial changes from `available` to `issued`
only inside that same transaction.

Migration `0009_inventory_transfers` adds paired `transfer_out` and
`transfer_in` movements plus a serial-item transfer history table. Transfers move
both balance and available serial ownership atomically; they do not reuse a
receipt or issue command.

Migration `0010_inventory_stocktakes` adds one open count per warehouse and
fixed-precision product counts. Migration `0011_inventory_stocktake_adjustments`
adds explicit inbound/outbound adjustment movement types. Migration
`0012_stocktake_tracking_evidence` adds normalized serial and batch evidence and
an explicit missing-serial state. Warehouse-scoped advisory locks serialize
opening a count with receipts, issues, transfers, and reservations, preventing a
moving target while physical evidence is captured.

Migration `0013_inventory_reservations` adds durable sales-order, quotation, and
service-request reservations with initial and remaining quantity, lifecycle
state, actor/timestamps, and version. Active serial assignments have a partial
unique index, so one available serial cannot be reserved twice. Balance-row locks
serialize availability checks; release and issue consumption retain reservation
and serial-assignment history rather than deleting it.

Migration `0014_inventory_valuation_replenishment` adds fixed-precision BGN unit
and generated total cost to every stock movement plus weighted-average unit cost
to each warehouse/product balance. Existing rows receive an explicit zero-cost
baseline because no historical acquisition cost can be inferred safely. It also
adds versioned minimum/target settings and a live replenishment view that derives
physical, reserved, and available quantity, low-stock state, and recommended
purchase quantity without a stale cached total.

Migration `0015_serial_traceability_parties` adds restrictive supplier, customer,
and technician references to immutable stock movements. These combine with the
serialized-item movement links and transfer ledger to produce chronological
custody without rewriting inventory history.

Migration `0016_customer_locations_equipment` adds explicit customer locations
and installed equipment to the ERP-owned master-data schema. Active location
names are normalized and unique per customer, while location type remains
configurable. An optional responsible contact is protected by a composite foreign
key so it cannot cross customer boundaries. Equipment records retain purchase and
warranty dates, one of the required active/under-repair/retired states, and a
globally unique normalized serial. Optional product and inventory-serialized-item
references are restrictive; the API links an existing inventory serial when one
is known and leaves legitimate legacy equipment unlinked instead of constructing
false custody history. Both entities use immutable UUIDs, active state, version,
actor, and timestamp metadata.

Migration `0017_organization_topology` adds the configurable internal operating
hierarchy separately from external customer/supplier partner records. The new
`organization` schema contains legal business entities, branches, physical
business locations, cash registers, employee-backed operators, and same-location
register/operator assignments. Composite foreign keys prevent an operator from
being assigned to a register or technician warehouse at another location.
Warehouses gain optional business-location and technician-operator ownership
without rewriting existing custody or requiring fabricated defaults. Codes and
UICs are normalized/uniquely constrained at their documented scopes; all entities
retain immutable UUIDs, active state, version, actor, and timestamps. The
migration seeds no legal entity, branch, location, register, operator, or
warehouse.

Migration `0018_inventory_returns` adds inbound return movements linked to one
immutable original issue. Cumulative returned quantity cannot exceed the issued
quantity. The return retains the original batch and fixed-precision BGN cost;
serial items must still be issued by that exact movement before their custody can
be restored. Immutable serial-return events preserve the issue/return chain even
after a serial becomes available for a later sale. The disposition records
whether stock returns to ordinary or service custody; fiscal, invoice, payment,
and POS reversals remain separate linked workflows.

Migration `0019_low_stock_alert_queue` adds explicit employee subscriptions and
transition state per configured warehouse/product. Inventory commands reconcile
reservation-aware availability in the same database transaction. Entering low
stock creates one pending `inventory.low_stock` in-system message per active
recipient and cycle; remaining low is idempotent, recovery resets the state, and
a later shortage starts a new cycle. Delivery workers and additional provider
channels can consume the existing retryable `notifications.messages` queue.

Migration `0021_security_administration` adds optimistic versions to employee
accounts and roles, records whether each persisted session verified a second
factor, and indexes account-status and reverse-chronological audit queries. The
API uses these fields for version-checked access changes, administrative 2FA
enforcement, session review/revocation, and audit exploration without exposing
credential material. Audit writes remain serialized and now allocate strictly
monotonic event timestamps under the same advisory lock, keeping chronological
integrity verification deterministic even during concurrent requests.

Migration `0022_reliable_integration_events` turns the existing integration
tables into an executable outbox/inbox lifecycle. Aggregate-scoped sequence
allocation, publication claims, replay counters, delivery rows, failure codes,
and completion/dead-letter timestamps make transport state durable and
observable. A database trigger protects immutable event identity and content.
Inbox receipts retain canonical payload hashes and per-cycle attempt state so a
duplicate delivery cannot repeat a completed consumer effect. Event replay resets
only incomplete deliveries; it does not erase completed receipts or alter the
originating business event.

Migration `0023_employee_password_change` adds the private
`identity.password_history` store. A successful self-service change moves the
previous salted scrypt hash into this table, retains only the configured recent
window, updates the account password/expiration/version, revokes every other
active session, and appends audit evidence in one transaction. The table is not
exposed by an API and never stores plaintext credentials.

Migration `0024_procurement_purchase_receiving` adds purchase orders, immutable
order lines, goods receipts, and receipt lines under the `procurement` schema.
Orders reference canonical supplier partners and receipt lines reference the
existing warehouse inventory ledger. Fixed-precision quantities and prices,
cumulative checks, row locks, and database constraints prevent over-receipt and
derive open, partially received, or received status without a mutable duplicate
total. Each goods receipt and its warehouse movement, balances, tracking
evidence, audit event, outbox event, and idempotency result commit in one
transaction. Internal UUID references are displayed until the approved scoped
document-number policy in `BUS-002` is available; the migration does not invent
an official numbering sequence.

Migration `0025_procurement_supplier_controls` completes the core procurement
record chain. `supplier_profiles` holds versioned payment and delivery terms,
while `supplier_evaluations` retains immutable overall 1–5 assessments and notes
without hard-coding vendor-specific dimensions. Supplier invoices preserve the
supplier-provided number, date, order currency, fixed-precision lines, and exact
purchase-order-line links; invoice numbers are unique within one supplier.
Invoice capture increments cumulative invoiced quantity for three-way comparison
but does not pretend to post an accounting document.

Supplier claims reference the exact goods receipt and receipt line for damaged or
non-conforming goods. Row locks and cumulative checks prevent claiming more than
was received. Claims progress through open, submitted, resolved, and closed in
order, with every transition appended to a separate status-history table. All
parent and source links use restrictive foreign keys; no history is silently
deleted or reassigned.

Migration `0026_sales_workflow_foundation` adds the connected `sales` workflow.
Quotations retain validity, warehouse, customer, fixed-precision prices, line and
overall discounts, VAT treatment, and calculated totals. Confirmation creates one
order and exact inventory reservations under balance-row locks. Serialized lines
retain specific serial assignments; batch-tracked lines require batch evidence at
shipment. Shipment consumes reservations, stock, batches, and serialized custody
in one transaction and links every line to its immutable issue movement.

An invoice draft is then copied from the shipped commercial snapshot, preserving
the quotation prices, discounts, VAT, currency, customer, shipment, and source
links. The migration's sequence table produces internal workflow references only.
It does not implement or claim approved fiscal/accounting numbering, BNB-rate
posting, legal issuance, PDF/email delivery, corrections, or payment state.

Migration `0027_sales_pricing_foundation` adds reusable customer price groups,
group membership, promotional campaigns, effective price lists, and one
fixed-precision price per product/list. A price list targets all customers, one
group, or one customer through database constraints and retains currency,
effective dates, priority, active state, and an optimistic version. Campaign and
group lifecycle changes are reversible; existing commercial documents are never
recalculated. Resolution filters by date and currency, ignores inactive or
out-of-period lists/groups/campaigns, and orders matches by priority, customer
specificity, then stable code and identifier.

Migration `0028_sales_subscriptions_handover` adds versioned service subscription
contracts linked by composite constraints to one canonical customer location and
its installed equipment. Separate ordered service rows preserve the covered work;
fixed-precision price/currency, validity, visit/billing frequencies, active state,
and next invoice date remain explicit on the contract. Recurring invoice drafts
snapshot one service period and amount per unique contract/billing date, allowing
the scheduled generator to advance the date and safely deduplicate a retry.

Every completed sales shipment now prepares one handover certificate and line
snapshot from its actual products, quantities, and issued serial numbers. The
certificate moves once from prepared to accepted with the representative,
timestamp, optional note, and optimistic version retained. Internal service,
draft, and handover references are operational identifiers only; the migration
does not claim approved fiscal/accounting numbering or legal invoice issuance.

Migration `0029_finance_collections_foundation` adds the `finance` schema and a
bounded BGN collection workflow. `customer_documents` link one Sales invoice
draft to one immutable source reference and retain exact total, allocated,
outstanding, and BGN amounts; the database constrains valid payment and review
states, prevents allocation above the total, and prohibits cancellation once an
allocation exists. `payments` and `payment_allocations` retain payment evidence
and one restrictive allocation link, while `payment_status_history` preserves
the transition trail. `internal_document_sequences` allocates `FIN-REV` and
`PAY` operational references under transaction locks. These records are not
legal, fiscal, accounting, or BNB-posted invoices; future financial documents,
rates, VAT, bank reconciliation, vouchers, and reports require their own
approved workflows.

Migration `0034_financial_documents_foundation` adds structured invoice,
proforma, credit-note, and debit-note drafts without enabling legal issuance.
`financial_documents` stores immutable issuer/customer, source/correction,
currency-rate, total, BGN-equivalent, date, and lifecycle snapshots;
`financial_document_lines` and `financial_document_vat_summary` preserve the
fixed-precision calculation evidence for 20%, 9%, 0%, exempt, and explicitly
rated intra-community treatments. Optional register and operator links are
constrained to the selected business location.

`draft_document_sequences` allocates internal `DINV`, `DPRO`, `DCN`, and `DDN`
references under transactional row locks for each location, optional
register/operator, document type, and year. Each displayed reference includes a
stable scope fingerprint so independent register/operator counters cannot produce
the same reference. Source-linked retries reopen the active draft instead of
creating a duplicate. They are workflow references only.
`official_number` remains null until the approved legal numbering and issuance
rules are implemented. Draft creation/cancellation is audited and outbox-backed;
the migration deliberately does not claim BNB retrieval, accounting/VAT posting,
fiscal/POS linkage, proforma conversion, PDF/signature output, or email delivery.

Migration `0035_finance_bank_reconciliation` adds balanced manual BGN bank
statements and immutable transaction lines. Incoming lines can be linked once to
an open customer collection record; the link retains whether the match was an
exact-reference automatic match or a user-confirmed manual match, and points to
the generated payment and allocation. Statement and transaction versions protect
concurrent review, while restrictive relationships prevent a bank transaction or
payment from being allocated twice.

`internal_document_sequences` also allocates `BST` statement and `PAY` payment
references under transaction locks. Statement creation and manual matching write
their business rows, audit records, and outbox events in the same transaction and
support idempotent replay. This migration does not add bank-specific file parsers,
supplier payment matching, advances, cash vouchers, or accounting posting.

Migration `0036_finance_cash_operations` adds BGN cash receipt/payment vouchers,
scoped register/operator/location/year sequences, reversible standalone voucher
status, and operational daily report evidence. A receipt linked to a customer
collection creates the payment and allocation in the same transaction. Linked
receipts cannot use the simple cancellation path because payment reversal remains
a separate pending workflow; cancelled standalone vouchers remain auditable and
are excluded from daily totals.

Migration `0037_finance_supplier_subledger` adds BGN supplier payables sourced
once from Procurement supplier invoices, supplier payments and allocations,
unallocated advances, balance-status history, and bilateral customer/supplier
offsets. It extends bank transactions with a single outgoing supplier-payment
link, allowing a Finance employee to allocate the line to a payable or preserve
it as an advance. Restrictive foreign keys, fixed-precision balance checks,
optimistic versions, transaction locks, and concurrency-safe `SP`, `SPAY`,
`SADV`, and `OFF` references prevent duplicate or cross-supplier allocation.
These records are an operational supplier subledger, not deductible-VAT or
general-ledger posting.

Migration `0038_reporting_export_foundation` adds a controlled reporting
catalogue and persistent asynchronous export jobs. The initial catalogue contains
the four operational Finance aging and turnover reports. A definition points to
reviewed application code and permitted formats; it never stores or accepts user
SQL. Each export retains its owner, filters, request hash, queue identifier,
attempt state, file metadata, checksum, size, row count, and timestamps.
Requester-scoped idempotency prevents one command from creating duplicate jobs.
Generated files live in private S3-compatible storage and are verified against
their saved length and SHA-256 before download. This foundation does not add the
still-pending statutory journals, VAT reports, accounting formats, or no-code
report-definition editor.

Migration `0039_logistics_operations_core` adds transaction-backed company
deliveries, reverse returns, and route plans. A delivery snapshots the active
customer location and stays linked to one completed Sales shipment and its
handover certificate. Optimistic versions and append-only status history protect
dispatch, exception, customer receipt, and cancellation changes. Completing a
delivery records the recipient and accepts a still-prepared Sales handover through
the existing retry-safe command.

Migration `0040_finance_journal_vat_review` adds an immutable VAT-treatment and
rate snapshot to new Procurement supplier-invoice lines, with generated net/VAT/
gross values. Historical lines remain explicitly incomplete instead of being
silently assigned tax. It also adds controlled Sales journal, Purchase journal,
and VAT review definitions to the asynchronous export catalogue. These are
preparation reports; official filing, deductible-VAT decisions, and structured
accounting formats remain approval-controlled work.

Reverse-return lines retain the original shipment line, quantity, shipped serials,
destination warehouse, inventory return movement, and optional Service request.
Receiving posts each item through the inventory return command and opens one
linked Service request for repair dispositions; stable sub-command keys make an
interrupted retry continue without duplicating stock or Service work. Route plans
snapshot ordered delivery and scheduled-Service stops for one active employee and
prevent the same source from appearing on two open routes. `DLV`, `RTN`, and `RTE`
are internal operational references. Econt and Speedy remain disconnected until
INT-002 is approved; no provider booking or tracking is claimed.

Migration `0030_service_work_orders_core` adds the `service` schema and its
operational request-to-completion record chain. `requests` retain the immutable
canonical customer, location, equipment, optional subscription reference, intake
channel, coverage type, priority, problem, reasoned cancellation, status, actor,
and timestamps. `work_orders` retain one request link, assigned technician and
technician warehouse, schedule, lifecycle timestamps, fixed-precision BGN labor,
parts, transport, and total costs, plus completion notes and customer-signature
metadata. Database constraints keep the request/work-order relationships,
statuses, costs, and dates valid; a work order cannot be orphaned from its
request.

Separate append-only status-history, time-entry, part-usage, part-serial, and
photo tables preserve the evidence and inventory relationship without rewriting
completed work. The service completion command joins the existing inventory
transaction to atomically issue parts from the assigned technician warehouse;
serial and batch rules remain enforced by that ledger. Images and signatures are
stored as controlled binary evidence and are available only through the
parent-record authorization boundary. Internal `SRV` and `WO` sequences are
operational identifiers, not fiscal or accounting document numbers. That
migration did not itself implement payment documents, warranty care, inspection
planning, route planning, or full sales/supplier serial history; later migrations
own those separate workflows.

Migration `0041_service_finance_link` links one completed, chargeable Service
work order to its prepared Finance document without copying or recalculating the
Service cost basis. The restrictive unique link makes a replay reopen the same
draft instead of creating a second financial document.

Migration `0042_service_technician_schedule` adds one versioned weekly schedule
policy per technician and explicit business-time windows for enabled weekdays.
Each window stores its start/end, bookable minutes, and visit limit; no production
working day is inferred. Service assignment uses a technician-scoped advisory
lock and rejects work outside those windows, overlapping active work orders, or
daily minute/visit overflow. The Logistics route planner takes the same lock and
counts delivery stops alongside Service appointments, while keeping Service route
stops tied to their assigned technician and original appointment window.

Migration `0043_service_care_management` adds the warranty-claim register and
its append-only status history, one technical or metrological inspection plan
per registered device, immutable inspection results, and retry-safe links from
subscription occurrences to generated Service requests. Claim and inspection
commands use optimistic versions, idempotency records, audit events, and the
transactional outbox. Planned visits retain their contract, equipment, due date,
generated request, and source job, while a uniqueness constraint prevents the
same occurrence from generating twice. Inspection reminder lead times, the
warranty reminder lead time, and the forward plan-visit window remain
configurable rather than becoming permanent client policy.

Migration `0033_managed_file_versions` turns the foundation `files.objects`
metadata into immutable logical-file histories. Every replacement keeps its own
object key, checksum, issuer, timestamp, and monotonically increasing version
under one `version_group_id`; the previous object is retained through
`replaces_object_id`. Authorized parents currently include canonical partner
records, warranty claims, CRM interactions, and financial documents. Finance
attachment reads require Finance view; uploads/replacements require Finance edit.
The parent must exist in `finance.financial_documents`; CRM access alone grants
no access. Supporting files never mutate document snapshots or status. This
extension uses the existing unconstrained parent-type column and version model,
so no schema migration is needed. Each parent keeps its own module
permissions; a Service technician can only access a claim in their assigned work
scope unless they hold Service approval authority.
Current uploads accept configured PDF/JPEG/PNG/WebP types, enforce a configured
size ceiling, inspect the file signature, and store content in the private
S3-compatible bucket. Downloads re-check byte length and SHA-256 before returning
private, non-cacheable content. File metadata, audit, outbox, and idempotency
records never contain the uploaded bytes. No delete/retention command is exposed
before `FILE-001`, and structural signature inspection is not represented as a
production malware scan.

Migration `0046_serial_lifecycle_traceability` links each accepted Sales handover
to one active location belonging to its customer. During acceptance, sold
serialised items are transactionally linked to an existing compatible customer
equipment record or registered as new equipment at that location. Restrictive
foreign keys and conflict checks prevent a serial from being reassigned to a
different customer location or product. The nullable database column preserves
earlier handovers, while all new API acceptances require the location. The
combined trace query reads the existing Procurement, inventory, Sales,
Logistics, and Service records; it does not duplicate or rewrite lifecycle
events.

Migration `0047_crm_customer_timeline` adds customer communication and follow-up
work to the shared CRM schema. `crm.interactions` records incoming and outgoing
calls, email, chat, and on-site visits against the canonical customer and an
optional same-customer location or contact. `crm.tasks` keeps assignment, due
time, priority, optional reminder, optimistic version, and terminal state, while
`crm.task_history` preserves every created, completed, or cancelled lifecycle
event. `crm.task_reminders` links one task reminder to the existing retryable,
idempotent notification queue; completing or cancelling a task cancels an
undelivered reminder without deleting its evidence. Composite foreign keys
prevent cross-customer references, and customer/location/date indexes support
stable reverse-chronological paging. Interaction files use the existing immutable
managed-file service and inherit CRM authorization from their parent record.

Migration `0048_crm_lead_opportunity_pipeline` adds the lead and opportunity
lifecycle to the shared CRM schema. Leads retain their source, contact details,
owner, qualification and conversion timestamps, optimistic version, and an
append-only history. A converted lead points to one active customer in the
shared partner register; database constraints and the conversion command prevent
the workflow from creating an unlinked CRM-only customer.

Opportunities retain one customer, optional source lead, fixed-precision BGN
value, probability, expected close date, owner, stage, and append-only stage
history. Quotation links point to existing Sales quotations for the same
customer. Separate lead and opportunity sequences allocate stable operational
references under a row lock. Command idempotency, optimistic versions, audit
events, and transactional outbox records protect conversion, stage movement,
and quotation linking from duplicate or stale updates.

Migration `0056_pos_customer_accounts` adds one versioned, dated customer credit
policy per canonical customer, concurrency-safe customer-advance numbering, and
append-only customer advance and POS account ledgers. Each on-account charge
snapshots its due date, credit limit, and payment-term days. POS payment records
retain their exact advance or account source, while every linked return refund
points to the original payment and appends a compensating credit or advance
restoration. Database triggers reject updates and deletes on posted customer
ledger entries; restrictive keys preserve the sale and return chain.

Migration `0057_pos_receipt_documents` snapshots each completed POS line's unit
code and links a Finance invoice draft to its exact POS sale and fiscal-receipt
number. A partial unique index permits only one active Finance document for a
sale, while the creation command also locks the source sale so concurrent
requests reopen the same draft. Receipt lines and VAT totals are copied from the
posted sale values; later product, price, tax, or unit changes cannot silently
rewrite them. The same sale response exposes its transactionally generated
warranty cards, whose printable content is rendered on demand rather than
stored as an unauthorised duplicate file.

Migration `0064_reporting_hub` adds `reporting.library_views` as an owner-scoped
union of the five existing saved-view tables. `report_schedules` stores immutable
configuration/timezone/recurrence anchors, the next occurrence, enabled state and
an optimistic revision. `report_schedule_runs` uniquely links a schedule and due
instant to an existing export job. `dashboard_preferences` stores reviewed
hidden-card keys and revisions by account and module. No business transaction or
KPI source is duplicated. Rollback drops this scheduling/preference metadata and
the union view; existing saved views, export jobs and audit evidence remain.
Back up schedule configuration before any rollback.
