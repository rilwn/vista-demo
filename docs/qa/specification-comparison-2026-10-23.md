# Vista specification and delivery checklist comparison

Reviewed 23 October 2026 against repository commit `9465c91`.

Implementation follow-up: the first Finance milestone after this baseline adds
scoped official number ranges, automatic collection links for issued non-POS
invoices/proformas, and retry-safe proforma conversion through all implemented
settlement paths. F02 and F04 now have local implementation/test evidence; F09
remains partial because POS settlement and the universal payment-status register
still require work. The baseline row assessments below are preserved; current
evidence is in the [traceability matrix](../architecture/traceability-matrix.md)
and pending work remains in `IMPLEMENTATION_PLAN.md`.

S05 follow-up: approved recurring subscriptions now issue due periods through the
existing worker, with official numbering, automatic collections, live access and
contract checks, rollback/retry behavior and a Finance setup/history screen.
Unconfigured subscriptions, earlier periods and existing manual Finance drafts
remain under manual review. API integration and the connected EN/BG mobile browser
flow provide local evidence; this is not hosted or full Finance acceptance.

F03/F09 follow-up, 25 October 2026: issued credit/debit notes now adjust the
original non-POS collection without rewriting its invoice or payments. The
append-only note ledger, corrected balances, overpaid customer credit, payment
reversal, all settlement paths and EN/BG source links have executable tests.
Workspace validation, 302 API checks, migration rollback/reapply and 13 affected
Finance/Sales/Service/POS browser journeys passed locally. Desktop/BG mobile
screenshots were reviewed; hosted/client acceptance remains pending.
POS settlement, scalable all-source status registers and accounting/FX acceptance
remain pending; this does not close the whole Finance lifecycle.

F06/F09 POS follow-up, 25 October 2026: linked invoices now show original POS
payments, deferred credit, refunds and remaining debt without a second payment
or collection. Issued invoices remain available in POS receipt history.
Inconsistent settlement evidence blocks issuance; source invoice amounts stay
fixed after returns. The connected screen links to the customer's account and
back to the same invoice. All 303 API tests, migration rollback/reapply and 14
connected browser journeys pass locally. EN/BG desktop/phone screenshots were
reviewed. The recurring panel also refreshes a waiting period after a background
issuance instead of retaining stale state.
F09 remains partial: deferred-credit collection, all-source register scalability
and accounting acceptance remain pending.

## Conclusion

F09 deferred-collection follow-up, 25 October 2026: Finance now records partial
and full payments against the original POS account charge, using the shared
payment table rather than a duplicate receivable. Authorized reversal preserves
the original and reopens debt. Source invoice status, account credit and POS
return eligibility update from the same records. All 304 API tests without skips,
`0083` rollback/reapply and 15 connected browser journeys pass, including a
lost-response replay, concurrency guards and retained customer-history reversals.
Desktop/Bulgarian mobile collection and history screenshots were reviewed.
Workspace validation, including all application builds, passes. Customer EUR
totals use stored currency-rate snapshots rather than adding source currencies.
Actual refunds of collected account
money, automatic bank/cash matching, advance/offset allocation and scalable
all-source reporting remain open. The original baseline table is retained.

F05 follow-up: Finance → Financial documents → Document settings now configures
company logos and authorized signature images. Draft PDFs show the logo;
issued PDFs and email include both configured images with the signatory name.
Exact file-version/checksum snapshots remain fixed after settings change.
Images use the shared protected file service; email retries use saved PDF bytes.
The renderer also preserves mixed English/Bulgarian text and numeric identifiers.
This closes the identified software-image gap, not hosted mail delivery or
certificate-based electronic-signature acceptance. The table below retains the
original comparison baseline.

The manager's checklist is useful, but it is a review of the **16 September
user guide**, not a test of the running software. Its introduction explicitly
says that “not described” requires a software check. Several Finance, Service,
CRM and POS findings describe an older implementation state. Conversely, the
Backup concern is supported by the current code: Recovery is an authenticated
review interface, not an operational backup and restore system.

The project has substantial ERP, CRM and online POS implementation. It does
not yet satisfy the full mandatory delivery scope. Neither the checklist's
80%/85% estimates nor the older QA register's locally verified defect count is
a measurement of full specification acceptance.

This comparison covers **all 128 checklist rows**, preserving their order.
It records source/code evidence, not a new hosted acceptance test. No application,
database, deployment setting or existing completion status was changed by this
review.

## Sources and assessment terms

- Original comparison source: `Vista-Technical-Specification-EN.docx` supplied
  on 23 October, including its scope, hardware and handover sections.
- Manager's comparison: `vista-check-en.docx`, titled _Vista – Delivery Check
  Against the Offer_. It contains 11 tables and 128 requirement rows. Neither
  supplied file contains embedded screenshots or a Word comments part.
