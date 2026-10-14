# Vista Operations QA finding register

Source: `Vista_Operations_QA_Report.docx`, tested 2 October 2026 with the Manager
account on the hosted Operations app. Ordered by the report's detailed sections.
AGENTS.md remains authoritative. No test records or audit history are to be deleted.

Status: **Pending** = not verified/fixed; **In progress** = partial implementation;
**Verified locally** = applicable local regressions passed, hosted retest pending;
**External acceptance** = code uses the recorded default, but needs real hardware,
infrastructure or witnessed evidence; **Deferred** = accepted as outside the
current rollout, still required by the SRS. Local verification is not hosted,
statutory or hardware acceptance.

Current: **49 locally verified** (hosted retest pending), **2 external acceptance**,
**1 deferred** (52 findings total).

Current implementation update, 14 October 2026: FIN-01, FIN-02, FIN-07, FIN-12,
FIN-13, SEC-02, WH-01, WH-04, SAL-02, SRV-02, SRV-03 and CRM-10 are now
**Verified locally**. The project owner selected the configurable defaults in
ADR-0004, so these items no longer wait on client decisions. The new WH-01
journey uses a purchase order and goods receipt created through the API, then
traces the same serial through sale, handover, return and Service repair.

Latest verification: 270/270 isolated API tests and 30/30 browser journeys
passed. The migration rehearsal converted representative BGN customer-credit,
advance-ledger, loyalty and CRM opportunity values to EUR at the statutory rate,
rejected a new BGN balance, and completed rollback/reapply on its disposable
database. The migration regression, full API suite, and browser suite passed;
`npm run validate` had also passed on this code before the migration-test-only
addition. Hosted retests remain open. ORG-03 fiscal-device acceptance and
BCK-01 witnessed backup/restore acceptance remain external evidence gates;
LOG-01 remains deferred for this rollout.

## 1. Platform processing

| Finding | Remaining work / verification                                                                                                                                                                                       | Status           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| SYS-01  | Events without a registered receiver are identified and cannot be replayed; the API returns a conflict without changing event state. Isolated API/browser tests passed. Review the hosted backlog after deployment. | Verified locally |
| SYS-02  | Notification retry recovery, bounded Redis reconnection and local bell HTTP 200 verified. A dependency 503 now preserves its safe error code and copyable support reference. Hosted retest remains open.            | Verified locally |

## 2. Finance

| Finding | Remaining work / verification                                                                                                                                                                                                                                                                                                                                             | Status           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| FIN-01  | Bulgarian invoice/proforma/credit/debit documents, scoped concurrency-safe numbering, PDF/email delivery with retry, BNB rate snapshots, paid-proforma conversion and POS receipt links pass isolated local tests. The chosen layout is a standard Bulgarian review format; no accountant approval gate is added. Physical fiscal-device acceptance remains under ORG-03. | Verified locally |
| GEN-01  | EUR accounting is effective 1 Jan 2026 (ADR-0003). Existing local/test amounts are converted, EUR defaults are applied, and active schemas reject BGN; local reconciliation passes. Hosted migration and restore rehearsal remain.                                                                                                                                        | Verified locally |
| FIN-02  | EUR is the default, BGN is rejected for new transactions, and supported foreign-currency documents use dated BNB rate snapshots with EUR accounting values. Rate retrieval and conversion regressions pass locally.                                                                                                                                                       | Verified locally |
| FIN-03  | Cumulative amount/quantity limits, original-line prefill, cancelled-note capacity and concurrent/idempotent credit regression verified.                                                                                                                                                                                                                                   | Verified locally |
| FIN-04  | Cash protection verified for concurrent payments, backdating and receipt cancellation; cancelled test payments restore the original balance.                                                                                                                                                                                                                              | Verified locally |
| FIN-05  | Drafts excluded from revenue, sales journals/output VAT and invoice-derived CRM metrics; negative/zero-baseline trend styling verified.                                                                                                                                                                                                                                   | Verified locally |
| FIN-06  | Future collection/customer/supplier payment and advance rejection verified, including incoming/outgoing bank matching and offsets without allocations.                                                                                                                                                                                                                    | Verified locally |
| FIN-07  | Authorized Accounting Manager/Owner roles can reverse a posted payment with a reason; original payment and allocation links remain intact, retries are idempotent, and closed-period corrections use the current open period. Permission, balance and replay tests pass locally.                                                                                          | Verified locally |
| FIN-08  | Subscription periods open in Finance for VAT review; saved charges preserved, linked previews reopen the same draft, concurrent preparation deduplicated.                                                                                                                                                                                                                 | Verified locally |
| FIN-12  | CSV/XLSX statement import maps date, direction, amount, currency and reference; counterparty is optional. EUR is the import currency. Possible duplicates require explicit review; unknown matches are not guessed. Parser, validation and bank workflow tests pass locally.                                                                                              | Verified locally |
| FIN-09  | Manual Finance lines resolve shared customer/date/currency prices with Finance permission; missing prices stay blank and delayed reads preserve manual edits.                                                                                                                                                                                                             | Verified locally |
| FIN-10  | Customer advances apply to the same customer's open receivable as linked, auditable payments; concurrency, retry and balance checks pass locally. Hosted retest pending.                                                                                                                                                                                                  | Verified locally |
| FIN-11  | Readable scope-aware draft references; collision-safe sequences; permission-aware Finance-to-Sales source navigation and return. Hosted retest pending.                                                                                                                                                                                                                   | Verified locally |
| FIN-13  | Income and Outcome exports provide the agreed fields in CSV/XLSX; unavailable partner account codes stay blank. Worker generation, downloads, output format and permissions pass local integration tests. No accountant approval gate is added for the current review flow.                                                                                               | Verified locally |

