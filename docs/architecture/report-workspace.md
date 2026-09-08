# Saved reports and operational Overview

Scope: AGENTS.md §§6.7, 7.6, 11 and 13. This increment does not enable official
accounting issuance, VAT filing or arbitrary SQL. Saved views use only the
reviewed Finance, Procurement, Warehouse, Sales, Logistics, Service, CRM and POS
report definitions described below.

## Overview card preferences

Overview → Customize overview lists only metrics returned for the signed-in role.
Save layout persists the hidden-card list for that account, across browsers and
sessions. Show all cards followed by Save layout restores the default visibility.
Hiding all available cards leaves the customization control accessible. Date
filters remain session-local; saving a layout does not change KPI calculations.

The authenticated PUT `/api/v1/operations/overview/preferences` accepts only four
reviewed metric keys and an integer revision. Accounts need Finance view, CRM view
or Service approve, matching the Overview entry policy. The owner comes only from
authentication. Preferences never grant metric access. Same-content retries are
no-ops; conflicting stale revisions return 409 without overwriting current choices.
Row locking and audit share one transaction. GET Overview reads preferences and
metrics from the same repeatable-read snapshot. Apply reloads current preferences
after a conflict. UI interaction tests and PostgreSQL integration tests cover save,
reload, reset, owner isolation, concurrent retries and conflict/validation behavior.

## Finance saved reports

- Finance → Finance reports → Export report offers the reviewed field catalogue,
  period (where applicable), file format, and private named configurations.
- Saved configurations are immutable copies in `reporting.saved_finance_reports`.
  Changed options can be saved as a new report. Names need not be unique.
- The same client-generated UUID and normalized request return one configuration
  and one audit event, including concurrent retries. Changed content with a reused
  UUID is rejected. The list is owner-scoped and paginated.
- Viewing requires Finance view permission; saving requires view and create.
  Export requests, retries and downloads retain their existing permission and
  owner checks. The UI disables commands without the required permission.
- Only reviewed field keys are accepted. Empty, duplicate and unknown fields,
  unknown request properties, invalid calendar dates, and reversed or inapplicable
  periods are rejected. SQL cannot be supplied by users.
- Export jobs persist the chosen period and field order before queueing. The
  existing renderer applies the same selection to CSV, XLSX and PDF. Formula-like
  spreadsheet text remains escaped. Saved options are not a data snapshot:
  each new export reads current source records when its worker executes. Completed
  files remain immutable and integrity-checked; replay does not post a second job.

## Saved Service reports

The Service request register, technician performance, and cost summary expose
their reviewed columns. Users can save a name, inclusive date range, file format,
and selected fields, then reopen those options in Service > Reports. Saving
creates an immutable private copy in `reporting.saved_service_reports`.
The owner-paginated `GET /api/v1/service/saved-reports` requires Service approve;
`POST` additionally requires Service create. Concurrent identical UUID requests
produce one copy and audit event; changed requests with that UUID conflict.
Unknown or duplicate fields, empty selections, invalid dates and extra request
properties are rejected. The active definition must support the chosen format.

Exports retain the asynchronous worker, owner-scoped downloads, integrity checks
and retry lifecycle. Column order is persisted and applied to CSV, Excel and PDF.
Omitting columns retains the full report for existing callers. Saved options are
not a snapshot of report data.

Dates filter request creation in the business timezone, including both endpoints.
Status, technician, recorded time and costs reflect current records when the
worker runs. Technician reports group by account and exclude unassigned work.
No financial posting or Service calculation changes are introduced.

The export panel shares Finance field-selection styling with its footer outside
the scrolling body. Component tests cover save/reopen/export, invalid selections
and periods, permission visibility and retry keys. PostgreSQL tests cover save
concurrency, owner isolation, validation, audit and column persistence; render
tests cover all three formats. Live visual verification is pending because no
browser is connected in this session.

## Saved CRM reports

All four CRM reports support private saved date ranges, formats and selected
columns: customer value and retention, pipeline conversion, employee performance,
and revenue breakdown. `GET /api/v1/crm/saved-reports` requires CRM view and lists
only the caller's copies, with pagination. `POST` additionally requires CRM create.
The immutable copies in `reporting.saved_crm_reports` use normalized hashes and
UUID replay protection, including concurrent saves and a single audit event.
Empty, unknown, duplicate or other-report fields, malformed/reversed dates,
unsupported formats and extra request properties are rejected. Omitting columns
on an export preserves the original full-report behavior.

