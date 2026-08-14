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
operational identifiers, not fiscal or accounting document numbers. The migration
does not implement payment documents, warranty claims, inspections, route
planning, or full sales/supplier serial history; those remain separate required
workflows.