## 3. Administration

| Finding | Remaining work / verification                                                                                                                                                                                                                                                                    | Status              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| ORG-01  | Bulgarian UIC 9/13-digit checksums and EU VAT formats are validated in Business Structure, Partners, and CRM lead conversion. VAT registration is not checked. Hosted retest remains.                                                                                                            | Verified locally    |
| ORG-02  | Version-checked edits and reversible deactivation for entities, branches, locations, operators and registers. Delete permission deactivates; Edit permission restores. Dependency guards prevent cascades; audit/outbox retain history. Hosted retest pending.                                   | Verified locally    |
| ORG-03  | Adopt the reported DATECS FP-2000, connected through a local USB adapter; keep the protocol behind the fiscal-device interface and use the simulator in development. Exact-unit H-18 registration and a real receipt/reversal on the target POS remain hardware acceptance, not a code decision. | External acceptance |
| SEC-01  | Admin role creation/editing, distinct role descriptions, five-action permission matrix, no-View warning, and Manager POS view without cashier privileges verified locally. Hosted retest pending.                                                                                                | Verified locally    |
| SEC-02  | Backend-enforced verified TOTP is mandatory for administrators and optional for other roles. Enrollment, login enforcement, recovery, authorization and audit regressions pass locally. Hosted role/account retest remains.                                                                      | Verified locally    |
| SEC-03  | Actual assigned role names, explicitly labelled active-session count and failed sign-in target display verified in API/browser. Hosted retest remains.                                                                                                                                           | Verified locally    |

## 4. Warehouse

| Finding | Remaining work / verification                                                                                                                                                                                                                                                                                                   | Status           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| WH-01   | One serial is now tested through a real supplier purchase-order receipt, sale, customer handover, repair return, Service work and technician repair history. Full trace is linked and locally verified. The older `DEMO-FR-ALFA-01` sample has no source receipt, so it remains explicitly unlinked; no history was fabricated. | Verified locally |
| WH-02   | Unknown source references are rejected without saving. The permission-protected active register persists, shows document numbers instead of internal IDs, prevents duplicate reservations when an order is referenced by ID or number, and supports release. Local validation passed; hosted retest pending.                    | Verified locally |
| WH-03   | Posted movement journal filters by warehouse, product, movement type and reference; linked receipts, shipments, returns, stocktakes and Service part issues open their source register. Internal UUIDs are not shown. Local API/UI tests passed; hosted retest pending.                                                         | Verified locally |
| WH-04   | A 10% or greater receipt-cost difference warns without blocking receipt. Compare the latest supplier-invoice cost, then latest product cost; show no warning without a baseline. EUR cost is used. Procurement UI/API and valuation regressions pass locally.                                                                   | Verified locally |
| WH-05   | Stock value summary now sums the displayed, cent-rounded line values using integer minor units; regression confirms the shown total reconciles. Hosted retest pending.                                                                                                                                                          | Verified locally |

## 5. Sales

| Finding | Remaining work / verification                                                                                                                                                                                                                          | Status           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| SAL-01  | Past validity dates are rejected using the configured business timezone. Expired drafts are displayed as Expired without rewriting their stored state and cannot be confirmed. Local API/UI checks passed; hosted retest pending.                      | Verified locally |
| SAL-02  | Draft revision, cancellation, stock guidance, bilingual quotation PDF, queued email delivery and retry after SMTP failure pass local API/UI integration tests. Production SMTP credentials still need deployment configuration; hosted retest remains. | Verified locally |

## 6. Service

| Finding | Remaining work / verification                                                                                                                                                                                                                                                                                                         | Status           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| SRV-01  | Technician drawer lists stocked batches with available quantities/expiry. Unknown batch returns a controlled 404; failed completion leaves work order and stock unchanged. Valid batch use, trace movement and deduction pass locally. Hosted retest pending.                                                                         | Verified locally |
| SRV-02  | Warranty customer charges are limited to labor and parts; transport and other charges are rejected. API integration tests pass locally.                                                                                                                                                                                               | Verified locally |
| SRV-03  | Work-order customer charges are recorded per job and kept separate from internal labor, part and transport costs. The completed-work browser journey verifies a EUR invoice draft from customer labor/transport charges while a zero-charge used part remains internal cost only. Totals, snapshots and Finance handoff pass locally. | Verified locally |
| SRV-04  | Unified equipment history now includes linked sales handovers, claim status history, unassigned requests, visits, completed repairs, used parts, technician and dates. Locally verified; hosted retest pending.                                                                                                                       | Verified locally |
| SRV-05  | Computed overdue flags appear for active scheduled/in-progress visits past their end and active inspections due before the Sofia business date. Due-today is distinct; stored workflow states are unchanged. API and Operations UI regressions pass locally.                                                                          | Verified locally |

## 7. CRM