- Project records: `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, the consolidated
  decisions, the previous 52-finding Operations QA register, source, migrations,
  controllers, UI pages and relevant test implementations.
- **Present:** executable implementation was found. This does not assert legal
  compliance, current hosted configuration, physical hardware success or final
  client acceptance.
- **Partial:** implementation exists, with a concrete missing behavior or
  unresolved acceptance boundary stated in the row.
- **Pending:** an operational implementation was not found in this repository.
- **Conditional:** the source makes the item optional or dependent on an actual
  company requirement. It must not be counted as a mandatory missing feature
  without establishing that condition.
- **Unverified:** ownership, training, actual equipment or operational evidence
  cannot be established by source inspection.

The “Manager” column reproduces the checklist classification, not this review's
acceptance verdict. “Not described” must not be read as “not implemented.”

## Specification alignment that needs attention

| Subject                         | Attached specification                                                                              | Current project position                                                                                                                       | Assessment                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounting currency             | §1.1.1 says accounting in BGN.                                                                      | EUR accounting, converted development data and rejection of new BGN transactions were explicitly requested by the project owner.               | An intentional approved change in the conversation. Update the delivery specification/change record so acceptance does not compare against obsolete BGN wording. |
| POS backup Internet router      | §3.8 includes a communication router among the hardware components, without calling it optional.    | AGENTS §8.9 and `FEATURE_POS_BACKUP_ROUTER` classify it as optional.                                                                           | A real baseline discrepancy. Establish which specification version governs delivery; this attached version does not support silently excluding the router.       |
| Procurement acceptance protocol | §1.2 expressly links delivery history to an acceptance-handover protocol.                           | AGENTS §6.2 names supplier invoices and goods receipts but omits that explicit protocol; current procurement code has receipt/invoice history. | Preserve the protocol requirement. A Sales handover certificate is a different workflow.                                                                         |
| Expiring warranty offer         | §2.5.1 includes an option to generate extended-warranty or subscription quotations.                 | AGENTS describes an offer option; CRM provides offer status and a Service-plan link.                                                           | Reminder and follow-up status alone do not demonstrate the quotation-generation option.                                                                          |
| Official numbering              | §1.1.1 and AGENTS require separate sequences by location/register/operator.                         | Draft references have scope; official numbers use `legal_entity_id` as their only sequence key.                                                | Implementation does not fully match the stated scoping requirement.                                                                                              |
| Backup scope                    | §4 covers custom execution, recovery, protection, multiple source types and physical/tape hardware. | Adopted operating defaults exist, but Recovery screens and planning templates do not execute the plan.                                         | Defaults allow development to proceed; they do not complete software implementation or replace the required source inventory and restore test.                   |

## 1.1 ERP Finance

| #   | Checklist requirement                           | Manager       | Current assessment                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F01 | Compliant invoice issuance                      | Partial       | **Partial.** An issue endpoint, issued state, official number and issue action now exist. “Draft only” is outdated. Full statutory acceptance is still open; the limitations below matter.                                                                                                                                                                                                             |
| F02 | Proforma automatically converted after payment  | Not described | **Partial.** A Sales-linked issued proforma converts when Collections records full settlement, including the shared advance-payment path. Bank matching writes allocations separately and does not call this conversion. Standalone proformas are not covered by that Sales-linked lookup.                                                                                                             |
| F03 | Credit/debit notes linked to original           | Covered       | **Present.** Original-invoice references, correction reasons and amount/quantity checks exist. Issuance validates the original issued invoice.                                                                                                                                                                                                                                                         |
| F04 | Separate location/register/operator numbering   | Not described | **Partial.** Draft sequences include location/register/operator scope and support concurrent allocation. Official invoice/correction sequences are per legal entity, not those individual scopes.                                                                                                                                                                                                      |
| F05 | PDF printing/email with logo and signature      | Not described | **Partial.** PDF generation and queued PDF email exist. The current financial renderer prints issuer text, signature lines and issuer name; no configured company-logo image is embedded. Signature lines support signing a printout, but signed email-PDF content is not demonstrated. The source does not require a particular electronic-signature technology. Staging mail is captured in Mailpit. |
| F06 | Invoice from POS receipt                        | Partial       | **Partial.** Source-sale/receipt links, Finance creation/issuance and the return link on the POS sale exist. Current executable fiscal path uses simulated receipts; physical-device acceptance remains open.                                                                                                                                                                                          |
| F07 | VAT 20/9/0/exempt/intra-community               | Partial       | **Present.** All five treatments are represented in the contract, calculations and Finance form. The old guide did not enumerate them.                                                                                                                                                                                                                                                                 |
| F08 | Foreign currency with automatic BNB rate        | Partial       | **Present.** BNB feed refresh, dated stored rates, rate lookup and EUR accounting snapshots exist. Hosted feed correctness/availability is not re-tested here. EUR replaces BGN by the owner's instruction.                                                                                                                                                                                            |
| F09 | Invoice register with payment states            | Partial       | **Partial.** Collections has unpaid/partial/paid/overdue/cancelled states; Finance has draft/issued/cancelled documents and correction links. A universal issued-invoice/payment-status register for every manual, Service, subscription and POS source is not established by those separate registers.                                                                                                |
| F10 | Cash/bank/POS/card/offset methods               | Covered       | **Present** as accounting/payment methods. Physical PIN-pad processing is a separate pending integration.                                                                                                                                                                                                                                                                                              |
| F11 | Multiple partial payments and remaining balance | Covered       | **Present.** Payment allocations and recalculated balances are transactional; concurrency/retry tests are in the Sales/Finance integration suite.                                                                                                                                                                                                                                                      |
| F12 | Automatic overdue marking                       | Not described | **Present.** The scheduled payment-status handler updates overdue receivables/payables. This is not just manual status selection.                                                                                                                                                                                                                                                                      |
| F13 | Upcoming/overdue email notifications            | Not described | **Partial.** Detection, in-system notifications, queued mail and retries exist. The deployed Compose sends mail to private Mailpit; client email delivery needs actual SMTP configuration and a hosted delivery check.                                                                                                                                                                                 |
| F14 | Manual/automatic bank-reference matching        | Covered       | **Present.** Exact-reference candidates, manual review, duplicate review and payment allocation exist. This does not fix the proforma conversion gap in F02.                                                                                                                                                                                                                                           |
| F15 | Cash vouchers and daily cash report             | Covered       | **Present.** Receipt/payment vouchers, balance checks and daily report calculations exist.                                                                                                                                                                                                                                                                                                             |
| F16 | Bulgarian bank-file import                      | Missing       | **Partial.** “Manual entry only” is outdated: the UI imports CSV/XLSX with column mapping and duplicate review. Actual files from Vista's bank(s) still need acceptance; no additional bank-specific format is assumed mandatory without the bank's files.                                                                                                                                             |
| F17 | Allocate payments to invoices/advances          | Covered       | **Present** for the documented invoice and customer/supplier advance workflows. Broader unspecified accounting items are not proved by these paths.                                                                                                                                                                                                                                                    |
| F18 | Receivables/payables and aging                  | Covered       | **Present.** Both registers and the four aging buckets exist.                                                                                                                                                                                                                                                                                                                                          |
| F19 | Turnover per partner                            | Covered       | **Present.** Customer and supplier turnover reports are implemented.                                                                                                                                                                                                                                                                                                                                   |
| F20 | Sales/purchase journals and accounting export   | Partial       | **Partial.** Journals and defined Income/Outcome CSV/XLSX exports exist, beyond generic PDF export. Unknown account codes intentionally remain blank. Import into the intended accounting package and statutory journal acceptance remain open.                                                                                                                                                        |
| F21 | VAT report                                      | Covered       | **Partial for final acceptance.** VAT review/report totals exist. That is evidence of a report, not proof of a complete accepted statutory filing workflow. The implementation plan still lists this acceptance work.                                                                                                                                                                                  |

Evidence: `apps/api/src/finance/financial-documents.service.ts` (issue at line
807, conversion at 1005, draft sequence at 2182),
`financial-documents.controller.ts`, `financial-document-renderer.ts`,
`bnb-currency-rates.service.ts`, `finance.service.ts`,
`finance-bank.service.ts`, `finance-reports.service.ts`, migrations
`0075`–`0078`; Operations `FinancialDocumentsPage.tsx`, `FinancePage.tsx`,
`FinanceBankPage.tsx`, `bank-import.ts`, `FinanceReportsPage.tsx`;
`apps/api/test/sales.integration.test.ts` and `tests/e2e/qa-finance.spec.ts`.

## 1.2 ERP Procurement

| #   | Checklist requirement                           | Manager | Current assessment                                                                                                                                                                          |
| --- | ----------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01 | Suppliers, terms and evaluation                 | Covered | **Present.** Supplier register, commercial terms and evaluations exist.                                                                                                                     |
| P02 | Purchase orders                                 | Covered | **Present.** Product lines, quantities, prices and expected delivery dates exist.                                                                                                           |
| P03 | Partial/full warehouse receipt                  | Covered | **Present.** Receipt posts stock and serial/batch records with the purchase-order link.                                                                                                     |
| P04 | Ordered/delivered/invoiced comparison           | Covered | **Present.** Procurement comparisons link receipt and invoice lines.                                                                                                                        |
| P05 | Supplier claims                                 | Covered | **Present.** Claims and tracked status transitions exist.                                                                                                                                   |
| P06 | Delivery history, invoice and handover protocol | Partial | **Partial.** Receipt/invoice history exists. A dedicated procurement acceptance-handover protocol generation/link was not found. Sales handover certificates do not close this requirement. |

Evidence: `apps/api/src/procurement/procurement.service.ts`,
`supplier-procurement.service.ts`, Operations `ProcurementPage.tsx` and
`SupplierProcurementPage.tsx`; `apps/api/test/procurement.integration.test.ts`.

## 1.3 ERP Warehouse

| #   | Checklist requirement                           | Manager       | Current assessment                                                                                                                                                                                      |
| --- | ----------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W01 | Unlimited warehouses including technician stock | Covered       | **Present.** Standard and technician warehouses are represented; no fixed warehouse-count limit was found.                                                                                              |
| W02 | Hierarchical categories                         | Covered       | **Present.** Parent/child category management exists.                                                                                                                                                   |
| W03 | Serial-number tracking                          | Covered       | **Present.** Serialized inventory, unique serial validation and source-linked traceability exist.                                                                                                       |
| W04 | Batches and applicable expiry                   | Covered       | **Present.** Batch quantities and expiry data are supported.                                                                                                                                            |
| W05 | Receipt/issue/write-off/transfer/stocktake      | Covered       | **Present.** These stock operations have backend workflows.                                                                                                                                             |
| W06 | Weighted-average cost                           | Covered       | **Present.** Receipt valuation and cost updates exist.                                                                                                                                                  |
| W07 | FIFO                                            | Not described | **Conditional.** The specification says “where required”; AGENTS treats it as optional. A feature flag exists but no FIFO valuation engine was found. Weighted-average costing is the implemented path. |
| W08 | Minimum stock and reorder suggestion            | Covered       | **Present.** Thresholds, stock recommendations and low-stock handling exist.                                                                                                                            |
| W09 | Reservations                                    | Covered       | **Present.** Source-linked reservation and release workflows exist.                                                                                                                                     |
| W10 | Supplier-to-customer-to-repair serial trace     | Covered       | **Present.** The connected Procurement/Sales/Service path and trace view exist. Real records still need valid source history; missing legacy history is not fabricated.                                 |

Evidence: `apps/api/src/inventory/inventory.service.ts`,
`product-categories/product-categories.service.ts`, `catalog/catalog.service.ts`,
Operations `WarehouseOperationsPage.tsx`, `SerialTraceabilityPage.tsx`;
Procurement/Sales integration suites and `tests/e2e/trade.spec.ts`.

## 1.4 ERP Sales

| #   | Checklist requirement            | Manager       | Current assessment                                                                                                                                                                                                                 |
| --- | -------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 | Quotation/order/shipment/invoice | Partial       | **Partial.** Sales still prepares an invoice draft; Finance can now prepare and issue the linked legal document. The earlier guide stops too early, but payment/register consistency across all sources still needs acceptance.    |
| S02 | Quotation validity and discounts | Covered       | **Present.** Validity, line/overall discounts and lifecycle checks exist.                                                                                                                                                          |
| S03 | Price lists and promotions       | Covered       | **Present.** Customer/group/date pricing and commercial rules exist.                                                                                                                                                               |
| S04 | Subscription contracts           | Covered       | **Present.** Location, equipment, services, frequency and billing terms are stored.                                                                                                                                                |
| S05 | Automatic recurring invoicing    | Not described | **Partial.** A scheduler generates period-specific subscription invoice drafts with retry protection. Finance review is connected; automatic final issuance of those recurring invoices is not implemented by the draft generator. |
| S06 | Specific serial reservation      | Covered       | **Present.** Confirmation validates and reserves selected available serials.                                                                                                                                                       |
| S07 | Equipment handover protocol      | Covered       | **Present.** Sales handover certificates and related equipment/warranty links exist.                                                                                                                                               |

Evidence: `apps/api/src/sales/sales.service.ts`, `sales-pricing.service.ts`,
`sales-subscriptions.service.ts:238`, Operations `SalesWorkflowPage.tsx`,
`SalesSubscriptionsPage.tsx`, `FinancialDocumentsPage.tsx`; Sales integration
and connected trade browser tests.

## 1.5 ERP Service

| #   | Checklist requirement                   | Manager       | Current assessment                                                                                                                                                                                                                           |
| --- | --------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V01 | Intake channels                         | Covered       | **Present.** Channel recording exists. Selecting email/portal as a channel does not establish an inbound mailbox or public portal connector.                                                                                                 |
| V02 | Work card                               | Covered       | **Present.** Customer/location/device/problem/service-type records exist.                                                                                                                                                                    |
| V03 | Scheduling/calendar/workload            | Covered       | **Present.** Assignments, appointment timing and workload views exist.                                                                                                                                                                       |
| V04 | Mobile work/parts/time/photos/signature | Covered       | **Present.** Responsive completion and evidence workflows exist. Target-device acceptance remains separate.                                                                                                                                  |
| V05 | Technician-stock parts deduction        | Covered       | **Present.** Completion posts used parts against the technician warehouse.                                                                                                                                                                   |
| V06 | Repair cost and payment document        | Partial       | **Partial.** Internal costs, separate customer charges and a source-linked Finance handoff exist. Finance issuance now exists; a complete Service-to-collection/payment lifecycle is not established for every source by this handoff alone. |
| V07 | Full serial history                     | Covered       | **Present.** Sale, repair, technician, time and parts data are linked into equipment/serial views.                                                                                                                                           |
| V08 | Warranty term/claim tracking            | Covered       | **Present.** Warranty status, remaining term and claim history exist.                                                                                                                                                                        |
| V09 | Inspection reminders                    | Partial       | **Present.** Inspection plans are entered by staff, and scheduled reminder preparation is implemented. Notifications are in-system; this row does not require automatic discovery of a device's legal inspection schedule.                   |
| V10 | Generate visits from subscription plans | Not described | **Present.** The scheduled generator creates deduplicated service requests from configured contract devices/services and visit dates. Dispatcher assignment remains a normal next step.                                                      |

Evidence: `apps/api/src/service/service.service.ts`,
`service-care.service.ts:472`–`706`, Operations `ServiceOperationsPage.tsx`;
`jobs/named-job-trigger-handlers.service.ts`, the service schedule jobs,
Sales integration suite and `tests/e2e/service.spec.ts`.

## 1.6 ERP Logistics

| #   | Checklist requirement                     | Manager | Current assessment                                                                                                                                                                                                                              |
| --- | ----------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L01 | Own-transport/courier delivery records    | Covered | **Present** for delivery planning and status records. Provider booking is separate.                                                                                                                                                             |
| L02 | Econt/Speedy booking and tracking         | Blocked | **Pending.** Provider status/adapter boundaries exist; real booking/tracking implementations are not operational. This remains a mandatory SRS integration even though the rollout deferred it.                                                 |
| L03 | Reverse logistics creates Service request | Covered | **Present.** Applicable returned/repairable devices create linked Service requests.                                                                                                                                                             |
| L04 | Calendar-based routes                     | Partial | **Present as a daily agenda.** Routes are grouped by date in a Route calendar view. It is not a month/week grid; the specification does not mandate one particular calendar layout. Demonstrate the agenda before declaring the feature absent. |

Evidence: `apps/api/src/logistics/logistics.service.ts`, Operations
`LogisticsOperationsPage.tsx:432`, Sales integration and trade browser tests.

## 1.7 and 1.8 ERP Reports and Security

| #   | Checklist requirement      | Manager       | Current assessment                                                                                                                                                 |
| --- | -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R01 | Overview KPIs              | Covered       | **Present.** Revenue period, Service, warranty and overdue-receivable indicators exist.                                                                            |
| R02 | Standard filtered reports  | Covered       | **Present.** Module report definitions and filters exist.                                                                                                          |
| R03 | Excel/CSV/PDF export       | Covered       | **Present.** Queued exports produce actual files in the supported report workflows.                                                                                |
| R04 | Configurable reports       | Covered       | **Present** as controlled report definitions, saved views, filters and schedules. This is not an arbitrary SQL/report-programming interface.                       |
| R05 | Personal employee accounts | Covered       | **Present.** Employee/account identity and role assignments exist. Shared demo accounts are demonstration data, not the final employee inventory.                  |
| R06 | Module/action permissions  | Covered       | **Present.** Backend permission enforcement and administration exist.                                                                                              |
| R07 | Material-action audit      | Covered       | **Present** in implemented workflows. This cannot establish backup-operation audit for a backup engine that does not yet run.                                      |
| R08 | Complexity and 2FA         | Covered       | **Present.** Password rules and TOTP enforcement for administrators are implemented.                                                                               |
| R09 | Password expiration        | Not described | **Present.** Configurable expiry and expired-login rejection exist. Default `PASSWORD_EXPIRY_DAYS=0` disables age-based expiry until a policy value is configured. |

Evidence: `apps/api/src/finance/operations-overview.service.ts`, report
services/controllers and `jobs/*report*`, `auth/auth.service.ts:620`,
`auth/password.service.ts`, `security-administration`, `audit`, shared auth;
Operations report pages, authentication/integration and report browser tests.

## 2 CRM

| #   | Checklist requirement                          | Manager        | Current assessment                                                                                                                                                                                                                 |
| --- | ---------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | Unified partner/UIC/VAT/address/bank records   | Covered        | **Present.** ERP/CRM/POS use the shared partner model.                                                                                                                                                                             |
| C02 | Legal representative/MOL                       | Not described  | **Present.** `company_representative` is persisted and shown/edited as Company representative. Confirm the Bulgarian business label with the user, rather than adding a duplicate field.                                           |
| C03 | Locations and contact roles                    | Covered        | **Present.** Per-partner locations and multiple contacts exist.                                                                                                                                                                    |
| C04 | Equipment by location                          | Covered        | **Present.** Serial, warranty and status data are linked to customer locations.                                                                                                                                                    |
| C05 | Duplicate detection                            | Covered        | **Present.** Name/UIC checks and controlled review exist; records are not silently merged.                                                                                                                                         |
| C06 | Interactions and attachments                   | Covered        | **Present.** Timeline records and authorized attachments exist.                                                                                                                                                                    |
| C07 | Tasks, priorities and due dates                | Covered        | **Present.** Assignment, reminders and completion workflows exist.                                                                                                                                                                 |
| C08 | Lead sources/qualification/conversion          | Covered        | **Present.** Leads convert to linked customer/opportunity records.                                                                                                                                                                 |
| C09 | Probability and Kanban pipeline                | Covered        | **Present.** Backend-validated stage movement and quotation prerequisites exist.                                                                                                                                                   |
| C10 | Ticket channel/priority/category/number        | Covered        | **Present.** Ticket creation and automatic numbering exist.                                                                                                                                                                        |
| C11 | Ticket to Service                              | Covered        | **Present.** Linked request creation exists with stable correlation.                                                                                                                                                               |
| C12 | Service to ticket                              | Not described  | **Present.** `POST crm/tickets/from-service-request/:serviceRequestId` and the Service UI handoff exist; existing links prevent duplication.                                                                                       |
| C13 | SLA deadlines                                  | Covered        | **Present.** Configured response/resolution timers and saved policy snapshots exist.                                                                                                                                               |
| C14 | SLA risk alerts and escalation                 | Not described  | **Present.** Scheduled at-risk/breached evaluation and assignee/manager notifications exist. The adopted weekday calendar excludes public holidays initially.                                                                      |
| C15 | Customer portal                                | Missing        | **Conditional and unimplemented.** The original calls this optional. The feature flag is disabled; it should not be counted as a mandatory missing item without selection.                                                         |
| C16 | Warranty cards/register                        | Covered        | **Present.** Sales/POS-backed warranty cards, remaining coverage and reconciliation exist.                                                                                                                                         |
| C17 | Expiring-warranty reminder and extension offer | Partial        | **Partial.** Scheduled in-system warranty reminders and offer follow-up status exist. A generated extended-warranty/subscription quotation from that context was not found.                                                        |
| C18 | Claims workflow                                | Covered        | **Present.** Device-linked claims, evidence and status history exist.                                                                                                                                                              |
| C19 | Sending satisfaction surveys                   | Partial        | **Partial.** Completed work can produce a survey invitation record and staff can share the question manually and enter the response. `sendSurvey` records an event; it does not send email/SMS or expose a customer response form. |
| C20 | NPS and referrals                              | Covered        | **Present.** Recorded scores feed NPS; referrals link to leads. This does not supply automated survey delivery.                                                                                                                    |
| C21 | Behavior/revenue/pipeline/staff analytics      | Covered        | **Present.** Calculations, filtered analytics and exports exist with formula documentation. Final business-data reconciliation is separate.                                                                                        |
| C22 | ERP/POS synchronization                        | Covered        | **Present** for implemented online flows through canonical shared records and events. Real hardware and full offline synchronization remain separate gaps.                                                                         |
| C23 | Enterprise integration API                     | Not verifiable | **Present as API capability.** Versioned authenticated APIs, OpenAPI and shared contracts exist. A connector to an unspecified external business system is not established or assumed required.                                    |

Evidence: `apps/api/src/partners`, Operations `PartnersPage.tsx:512` and
`988`, `crm/crm-timeline.service.ts`, `crm-pipeline.service.ts`,
`crm-tickets.controller.ts:157`, `crm-tickets.service.ts:585` and `738`,
`crm-after-sales.service.ts:259`, `crm-analytics.service.ts`,
`docs/architecture/crm-analytics.md`, `docs/api/README.md`;
partner/CRM integration suites and `tests/e2e/crm.spec.ts`.

## 3 POS

| #   | Checklist requirement                    | Manager       | Current assessment                                                                                                                                                                                                                  |
| --- | ---------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O01 | Barcode/search/quick panel               | Covered       | **Present.** Browser input supports code/name/barcode lookup and quick-access products. Actual scanner configuration/testing is still required.                                                                                     |
| O02 | Stock/price synchronization              | Covered       | **Present** for online ERP-backed availability and pricing.                                                                                                                                                                         |
| O03 | Certified fiscal receipt                 | Blocked       | **Pending.** The executable checkout supports the simulator. Hardware mode returns `POS_FISCAL_ADAPTER_UNAVAILABLE`; DATECS is not merely awaiting a final acceptance signature.                                                    |
| O04 | Invoice from POS                         | Partial       | **Partial.** Receipt-linked invoice creation/Finance issuance and bidirectional links exist. Certified receipt behavior depends on O03.                                                                                             |
| O05 | Multiple registers/operators             | Covered       | **Present.** Assignments and shift scoping exist.                                                                                                                                                                                   |
| O06 | Mandatory serial/warranty card           | Covered       | **Present.** Available serial selection is enforced and warranty documents are generated. Real printer/device checks remain open.                                                                                                   |
| O07 | Card payment through PIN pad             | Blocked       | **Pending.** Simulated card acceptance is not a connected payment terminal.                                                                                                                                                         |
| O08 | On-account/split/advance/change          | Covered       | **Present** in the online application, with corporate terms, balances and tender/change calculations.                                                                                                                               |
| O09 | Linked returns                           | Covered       | **Present.** Original sale and refundable quantities are validated; physical fiscal reversal still depends on O03.                                                                                                                  |
| O10 | Repair returns to Service warehouse      | Not described | **Present.** Repair disposition uses `service_return_warehouse_id` and updates device/stock state. This is explicitly exercised in the POS integration suite.                                                                       |
| O11 | Authorized manual discounts              | Covered       | **Present.** Percentage/fixed discounts and separate approver authorization exist.                                                                                                                                                  |
| O12 | Bundle/quantity promotions               | Not described | **Present.** Both commercial-rule types and POS pricing application exist. A generic campaign alone was not the implementation.                                                                                                     |
| O13 | Loyalty points                           | Covered       | **Present.** Accrual/redemption use ledger entries, not just a mutable balance.                                                                                                                                                     |
| O14 | Corporate pricing                        | Covered       | **Present.** Customer-specific ERP pricing is used by the POS resolver.                                                                                                                                                             |
| O15 | Full offline selling/fiscal receipt      | Partial       | **Partial.** Durable interrupted-checkout recovery/replay exists. A fresh sale during server outage, cached operational data, conflict reconciliation and certified offline fiscal issuance are not completed.                      |
| O16 | X/Z and product/payment/location reports | Covered       | **Present as application reports.** They report application/simulator data. Certified fiscal-device X/Z commands and hardware totals are not established.                                                                           |
| O17 | Terminal/scanner/fiscal device/router    | Blocked       | **Partial.** A browser workstation and scanner input path exist; target DATECS/PIN-pad/scanner/printer acceptance is outstanding. The attached specification includes a backup router, contrary to AGENTS' optional classification. |

Evidence: `apps/api/src/pos/pos.service.ts:1045`, `1687`, `1831` and `2392`,
`pos-reports.service.ts`, `sales/sales-pricing.service.ts`,
`apps/pos-web/src/checkout-recovery.ts`, `PosTerminal.tsx`,
`fiscal-mode-policy.ts`; `apps/api/test/pos.integration.test.ts`,
`tests/e2e/pos-commercial.spec.ts`, `pos-recovery-returns.spec.ts`.

Staging was explicitly enabled for simulated receipts on 14 October. This is
useful for client demonstrations and is not evidence of actual fiscal-device
integration. The deployment setting is gated to staging and remains blocked in
the production deployment stage.

## 4 Backup and Disaster Recovery

| #   | Checklist requirement                   | Manager | Current assessment                                                                                                                                                                                          |
| --- | --------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B01 | Plan/classification/RPO/RTO             | Missing | **Partial.** Adopted default targets exist in the decisions. The dedicated backup plan is still an unapproved template with obsolete BAK blockers; there is no connected source/policy management workflow. |
| B02 | Scheduled automatic backup              | Missing | **Pending.** Job names and queue infrastructure exist; no domain backup executor is connected. A queued request is not an executed backup.                                                                  |
| B03 | Full/incremental/differential/snapshots | Missing | **Pending.** No operational implementations for these backup types were found.                                                                                                                              |
| B04 | Deduplication/compression               | Missing | **Pending** as backup-system capabilities. Ordinary container/file compression is not evidence of backup deduplication.                                                                                     |
| B05 | Email/SMS backup notifications          | Missing | **Partial infrastructure only.** Shared email queue exists; SMS is explicitly unconfigured and no running backup engine produces success/failure/missed-backup events.                                      |
| B06 | Tamper-resistant backup logs            | Missing | **Partial infrastructure only.** Shared audit controls exist, but actual backup/restore execution records do not yet exist.                                                                                 |
| B07 | Ransomware protection/air gap           | Missing | **Pending.** No configured independent protected copy or operational isolation workflow was found.                                                                                                          |
| B08 | Console MFA                             | Covered | **Present.** Unified authentication and an MFA gate protect console access. That gate is not an implementation of future destructive-action authorization.                                                  |
| B09 | Role separation/four eyes               | Missing | **Partial foundation only.** Named roles/permissions and explanatory UI exist; there are no operational backup approvals and execution endpoints enforcing the workflow.                                    |
| B10 | AD/LDAP/Entra integration               | Missing | **Conditional and unimplemented.** The specification requires this if a company directory exists. No configured directory/connector was found; local login is not directory integration.                    |
| B11 | Written recovery procedures             | Missing | **Partial documentation only.** A template lists the required procedures but contains no accepted, executable site-specific runbook.                                                                        |
| B12 | Granular/bare-metal restore             | Missing | **Pending.** No operational restore engine/adapters were found.                                                                                                                                             |
| B13 | Witnessed restore and protocol          | Missing | **Pending.** No completed restore evidence or signed protocol is recorded. Database migration tests and deployment restart tests do not substitute.                                                         |
| B14 | Physical storage server/tape drive      | Missing | **Unverified and not integrated.** Neither provisioned equipment evidence nor a working tape adapter is present. A VPS deployment alone does not satisfy this hardware scope.                               |

Evidence: `apps/backup-control/src/App.tsx:243`–`315` renders disabled actions,
disabled search and empty tables. Its API client connects authentication, not
backup execution. `apps/api/src/jobs/named-job-trigger-handlers.service.ts:45`
keeps jobs without a domain implementation as pending handoffs. No backup or
restore domain service/controller was found. `infrastructure/backup/README.md`,
`docs/backup/information-backup-plan.md`,
`docs/disaster-recovery/procedures.md`, `tests/disaster-recovery/README.md`
and `tests/offline-sync/README.md` are planning placeholders, not operational
acceptance evidence.

The manager's Backup warning is substantively correct. The earlier QA register's
BCK-01 wording focuses too narrowly on external inventory and a witnessed test;
software execution, restore, storage protection and approval work also remain.

## 5 Technology and Handover

| #   | Checklist requirement                    | Manager        | Current assessment                                                                                                                                                                                                                    |
| --- | ---------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01 | NestJS/PostgreSQL/Redis/React/TypeScript | Not verifiable | **Present.** Workspace manifests, modules, database services, Docker services and TypeScript sources establish the required stack.                                                                                                    |
| T02 | CI/CD/HTTPS/HSTS                         | Not verifiable | **Present in repository configuration.** GitHub Actions validation/image/security jobs, Docker deployment and production HTTP hardening exist. Current hosted scan results and TLS/HSTS behavior were not re-verified in this review. |
| T03 | Unified roles across apps                | Covered        | **Present** through shared identity/authentication/permissions. Operational Backup action enforcement is still absent because those actions are not implemented.                                                                      |
| T04 | Technical documentation/OpenAPI          | Not verifiable | **Partial.** Architecture, generated API contracts, schema and deployment documentation exist. Backup documents and some traceability/status notes are stale; complete handover documentation is not accepted.                        |
| T05 | User guide/in-app help                   | Covered        | **Present but needs refresh.** A role/user manual and bilingual help exist. The 16 September guide omits later behavior; pending integrations must remain clear to users.                                                             |
| T06 | Client-owned Git source                  | Not verifiable | **Partial evidence.** Source is in Git and staging used a demo mirror. Final Vista ownership/access/transfer is not established by these files.                                                                                       |
| T07 | Staff training                           | Not verifiable | **Unverified.** Manuals, test instructions and a live demo are not evidence that client staff training and handover occurred.                                                                                                         |

Evidence: root/workspace `package.json` files, `.github/workflows/ci.yml`,
`apps/api/src/common/http-application.ts`, `infrastructure/deployment`,
`docs/api/README.md`, `docs/database/schema.md`, `packages/contracts/src/generated/v1.ts`,
`packages/ui/src/help-content.ts`, `docs/user-guides/vista-working-and-demo-guide.docx`.

## What explains the different impressions

1. The checklist uses an older user guide. It cannot see several features
   implemented after 16 September, nor backend-only behavior such as scheduled
   status detection, scoped draft sequences or API integration capabilities.
2. The earlier 52-finding QA register tracks defects from an Operations test,
   not the full delivery specification. Fixing those defects never completed
   every POS, integration, Backup or handover requirement.
3. Some completed subflows were described too broadly. Draft generation is not
   automatic invoice issuance; separate draft numbering is not scoped official
   numbering; queued jobs are not executed backups; a console login is not a
   backup system; simulated fiscal receipts are not DATECS operation.
4. Staging intentionally captures outgoing mail and simulates fiscal processing.
   Those settings support demonstrations but leave real provider/hardware
   acceptance open.
5. Defaults replaced unanswered business questions, but old BAK/INT blockers and
   old phase notes were not reconciled consistently across the documentation.
6. The attached specification itself needs version alignment with the approved
   EUR change and the router requirement before final acceptance.

## Recommended next work in order

1. Reconcile the delivery baseline and status wording using these 128 rows.
   Keep currency as the approved EUR change; resolve the router-version
   discrepancy explicitly. Record real software gaps separately from provider
   configuration, hardware tests and optional work.
2. Close the Finance lifecycle gaps: official numbering scope, proforma payment
   paths including bank matching, issued-document/collection linkage, recurring
   final issuance, company branding/signature handling and accounting export
   acceptance. Use connected scenarios rather than isolated form demonstrations.
3. Complete the remaining ERP/CRM flows: Procurement acceptance protocol,
   warranty quote generation, actual survey delivery, external email and required
   courier booking/tracking.
4. Implement operational Backup/DR using the already adopted defaults. This is
   a software milestone as well as infrastructure work; plan storage/source
   access and the eventual witnessed restore alongside implementation.
5. Complete the DATECS local connector, PIN-pad path where selected, target
   hardware tests and full offline sales/synchronization. Preserve simulator
   availability for staging demonstrations.
6. Refresh the concise role guide, run hosted specification acceptance with
   evidence, complete training and transfer source/hosting/operating ownership.

This review recommends an order; it does not silently change the existing plan
or begin implementation of the findings.

## Verification performed for this review

- Read the complete supplied specification and all 128 checklist entries,
  including the checklist's method statement and summary.
- Read all of `AGENTS.md`, the remaining implementation plan and relevant
  decision/status records; inspected executable paths and their test sources.
- Inspected Finance issue/conversion/numbering/PDF/mail paths, CSV/XLSX mapping,
  Service scheduling/reminders, CRM ticket/SLA/survey paths, online POS fiscal
  guard/promotions/returns, Recovery disabled actions and missing executors.
- Fresh focused tests passed: 19 API unit tests across BNB-rate parsing,
  SLA business time, named-job handling and fiscal-simulator policy; four
  Operations bank-import mapping tests. These checks support specific
  implementation findings. They are not a full hosted, physical-device,
  statutory filing, restore or 128-scenario runtime acceptance run.