Column order is stored with each export and applied by the existing asynchronous
worker to Excel, CSV and PDF. Saved options do not freeze source data. Existing
CRM calculation criteria remain in each export: equal-period customer comparison,
opportunity-cohort pipeline analysis, employee completion dates and recorded
financial value using document rate snapshots. This does not introduce posted
accounting revenue or change any KPI formula.

The panel uses shared field-selection styling, a scrolling body and a separate
footer. Tests cover saving/reopening, validation, retry keys, field reset when
changing report type, all formats, owner isolation, audit and worker replay.
Live visual verification remains pending because no browser is connected.

## Saved POS reports

Seven date-range reports support private saved options and field-selectable
Excel/CSV/PDF exports: shifts, cashiers, products, categories, payments, locations
and location comparisons. `GET /api/v1/pos/saved-reports` is owner-paginated and
requires POS view; `POST` additionally requires POS create. UUID/content hashes
ensure concurrent retries produce one configuration and audit event. Unknown,
duplicate and empty fields, malformed/reversed dates, extra properties and
unsupported formats are rejected. Selected order and filters persist on the export
job. Omitting columns retains the original full-report behavior.

Saved options restore the report tab, applied dates and optional location/register/
cashier filters, format and fields. On-screen tables remain complete; field
selection affects files only. Controls are inline, collapsible and responsive.
Saving/export/retry controls respect POS create permission.

X/Z reports retain their complete shift-based export flow. They cannot be saved
as date-range views or have totals hidden by field selection. Existing open/closed
shift checks, snapshot behavior and simulator labels remain. This feature does
not issue a certified fiscal report or change any POS totals.

Evidence: `PosSavedReports.test.tsx`, POS application tests,
`pos-report-columns.test.ts` and isolated `pos.integration.test.ts` (save replay,
validation, private access, audit, column persistence and migration rollback).
All three formats use the shared renderer. Browser-based visual verification is
pending because no browser is connected in this session.

## Procurement, Warehouse, Sales and Logistics reports

Each module has a Reports work area and a common responsive report workspace.
Access requires that module's view permission. Saving, requesting exports and
retrying exports also require create permission. Downloads and lists are always
owner-scoped, even between employees with identical permissions.

| Module      | Report                    | Grain and date basis                                                                                                                                                                                                                                 |
| ----------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Procurement | Purchase order comparison | One row per ordered product; order creation date. Ordered, delivered and invoiced quantities come from the purchase-order line. Awaiting delivery is ordered less delivered.                                                                         |
| Procurement | Supplier claims           | One row per claim; claim creation date. All current claim statuses are included.                                                                                                                                                                     |
| Warehouse   | Stock and valuation       | Current balance per warehouse/product, including inactive master records with stock. Active remaining reservations are summed once; available is on-hand less reserved. Value is on-hand × weighted-average unit cost, rounded to four BGN decimals. |
| Warehouse   | Stock movements           | One row per posted transaction; occurrence date. Quantity is the recorded amount, with direction identified by movement type.                                                                                                                        |
| Warehouse   | Replenishment             | Current configured stock policies only. Uses the reservation-aware replenishment view, including policies with zero stock. Recommended quantity is max(target − available, 0).                                                                       |
| Sales       | Quotations and orders     | One row per quotation; quotation creation date. Preserves original currency and VAT-inclusive total, with no cross-currency total.                                                                                                                   |
| Sales       | Shipments                 | One row per shipment; shipment date. Links to its order and prepared invoice draft, not an official invoice.                                                                                                                                         |
| Logistics   | Deliveries                | One row per delivery; scheduled start date. Includes cancellations and exceptions.                                                                                                                                                                   |
| Logistics   | Returns and repairs       | One row per return line; return registration date. Includes original shipment, destination and applicable Service request.                                                                                                                           |
| Logistics   | Route plans               | One row per route; route date. Stop count includes the plan's current stops.                                                                                                                                                                         |

- Date ranges are inclusive business-calendar dates in the configured timezone.
  Current-state reports reject date ranges instead of presenting historical data.
- Search is a case-insensitive literal substring across report values, not SQL or
  wildcard syntax. Empty search means all rows. It is limited to 120 characters.