| Finding | Remaining work / verification                                                                                                                                                                                                                                                                                                                                                         | Status           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| CRM-01  | Response/resolution at-risk and breach events, escalation recipients, delivered notifications and replay deduplication pass locally. Hosted retest pending.                                                                                                                                                                                                                           | Verified locally |
| CRM-02  | Search customers, review shared locations/equipment, and open the selected serial's Service history. Local UI/type checks passed; hosted retest pending.                                                                                                                                                                                                                              | Verified locally |
| CRM-03  | Service start/completion synchronizes equipment status; CRM cannot change/deactivate a device with open Service work. Retired devices stay visible in history but cannot receive new work. Locally tested; hosted retest pending.                                                                                                                                                     | Verified locally |
| CRM-04  | Completing linked Service work resolves its still-open CRM ticket once, retaining the stable correlation ID and writing one history, audit, and outbox record. Isolated API verification passed; hosted retest pending.                                                                                                                                                               | Verified locally |
| CRM-05  | Customer timeline combines CRM interactions/tasks, tickets, Service requests, Sales quotations and Finance payments in date order. Source records respect module access; payment values stay private. Local API and UI regressions passed; hosted retest pending.                                                                                                                     | Verified locally |
| CRM-06  | Sales handover now links legacy equipment with a missing catalog-product link before card generation. CRM counts eligible sold serials and edit-authorized reconciliation creates only cards backed by accepted handovers or completed POS sales, with audit/outbox and retry protection. Locally verified; hosted retest pending.                                                    | Verified locally |
| CRM-07  | Feedback & NPS lists completed Service jobs and accepted deliveries awaiting a survey; staff can open the preselected one-question survey, share it using their usual contact method, record the invitation and later save the customer's score. Duplicate attempts conflict; API/browser coverage passes locally. Automatic email remains subject to INT-001. Hosted retest pending. | Verified locally |
| CRM-08  | Lead telephone values accept common local/international notation with 7–15 digits, without forcing a country. The form shows a bilingual field error and blocks invalid submission; API responds with a telephone-specific validation detail. Domain, CRM API, component, and browser checks pass locally. Hosted retest pending.                                                     | Verified locally |
| CRM-09  | The pipeline now opens an unquoted opportunity when staff try to move it to Quotation sent, explains that a Sales quotation must be linked, and keeps the move disabled until linked. The API rejects direct attempts without changing stage/version; linking then moving passes locally. Hosted retest pending.                                                                      | Verified locally |
| CRM-10  | Configurable Sofia weekday hours; response/resolution timers start on ticket creation and stop when the corresponding event is recorded; 4-business-hour response, 2-business-day resolution, 75% at-risk alerts and overdue notices to the assignee and CRM manager are implemented and locally tested. Public holidays are excluded initially.                                      | Verified locally |

## 8. Logistics, POS and Recovery

| Finding | Remaining work / verification                                                                                                                                                                                                                                                                                                                     | Status              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| LOG-01  | Courier adapters are deferred for the current rollout; Econt/Speedy remain in the SRS and require vendor details and acceptance before activation.                                                                                                                                                                                                | Deferred            |
| POS-01  | Operations opens POS Reports at the configured public URL. Manager can review all views without export/write access; POS Operator can create exports. Isolated API/browser checks and frontend build pass locally. Hosted retest pending.                                                                                                         | Verified locally    |
| BCK-01  | Use the ADR-0004 baseline: deployed Vista database/object storage first, hourly critical database recovery points, daily full backups, 1h/4h critical RPO/RTO, encrypted independent copy and separated backup roles. Remaining evidence is the actual asset/hardware inventory and witnessed restore; production destructive actions stay gated. | External acceptance |

## 9. Shared interface

| Finding | Remaining work / verification                                                                                                                                                                                                                                                                                                               | Status           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| UI-01   | EN/BG statuses, actions, modules, pipeline history/notices, and date language across nested workflows. Local component and CRM journeys pass; hosted retest pending.                                                                                                                                                                        | Verified locally |
| UI-02   | Locale-consistent dates, decimals, currencies and VAT now use shared locale-aware formatters across Operations pages, notifications and reports. Operations component tests, typecheck and production build pass; hosted retest pending.                                                                                                    | Verified locally |
| UI-03   | UUID fragments are no longer presented as business references across Operations, Procurement, Warehouse and POS checkout recovery. Human context is shown; full technical IDs are available through localized copy controls. No purchase-order numbering was invented; BUS-002 remains open. Local regressions pass; hosted retest pending. | Verified locally |
| UI-04   | Tablet acceptance at 768 px covers four ERP report tables, partner register, six-stage CRM pipeline, opportunity/partner drawers and internal vertical scrolling. Browser checks pass locally; hosted retest pending.                                                                                                                       | Verified locally |
| UI-05   | System activity description and singular/plural labels corrected; record search covers partners, Finance legal documents, collection records, and serials with direct handoff; Escape closes drawers; browser-native validation is replaced by accessible inline EN/BG messages. Locally verified; hosted retest remains.                   | Verified locally |

## First batch evidence, 8 October 2026

- `npm run validate`: passed OpenAPI/client consistency, formatting, lint,
  workspace types, 354 enabled workspace tests and all production builds.
  Infrastructure-only tests are deliberately enabled in the separate run below.
- Isolated `--all-integration` run: all 255 API tests passed with no skips.
  Includes real Redis worker retry, reminder deduplication, cash concurrency,
  historical balance protection, credit concurrency and migration repair/rollback.
- `qa-finance.spec.ts`, `operations.spec.ts`, `trade.spec.ts`: all six browser
  journeys passed. Includes foreign-rate inputs, credit prefill/rejection,
  switching away from a delayed original-document lookup, tablet overflow,
  notification loading, permissions, attachments and the connected Sales/payment flow.
- Migration `0065` rolled back and reapplied in the disposable database. Its
  repair test preserves event content and leaves unsupported handoffs pending.
- Tablet Finance screenshot reviewed; browser and Operations type checks and
  affected-file lint passed. The existing Operations bundle-size warning remains.
- No hosted records, credentials or settings changed. No legal issuance,
  base-currency migration, external provider or certified hardware claim is made.

## Second Finance batch evidence, 9 October 2026

- `npm run validate` passed OpenAPI/client consistency, formatting, lint,
  workspace types, 354 enabled workspace tests and production builds.
- All 255 enabled API tests passed in disposable PostgreSQL/Redis infrastructure,
  including future supplier payments, incoming/outgoing bank matching and offsets,
  shared Finance price resolution, subscription source validation and concurrent
  preparation with different idempotency keys returning one active draft.
