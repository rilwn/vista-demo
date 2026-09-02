# CRM analytics definitions

The CRM analytics screen and exports use controlled server-side definitions. A
user can choose a date range and an approved report, but cannot enter arbitrary
SQL or change a formula.

All dates are interpreted in the configured business timezone. Monetary results
use the BGN snapshot stored on each financial document; later currency or tax
changes do not alter an earlier result.

## Customer activity

- **Active customers:** distinct customers with a non-cancelled invoice issued
  in the selected period.
- **Purchase frequency:** non-cancelled invoice count divided by active
  customers in the selected period.
- **Average transaction value:** average stored BGN gross total of those
  invoices.
- **Sources:** `finance.financial_documents`.

## Retention and churn

The comparison window is the equal-length period immediately before the selected
period.

- **Retention:** customers invoiced in both periods divided by customers
  invoiced in the comparison period.
- **Churn:** comparison-period customers without an invoice in the selected
  period divided by comparison-period customers.
- Cancelled documents, proformas, credit notes, and debit notes do not count as
  purchases.

## Observed customer value

This is an operational, observed value—not a forecast. For every customer, the
system totals stored BGN net value, excluding VAT, through the selected end date.
Invoices and debit notes increase the value; credit notes reduce it. The KPI is
the average across customers with recorded value. Proformas and cancelled
documents are excluded.

## Preferred products and services

Products and Service types appearing on non-cancelled invoices and debit notes
in the selected period are ranked by document count, quantity, and stored net
BGN value excluding VAT. Credit notes reduce quantity and value. Sources are
financial documents and lines, products, Service work orders, and Service
requests.

## Pipeline conversion

The cohort contains opportunities created in the selected period. Audited stage
history through the period end determines stage entry. Conversion from a stage
to the next stage is distinct opportunities entering the next stage divided by
distinct opportunities entering the previous stage. Current counts use the last
audited stage at the period end.

## Employee performance

The selected period counts:

- completed Service requests by the employee who completed the request;
- resolved or closed CRM tickets by the assigned employee, falling back to the
  employee who recorded the update;
- completed Sales shipments by the employee who shipped them.

These are activity counts, not a staff-ranking or compensation score.

## Recorded revenue

Recorded revenue is stored BGN net value excluding VAT for non-cancelled
invoices and debit notes, less credit notes, issued in the selected period.
Proformas are excluded. The same value is grouped by:

- product from financial-document lines;
- Service type from the linked Service work order;
- immutable customer snapshot on the financial document;
- customer region from the active registered or billing address;
- responsible employee from the linked Sales quotation or Service assignment,
  falling back to the document creator.

Rows without an applicable link are omitted only from that specific breakdown;
the headline recorded-revenue total remains based on all eligible documents.

## Export reproducibility

CSV, XLSX, and PDF exports persist the report key, filters, requester, lifecycle,
row count, checksum, and generated file. Jobs are queued and retry-safe. Only
the requesting account can list or download its exports unless a separately
approved administrative workflow is added.
