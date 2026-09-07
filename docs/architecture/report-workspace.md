# Saved Finance reports and operational Overview

Scope: AGENTS.md §§6.7, 7.6, 11 and 13. This increment does not enable official
accounting issuance, VAT filing, arbitrary SQL, or reports outside the existing
seven Finance definitions.

## Saved reports

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

## Overview calculations

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

## Verification

- Sales/Finance infrastructure integration covers migration down/up in a disposable
  database, concurrent saves, owner isolation, audit uniqueness, request validation,
  selected-field exports/replay and dashboard-to-source reconciliation.
- Renderer tests cover all three formats and excluded-field removal. Frontend
  tests cover save/reopen, field selection, empty selection, dashboard filters,
  restricted responses and request failure/retry.
- Browser fixture checks exercise the real application components independently
  of client data, including desktop/mobile scrolling and footer geometry.

Remaining report authoring outside Finance, report scheduling, dashboard layout
configuration, official revenue accounting and other module-specific reporting
remain in the implementation plan.