- All eight selected browser journeys passed: existing attachment, monitoring,
  credit/rate, notification and connected trade regressions, plus Finance-only
  customer prices and the real recurring-worker Sales-to-Finance handoff.
  Price tests include a delayed lookup during manual editing and an unmatched
  currency. Subscription tests include same-draft reopening, Bulgarian dates
  and actions, tablet drawer and page overflow checks.
- Migration `0066` rolled back and reapplied in the disposable database;
  reviewed tablet screenshots. A shared top-bar search minimum width that caused
  tablet overflow was removed. Finance summary-label EN/BG regression passed.
- Final browser type checking, lint and formatting passed. Existing Operations
  bundle-size warning remains. No hosted records or configuration changed.
- Subscription records are Finance review drafts, not legal issuance or collection
  posting. Approved numbering, BNB, provider and hardware dependencies remain.

## Third Finance batch evidence, 9 October 2026

- FIN-10 is locally verified. The advance can be applied to a same-customer
  open receivable; available funds and receivable limits are enforced, concurrent
  applications cannot double-spend the advance, and retry returns the same result.
  The client preserves fixed-decimal values through allocation and account totals.
- The resulting payment retains the advance's original date, method and reference;
  collection, advance balance, append-only ledger, audit and outbox stay linked.
- Full `npm run validate` passed OpenAPI/client checks, formatting, lint,
  workspace types, all 354 enabled tests and production builds. Infrastructure
  tests were run separately.
- All 22 Sales/Finance API integration tests, all five Finance browser journeys,
  and all 54 ERP/CRM component tests passed. Migration `0067` rolled back and
  reapplied on a clean disposable schema. Hosted retest remains open.

## Fourth Finance batch evidence, 9 October 2026

- FIN-11 is locally verified. Internal draft references now include readable
  location, register and operator scope, while sequence uniqueness remains
  protected by the immutable scope key. Official numbering rules are unchanged.
- Finance collection and financial-document previews can open the linked Sales
  workflow when the user has Sales view permission. The drawer returns directly
  to the originating Finance page; a browser test covers the complete route.
- All 22 Sales/Finance API integration tests and six Finance QA browser journeys
  passed. The source-navigation component regression passed.
- Full `npm run validate` passed OpenAPI/client checks, formatting, lint,
  workspace types, 354 enabled tests and production builds. The existing
  Operations bundle-size warning remains. Hosted retest is still pending.

## Shared interface batch, 9 October 2026

- UI-02 is locally verified. Shared formatters now keep exact decimal inputs,
  localize dates, quantities, decimal/group separators and EUR/foreign-currency
  amounts consistently across Finance, CRM, Service, Sales, Procurement,
  Logistics, Warehouse, reports, partner files and payment notifications. VAT
  percentages follow the selected language; date-input and machine ISO values
  remain unchanged.
- Added regressions for large exact-decimal values, localized VAT/amounts,
  notifications and switching the Operations shell from EN to BG. The app-level
  test harness now mounts the same LocalizationProvider used in production.
- All 122 Operations component tests passed, Operations typecheck passed, and
  the production build passed. The existing bundle-size warning remains.
  Hosted visual retest is still required.

## Fifth batch evidence, 9 October 2026

- ORG-01 is locally verified. Invalid Bulgarian UICs and EU VAT formats are
  rejected before saving in organization, partner, and new-customer conversion
  flows. Valid-format Bulgarian and EU examples pass; existing unchanged partner
  identifiers remain editable. VAT format checks do not establish that a tax
  registration is active.
- The isolated QA/CRM run passed 47 API integration tests and four CRM browser
  journeys. The Operations component suite passed all 55 tests, including
  field-level rejection in Business Structure, Partners and CRM conversion.
- Full `npm run validate` passed API contract checks, formatting, lint, all 354
  enabled workspace tests, and production builds. The existing Operations
  bundle-size warning remains. Hosted retest is still pending.

## Sixth batch evidence, 9 October 2026

- ORG-02 is locally verified. Legal entities, branches, locations, operators
  and cash registers support version-checked edits and reversible status changes.
  Deactivation requires Delete permission; reactivation requires Edit. Active
  children, warehouse links, register assignments and open shifts block parent
  deactivation without cascading. Inactive records remain visible for controlled
  restoration; audit and outbox history are retained.
- Isolated PostgreSQL/Redis QA integration passed all 48 tests, including the
  organization lifecycle and permission separation. Four CRM browser journeys
  passed. The Operations component suite passed all 56 tests; focused permission
  policy and development-account fixture tests passed. OpenAPI/client generation
  and checks passed. Hosted retest remains pending.

Hosted platform verification and external hardware/restore evidence remain
open. No client decision blocks the 12 items listed in the 14 October update.

## Seventh batch evidence, 9 October 2026

- SEC-01 is locally verified. Role descriptions now identify each demo role's
  responsibilities; administrators can create and edit roles through the full
  View/Create/Edit/Delete/Approve matrix. Selected non-View actions show a
  warning explaining that users cannot open that module's screens without View.
- The local Manager has POS View and Approve, but no POS Create or Edit. The
  role screen's warning and controls are bilingual; backend role changes remain
  permission-protected, version-checked, idempotent, and audited.
- The security control-room browser regression and full ERP/CRM suite passed.
  Isolated auth/security integration passed all 16 tests, including denied edit,
  administrator update, retry replay, and before/after audit evidence. One
  isolated browser acceptance journey passed.
- Full `npm run validate` passed OpenAPI/client consistency, formatting, lint,
  workspace types, enabled tests, and production builds. The existing Operations
  bundle-size warning remains. No hosted roles or permissions were changed.