- The preview has 25 rows per page, a stable source-ID order and an independently
  counted total in the same repeatable-read snapshot. Internal ordering IDs are
  removed from the response. Export uses the same query/fields and a fresh
  snapshot when the job runs; it is not restricted to the visible page.
- Selected fields control the preview and every export format. At least one
  reviewed field is required. Dates, search, field order and format are saved;
  names need not be unique. Changed views are new immutable copies.
- Saving/exporting uses applied filters, not unsaved edits in the filter form.
  Lost responses retain the client request key; repeated identical saves or
  export requests do not create another record. Successful new export requests
  can deliberately create a fresh snapshot.
- Exports use the established queued worker, advisory lock, audit events,
  retry lifecycle, object storage and SHA-256 verification. Recent exports refresh
  while work is pending. Only the owner with current module access can download.
- Exports above 100,000 rows fail with a request to narrow the filters. No export
  is silently truncated. CSV formula escaping and packaged PDF fonts are reused.
  Excel numeric fields preserve fractional quantities and prices. PDF cells wrap
  and continue across pages, including mixed Latin/Cyrillic text; tables wider
  than nine fields use landscape A3. Page numbers stay on the content pages.
- Migrations are tested up/down before export records exist. Rollback is
  intentionally restricted once export jobs reference the new definitions.
- Database integration tests execute all ten queries, empty searches, invalid
  dates/fields, cross-module denial, owner isolation and concurrent saved-view
  replay. CSV is exercised for every definition; Excel/PDF for each module.
  UI tests cover all four workspaces, restoration, failures, field selection,
  read-only accounts and visible downloads.

## Overview calculations

Overview and module landing pages share `WorkAreaCards` for compact, responsive
navigation. Links retain their existing routes and permission filtering, with
visible keyboard focus and full descriptions. Live visual verification of this
layout remains pending while the browser connection is unavailable.

All four queries share one read-only, repeatable-read PostgreSQL snapshot. Dates
use the configured business timezone; amounts use PostgreSQL fixed precision.
The default revenue period is the current Sofia calendar month to today.

| Metric                  | Calculation and scope                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recorded revenue        | Sum BGN net amounts of non-cancelled Finance invoices and debit notes, less credit notes, with issue date in the selected inclusive period. Excludes proformas and VAT. Includes prepared documents; explicitly **not posted accounting revenue**. POS sales are not separately added, avoiding double counting linked Finance documents. Requires Finance view. |
| Active Service requests | Current count with status new, scheduled, or in progress. Independent of the revenue date range. Requires Service approve, matching existing global Service reports.                                                                                                                                                                                             |
| Warranties ending soon  | Active customer equipment with warranty end date from today through today plus the selected number of days, both inclusive. Counts equipment, not duplicate warranty cards. Requires CRM view or Service approve. Default 30 days is a changeable display filter, not a reminder policy.                                                                         |
| Overdue receivables     | Current positive outstanding collection balances whose due date is before today and whose review state is pending Finance review. Sum each balance multiplied by its saved exchange rate, rounded to four decimals, matching the aging register. Cancelled collections are excluded. Requires Finance view.                                                      |

Unauthorized metric values are omitted by the API, not returned as zero or hidden
only with CSS. Current operational counts are labelled with their as-of date and
are not historical values for the selected revenue period.

The Overview uses compact metric cards with short date/window summaries. The
prepared-revenue qualification remains visible below the cards; additional
definitions are available under **How these figures are calculated**. Filter
labels sit outside their control wrappers so the searchable select cannot add an
extra grid row. Date fields, the searchable control and Apply share a 40px height.
Cards use four, two or one columns at the desktop, tablet and phone breakpoints.
This presentation change does not alter API requests, calculations or permissions.

## Verification

- Sales/Finance infrastructure integration covers migration down/up in a disposable
  database, concurrent saves, owner isolation, audit uniqueness, request validation,
  selected-field exports/replay and dashboard-to-source reconciliation.
- Renderer tests cover all three formats and excluded-field removal. Frontend
  tests cover save/reopen, field selection, empty selection, dashboard filters,
  restricted responses and request failure/retry.
- The initial report-panel browser checks covered desktop/mobile scrolling and
  footer geometry. The 8 September Overview restyling has component/interaction
  coverage; rendered visual re-verification remains outstanding because no browser
  automation surface was available in that development session.

Remaining report authoring outside Finance, report scheduling, dashboard layout
configuration, official revenue accounting and other module-specific reporting
remain in the implementation plan.