At this point in the 9 October sequence, WH-01 still awaited a genuine source
receipt. The 14 October update above supersedes that status: the complete trace
is now verified against a purchase order and receipt created through the API.
Hosted verification remains open.

## Eighth batch evidence, 9 October 2026

- SEC-03 is locally verified. The authenticated account context carries its
  assigned role names, and the Operations account menu shows the actual role
  instead of a generic employee label. The Sessions tab labels its number as
  active while retaining revoked and expired entries in the history list.
- Failed sign-in audit entries resolve a known target account to its employee
  display name. Unknown email addresses are not copied into the audit record;
  those entries are labelled as an unrecognized account. The audit still shows
  the system as the event actor.
- Focused Operations UI regression, API type check, all 16 isolated
  authentication/security integration tests, and one isolated browser journey
  passed. Full `npm run validate` passed OpenAPI/client checks, formatting,
  lint, workspace types, 359 enabled tests, and production builds. The existing
  Operations bundle-size warning remains. Hosted retest remains pending.

## Ninth batch evidence, 9 October 2026

- WH-01 now resolves an installed customer device when no inventory serial row
  exists. The response includes its customer, location, product/device name and
  linked Service history; it does not invent a warehouse, receipt, or sale.
  Operations shows an explicit notice when inventory history is not linked.
- At this point in the 9 October sequence, the source QA sample
  `DEMO-FR-ALFA-01` was registered at Alfa Market but had no serialized
  inventory/receipt source in the demo fixture. The finding remained in
  progress until genuine source records were added to the isolated test flow;
  the 14 October update above records that verification.
- The isolated QA suite passed all 43 selected API integration tests and one
  browser journey. The ERP/CRM app suite passed all 56 tests; API type checking
  passed. `npm run validate` passed OpenAPI/client checks, formatting, lint,
  workspace types, 359 enabled tests, and production builds. The existing
  Operations bundle-size warning remains.
- No customer history, hosted record, or stock balance was changed.

## Tenth batch evidence, 9 October 2026

- WH-02 is locally verified. Creating a reservation requires an existing
  quotation, sales order or Service request; `NONEXISTENT-SO-999` returns a
  specific 404 and creates no reservation. Existing document IDs and public
  document numbers resolve to one canonical source; duplicate active reservations
  are rejected even when the same order is submitted once by ID and once by number.
  The register shows public references and never exposes an unresolved internal ID.
- A permission-protected, paginated active-reservation register now survives
  reloads and offers a release action. Releasing removes the entry from the
  active list while retaining the auditable reservation record.
- The focused ERP/CRM UI regression passed. Isolated PostgreSQL/Redis integration
  passed all 43 selected API tests, including the invalid reference, no-write
  result, denied viewer access, release, automatic sales-order reference display,
  and duplicate prevention; the browser journey passed. Full `npm run validate`
  passed OpenAPI/client checks, formatting, lint, workspace types, enabled tests,
  and production builds. The existing Operations bundle-size warning remains.
  Hosted retest remains pending.
- No hosted record or customer data was changed.

## Eleventh batch evidence, 9 October 2026

- WH-03 is locally verified. The Stock movements page now lists posted receipts,
  issues, returns, transfers and stocktake adjustments with signed quantities,
  value, actor, date, warehouse, product and available source reference. Filters
  cover warehouse, product, movement type and product/reference search.
- Linked Procurement receipts, Sales shipments, Logistics returns, stocktakes
  and Service part issues navigate to their corresponding registers. Unknown
  UUID-like references are hidden rather than displayed as internal identifiers.
- The browser regression verified combined filters and source navigation. The
  isolated PostgreSQL/Redis run passed all 43 selected API tests, including
  stocktake source details and permission denial; one browser journey passed.
  API and web type checks passed. Hosted retest remains pending.
- No hosted records or inventory balances were changed.

## Twelfth batch evidence, 9 October 2026

- WH-04 now displays a bilingual, non-blocking warning when a EUR receipt unit
  cost differs from the EUR purchase-order price. Excluding the line hides the
  warning. The user-entered cost is submitted and retained for stock valuation;
  isolated PostgreSQL integration confirms the weighted average uses that cost.
- The purchase-order UI regression passed. The full API suite exposed stale POS
  role expectations, which were corrected to match Manager's configured
  read-only POS access and operator-scoped transaction lookup. An unrelated
  managed-file cleanup hook was extended for full-suite parallel load.
- The project owner later confirmed the 10% threshold, latest-cost comparison,
  and warning-only behavior in ADR-0004. EUR-aware comparison follows the
  accounting transition. Hosted retest remains pending. No hosted or
  development stock records were changed.

## Thirteenth batch evidence, 9 October 2026

- WH-05 is locally verified. Inventory value now sums each stock row after the
  same two-decimal display rounding, using integer minor units rather than
  floating-point accumulation. The regression covers values that previously
  could make the total differ by EUR 0.01.
- SAL-01 is locally verified. A quotation cannot be created with a validity date
  before today's configured business date. Existing drafts whose validity has
  ended display **Expired** without changing their persisted draft status, and
  the API rejects confirmation. API integration confirms no order is created;
  the UI test verifies the date guard and hides the confirmation action.
- The isolated API suite passed all 257 tests; the focused Sales UI regression,
  API/web type checks, and OpenAPI/client consistency check passed. The full
  browser run passed 53/55; its two failures were stale recovery-button selectors
  in the test script, not application behavior. Both corrected recovery journeys
  passed on isolated rerun. Hosted retest remains pending.
- No hosted records, development stock balances, or sales data were changed.

## Fourteenth batch evidence, 9 October 2026

- SAL-02's local quotation lifecycle is implemented: users can revise or cancel
  only draft/expired quotations; version checks prevent stale edits, each saved
  revision is snapshotted, and changes are audited. Cancellation records its
  actor, time and optional reason. Confirmed quotations cannot be rewritten.
- Stock availability guidance is shown while preparing and previewing a
  quotation. Confirmation still rechecks inventory and reservations as the final
  authority. A bilingual, printable commercial quotation PDF is available; it
  is clearly not a tax invoice.
- The quotation API integration suite passed all 24 tests, including revisions,
  stale-version rejection, idempotent retry, snapshots, cancellation and PDF
  retrieval. The focused Sales UI workflow and bilingual PDF renderer tests
  passed. The full `npm run validate` passed OpenAPI/client checks, formatting,
  lint, all workspace type checks, 168 enabled tests and production builds. The
  default validation run skips infrastructure-only API tests; the 24-test
  quotation integration suite was run separately with PostgreSQL/Redis.
- Email delivery remains open until the approved sender/provider and delivery
  rules are supplied. Hosted retest remains open. No hosted configuration or
  records were changed.

## Fifteenth batch evidence, 9 October 2026

- SRV-01 is locally verified. Service reference data now includes available
  technician-warehouse batches, quantity and expiry date. The completion panel
  selects a stocked batch rather than accepting free text, caps quantity at its
  availability, and explains when no batch is available. Labels and error
  messages are bilingual.
- An unknown batch returns `INVENTORY_BATCH_NOT_FOUND` (404). Integration
  evidence confirms the work order stays in progress and no stock or issue
  movement is committed. A valid batch completion records batch usage, deducts
  both product and batch balances once, and carries the selected batch into the
  work-order and Finance handoff records.
- OpenAPI/client generation, workspace type checks, and all 24 isolated
  PostgreSQL/Redis Sales/Service integration tests passed. Hosted retest remains
  pending. No hosted or development records were changed.

## Sixteenth batch evidence, 9 October 2026

- SRV-04 is locally verified. The equipment-history API combines source-linked
  sales handovers, warranty-claim status changes, unassigned service requests,
  scheduled/in-progress visits, and completed repairs. Entries are newest first
  and retain their source reference, current state, event date, assigned
  technician, and used-part/batch details where applicable.
- Users with Service approval can review the full equipment history. A
  technician without approval sees only assigned work and cannot retrieve an
  unrelated device's history. The bilingual Equipment history page now labels
  each event type and status clearly.
- All 24 isolated PostgreSQL/Redis Sales/Service integration tests passed,
  including sale, both claim states, an unassigned request, repair details,
  event ordering and technician scope. All 113 Operations/CRM web tests passed.
  OpenAPI/client generation, type checks, formatting, lint, workspace tests and
  production builds are included in the full validation pass. Hosted retest
  remains pending; no hosted records or customer data were changed.

## Seventeenth batch evidence, 9 October 2026

- SRV-05 is locally verified. Active scheduled or in-progress visits are marked
  overdue only after the appointment end instant. Active inspection plans are
  marked overdue only when the due date is before the configured Sofia business
  date; a plan due today is not overdue. These are calculated response flags,
  not stored status changes.
- The request register, work-order cards, technician calendar, inspection cards,
  and inspection detail show a clear bilingual overdue state. Completing an
  inspection refreshes the due indicator.
- All 24 isolated PostgreSQL/Redis Sales/Service integration tests passed,
  including due-today/past-due boundaries and scheduled/in-progress visits. All
  57 Operations/CRM app tests passed, including overdue calendar and inspection
  panel assertions. Three browser regressions also passed. Full validation
  passed OpenAPI/client consistency, formatting, lint, type checks, workspace
  tests and production builds. Hosted retest remains pending; no hosted records
  were changed.

## Eighteenth batch evidence, 9 October 2026

- CRM-01 is locally verified. The SLA evaluator records approaching and missed
  response/resolution deadlines, sends each escalation once to the configured
  recipient, and retains notification delivery state in the ticket's SLA history.
- Replaying the evaluator produces no duplicate escalation or notification. The
  ticket preview shows the triggering deadline, recipient and delivery status
  without exposing internal account identifiers. Labels are bilingual.
- All 24 isolated PostgreSQL/Redis Sales/CRM/Service API integration tests and
  all 58 Operations/CRM component tests passed. Three selected browser checks
  passed. Hosted retest remains pending; no hosted records were changed.

## Nineteenth batch evidence, 9 October 2026

- CRM-02 now has a dedicated customer Locations & equipment register. It reads
  shared partner/location/equipment records, respects CRM and Service access,
  and carries the chosen equipment into Service history without duplicating
  customer or device records.
- The ERP/CRM frontend typecheck passed. All 115 frontend tests passed,
  including the CRM-to-Service history handoff regression. Hosted retest remains
  pending; no hosted records were changed.

## Twentieth batch evidence, 9 October 2026

- CRM-03 keeps Active, Under repair and Retired statuses aligned with Service.
  Starting work sets Under repair; completing work restores Active. Status edits
  and deactivation are blocked while work is scheduled or in progress, with a
  clear bilingual explanation. Retired devices remain in history and cannot be
  selected for new Service requests.
- The isolated PostgreSQL/Redis suite passed all 24 Sales/Service integration
  tests, including the status transitions and guards. All 115 frontend tests,
  API and UI typechecks, targeted lint, and three browser regressions passed.
  Hosted retest remains pending; no hosted records were changed.

## Twenty-first batch evidence, 9 October 2026

- CRM-04 is locally verified. Completing a Service work order resolves its
  linked CRM ticket only if that ticket is still open. The update, bilingual
  history note, audit event and outbox event commit together and retain the
  existing ticket/service correlation ID. Retrying ticket-link creation returns
  the same resolved ticket and adds no duplicate resolution records.
- All 24 isolated PostgreSQL/Redis Sales/Service integration tests passed,
  including single-resolution history/audit/outbox assertions. Three selected
  browser checks passed; API typecheck, targeted lint and formatting passed.
  Hosted retest remains pending; no hosted records were changed.

## Twenty-second batch evidence, 9 October 2026

- CRM-05 is locally verified. The customer timeline combines CRM interactions
  and task history with linked tickets, Service requests and work updates,
  Sales quotations, and customer payments. Entries remain chronological; a
  location filter does not falsely assign account-wide records to a location.
- The API returns operational entries only when the signed-in account can view
  their source module. Finance entries do not expose payment amounts or payment
  references. The bilingual UI displays source, status and public reference;
  opening a ticket from its timeline entry opens that ticket.
- All 9 isolated PostgreSQL API tests for CRM pipeline and timeline passed,
  including CRM-only access filtering and payment-value exclusion. All 59
  Operations/CRM component tests passed, including linked-ticket navigation;
  three selected browser checks also passed. Hosted retest remains pending;
  no hosted records were changed.

## Twenty-third batch evidence, 9 October 2026

- CRM-06 is locally verified. Sales handover repairs the catalog and inventory
  links for an existing serial record before issuing its warranty card. CRM
  reports eligible sold serials, registered cards and missing cards using the
  completed POS sale and accepted Sales handover records as evidence.
- An authorized, idempotent reconciliation action creates missing cards only
  for those source-linked sales, with audit and outbox events. The register
  updates immediately; repeated requests do not create duplicate cards. The
  bilingual UI shows a repair notice only when a verified gap exists.
- All 24 isolated Sales/Service API integration tests passed, including a
  simulated legacy equipment record, exact one-card generation, missing-card
  reconciliation, permission denial, and replay. All 59 Operations/CRM
  component tests passed. Full `npm run validate` passed, including OpenAPI
  drift, formatting, lint, typechecks, workspace tests and builds. Three
  selected warranty browser checks passed. Hosted retest remains pending; no
  hosted records were changed.

## Twenty-fourth batch evidence, 9 October 2026

- CRM-07 is locally verified. Feedback & NPS now lists completed Service jobs
  and accepted deliveries without a survey. The selected source is carried
  into the one-question survey form; staff are asked to share it with the
  customer through their usual contact method before recording the invitation.
  Customer scores and optional comments stay linked to their source work and
  update NPS.
- The API excludes completed work without a customer location, rejects a second
  invitation with a conflict, protects creation by permission, and supports
  safe replay for invitation and response commands. The isolated Service API
  suite passed all 24 tests; the Operations/CRM component test, API/UI
  typechecks, and connected browser journey passed. The browser test records an
  invitation after serialised handover and captures a response.
- Automatic customer email is not claimed because the approved email provider
  remains open under INT-001. Hosted retest remains pending; no hosted records
  were changed.

## Twenty-fifth batch evidence, 9 October 2026

- CRM-08 is locally verified. Lead telephone numbers now accept common local or
  international formatting without assuming a country, require 7–15 digits,
  and reject arbitrary text. The lead form explains the format in English and
  Bulgarian, marks the field invalid accessibly, and keeps Save lead disabled
  until the value is corrected. The API returns a specific telephone field
  error before creating a lead.
- Domain tests passed 9/9, the focused lead UI test passed, CRM API and timeline
  integration tests passed 9/9, the CRM browser suite passed 4/4, and API and
  web typechecks passed. Hosted retest remains pending; no hosted records were
  changed.

## Twenty-sixth batch evidence, 9 October 2026

- CRM-09 is locally verified. Attempting to move an unquoted opportunity to
  Quotation sent opens its panel with that stage selected, explains the missing
  quote, and disables the move until staff link a customer quotation. The API
  returns a specific conflict without changing the stage; linking a quote then
  allows the transition.
- The opportunity UI regression, isolated CRM pipeline/timeline API suite
  (9/9), and CRM browser suite (4/4, including the report's drag-and-drop path)
  passed. Hosted retest remains pending; no hosted records were changed.

## Twenty-seventh batch evidence, 9 October 2026

- POS-01 is locally verified. Operations' report library now opens the POS
  Reports screen through the configured cross-app URL; no dead internal
  `/modules/pos` destination remains. Coolify requires the public POS origin at
  build time, and isolated browser coverage uses the configured POS address.
- Manager can read the overview, all report definitions, and POS report views
  without create permission. The POS Operator retains report-creation access.
  Four isolated POS API tests and the Manager cross-app browser journey passed;
  the report-history browser journey also passed. Hosted retest remains pending;
  no hosted records were changed.

## Twenty-eighth batch evidence, 9 October 2026

- UI-01 is locally verified. Added reviewed Bulgarian labels for the missing
  logistics, Service, CRM and NPS statuses plus common Create/Update actions.
  CRM pipeline stages now use natural forms for leads and opportunities; its
  history and stage-change confirmation are fully localized. Nested workflow
  dates use the active app language rather than the browser's system locale.
- The translation-boundary, locale-provider and CRM label tests passed (7/7),
  the CRM pipeline/timeline API suite passed (9/9), and the four existing CRM
  browser journeys plus the Bulgarian-to-English pipeline journey passed in
  isolated runs. Operations typecheck and affected-file lint passed.
- The production-style Docker image rehearsal stopped before application
  compilation because `npm ci` received a registry read timeout. This is a
  network check to retry, not a passing image build; hosted retesting also
  remains pending.

## Twenty-ninth batch evidence, 9 October 2026

- UI-02 is locally verified. Shared formatters now localize dates, quantities,
  decimal/group separators, EUR/foreign-currency amounts and VAT presentation
  across Operations Finance, CRM, Service, Sales, Procurement, Logistics,
  Warehouse, reports, partner files and payment notifications. Exact financial
  decimal strings and machine date values remain unchanged.
- Added regressions for large exact-decimal values, localized VAT/amounts,
  payment notifications and switching the Operations shell from EN to BG. The
  app-level test harness now mounts the same LocalizationProvider used in the
  production entry point.
- Full `npm run validate` passed OpenAPI/client consistency, formatting, lint,
  workspace typechecks, all 372 enabled workspace tests and production builds.
  Ninety-one infrastructure integration tests are intentionally skipped by
  this default suite and remain covered by separate isolated runs. The existing
  Operations bundle-size warning remains. Hosted visual retest is still
  required.

## Thirtieth batch evidence, 9 October 2026

- UI-03 is locally verified. System activity, partner details, sign-in errors,
  Procurement purchase orders and goods receipts, Warehouse movement results,
  and POS checkout recovery no longer show shortened UUIDs as if they were
  business references. Human supplier/warehouse/date or delivery-reference
  context remains visible; full technical identifiers are copied with a
  localized button and are shown only as a selectable fallback if clipboard
  access fails.
- Purchase-order numbering remains unresolved under BUS-002; no numbering rule
  was invented. A missing product-code fallback no longer displays the
  underlying product UUID.
- The identifier component and Operations app tests passed (61/61); POS
  checkout/recovery tests passed (25/25). Operations and POS typechecks passed.
  Full `npm run validate` passed OpenAPI/client checks, formatting, lint,
  workspace typechecks, 376 enabled tests and production builds. The 91
  infrastructure-only API tests remain skipped by the default suite; the
  existing Operations bundle-size warning remains. Hosted retest is pending.

## Thirty-first batch evidence, 9 October 2026

- UI-04 is locally verified at a 768 px tablet viewport. Procurement, Warehouse,
  Sales and Logistics report tables remain reachable within their own horizontal
  scroll regions without widening the page. The partner register behaves the
  same way; its record drawer now uses border-box sizing so its padding cannot
  push it beyond the tablet edge, and its content remains vertically scrollable.
- The six-stage CRM pipeline scrolls within the board, not the page. Its
  opportunity drawer fits the viewport and keeps its content reachable. Browser
  checks also cover the report table and partner table scroll positions.
- Isolated Chromium browser checks passed for all 5 CRM journeys, 5 report
  journeys, both Business Structure/partner journeys, plus a rerun of the
  partner-drawer check after accounting for its opening animation. The drawer
  screenshot was reviewed at tablet width. Hosted retest remains pending; no
  hosted records were changed.

## Thirty-second batch evidence, 9 October 2026

- The full `npm run validate` passed: OpenAPI/client consistency, formatting,
  lint, workspace typechecks, 377 enabled tests and all production builds. The
  91 infrastructure-only API tests remain skipped by the default suite and are
  covered by the separate isolated integration runs recorded above. The
  Operations bundle-size warning remains.
- UI-05 is locally verified. The overview greeting no longer includes an
  employee's display name, the duplicate System activity description is
  corrected, singular counts use singular grammar, and Sales identifiers have
  a readable separator. Escape closes the active drawer, and invalid native
  form values receive accessible inline English or Bulgarian messages.
- Global search now covers partners, legal Finance documents, customer
  collection records and serials through permission-protected APIs. Selecting
  a result opens that record in its register; the demo journey confirms the
  seeded customer, collection record and equipment serial.
- Operations component tests passed 60/60, isolated QA PostgreSQL/Redis API
  integration passed 45/45, the CRM lead validation/Escape journey passed, and
  the Chromium global-search journey passed. Hosted retest remains pending; no
  hosted records were changed. The new serial-search endpoint is explicitly
  covered by the HTTP read-rate-limit policy regression.

## Thirty-third batch evidence, 12 October 2026

- SYS-01 is locally verified. System activity now identifies events that have
  no registered receiving integration. They are not counted as work in
  progress, their details explain why they are waiting, and retry is withheld.
  The API rejects replay with `INTEGRATION_CONSUMER_NOT_CONFIGURED` and leaves
  the event status and replay count unchanged.
- Full `npm run validate` passed OpenAPI/client consistency, formatting, lint,
  all workspace typechecks, 379 enabled tests, and production builds. The
  default run skips 91 infrastructure-only tests; the isolated QA run passed
  all 45 API integration tests and all 3 Operations browser journeys using
  system Chromium. This includes the no-receiver replay and telemetry checks.
- SYS-02 local recovery behavior is covered. A test-only dependency outage
  returns a stable error code and the same correlation reference in the API
  header and response. The Operations notification panel shows plain-language
  guidance, the safe error code and a copyable support reference in English
  and Bulgarian. The hosted 503 still needs to be captured and retested after
  deployment; no hosted data was changed.
- At that time, reconciliation recorded `WH-001` for the goods-receipt
  variance threshold and foreign-currency comparison. The project owner later
  selected the 10% EUR baseline in ADR-0004; WH-04 is now **Verified locally**.
- Hosted activity backlog review remains pending. No hosted records or local
  business data were changed.

## Release checks

- Unit/type/lint/build checks for each implementation batch.
- Isolated PostgreSQL/Redis integration tests, migration up/down/up and browser flows.
- After deployment, recheck processing and the notification endpoint on the hosted
  environment. Capture safe error codes/references, never credentials or secrets.
- Keep TESTME.md short and navigation-based. Preserve its current user edits.
