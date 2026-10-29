# Requirement Traceability Matrix

Security UI, 29 October 2026 (AGENTS §§6.8, 17, 19–20): employee access,
account creation, role creation/editing and recovery handoff use viewport-owned
right panels with separate scrolling bodies and full-width fixed action bars.
Focus is contained and restored; the background is inert while a panel is open.
Role/module search preserves selections, including after failed saves. Narrow
permission layouts show labeled actions without horizontal scrolling. Existing
administrative MFA restrictions and backend commands remain unchanged. English
and Bulgarian labels include recovery forms, statuses and language-switching
success notices. Evidence: eight focused Security component tests, the existing
Operations workflow tests, three isolated Security browser journeys, and eight
real authentication/recovery regression journeys across the three apps.
Desktop/phone screenshots are reviewed; manual checks begin in `TESTME.md`.
No backend, API-contract or database changes are included in this UI pass.

Business structure UI, 29 October 2026 (AGENTS §§17, 19–20): all five create
and edit flows use a separate right-side panel instead of an inline form in
the hierarchy. The panel has a fixed header/footer, internally scrolling
content, keyboard focus containment and return, Escape/cancel, inert background,
and English/Bulgarian labels. Location resources expand on request; register
and operator rows no longer compete with the company/location hierarchy.
Known location-type codes have readable localized labels. Shared searchable
choices stay inside their parent dialog, expose only the visible combobox,
reopen on click, and close before the panel on Escape. API commands,
authorization, contracts and database behavior are unchanged. Evidence:
`OrganizationPage.test.tsx`, existing organization workflow tests, and
`tests/e2e/organization.spec.ts`, including desktop and Bulgarian phone
screenshots. Manual checks are in `TESTME.md`.

EUR migration compatibility, 26 October 2026 (AGENTS §§4.3–4.4, 15.2, 16,
19): the migration runner recognizes only the exact original/corrected `0069`
checksum pair. It verifies completed conversion and normalized EUR rates before
reconciling metadata, retains the original applied timestamp and appends one
event through the existing tamper-resistant audit chain transactionally. It
never reruns the lossy conversion. Canonical and fresh databases retain ordinary
behavior; all unknown drift still fails before reconciliation. Regression tests
cover both releases, source pinning, invalid state, unrelated drift, rollback,
replay and audit immutability. The local backup was restored and compared across
185 tables; the compiled migration entrypoint and pending Finance upgrade were
rehearsed before the approved local repair. A pre-existing local audit warning
is preserved and tracked for investigation, not silently rewritten. Hosted
deployment remains a separate acceptance gate.

Verification: workspace checks/builds and the audit writer's unchanged canonical
format pass. All 313 API tests without skips, migration rollback/reapply and 12
selected Finance/POS browser journeys pass. `npm run dev` completed locally;
the API readiness endpoint, three browser applications and three API proxies
returned HTTP 200. The compiled production migration command, with database-only
configuration, upgraded the restored historical database and replayed as a no-op.
No hosted database or deployment was changed. The private pre-repair backup and
restore/upgrade evidence remain outside Git under `.data/`.

POS collected-account return reconciliation, 26 October 2026 (AGENTS §§4.3–4.5,
6.1, 8.3–8.4, 11, 15–17): migration `0084` separates released unpaid debt from
repayment due for previously collected amounts. Finance can prepare and issue an
exact linked POS-return credit note, then record a completed cash/bank repayment
against the original collections. Append-only database guards, sale locks,
idempotent retries, partial/concurrent allocations, reversal blocking, rollback
and migration rehearsal pass. Both application and database guards prevent
issuing an invoice after a sale return or cancelling a repaid return credit note.
Six POS integration tests and three connected English/Bulgarian desktop/phone
browser journeys pass; screenshots were reviewed.
The app does not send funds or claim certified fiscal-device acceptance. Bank/
cash matching, advance/offset allocation, scalable registers and accounting/VAT
acceptance remain open.

Deferred POS collections, 25 October 2026 (AGENTS §§4.1–4.4, 6.1, 8.3–8.4,
11, 15–17; comparison F09): migration `0083` adds the original-sale link to
Finance payments and append-only account payment/reversal entries. The account,
invoice and POS credit views reflect actual received money without adding a
collection or repeating checkout payments. Original invoices and POS stock/shift
amounts remain fixed. Source/snapshot guards, deferred no-orphan checks,
immutability and sale/customer locking protect the postings. Finance Create
records receipt evidence; Finance Approve reverses an error with a retained
reason. Demo permissions are unchanged. The connected EN/BG desktop/mobile
journey covers a lost successful response, stable-key replay, partial collection,
reversal, final settlement and a flush footer. All 304 API tests without skips,
`0083` rollback/reapply and 15 selected Finance/Sales/Service/POS browser journeys
pass locally. Desktop and Bulgarian phone collection/history screenshots were
reviewed. Customer overview debt, frozen-rate EUR totals and reversed-payment history are covered;
migration regressions and a midnight-sensitive Service test were corrected.
Workspace validation passes generated-contract, formatting, lint, type, unit-test
and production-build checks. The existing Operations bundle-size warning remains.
Paid-account refunds, automatic bank/cash
matching, advance/offset allocation, scalable registers and accounting/reporting
acceptance remain pending. A collected portion is blocked from return before
fiscal/stock posting rather than converted to an invented refund or negative debt.

POS invoice reconciliation, 25 October 2026 (AGENTS §§4.1–4.4, 6.1, 8.3–8.4,
11, 15.3; comparison F06/F09): the Finance document reads original POS payments,
returns/refunds and account charges. It distinguishes received money from
deferred debt and blocks issuance when the source does not reconcile. Original
invoice snapshots remain unchanged; no extra payment, collection or stock entry
is posted. POS history retains issued invoice numbers and source links.
The focused five-test POS integration suite passes cash, split cash/card, advance, deferred,
partial/full return, replay, concurrency, permission and overdue checks.
Connected EN/BG desktop/mobile browser acceptance passes. Deferred POS collection,
all-source register scalability and accounting acceptance remain pending.
Verification: workspace validation, all 303 API tests without skips, empty-schema
`0082` rollback/reapply and all 14 selected Finance/Sales/Service/POS browser
journeys pass. Desktop and Bulgarian phone screenshots were inspected. The
regression run also exposed and fixed an open recurring-invoice panel retaining
a stale Waiting state after a concurrent worker run. A delayed-read browser check
now verifies automatic refresh without another issuance command. This is local
evidence, not hosted or physical-device acceptance.

Collection corrections, 25 October 2026 (AGENTS §§4.3–4.4, 6.1, 11, 17;
comparison F03/F09): migration `0082` links each issued non-POS credit/debit note
once to its original invoice collection. Original invoice/rate/payment snapshots
stay unchanged; corrected totals, outstanding and customer credit are explicit.
Cash, bank matching, manual payments, advances, offsets and reversal use the
corrected balance. Database ledger validation/immutability, partial/full payment,
concurrent issuance/allocation, retry, rollback and legacy backfill have isolated
coverage. EN/BG previews link original, note and collection; concise steps are in
`TESTME.md`. Workspace validation, all 302 API tests without skips, migration
rollback/reapply and 13 Finance/Sales/Service/POS browser journeys pass locally.
Screenshot review also corrected header/body spacing; BG mobile balance/credit
and scrolled note views are verified. POS settlement, universal scalable status
registers and accounting/FX acceptance remain open. No hosted data was changed.

Financial document images, 23 October 2026 (AGENTS §§4.3, 4.5, 6.1, 10–11;
comparison F05): `0081` stores per-company image profiles and immutable issued
snapshots. The Finance API/UI configures protected logos and explicitly authorized
visual signatures. Drafts omit signature images; issuance, automatic recurring
invoices and paid-proforma conversions freeze exact versions. PDF/email use
integrity-checked assets, and queued mail retries retain identical attachments.
English/Bulgarian font runs preserve mixed-script labels and numeric party IDs;
multi-page rows, notes and signature placement are covered by renderer tests.
Authorization, stale settings, idempotency, file-parent mismatch, malformed images,
storage corruption and guarded downgrade have isolated regression coverage.
Browser acceptance covers image upload, issue, PDF download, email queueing,
settings changes and a scrollable BG mobile panel with a full-width footer.
This does not claim hosted email or certificate-based digital signing.

Verification: `npm run validate` passed all checks/builds and 409 enabled
workspace tests. The disposable acceptance run passed all 295 API tests without
skips, `0081` rollback/reapply and 12 Finance/Sales/Service/POS browser journeys.
Desktop/BG mobile screenshots and all pages of draft, issued, unchanged-after-edit
and four-page bilingual PDF samples were visually checked. The existing Operations
bundle-size warning remains; no hosted data/configuration was changed.

Operations QA CRM/POS follow-up, 9 October 2026 (AGENTS §§7.3, 8.7, 11–13):
CRM-08 telephone format validation and CRM-09 quotation-stage prerequisites
are covered by shared-domain/API/browser regressions. POS-01 verifies the
Manager's read-only report access from Operations through to Vista POS, while
the POS Operator retains export creation. The Operations build requires the
public POS URL; isolated API/browser coverage passes. Its Docker image rehearsal
did not reach app compilation because npm registry access timed out during
`npm ci`. UI-01 covers bilingual workflow statuses/actions and context-correct
CRM pipeline history, descriptions, source options, count summaries, and
date language. Component tests plus Bulgarian-to-English CRM browser coverage
pass. Evidence and
remaining hosted acceptance are tracked in
`docs/qa/operations-2026-10.md` and `TESTME.md`. UI-02 centralizes locale-aware
date, quantity, decimal, currency and VAT presentation across Operations
workflows; exact financial decimal strings and machine date values remain
unchanged. Component, type and production-build checks pass locally; hosted
visual acceptance remains open. UI-03 replaces UUID fragments with human
context and bilingual copy controls across Operations, Procurement, Warehouse
and POS checkout recovery. No purchase-order numbering is introduced before
BUS-002 approval; local UI regressions and workspace validation pass, with
hosted retest pending. UI-04 confirms 768 px table/board-local scrolling and
viewport-bound partner/opportunity drawers. UI-05 fixes repeated overview copy,
singular count grammar and missing Sales-reference separators; adds Escape
dismissal and bilingual inline validation; and searches partners, Finance
documents/collections and serials through permission-protected APIs. Isolated
Chromium and PostgreSQL/Redis checks pass locally; hosted retest remains open.

Operations QA second Finance batch, 9 October 2026 (AGENTS §§4.1–4.4, 6.1,
6.4, 11–13, 15, 17): FIN-06 future-payment regressions now cover supplier
payments, incoming/outgoing bank matching and offsets without posting allocations.
FIN-08 connects recurring subscription billing periods to Finance VAT review,
preserving the saved net charge and source relationship. Migration 0066 adds the
restricted source FK and one-active-document index; source row locking prevents
concurrent different-key preparation from creating duplicate drafts. Finance
reference data and permission-aware Sales links reopen the same review document.
FIN-09 uses the existing shared customer/date/currency price resolver through a
Finance-protected endpoint. No matching price remains blank; delayed lookups do
not overwrite manual prices. API contracts/OpenAPI and EN/BG workflow copy are
updated. Tablet search overflow and precise form labels were corrected.
`npm run validate` passed all checks/builds and 354 enabled workspace tests;
all 255 enabled API tests and eight selected browser journeys passed in isolated
infrastructure. Migration 0066 rollback/reapply, browser types, final lint/format
and summary-label translation regression passed; tablet screenshots reviewed.
These are review drafts, not legal invoice issuance or subscription collection
posting. FIN-10/11, Administration and later QA findings remain open, along with
hosted platform checks and approved business/provider/hardware dependencies.

Operations QA first batch, 8 October 2026 (AGENTS §§4.3–4.6, 6.1, 6.7,
7.6, 10–13, 15, 17): `docs/qa/operations-2026-10.md` preserves all 52 report
findings in source order and distinguishes local evidence from hosted acceptance
and required decisions. Implemented scheduler calls now record completed
execution evidence; unsupported handoffs remain pending. Migration 0065 repairs
only eligible historical markers, retains immutable event content and supports
scoped rollback. Notification failure attempts/recovery and bounded Redis
reconnection remain fail-closed. Finance enforces explicit foreign-rate sources,
concurrency-safe cumulative credit/quantity limits, per-register cash protection
including backdating/cancellation, and future-payment guards. The correction form
loads original lines with race-safe state and precise accessible labels. Revenue,
sales journal/output VAT and invoice-derived CRM metrics exclude unissued drafts;
negative trend comparisons no longer imply improvement against a zero baseline.
`npm run validate` passed 354 enabled workspace tests plus all checks/builds. An
isolated all-integration run passed all 255 API tests; six selected browser
journeys passed, including the new QA Finance flow and delayed-read switch,
notification loading, platform permissions, attachments and connected trade.
Migration 0065 rolled back/reapplied and the tablet drawer screenshot was reviewed.
The existing Operations bundle-size warning remains. Hosted 503/backlog review,
dedicated future bank/offset cases, later findings, legal issuance, approved BNB,
base-currency decisions and physical/provider acceptance are not claimed complete.

A4 preparation (AGENTS §§3.2–3.4, 17, 18): shared `packages/ui/src/help.tsx`
provides searchable, module-filtered help in all three authenticated shells.
`help-content.ts` keeps the guides and unavailable-feature warnings separate
from presentation. Unit and browser checks cover search, role filtering, Escape,
focus return, narrow viewports and returning to the workspace. Deployment
Dockerfiles, loopback-only Compose, an isolated migration/restart rehearsal and
four application-image CI scans are added under `infrastructure/deployment` and
`.github/workflows/ci.yml`. `npm run validate` passes, including formatting,
lint, types, OpenAPI consistency, 333 enabled workspace tests and production
builds. `npm run test:deployment` passes four built images, migrations, deep
links, API health/access checks and restart using disposable resources only.
Hosted scan evidence and public deployment remain unclaimed.

Finance, Service, CRM, POS and central report browser acceptance (AGENTS §§6.7,
7.6, 8.7, 11–13, 15, 17): `tests/e2e/reporting-more.spec.ts` adds five isolated
journeys. Finance supplier turnover, the initial Service and CRM reports, and the
POS shift register restore saved periods after reload and produce real CSV,
Excel and PDF downloads. Finance, Service and CRM verify that another employee
can access report definitions but cannot list or download the owner's export.
The central library finds a saved Warehouse view, produces an on-demand export,
runs a daily schedule, downloads its generated file and persists pause/resume.
The schedule-opening button no longer turns the opening click into an unintended
form submission; explicit creation remains a separate action. Browser coverage
exercises that editable step and a component assertion rejects premature submission.
Desktop and phone export-panel screenshots and footer/overflow checks are included.
File checks cover names, binary signatures and non-HTML CSV output, not every cell,
every definition, official filings or fiscal certification. The standalone POS
case also supports an empty period; the full suite provides earlier cashier sales.
No migrations, contracts, business calculations or development accounts changed.
Validation: all 30 browser journeys pass together; 27 targeted reporting
component/display tests pass, including the updated eight hub cases. Operations
and browser type checking, targeted lint/format checks and the Operations build
pass. The existing bundle-size warning remains. Test infrastructure is disposable;
this is not production, statutory, hardware or Backup/DR acceptance.

ERP report browser acceptance (AGENTS §§6.7, 11, 13, 15, 17):
`tests/e2e/reports.spec.ts` exercises the first operational report in Procurement,
Warehouse, Sales and Logistics through UI navigation and real APIs. It creates
the Logistics delivery through the UI, recovers empty searches, rejects inverted
date ranges, restores saved searches after reload and downloads twelve queued
CSV/Excel/PDF files. Assertions cover format signatures, filenames and CSV text,
not every exported cell or statutory compliance. A failed Warehouse download can
be retried without requesting a new export. Its error now describes the failed
download separately from export-list loading. A read-only viewer sees stock but
cannot request an export; a direct authenticated create request receives 403.
Narrow-screen screenshots and page-overflow assertions accompany the journeys.
All 24 targeted reporting component/display tests pass, including the eight ERP
workspace cases and failed-download recovery.
Final validation: all 25 isolated browser tests pass together. The older Service
and trade journeys now use the shared, bounded login-cooldown helper rather than
failing when the expanded suite reaches the real authentication rate limit.
Browser/Operations TypeScript checks, targeted ESLint/Prettier and the Operations
production build pass. Desktop and phone screenshots were reviewed; the existing
large-bundle build warning remains. Disposable test services were removed normally.
No migrations or API contracts changed. Other report definitions, pagination,
cross-account file access and Finance/Service/CRM/POS/central browser journeys
remain pending; existing API tests are complementary, not replaced.

Account-security lifecycle acceptance (AGENTS §§4.2, 6.8, 10, 15, 17):
`tests/e2e/auth.spec.ts` adds two isolated employee journeys. The first verifies
current-password and authentication-code errors, authenticator enrollment,
revocation of a second session, MFA on the next login, removal and subsequent
password-only login. The second verifies password confirmation, password change,
other-session revocation, policy expiry, administrator-issued recovery through
Security, one-time-code consumption, revocation of a separate active session and
login with the recovered password. The fixture alone receives a simulated expiry;
no development credentials are changed. Authenticator footer positioning and
phone-width overflow have explicit browser assertions.
The authentication integration suite passes all 16 tests, including mandatory
administrator MFA, administrator recovery/re-enrollment, password history,
lockout, authorization and audit. Its stale rollback test now unwinds all newer
dependencies through migration 0023 and verifies exact reapplication order.
CI builds shared/API dependencies before browser type checking and validation.
The isolated runner accepts `--auth-integration` without production credentials.
Validation: all 20 browser journeys passed together, with 54 Operations component
tests and the 16 authentication integration tests passing separately. Targeted
lint/formatting, API/browser/Operations TypeScript checks and the Operations
production build passed. The authenticator footer fills the panel width without
an unused scrollbar gutter; the recovery status no longer repeats the header icon.
No API contract or schema change was needed. Hosted CI results are not asserted
by these local runs.

Administrator recovery hardening (AGENTS §§4.2, 4.3, 10, 11, 15, 16, 17):
`tests/e2e/auth.spec.ts` verifies administrator-issued recovery with an interrupted
handoff response and same-key retry, old-session revocation, mandatory replacement
authenticator enrollment, invalid-code rejection, consumed-code rejection and
subsequent MFA-verified administrative access. Phone recovery layout is checked.
`authentication.integration.test.ts` issues four concurrent identical handoffs,
asserts one code and audit event, and rejects consumed/revoked handoff retrieval.
The service now serializes that initial lookup and selects the lifecycle flags
used by its replay guard. All eight authentication browser journeys and 16 API
integration tests passed together on 10 September 2026, with six authentication
unit tests and 104 Operations component tests passing separately. No real accounts
or development credentials were modified. No contract or schema changes.

Cross-app authentication acceptance (AGENTS §§4.2, 6.8, 9.3, 10, 17):
`tests/e2e/auth.spec.ts` exercises real Operations manager, POS cashier and
Recovery operator MFA challenges, invalid-code rejection, phone-width form
access, reload/session restoration and server-side sign-out revocation. The
viewer is denied POS/Recovery navigation and the POS API returns 403. Password-only
backup sessions now receive setup guidance instead of the Recovery console.
This console gate is not a replacement for backend MFA/authorization on future
Backup operations, which remain unavailable and pending Phase 8 acceptance.
The isolated runner now includes Recovery on port 5375, with a configurable API
proxy matching the other apps. Administrator provisioning uses the existing
controlled function; temporary test factors are removed before later cashier
journeys. No local development account or authenticator is changed.
All 18 browser journeys passed together; eight Recovery component tests,
targeted lint, browser/Recovery TypeScript checks and the Recovery build passed.
The five authentication journeys passed again after the final notice styling;
phone-width MFA and setup-required screenshots were reviewed.
Authenticator enrollment/removal, recovery/expiry and additional action-level
acceptance remain pending rather than being counted as covered by sign-in tests.

POS returns and interrupted-checkout acceptance (AGENTS §§6.3, 8.3–8.5, 15–17):
`tests/e2e/pos-recovery-returns.spec.ts` exercises an 83.40 EUR card-paid bundle
with a fixed discount and points redemption, full refund and points reversal;
a serialised return to Service with sale/return references in Operations; and a
real committed sale whose HTTP acknowledgement is lost, surviving reload and
recovering one receipt without another sale submission. All three focused
browser journeys and four real-database POS integration tests passed.
Refund previews now use saved discounted net/VAT amounts and cumulative returned
amounts, including the final-return rounding residue, rather than list prices.
Five `return-totals.test.ts` regressions bring POS component coverage to 39 tests.
The additive optional `returnedNetTotal`/`returnedVatTotal` API fields expose
existing persisted return amounts; no migration is required. Serial traceability
resolves POS sale, fiscal receipt, return and reversal references, with database
integration assertions. These tests use disposable services and simulated fiscal
and card adapters, not certified hardware or full offline selling.
Final validation: all 13 browser journeys passed together on a fresh migrated
database; all 39 POS component tests passed. API/POS/browser TypeScript checks,
targeted lint/formatting, POS production build and generated-client consistency
passed. Discounted-return, recovered-receipt and Service-custody screenshots were
reviewed. Repeated cashier logins honor the real rate-limit cooldown rather than
changing security limits. Disposable test services were removed after execution.

POS commercial/payment browser acceptance (AGENTS §§8.3, 8.5, 15–17):
`tests/e2e/pos-commercial.spec.ts` verifies a two-adapter quantity offer, denied
cashier self-approval, a separately authenticated manager's percentage discount,
100-point redemption, 96-point earning, and a 40 EUR cash / 56 EUR simulated-card
split with 10 EUR change. The sale has exactly two persisted points entries after
reload. A second journey applies 20 EUR of an 80 EUR customer advance and 40 EUR
of approved credit, then reopens 60 EUR unused advance and 1,960 EUR available
credit. Each shift closes with its expected cash balance.
Excessive advance input is no longer silently clamped at checkout: validation
blocks it and preserves the entered value with an accessible field error.
`apps/pos-web/src/App.test.tsx` covers negative, over-balance and over-total inputs
followed by a valid payment. The subsequent returns/recovery acceptance above
covers card-only, fixed/bundle discounts, loyalty reversal and repair returns;
broader cross-app acceptance stays in A3.
The PIN-pad/fiscal adapters are development simulators, not hardware acceptance.
Validation: the full ten-test browser suite passed twice; both affected journeys
passed again after the final validation-hint adjustment. All 34 POS component
tests, targeted lint/formatting, TypeScript and the POS production build passed.
The field-error screenshot was reviewed. No API contract or database migration
changed; each browser run applied migrations to a new disposable database.

Online POS browser acceptance (AGENTS §§8.1–8.4, 15.3(3), 17):
`tests/e2e/pos.spec.ts` opens a shift with 100 EUR, blocks a missing-serial sale,
sells DEMO-FR-STOCK-01 to an existing customer/location for 720 EUR, checks
30 EUR change, downloads the generated warranty PDF and prepares a linked
Finance draft. History reload preserves that draft. A linked full return
restocks the device, shows Fully returned and restores expected cash to 100 EUR
before closing the shift. The runner starts a separate POS server on 5374 using
the isolated API. Fiscal receipts/reversals use the development simulator.
The POS now blocks checkout throughout pricing refresh, ignores stale pricing
responses and refreshes terminal context after a return. Component regressions
cover pricing-debounce blocking and the refreshed post-return drawer balance.
Eight browser tests and 34 POS component tests pass locally, along with targeted
lint, TypeScript, formatting and POS production-build checks. Hosted CI has not
been run as part of this local milestone.
This is not certified fiscal/offline acceptance or official invoice issuance;
broader payment, commercial, recovery, reporting and role journeys remain pending.

CRM browser acceptance (AGENTS §§7.3, 7.4, 15.3(6–7), 17):
`tests/e2e/crm.spec.ts` qualifies a lead, converts it against an existing customer,
links that customer's seeded quotation, drags the opportunity into Negotiation,
records Won and verifies persistence and narrow-screen overflow. The ticket
journey creates linked records from both CRM and Service and checks that repeated
round trips retain their original ticket/request numbers. Ticket creation now
waits for reference data, preventing an empty initial customer/location state;
`App.test.tsx` holds the reference response pending to guard this regression.
The new-customer journey verifies conversion replay after a lost response, the
shared customer/contact registry and a Lost outcome with 0% probability and a
single retained history note after retry/reload. Duplicate detection keeps the
form and permits explicit existing-customer selection without silent merging.
Four CRM browser journeys, five CRM pipeline API integration tests and 104
Operations component tests passed on 10 September 2026 in targeted runs. API
tests also verify zero Lost weighted revenue, denied viewer stage changes and
stale-version rejection. Hosted CI execution remains separate from local evidence.

Service browser acceptance (AGENTS §§6.5, 15.3(4), 17):
`tests/e2e/service.spec.ts` verifies manager dispatch, separate assigned-technician
completion at phone width, required signature capture and retained image,
45 minutes, one batch-tracked part, 106 EUR repair cost and stock falling from
5 to 4. The manager opens the completed work from an older list and prepares a
Finance draft with an asserted source-work-order link. Work-order list previews
now fetch current details rather than reopening cached list data; `App.test.tsx`
also covers a stale scheduled row with a completed detail response. Five browser
tests and 97 Operations component tests pass. Official issuance, Service photo
upload browser coverage and broader role/report acceptance remain pending.

Sales collections browser acceptance (AGENTS §§6.1, 15.3(1), 17):
`tests/e2e/trade.spec.ts` continues the received-device sale into its linked
collection. It verifies 720 EUR total, a rejected 721 EUR input, a 200 EUR partial
payment and 520 EUR final payment, status/balance transitions and exactly two
persisted payment references after reload. A pre-submit browser disconnection
preserves the entered amount/reference and allows retry after reconnecting.
Phone-width overflow and a paid-record screenshot are checked. Four local
browser tests pass against isolated real services. This is operational collection
acceptance, not official invoice issuance, bank-provider settlement or recovery
from an acknowledgement lost after server commit.

Procurement/Sales browser acceptance (AGENTS §§6.2, 6.3, 6.4, 15.3):
`tests/e2e/trade.spec.ts` creates a two-device purchase order, posts separate
serialised receipts, verifies both receipt records and matched supplier invoice
quantities/VAT, then sells a received serial through reservation, shipment,
customer handover and invoice draft. It verifies mandatory serial selection,
receipt checkbox state, phone-width overflow and persistence after reload.
Four local browser tests pass with real API/storage/database services. Official
issuance remains outside this trade test's coverage; operational collection
payments are covered by the continuation above.

Browser acceptance foundation (AGENTS §§10, 15, 16): `npm run test:e2e`
creates isolated disposable PostgreSQL, Redis, storage and mail services, migrates
and seeds them, then runs Chromium against the compiled API and Operations app.
`tests/e2e/operations.spec.ts` covers Finance draft attachment replacement,
original-version byte integrity, reopening and narrow-screen access; monitoring
navigation/refresh; and a viewer's blocked monitoring route. Three local browser
tests pass. CI is configured to run them and retain failure evidence; hosted CI
has not been run here. This is partial acceptance, not completion of A3 or the ten
required business journeys. Setup and remaining coverage: `tests/e2e/README.md`.

Operational monitoring (AGENTS §§3.4, 4.6, 11, 12): System activity now displays
the existing protected queue metrics with read-only refresh and explicit failure
states. `/platform/jobs/metrics/prometheus` exports fixed-label gauges under the
same platform-view permission. Queue checks have a five-second HTTP deadline and
sanitized failure responses. Evidence: `jobs.controller.test.ts`,
`JobMonitor.test.tsx`, the real-queue access test in `partners.integration.test.ts`
and `infrastructure/monitoring/README.md`. A mobile fixture screenshot verifies
the new component's layout. Production alerting/provider selection remains pending.

Finance supporting attachments (AGENTS §§4.5, 10, 11, 17): the managed-file
`financial_document` parent, Finance view/edit authorization and document-preview
attachment controls support upload, download and immutable replacement history.
Evidence: `files.integration.test.ts` covers denied CRM/view-only access, missing
parents, invalid bytes, replay, history and unchanged financial snapshots;
`App.test.tsx` covers preview upload. Desktop/mobile fixture browser checks verify
the replacement form and scrolling at 1440px/390px without horizontal overflow.
Existing schema/storage are reused; no migration or official issuance is added.

ERP reporting completion (AGENTS §§6.2–6.7, 11, 13, 17):
`0063_erp_operational_reports`, `/erp/reports/{scope}` APIs, ten controlled
definitions, `ErpReportsPage` and the shared export worker cover Procurement,
Warehouse, Sales and Logistics. Includes paginated previews, literal search,
applicable date filters, private saved views, field selection and Excel/CSV/PDF.
Evidence: `erp-report-columns.test.ts`, `ErpReportsPage.test.tsx`,
`sales.integration.test.ts`, generated OpenAPI and `report-workspace.md`.
Official accounting and approved production email delivery remain pending.
The shared library, scheduled account downloads and Finance/Service/CRM/POS
summary-card preferences are implemented by `0064_reporting_hub`, the Reporting
API/workspace and shared `DashboardCards`. Evidence: `ReportingHubPage.test.tsx`,
`reporting-access.test.ts`, `sales.integration.test.ts`, generated contracts and
`report-workspace.md`. Browser fixture checks cover panels at three widths.
The follow-up report presentation review covers active navigation, a single Back
link, compact defaults, aligned controls, readable dates/decimals, and UUID copy
actions. Evidence: `erp-report-display.test.ts`, `ErpReportsPage.test.tsx`, and
Chromium fixture-based layout checks at desktop, tablet and narrow widths.

Overview configuration (AGENTS §§6.7, 11, 17): `0062_overview_preferences`, the
Overview preferences PUT API and `OverviewPreferences.tsx` provide private saved
card visibility, reset, conflict handling and transactional audit. KPI formulas
and backend metric permissions are unchanged. Evidence:
`OperationsOverview.test.tsx`, `sales.integration.test.ts`, OpenAPI and
`report-workspace.md`. Module summary preferences are covered by migration 0064.

POS reporting extension (AGENTS §§8.7, 11, 13, 17): migration
`0061_saved_pos_reports`, saved-report APIs, seven reviewed column definitions and
POS inline controls add private date-range views. X/Z reports retain full shift
totals. Evidence: `PosSavedReports.test.tsx`, `pos-report-columns.test.ts`,
`pos.integration.test.ts`, generated OpenAPI and `report-workspace.md`.

Service reporting extension, 8 September 2026 (AGENTS §§6.7, 11, 13, 17):
`0059_saved_service_reports`, Service saved-report endpoints, reviewed column
definitions and the existing export worker support private reusable date/format/
field selections. Evidence: `service-report-columns.test.ts`,
`sales.integration.test.ts`, `ServiceReportsView.test.tsx`, generated OpenAPI and
`report-workspace.md`. Module summary preferences are covered by migration 0064.
The original Service view's separate live acceptance remains in release hardening.

CRM reporting extension, 8 September 2026 (AGENTS §§7.6, 11, 13, 17):
`0060_saved_crm_reports`, CRM saved-report endpoints, reviewed fields and the
shared export worker provide private reusable date/format/field selections for
all four CRM reports. Evidence: `crm-report-columns.test.ts`,
`sales.integration.test.ts`, `CrmSavedReports.test.tsx`, generated OpenAPI and
`report-workspace.md`. Live browser layout verification remains pending.

Baseline date: 2026-08-11; current disposition reconciled 2026-10-28
Source of truth: `AGENTS.md`

This matrix maps each specification section to implementation and verification
evidence. The initial phase labels in the final column are retained as planning
history, not as the current backlog; the dated current disposition below and
the linked comparison and QA registers supersede those labels.

| ID / source           | Requirement group                                                                                                                                                                            | Planned modules and persistence                                                        | API / UI / documentation                                             | Verification                                                                                                                                                                 | Initial phase / status (historical; see current disposition below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCH-01 §3.1          | Mandatory Node/NestJS/TypeScript, React/Vite/TypeScript, PostgreSQL, Redis, optional S3, OpenAPI, source control, CI/CD                                                                      | `apps/api`; three Vite apps; config/storage packages; PostgreSQL migrations            | OpenAPI; deployment and environment docs                             | clean install, lint, typecheck, test, build, CI                                                                                                                              | P1 scaffold verified; source-control ownership pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ARCH-02 §3.2          | Modular, API-first, headless, responsive, integrated, shared master data, portable/scalable hosting                                                                                          | API bounded modules; outbox; shared domain/contracts                                   | module APIs; responsive application shells; architecture docs        | boundary and responsive tests; deployment rehearsal                                                                                                                          | P1–P9 / planned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ARCH-03 §3.3          | Required monorepo layout; ERP/CRM may share; POS separate; technician responsive web                                                                                                         | `apps/*`, `packages/*`, `infrastructure/*`, `docs/*`, `tests/*`                        | three application shells                                             | workspace build and structure validation                                                                                                                                     | P1 scaffold implemented; acceptance pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ARCH-04 §3.4          | One-command local setup; containers; env validation; migrations/seeds; reproducible commands; no secrets                                                                                     | root scripts; Compose; config package; migrations                                      | environment/deployment reference                                     | invalid-env, migration up/down, clean-start tests                                                                                                                            | P1 foundation and deterministic private dev bucket verified; production setup pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| DATA-01 §4.1          | ERP-owned unified products, categories, partners, locations, equipment/serials, prices, warehouses, documents, payments; real-time CRM/POS sync                                              | master-data modules; outbox/inbox; canonical IDs                                       | versioned ERP APIs; CRM/POS consumers                                | source-of-truth and synchronization integration tests                                                                                                                        | P2/P3/P5/P6 canonical paths verified. CRM reads the ERP-owned customer, location, equipment, Sales, finance, receivable, payment, and POS sale records. Online POS reads the same products, stock, pricing, customers, registers, and operators, then publishes audited sale events without a duplicate master-data store. Provider reconciliation remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| IAM-01 §4.2, §6.8     | One employee account; unified module/action RBAC (view/create/edit/delete/approve); admin 2FA; optional other 2FA; password complexity/expiry                                                | identity, auth, RBAC, sessions, factors                                                | auth/session/factor/role APIs; account/admin UI                      | auth, 2FA, expiry and backend RBAC tests                                                                                                                                     | P1 login/TOTP, controlled initial-administrator provision, connected administration, employee password change, and administrator-issued password/factor recovery verified; configurable history/complexity/expiry, session revocation, audit, and My access UI are covered. Approved production roles and policy values remain pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| IAM-02 §4.2, §9.3–9.4 | Backup operator/admin/security-officer separation; four eyes; central AD/LDAP/Entra/SAML/OAuth/OIDC; protected emergency access                                                              | roles, approvals, identity adapters, emergency access audit                            | backup access/approval APIs and UI; runbook                          | role separation, MFA, four-eyes, provider contract tests                                                                                                                     | P1 four-eyes DB invariant verified; remaining behavior planned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AUD-01 §4.3           | Tamper-resistant actor/time/action/target audit for documents, serials, logins, backup/restores, policy and approvals; ordinary users cannot delete backup logs                              | append-only audit event store; integrity metadata                                      | authorized audit query API/UI                                        | mutation denial, completeness and integrity tests                                                                                                                            | P1 serialized append-only hash chain plus protected filtered query, control-room explorer, and recomputed integrity verification tested live                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| FIN-01 §4.4           | Fixed-precision EUR accounting; multi-currency BNB snapshots; VAT 20/9/0/exempt/ICA; immutable posted calculations                                                                           | money/tax/rate domain; financial migrations                                            | finance APIs and posted-document views                               | tax, currency, rounding and immutability tests                                                                                                                               | P3 draft foundation verified: deterministic fixed-point line/VAT/EUR calculation and explicit currency-rate date/source snapshots for all required VAT treatments; automatic BNB retrieval, approved posting, and posted-document immutability remain pending FIN-001/2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DOC-01 §4.4–4.5       | Linked source/correction/fiscal/accounting/payment docs; concurrency-safe sequences; timezone; PDF/logo/signature/email; versioned secure files                                              | documents, sequences, attachments, storage                                             | document/file APIs, print/email UI                                   | sequence concurrency, links, access and output tests                                                                                                                         | Partner-file versions and structured financial draft source/correction links plus concurrency-safe internal scope references verified; official numbering, fiscal/accounting/payment links, approved templates/logo/signature/email, production scanning/retention, and remaining attachment parents stay pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| NTF-01 §4.6           | In-system/email notifications; backup SMS; queued, retryable, observable, idempotent                                                                                                         | notification outbox/jobs/adapters                                                      | notification centre and delivery status                              | retry, duplicate replay, provider failure tests                                                                                                                              | P1 queued, retryable and deduplicated in-system/email delivery is implemented and locally tested; the Backup SMS adapter is optional, configured off, and tested with provider calls stubbed. Live mail/SMS delivery still requires deployment configuration and hosted checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| INT-01 §4.7, §11      | BNB, bank, email, Econt, Speedy, fiscal, PIN pad, scanner, optional ESL/e-commerce, identity, enterprise adapters; errors/retry/idempotency/log/reconcile                                    | ports/adapters; integration runs; inbox/outbox/idempotency                             | versioned APIs/webhooks; integration operations UI                   | adapter contract and reconciliation tests                                                                                                                                    | P1 durable outbox publisher, inbox deduplication, payload-free operations UI/API, ordering boundary, dead-letter state, and audited replay verified with low-stock consumer; named provider adapters remain in P1/P3/P6/P8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| DOM-01 §5             | Explicit identity, organization, partner, location, contact, address, bank, contract and SLA entities with immutable IDs                                                                     | identity and master-data migrations/domain                                             | shared contracts and CRUD APIs                                       | constraints and relationship tests                                                                                                                                           | P1 identity plus P2 organization and partner/location/equipment create, update, version-lock, and reversible-lifecycle slices verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| DOM-02 §5             | Explicit catalog, equipment, warehouse, procurement, sales, finance, service and logistics entities                                                                                          | catalog and inventory migrations/domain                                                | catalog plus connected warehouse operations UI/APIs                  | live catalog/inventory and browser workflow tests                                                                                                                            | P2 catalog, customer-equipment register, and warehouse ledger/balance/serial/batch/valuation/operator workflows verified; later modules planned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| DOM-03 §5             | Explicit CRM, ticket, survey, POS, reporting, backup/restore/DR/audit entities                                                                                                               | module migrations/domain                                                               | module APIs and screens                                              | migration/schema and workflow tests                                                                                                                                          | P5–P8 / planned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ERP-FIN-01 §6.1       | VAT-compliant invoice/proforma/conversion/credit/debit, scoped numbering, PDF/email, POS receipt linkage, VAT and currency                                                                   | finance/document modules                                                               | finance API and screens                                              | proforma and fiscal-link integration/E2E tests                                                                                                                               | P3/P6 structured draft foundation verified: invoice/proforma/credit/debit preparation from Sales or manual lines, required VAT treatments, immutable party/rate/EUR/source/correction snapshots, transactional internal numbering, and one concurrency-safe Finance invoice draft linked bidirectionally to an exact posted POS receipt. RBAC, idempotency, audit/outbox, responsive preview/back UI, and live database concurrency coverage pass. Legal issuance/conversion, official numbering, BNB adapter, certified fiscal link, approved PDF/email, and posting remain pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ERP-FIN-02 §6.1       | Invoice states, partial payments/balance/overdue, all payment methods, reminders, automatic/manual bank matching                                                                             | payments, allocations, bank, schedules                                                 | payments/register UI and APIs                                        | allocation, overdue and matching tests                                                                                                                                       | P3 operational foundation verified: EUR customer and supplier balances, partial allocations, advances, bilateral offsets, balance/status history, retry-safe overdue detection, idempotent in-system upcoming/overdue reminders for operational Finance users, balanced manual statements, exact-reference incoming matching, confirmed outgoing supplier matching, RBAC, locking, audit/outbox, and responsive register/drawer flows. Legal invoice states, provider-backed email reminders, reversals, approved bank-file adapters, and accounting posting remain pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ERP-FIN-03 §6.1       | Cash vouchers/daily reports; Bulgarian statements/manual entry; invoice/advance/other allocation                                                                                             | cash/bank modules                                                                      | import/mapping screens and APIs                                      | parser contracts and allocation tests                                                                                                                                        | P3 verified: manual EUR statements, customer and supplier payment allocation, explicit supplier advances, bilateral offsets, concurrency-safe cash receipt/payment vouchers, collection-linked cash allocation, cancellation of independent vouchers, and operational daily cash reports. Finance now parses standard single-account EUR CAMT.053 and MT940 statements alongside CSV/XLSX mapping; parser, duplicate-review and browser upload tests pass. Actual Vista-bank export compatibility remains an operational check. Cash-day controls, linked-payment reversal, direct supplier cash-voucher allocation, and accounting posting remain pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ERP-FIN-04 §6.1       | Receivable/payable registers; aging buckets; turnover; sales/purchase journals; accounting export; VAT reports                                                                               | reporting definitions/export jobs                                                      | reports/filter/download UI and APIs                                  | formula, access and Excel/CSV/PDF tests                                                                                                                                      | P3 operational registers verified for balances, aging, partner turnover, Sales and Purchase journals, and recorded VAT by treatment/rate. All seven controlled reports support owner-scoped asynchronous CSV/Excel/PDF generation with idempotent queueing, retry state, integrity checks, access control, audit evidence, responsive UI and live workflow tests. Supplier invoices now retain invoice-date BNB/EUR snapshots; foreign-currency purchase journals, input VAT, and Income/Outcome exports reconcile to source amounts. Unknown account codes remain blank under the adopted default. Named-package mapping is not assumed without a target chart.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ERP-PROC-01 §6.2      | Supplier terms/evaluation, POs, partial/full receipt, automatic warehouse receipt, three-way comparison, claims/status, linked history and acceptance-handover protocol                      | procurement + warehouse + finance                                                      | procurement API/UI                                                   | PO-to-receipt-to-invoice/protocol E2E                                                                                                                                        | P3 procurement plus immutable acceptance protocols verified: partial/full receipt, stock posting, invoice matching, discrepancies, traceable numbered protocol, concurrent retry safety, source linkage, print view, English/Bulgarian UI and no additional stock movement. Hosted retest remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ERP-WMS-01 §6.3       | Unlimited central/Vratsa/service/mobile warehouses; hierarchical required categories                                                                                                         | catalog/warehouse domain                                                               | category UI; warehouse API                                           | hierarchy, normalized warehouse lifecycle tests                                                                                                                              | P2 categories verified; empty configurable standard/technician warehouse foundation verified; client topology remains BUS-001                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ERP-WMS-02 §6.3       | Unique mandatory serials; batch/expiry; receipt/issue/return/transfer/stocktake; weighted average; optional FIFO                                                                             | inventory ledger/balance/serial/batch/return/transfer/stocktake/valuation              | connected movement, stock, and stocktake APIs/UI                     | live invariants plus browser command/approval tests                                                                                                                          | P2 receipt, issue, linked return, transfer, stocktake, and weighted-average EUR valuation verified end to end; optional FIFO planned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ERP-WMS-03 §6.3       | Minimum stock/alerts/recommendations; reservations; supplier/customer/technician serial traceability; no negative/double counts                                                              | reservations, replenishment, alert state/queue, traceability                           | connected replenishment/reservation/serial timeline APIs/UI          | live invariants plus browser settings/movement tests                                                                                                                         | P2/P4 reservation, cycle-deduplicated low-stock notification delivery, replenishment, and complete supplier receipt→sale→customer handover→return→Service→technician repair serial timeline verified with current custody, exact-serial return validation, audit, retry, live database, and browser tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ERP-SALES-01 §6.4     | Quotation→order→shipment→invoice; validity, line/overall discounts; price lists by group/customer/time/campaign                                                                              | sales/pricing modules                                                                  | workflow APIs/screens                                                | quotation-to-payment E2E                                                                                                                                                     | P3 quotation→confirmed order→shipment→invoice-draft and scoped price lists verified with validity, discounts, VAT snapshots, stock/serial/batch controls, deterministic currency/date/customer price resolution, quotation application, audit/outbox, responsive preview/back UI, and live retry tests; approved official invoice issuance and payment remain pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ERP-SALES-02 §6.4     | Service contracts by location/devices/frequency/services/pricing; recurring invoice; serial reservation; handover certificate                                                                | contracts/sales/schedules/docs                                                         | contract API/UI and certificates                                     | recurring-job and handover tests                                                                                                                                             | P3/P4 service contracts, installed-device/location coverage, visit/billing schedules, retry-safe recurring drafts, shipment-derived handover certificates, customer-location acceptance, and transactional sold-serial equipment registration verified with audit/outbox and responsive UI; approved legal invoice issuance remains ERP-FIN scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ERP-SVC-01 §6.5       | Requests from telephone/email/portal/on-site; work order customer/location/device/serial/problem/service type                                                                                | `service` requests/work orders and canonical master-data links                         | protected Service API; responsive request/work-order UI              | live authorization, retry, and browser-navigation tests                                                                                                                      | P4 core in progress: manual source capture, validated canonical references and coverage type, request intake, dispatch/rescheduling, cancellation, audit/outbox, idempotent commands, and loop-safe CRM ticket correlation are verified. Inbound email and portal channel adapters remain planned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ERP-SVC-02 §6.5       | Technician schedule/calendar/workload; responsive assigned/completed/parts/time/photo/signature                                                                                              | assignments, time entries, photo/signature evidence, status history                    | responsive schedule/My work/work-order views and evidence API        | live workflow plus browser-navigation tests                                                                                                                                  | P4 operational scheduling verified: versioned explicit weekday availability, daily bookable minutes and visit limits, seven-day technician workload calendar, business-time assignment validation, concurrency-safe overlap/capacity enforcement, assigned-work access, start/complete, time, photos, controlled evidence retrieval, drawn or keyboard-selected signature image, responsive and focus-contained drawers, and audit/outbox evidence. Mobile-width technician and desktop acceptance are verified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ERP-SVC-03 §6.5       | Technician stock deduction; labor/parts/transport cost; payment doc; full serial service history; warranty and inspection; plan visits                                                       | service/inventory transaction boundary; Service-to-Finance source link                 | cost/history UI and Service/Finance endpoints                        | source integrity, replay and browser tests                                                                                                                                   | P4 fixed-precision costs, atomic technician-stock deduction, competing-repair prevention, linked Finance draft and issued invoice handoff, one automatic collection, replay-safe payment allocation, paid balance status and prevention of a duplicate invoice, warranty monitoring/claims, inspections, retry-safe reminders, subscription visits, operational reports, CRM SLA links, and the complete supplier/sale/customer/return/technician repair serial lifecycle are locally verified. Hosted retest remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ERP-LOG-01 §6.6       | Own/courier delivery; Econt/Speedy create/track; reverse logistics; auto service request; route calendar                                                                                     | logistics/adapters/service correlation                                                 | delivery/return/route APIs and responsive UI                         | live lifecycle, replay, inventory/Service and browser tests                                                                                                                  | P3/P4 company-transport delivery, Sales handover receipt, exception/cancel trail, reverse return through original shipment/serial, atomic inventory receipt, retry-safe automatic Service intake, and mixed delivery/Service route calendar are verified. Service stops retain their appointment and technician; shared locks prevent route/Service overlap and route deliveries consume configured technician capacity. Econt/Speedy booking, tracking history, duplicate-safe retry and reconciliation now pass adapter and isolated API/database tests; live provider credentials and hosted checks remain under INT-002.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| RPT-01 §6.7, §13      | Dashboard KPIs; all module reports; filters; Excel/CSV/PDF; no-code controlled reports; async large export; access/reproducibility                                                           | reports/dashboard/export jobs                                                          | dashboard/report designer/download UI/API                            | KPI formula, authorization and export tests                                                                                                                                  | P3/P4/P5 export foundation verified for seven Finance, three Service, and four CRM reports: controlled catalogues, persisted jobs, background generation, private integrity-checked downloads, CSV/Excel/PDF renderers, scoped access, audit, replay safety, responsive UI, and live database coverage. Private saved, field-selectable Finance, Service, CRM and date-range POS reports and permission-scoped operational Overview metrics now have API/UI, concurrency, migration, export and source-reconciliation coverage (docs/architecture/report-workspace.md). Ten additional Procurement/Warehouse/Sales/Logistics reports now have private saved field selections, paginated previews and asynchronous exports. Account-owned Overview card layout is implemented. Shared report library, private scheduled downloads and Finance/Service/CRM/POS summary-card preferences are implemented with migration 0064 and retry, permission-revocation, UI and integration coverage. Official accounting revenue, approved email delivery and Backup reporting remain pending.                                            |
| CRM-MD-01 §7.1        | One synchronized partner DB; legal/individual details; addresses/banks; multiple locations/contacts/equipment/status; duplicate warning/resolution, no silent merge                          | shared partner/location/equipment models; duplicate candidates                         | partner APIs/UI                                                      | duplicate and source-of-truth tests                                                                                                                                          | P2 canonical registry, relations, versioned maintenance, guarded reversible lifecycle, and duplicate blocking verified; controlled resolution pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CRM-COM-01 §7.2       | Chronological calls/email/visits/chat/tasks; attachments; assigned reminders/dates/priorities; customer/location timelines                                                                   | interactions/tasks/attachments                                                         | timeline/task UI/API                                                 | ordering, authorization and attachment tests                                                                                                                                 | P5 verified: customer and location timelines combine incoming/outgoing calls, email, chat, visits, and immutable task lifecycle events; tasks retain assignee, due date, priority, optional reminder, and history. Interaction attachments inherit CRM authorization. Commands are retry-safe and audited; notification delivery, chronological paging, permissions, attachment access, responsive drawers, keyboard containment, and real PostgreSQL lifecycle are verified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| CRM-LEAD-01 §7.3      | Named lead sources; qualification; customer/opportunity conversion; specified stages; revenue/probability; audited validated Kanban                                                          | leads/opportunities/pipeline/audit                                                     | Kanban and conversion API/UI                                         | transition/auth/audit and lead E2E tests                                                                                                                                     | P5 verified: telephone, referral, website, and trade-exhibition leads retain owner and lifecycle history; qualified leads convert once to an existing or newly shared customer and may create an opportunity. New, Qualified, Quotation Sent, Negotiation, Won, and Lost stages retain exact EUR value, probability, owner, close date, Sales quotation links, optimistic versions, audit, outbox, idempotency, responsive drag/drop Kanban, and an accessible panel alternative. DTO, browser-flow, migration rollback/reapply, live PostgreSQL lifecycle, RBAC, duplicate, and stale-update tests pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CRM-TKT-01 §7.4       | Ticket number/channel/priority/category; bidirectional ERP service creation without loops                                                                                                    | tickets/correlation/inbox/outbox                                                       | ticket and service APIs/UI                                           | duplicate-loop E2E                                                                                                                                                           | P5 verified: concurrency-safe ticket numbers, required intake fields, first-response and controlled status history, canonical customer/location/device links, combined-permission checks, stable correlation IDs, and idempotent CRM→Service and Service→CRM creation pass infrastructure and responsive browser checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CRM-SLA-01 §7.4       | Customer/contract SLA response/resolution, monitoring, risk alerts and overdue escalation                                                                                                    | SLA policies/timers/jobs                                                               | SLA admin/status UI/API                                              | deadline, retry and escalation tests                                                                                                                                         | P5 operational engine verified: global, customer, or subscription-contract policies snapshot response/resolution targets onto tickets; the responsive status UI shows both timers; the recurring evaluator creates risk/breach escalation notifications once under replay. Approved production policy values and ownership remain SLA-001.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CRM-PORT-01 §7.4      | Optional portal submit/status                                                                                                                                                                | feature-flagged portal module                                                          | portal UI/API                                                        | authorization and status E2E                                                                                                                                                 | P5 / blocked by selection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CRM-AFS-01 §7.5       | Automatic serial warranty cards/register/status/remaining/reminders/extension/subscription offers                                                                                            | warranties/cards/schedules                                                             | warranty UI/API/PDF                                                  | sale-to-card and reminder tests                                                                                                                                              | P4/P5/P6 operational flow verified: serialised POS sale creates the equipment and warranty card atomically; CRM provides the central status, remaining period, reminder and offer workflow; the POS receipt provides an authorization-scoped printable PDF. Approved physical printing remains POS hardware work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CRM-AFS-02 §7.5       | Claims with description/photos/docs/device/serial; Received→Review→Approved/Rejected→Closed; complete history                                                                                | claims/files/workflow                                                                  | claims UI/API                                                        | transition, audit and history tests                                                                                                                                          | P5 / planned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CRM-AFS-03 §7.5       | Post-service/delivery satisfaction surveys; NPS trend; referral links                                                                                                                        | surveys/responses/referrals                                                            | survey/analytics UI/API                                              | NPS and trigger tests                                                                                                                                                        | P5 / planned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CRM-AN-01 §7.6        | Purchase frequency, ATV, preferences, retention/churn/CLV, conversion, employee KPIs, revenue dimensions; documented formulas/windows/status/sources                                         | versioned KPI/report definitions                                                       | dashboard/export/formula docs                                        | reproducibility and export tests                                                                                                                                             | P5 operational analytics verified: customer activity, retention/churn, observed customer value, product/Service preferences, audited pipeline conversion, employee completion counts, and net EUR revenue by product, Service, customer, region, and employee use controlled definitions and business-timezone windows. The responsive dashboard and account-scoped queued CSV/XLSX/PDF exports are covered by DTO, service, browser, real-PostgreSQL, Redis-worker, object-integrity, and download checks. KPI-001 business sign-off remains a Phase 0 decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CRM-INT-01 §7.7       | ERP two-way partner/location/equipment/document/payment sync; POS customer/profile/invoice/history; enterprise APIs                                                                          | outbox/inbox/master-data API                                                           | integration API/UI                                                   | sync/replay/reconciliation tests                                                                                                                                             | P5/P6 canonical integration verified. POS customer recognition uses the ERP-owned partner and location; completed POS sales appear in CRM purchase history; serialised checkout creates connected equipment and warranty records transactionally. Approved external enterprise adapters and reconciliation remain pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| POS-SALE-01 §8.1      | 1D/2D scan, name/code search, quick panel; real-time ERP stock/price/promotion; H-18 fiscal receipt; receipt invoice; multi-register/operator                                                | sale/catalog/cache/hardware adapters                                                   | cashier UI/API                                                       | scanner/fiscal simulations and sale E2E                                                                                                                                      | P6 online foundation verified: assigned shifts, live ERP catalog/availability, name/code/barcode lookup, register-specific quick access, customer pricing, checkout, transactional stock, audited scoped numbering, idempotent commands, and sale history. A completed customer receipt prepares one linked Finance invoice draft with exact immutable line/VAT snapshots and concurrency-safe replay. Certified H-18 hardware, physical scanner acceptance, and approved official invoice issuance remain pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| POS-SERIAL-01 §8.2    | Mandatory valid serial for named equipment; link customer/date/warranty; print card; real-time CRM/ERP; block invalid/unavailable                                                            | sale/inventory/warranty/outbox                                                         | serial capture UI/API                                                | duplicate/unavailable/concurrent sale tests                                                                                                                                  | P6 online serial flow verified: checkout requires an available serial plus canonical customer location, locks stock, blocks reuse, records the inventory movement, and creates linked equipment, warranty, audit, and outbox records in one transaction. The receipt exposes an authorization-scoped printable warranty-card PDF with sale, customer, device, serial, issuer, and coverage evidence; approved physical-printer integration remains hardware work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POS-PAY-01 §8.3       | Cash, PIN pad, corporate on-account, split, advance, balance, change; recoverable/idempotent payment/fiscal/invoice/stock                                                                    | payment saga/idempotency/inventory                                                     | payment UI/API                                                       | failure injection and duplicate replay tests                                                                                                                                 | P6 online payment flow verified for cash, development card, split, customer advance, approved on-account, and mixed advance/remainder checkout. Customer terms and balances use fixed precision, Sofia business dates, locked credit/advance checks, snapshotted due terms, append-only account ledgers, exact-payment return reversal, transactional posting, stable client IDs, and idempotent replay. Card authorization attempts and immutable events now persist; uncertain results are reconciled under the same sale key before any retry, verified by PostgreSQL integration tests. No payment PIN pad/provider is connected; provider-backed processing and hardware acceptance remain external.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| POS-RET-01 §8.4       | Returns, fiscal reversal, original link, eligible stock, repairable service stock; authorized audited exception only                                                                         | returns/fiscal/inventory/service                                                       | return UI/API                                                        | linked return E2E and exception denial                                                                                                                                       | P6 linked-return flow verified: original receipt, unreturned quantities and serials are enforced; partial/full returns refund only original payment methods; inventory is restored or serialised equipment is sent to Service; fiscal reversal, refund, stock/equipment, audit, and outbox changes commit together and replay idempotently. The approved exception workflow and certified hardware reversal remain pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| POS-PRC-01 §8.5       | Percentage/fixed discounts with roles; bundle/quantity; loyalty identity, earn/redeem ledger; ERP corporate pricing                                                                          | pricing/loyalty ledger/RBAC                                                            | cashier pricing/loyalty UI/API                                       | precedence, permission and ledger tests                                                                                                                                      | P6 verified: ERP-owned customer/group/campaign prices and dated quantity/bundle offers resolve at server-side checkout; priority and non-stacking rules are deterministic. Manual percentage/fixed discounts require a different `pos:approve` employee and a short-lived, single-use approval bound to the exact basket. Customer loyalty identity, enrolment, earning, redemption, append-only ledger history, and return compensations are transactional, audited, and integration-tested. Production commercial parameters remain subject to POS-003 approval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| POS-OFF-01 §8.6       | Durable local store/client IDs/queue/autosync/idempotency/conflict policy/audit/no duplicate/status count/all named failures/fiscal offline hardware proof                                   | POS IndexedDB/local DB; sync protocol                                                  | offline banner/reconciliation UI/API                                 | dedicated offline suite and target hardware                                                                                                                                  | P7 software flow locally verified; physical fiscal acceptance remains external. Restricted DATECS offline cash sales support multi-line whole-unit untracked, batch-tracked and serial-tracked goods, plus saved customer/location and cached customer pricing. Receipt intent is stored before printing and consumes a one-use server-leased DATECS identifier. Product, batch and serial quantities are checked against saved stock; price, VAT, customer, tender, change and receipt evidence are rechecked before server posting. Conflicts remain visible. Retry/conflict records sync to an append-only server audit journal using stable event IDs; duplicate replay returns the original audit receipt, while a reused ID with changed details is rejected. Existing local attempts survive the IndexedDB v5→v6 upgrade. Offline cards, on-account/split payments, discounts, promotions and loyalty remain disabled under the safe offline policy. Local POS tests, API integration, migration rollback/reapply, typecheck and build pass; exact DATECS H-18 offline behavior remains unverified on target hardware. |
| POS-RPT-01 §8.7       | Shift/cashier/X/Z/product/category/payment/time/location/comparison reports and Excel/CSV/PDF                                                                                                | POS reports/export jobs                                                                | report UI/API                                                        | formula/export/access tests                                                                                                                                                  | P6 verified: filtered shift, cashier, product, category, payment, period, location, and cross-location reporting; open-shift X and closed-shift Z cash reconciliation; controlled asynchronous CSV/Excel/PDF exports; scoped access, retries, exact filters, fixed-precision totals, responsive UI, and live PostgreSQL coverage. Development X/Z output remains explicitly simulated until certified H-18 hardware acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| POS-HW-01 §8.8–8.9    | Mandatory terminal/scanner/certified fiscal device/backup Internet router; test doubles; optional kiosk/ESL/e-commerce behind flags                                                          | hardware ports/adapters/features                                                       | setup docs/admin UI                                                  | CI simulators and real hardware tests                                                                                                                                        | P6 development fiscal receipt/reversal and card simulators are verified and hard-blocked outside local/test environments. Target terminal, scanner, certified fiscal device, PIN pad, required backup Internet router, and hardware acceptance remain external; optional features stay unavailable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| POS-INT-01 §8.10      | ERP catalog/inventory/price/document/accounting two-way; CRM recognition/history; enterprise APIs                                                                                            | outbox/inbox/sync/reconcile                                                            | sync API/operations UI                                               | integration and duplicate-replay tests                                                                                                                                       | P6 online internal integration and restricted offline receipt reconciliation are locally verified. ERP catalog, stock, prices, partner/location identity, serial movements, customer equipment/warranty, POS payments, linked Finance invoice drafts, audit and durable outbox share the operational records; completed sales appear in CRM purchase history. Offline fiscal receipts reconcile idempotently with price/stock/customer/serial checks and audited conflicts. Approved official accounting/fiscal issuance, external APIs and target-hardware acceptance remain external.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| BAK-PLAN-01 §9.1      | Source inventory, classification, RPO/RTO and approved/reviewed plan                                                                                                                         | Backup inventory and policies                                                          | Recovery and backup plan                                             | Inventory, approval and review tests                                                                                                                                         | Inventory, approval and annual review workflows are implemented; actual company inventory and management sign-off remain external.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| BAK-JOB-01 §9.2       | Scheduled backups across named sources, modes, deduplication, compression and alerts                                                                                                         | Backup scheduler and source adapters                                                   | Recovery jobs and policies                                           | Lifecycle, S3, WebDAV, IMAP, MariaDB and schedule tests                                                                                                                      | Local software covers PostgreSQL/MySQL/MariaDB snapshots; IMAP, WebDAV, S3 and mounted file/server/workstation/mobile-device snapshots; full/incremental/differential file, email and cloud runs; and exported system-image files. API integration 13/13, Backup unit 56/56, Recovery UI 36/36; disposable MariaDB dump/restore/record recovery passed. Actual source setup and site/hardware acceptance remain external.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| BAK-SEC-01 §9.3       | Ransomware protection, isolated copies, MFA, separated roles and four-eyes controls                                                                                                          | Backup approvals, independent copy and audit                                           | Recovery approval screens                                            | Approval, copy verification and integrity tests                                                                                                                              | MFA, separated roles, approval-gated critical controls and verified encrypted independent-copy software are implemented. Actual air gap, tape, separate infrastructure and domain protection remain external.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| BAK-ID-01 §9.4        | AD/LDAP/Entra/SAML/OIDC group mapping and audited emergency access                                                                                                                           | Identity adapters and group mappings                                                   | Access administration                                                | `directory-authentication.service.test.ts`, `directory-federation.test.ts`, `directory-ldap.test.ts`, `session.service.test.ts`, and `AuthenticationForm.directory.test.tsx` | Provider-neutral LDAP/AD, OIDC/Entra ID, and signed SAML sign-in is implemented locally. Only existing active employee accounts are accepted; explicit external groups map to existing Vista roles, administrative access requires MFA, and emergency local access is allowlisted, requires password plus MFA and reason, and is audited. State/nonce/signature/replay checks and exact-origin one-use app handoff are tested. Provider remains disabled until actual Vista credentials/configuration and hosted connection checks are supplied. See `docs/deployment/directory-sign-in.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| BAK-RST-01 §9.5       | File, database, server and infrastructure recovery; granular and bare-metal restore                                                                                                          | Restore requests, approvals and jobs                                                   | Recovery UI and procedures                                           | Isolated restore, source-loss and authorization tests                                                                                                                        | PostgreSQL/MySQL/MariaDB restores create isolated databases; one database record exports as audited JSON. One email message restores as `.eml`; selected S3/WebDAV/mounted files and exported server/workstation images restore to isolated storage for download. Direct replacement-hardware imaging and witnessed whole-site recovery remain external acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| BAK-DR-01 §9.5        | Implementation DR test and signed protocol: evidence, RTO/RPO, nonconformities, corrections; annual schedule                                                                                 | DR-test register, isolated restore approval, shared-file evidence, scheduled reminders | Recovery DR-test page, downloadable signed protocol, restore runbook | isolated database integration tests; witnessed site restore                                                                                                                  | P8 / plans from verified database copies, requires independent approval for isolated restore, records measured RPO/RTO and corrective actions, stores immutable signed PDF evidence, and permits authorized download. A daily idempotent reminder notifies Backup users initially, within 30 days of the test date, and when overdue; integration tests cover delivery and replay. Witnessed site restore remains external.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| BAK-HW-01 §9.6        | Physical storage server and tape hardware, rotation, isolation and compatibility                                                                                                             | Hardware inventory and integration                                                     | Hardware and operations documentation                                | Physical tape restore                                                                                                                                                        | Hardware provisioning and witnessed compatibility remain external acceptance gates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| SEC-01 §10            | TLS/HSTS, RBAC/admin 2FA/audit, password safety, least privilege, validation/encoding, applicable CSRF, CORS, limits, secrets, backup encryption, scanning, data safety                      | API middleware/guards/config; CI scanners                                              | security docs/admin policy UI                                        | security/integration/CI tests                                                                                                                                                | P1 HSTS/CORS/validation, explicit endpoint tiers, production-required distributed Redis throttling, login limits, scrypt, default-deny/admin-TOTP, guarded access administration, session revocation, and audit verification tested; remaining controls planned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| SEC-02 §10            | Never log passwords, auth tokens, PIN/full card data, or unmasked secrets; no backup secret leakage                                                                                          | logger redaction/data policies                                                         | logging/runbook docs                                                 | redaction and fixture scans                                                                                                                                                  | P1 structured logger redaction test verified; fixture scanning and backup coverage planned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| API-01 §11            | Versioned OpenAPI; request/response validation; stable errors/correlation; pagination/filter/sort/date; verified webhooks                                                                    | API common layer/contracts                                                             | OpenAPI and endpoint docs                                            | contract, validation and signature tests                                                                                                                                     | P1 committed v1 TypeScript client is generated from OpenAPI for all browser apps; existing ERP/CRM calls compile against it; metadata validation and deterministic drift checks run in CI; stable errors/correlation verified; webhook controls remain planned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| API-02 §11            | Idempotent retry; transactions; outbox; reconcile; background jobs; integration failure durability                                                                                           | idempotency/inbox/outbox/jobs                                                          | operations/reconciliation UI/API                                     | fault injection/replay/integration tests                                                                                                                                     | P1 active outbox publication, durable consumer inbox, per-consumer state, stale-claim recovery, ordering, poison dead-lettering, authorization and audited idempotent replay verified; later-domain event consumers and provider reconciliation remain planned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| JOB-01 §12            | All named payment/invoice/inspection/service/warranty/SLA/report/backup/annual jobs; idempotent retry                                                                                        | scheduler and module jobs                                                              | job status/admin UI                                                  | clock/retry/duplicate tests                                                                                                                                                  | P1 unified worker, complete named handler registry, deterministic outbox handoff, notification lifecycle, protected telemetry, and retry/replay tests verified. P3 owns active overdue-payment and asynchronous report-generation handlers. P4 adds active inspection, warranty-expiry, and subscription-visit schedules. P5 activates the recurring CRM SLA evaluator with transactional notification uniqueness and infrastructure replay coverage. Backup execute/verify, retention, missed-run detection, annual DR-test reminders and annual plan-review reminders are implemented; plan-review integration verification passes in the disposable PostgreSQL suite.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| TEST-01 §15           | Required unit, integration, ten E2E, simulator, real hardware and recovery suites; restore not backup-only                                                                                   | `tests/*` and workspace tests                                                          | test/hardware/DR protocols                                           | CI plus signed hardware/DR evidence                                                                                                                                          | P1–P9 / planned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| DATA-INT-01 §16       | All named uniqueness, non-duplication, allocation, movement, orphan, no-silent-delete guarantees; reversals/cancellation/versioning                                                          | constraints/transactions/immutable ledgers                                             | controlled APIs/UI confirmations                                     | database concurrency/integrity tests                                                                                                                                         | P1–P8 / planned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| UX-01 §17             | Responsive back office/tablet/mobile; fast keyboard/touch POS; obvious offline; inline errors; recovery; confirmations; accessibility; localization; help                                    | shared UI/i18n/app shells                                                              | all screens/help                                                     | viewport, keyboard, accessibility and failure-state tests                                                                                                                    | Shared branded sign-in, scalable vector marks/icons, compact inline guidance, accessible action toasts, and account-scoped POS sound preference verified. The POS uses a fixed counter shell with internal scrolling, persistent navigation/status, and responsive touch layout. Remaining localization, built-in help, offline state, and final viewport/accessibility acceptance stay in their owning phases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| DOCS-01 §18           | Architecture/ADR/OpenAPI/schema/deploy/env/integration/hardware/backup/DR/protocol/manual/help/runbook/traceability docs updated with behavior                                               | `docs/*` and generated artifacts                                                       | documentation                                                        | link/build/review checks                                                                                                                                                     | P0–P9 / in progress                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| DOD-01 §19–20         | Inspect/trace/test/document every change; authorization/audit/failure/idempotency/UI/migration/Linux/traceability definition of done; full mandatory scope and explicit optional disposition | all modules                                                                            | all deliverables                                                     | milestone evidence review                                                                                                                                                    | P0–P9 / in progress                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Current disposition (2026-10-28)

The current implementation comparison covers all 128 rows in the supplied
delivery checklist. Local source, migration, API, UI and test evidence is
recorded in [`docs/qa/specification-comparison-2026-10-23.md`](../qa/specification-comparison-2026-10-23.md).
The Manager's Operations QA register reports 50 findings verified locally, no
findings in progress, and two external-acceptance findings. Its historic dated
notes below document how work progressed; they do not override the current
register summary.

Backup/Recovery software for the supported database, email, cloud, mounted-file,
system-image export, granular restore, approvals, audit and recovery paths is
implemented and locally tested. Directory authentication now has configurable
LDAP/Active Directory, OIDC/Entra ID and signed SAML adapters, existing-account
linking, existing-role group mapping, administrator MFA and audited emergency
local access. Both capabilities remain disabled or isolated until actual
provider/source configuration is accepted in Vista's environment. Recovery's
English and Bulgarian in-app help now lists the implemented source types and
clearly separates them from physical-site recovery acceptance; both localized
descriptions are covered by `packages/ui/src/help-content.test.ts`.

No additional locally implementable mandatory software feature was found.
Final handover audit still needs one correction in the September Word manual:
it says Recovery policies, backups, restores and DR tests are unavailable,
which no longer matches the implemented software. The current Markdown DR
procedures are updated; the Word manual has not been modified or visually
re-rendered in this environment. Remaining mandatory acceptance is external:
real DATECS H-18/PIN-pad,
scanner, router and offline hardware tests; actual company backup inventory,
physical server/tape and independent storage; witnessed whole-service and
replacement-hardware recovery; production provider credentials and delivery;
hosted security/regression checks; and confirmed repository ownership and staff
training. Optional customer portal, FIFO valuation, Electronic Shelf Labels and
e-commerce fiscalization remain unselected and disabled.

**Currency clarification (2026-10-13, ADR-0003):** Some earlier QA evidence was
recorded before the EUR transition. Local development/test balances and
valuations have since been converted to EUR, and EUR is the active accounting
currency across the apps. Hosted migration rehearsal and restore verification
remain. The conversion updated amounts, not just labels.

**Application default (2026-10-13, ADR-0004):** EUR is the active default for
money-related work in ERP/CRM and POS. Other source currencies remain part of
the required multi-currency design; automatic BNB rates are still being
implemented. Recovery has no currency workflow.

## Matrix maintenance

### CRM QA verification update (2026-10-09)

CRM-AFS-03 survey proposals after completed Service or accepted delivery and
CRM-LEAD-01 lead telephone format validation and quotation-stage prerequisites
are locally verified in the QA register. The survey invitation is recorded
after staff share the question; automatic email remains subject to INT-001.
Telephone validation supports common international formatting without a
country-specific assumption. An opportunity cannot enter Quotation sent until
a customer quotation is linked; the API enforces the same rule as the UI.

### Service photo acceptance (2026-09-10)

AGENTS §§4.5, 6.5, 11, 15 and 17: `tests/e2e/service.spec.ts` exercises invalid
image content, lost upload acknowledgement with one-photo replay, individual image
retry, exact download, signed completion and authorized manager reopening.
`ServiceEvidenceGallery.test.tsx` covers partial gallery failures and late-response
cleanup. Open Service panels now survive background list refreshes. Photo replay
reauthorizes the current work-order assignment, verified by
`apps/api/test/sales.integration.test.ts`. The shared managed-file integration suite
also passes parent-access, immutable-version and content-validation checks. No
schema or public API changes were required. Remaining attachment browser journeys
are named in the implementation plan; production storage/scanning decisions remain open.

### Reporting acceptance evidence (2026-09-10)

- AGENTS §§6.7, 8.7, 11–13: `tests/e2e/pos-report-history.spec.ts` verifies
  paged POS export history, older downloads, lost-acknowledgement replay and fresh
  repeated exports. `apps/pos-web/src/PosExportHistory.test.tsx` covers paging,
  refresh reset and recoverable loading failures.
- The isolated `--sales-integration --pos-integration` run passed 25 database
  tests and 31 browser journeys. Existing Sales integration coverage verifies all
  ten Procurement/Warehouse/Sales/Logistics report definitions, private exports,
  concurrent schedule creation/dispatch, worker deduplication and access revocation.
  These checks do not certify statutory outputs or hardware behavior.
- Finance, Service and CRM now use shared paged export history with independent
  loading/recovery and account-change response guards. `useExportHistory.test.tsx`
  covers current-page refresh, creation reset and stale-account responses;
  `tests/e2e/report-history.spec.ts` verifies older CSV downloads, repeated fresh
  exports, interrupted-history recovery and responsive layouts in all three panels.
  POS integration checks deny another POS-authorized employee's list, content and
  retry access. Production-scale export/performance acceptance remains separate.

Attachment acceptance evidence for AGENTS §§4.5, 7.2, 7.5 and 11:
`tests/e2e/attachments.spec.ts` exercises partner documents, CRM interaction
attachments and warranty-claim evidence through UI navigation. It proves stable
keys after lost upload responses, single-file replay, exact original-version
downloads, persisted files after reopening, narrow-screen layout and backend
read-only upload denial with permitted downloads. Shared-list failure recovery and
parent/account state isolation are covered by `PartnerDocumentsPanel.test.tsx`.
All three browser journeys and six managed-file integration tests passed on
10 September 2026. Production malware scanning/storage policy remains FILE-001
dependent; this acceptance does not remove that requirement.

ERP report hardening evidence for AGENTS §§11, 13 and 15:
`tests/e2e/report-hardening.spec.ts` passed both browser journeys on
10 September 2026. A disposable 1,001-product fixture verifies all 41 preview
pages against the complete CSV, keyboard paging and narrow-screen containment.
Read-only users receive HTTP 403 for save/export/retry in Procurement, Warehouse,
Sales and Logistics (12 denied requests). Three tests in
`apps/api/src/jobs/erp-report-data.service.test.ts` verify export bounds,
parameterized queries, repeatable-read snapshots and failure cleanup.
Local timings are attached to the HTML browser report. These checks do not
establish production-scale performance or close other report-family acceptance.

Container-scanning evidence for AGENTS §10:
`.github/workflows/ci.yml` discovers images from both Compose files and runs a
commit-pinned Trivy action for OS/library vulnerabilities. High/critical findings
and scan errors fail the check; other images continue and JSON evidence is retained.
All five `tests/security/container-images.test.ts` checks passed on
10 September 2026, with TypeScript, ESLint and YAML syntax validation.
See `docs/deployment/container-security.md` for reproduction and triage.
Hosted execution, finding remediation and future A4 application-image coverage
remain pending; configuration tests are not a clean vulnerability assessment.
The local Redis scan was stopped during a slow vulnerability-database download;
it produced no assessment and must be rerun.

Report-family acceptance for AGENTS §§4.2, 6.7, 7.6, 8.7, 11 and 13:
`tests/e2e/report-families.spec.ts` covers Finance purchase journals, the Service
request register, CRM employee performance and POS closed shifts. Each uses
1,001 disposable records and compares every identifier in downloaded CSV,
Excel and multi-page PDF files. A dropped successful submission response must
retry with the same key/export ID. The viewer is denied save/create/retry in all
four families; Service approval and POS module restrictions remain intact.
`report-family-fixtures.ts` rejects non-test databases, creates disabled synthetic
employees and removes its records before later tests. No business posting rules
or development records are changed. `report-history.spec.ts` now calculates its
expected page counts from existing history, so tests can run together.
`npm run test:e2e:reports` runs the combined report acceptance group. PDF content
checks require Poppler; CI installs it. These are local fixture measurements,
not production capacity, official accounting or hardware acceptance.

The PDF inspection identified raw UTC times in POS exports despite business-time
criteria. `pos-reports.service.ts` now formats new shift-register and X/Z export
times in the configured business timezone. Four tests cover winter, summer,
midnight rollover and a non-Sofia configuration. Stored/API timestamps and old
export files remain unchanged. Shared PDF numeric columns have more space for
headings; generated first/last pages are included in local visual acceptance.

Verified on 10 September 2026: the combined report run passed all 21 browser
checks and 4 POS database integration tests. Related validation passed 71 API
unit tests, 31 Operations/POS component tests, TypeScript, affected-file lint
and formatting checks. Temporary services were removed after the successful
run. This closes the bounded report-family acceptance, not all Phase A3 work.

Cross-app regression for AGENTS §§10, 15, 16 and 18 is reproducible with
`npm run test:regression`: repository validation precedes isolated acceptance
so shared-package builds cannot hot-reload an active browser journey. CI runs
`npm run test:acceptance` with all database/infrastructure API tests enabled,
followed by browser journeys and latest-migration rollback/reapply. Generated
browser artifacts are excluded from lint/formatting, not the test sources.
The generated API client and rate-limit inventory now include the existing
Prometheus monitoring route. Authentication browser helpers honor real rate-limit
cooldowns and regenerate MFA codes after waiting. The CRM timeline integration
setup rolls back dependent migrations in order, then reapplies the timeline and
its successors before testing interactions, tasks and attachments.

Verified on 10 September 2026: repository validation passed all 329 enabled
workspace tests, contract drift, formatting, lint, type checks and application
builds. The final isolated acceptance run passed all 241 API tests with database
and infrastructure checks enabled and all 47 browser journeys (8.2 minutes).
Migration `0064_reporting_hub` rolled back and reapplied after the browser run;
temporary services were removed successfully. Changed-test lint and browser/
security TypeScript checks also passed, as did five container-inventory tests.
These results close local cross-app acceptance for implemented workflows only.
Hosted vulnerability scans, production capacity, official/fiscal hardware,
full offline selling, operational Backup/DR and client-data acceptance remain
pending. Development accounts, credentials and records were not modified.

Finance QA FIN-10 evidence, 9 October 2026: migration `0067` links advance
ledger applications to Finance collections and their payment allocations.
The protected customer-account workflow caps application at both available
advance and receivable balances, retains the original payment date/method and
advance reference, and updates both balances atomically. API coverage verifies
authorization, over-allocation rejection, two concurrent partial applications,
idempotent replay, ledger/payment linkage and zero remaining advance. All 22
Sales/Finance API integration tests, all 54 ERP/CRM component tests and all five
Finance browser journeys passed; migration rollback/reapply also passed on a
clean disposable schema. Browser acceptance used the installed system Chromium.
The QA register records FIN-10 as verified locally; hosted retest remains open.

Shared-interface QA UI-04 evidence, 9 October 2026 (AGENTS §§3.3, 17):
tablet-width report tables and the partner register keep horizontal scrolling
inside their table regions; the six-stage CRM pipeline scrolls inside its board;
partner and opportunity drawers fit the viewport and retain internal vertical
scrolling. `tests/e2e/reports.spec.ts`, `tests/e2e/crm.spec.ts`, and
`tests/e2e/organization.spec.ts` cover the 768 px acceptance. The partner record
drawer uses border-box sizing so its padding is included in the viewport-bound
width. Chromium browser checks passed locally; hosted visual retest remains
pending.

For an active vertical slice, split the relevant group row into individual
requirements and add concrete identifiers, for example migration timestamp,
route/operation ID, screen route, unit/integration/E2E test path, ADR, and
acceptance record. Never delete a row when deferring it; retain it with its
dependency or decision blocker.

## QA status reconciliation, 14 October 2026

The current status for Operations QA findings is recorded in
[`docs/qa/operations-2026-10.md`](../qa/operations-2026-10.md). FIN-01,
FIN-02, FIN-07, FIN-12, FIN-13, SEC-02, WH-01, WH-04, SAL-02, SRV-02, SRV-03
and CRM-10 are verified locally against their QA scope. Older phase notes in
this matrix describe the earlier implementation state. This does not substitute
for wider statutory/production acceptance, a hosted retest, DATECS hardware
verification, or the witnessed backup restore, which remain explicit gates.

## Finance lifecycle extension, 23 October 2026

AGENTS §§4.4, 6.1 and 11; specification-comparison F02, F04 and the non-POS
portion of F09:

- Migration `0079_finance_collection_sources` permits non-Sales collections and
  records independent location/register/operator official-number series. The
  allocator preserves existing numbers, reserves non-overlapping ranges and
  fails safely at ten-digit exhaustion.
- Issuing a positive-value manual, Sales, completed Service or subscription
  invoice/proforma creates or links one collection. Older issued documents have
  a version-checked, permission-protected collection-link command. Issued-source
  collections cannot be cancelled independently; POS receipt invoices are
  excluded from automatic collection to avoid double settlement.
- Manual payment, bank matching, cash voucher, advance application and supplier
  offset use the same transactional paid-proforma conversion. The invoice keeps
  source/party/line links, its own dated EUR snapshot and the existing payment
  allocations. Preview navigation follows both conversion directions and the
  collection, with Bulgarian labels and phone-width layouts.
- Evidence: `apps/api/test/sales.integration.test.ts` covers concurrent scoped
  issuance, range renewal/exhaustion, partial bank payments, settlement replay,
  older-document linking, authorization, stale versions and downgrade refusal.
  `tests/e2e/qa-finance.spec.ts` follows manual proforma → issue → two payments →
  official invoice → original proforma → same collection, plus BG/mobile checks.
  Existing trade, technician-Service and POS journeys remain regression coverage.

Company-logo/signature handling, correction balances,
all-source register scalability, POS payment reconciliation and statutory/export
acceptance are still pending. This extension is not full Finance or project
acceptance and does not change external hardware/restore gates.

Local verification: `npm run validate` passed, including all workspace checks,
tests and builds. The isolated full API run passed 283 tests with no skips;
ten connected Finance/Sales/Service/POS browser journeys passed. After the final
translation and migration-guard corrections, all 32 Sales/Finance integration
tests and seven Finance browser journeys passed again. Migration `0079`
rollback/reapply and refusal to discard non-Sales collections both passed.

## Recurring issuance extension, 23 October 2026

AGENTS §§4.4, 6.4, 11–12; specification-comparison S05:

- Migration `0080` retains explicit Finance approval per subscription revision,
  scope, first date, tax treatment and payment term, plus per-period issuance
  outcomes. Existing contracts and manual Finance drafts are not auto-issued.
- The existing billing worker now issues enabled due periods, atomically linking
  official invoice, number, collection, audit and outbox. Live approver permissions
  and contract snapshots are checked again on execution. Failed financial effects
  roll back; retries, concurrent workers and changed approvals cannot duplicate an
  invoice. A bounded failure count moves persistent errors to visible review.
- Finance → Recurring invoices provides searchable pagination, setup, immediate
  due-period processing and recent history with links to Finance/collections.
  Sales history displays the issued number. New screens, errors and help text
  support English/Bulgarian and narrow viewports.
- Evidence: Sales/Finance integration scenarios cover authorization, replay,
  concurrent workers, transient failure rollback/retry, manual-draft preservation,
  stale versions, contract/access and billing-cycle changes, retry exhaustion and
  downgrade protection. The connected
  Finance browser journey covers setup → issued invoice → collection → payment →
  disable, with Bulgarian phone-width panel checks.

Branding/signatures, correction balance effects, POS settlement reconciliation,
all-source register scalability and statutory/export acceptance remain pending.

Final local verification: `npm run validate` passed. The isolated acceptance run
passed all 288 API tests without skips, migration `0080` rollback/reapply and all
11 connected Finance/Sales/Service/POS browser journeys. EN/BG screenshots were
reviewed, including scrollable phone-width forms with fixed full-width actions.
Only disposable test databases/containers were used; no hosted deployment or
physical-device/restore acceptance was performed.

## Startup rate import and audit serialization, 26 October 2026

AGENTS §§4.3–4.4, 4.7, 10–12:

- BNB startup imports now use the shared retryable queue, deduplicated by business
  date, alongside the existing weekday schedule. The bounded official XML adapter
  rejects HTML access errors and invalid/inconsistent feeds before database writes.
  Cache writes are transactional and identical replays are no-ops; issued document
  snapshots stay unchanged. Evidence: `bnb-rate-feed.test.ts`,
  `bnb-currency-rates.refresh.test.ts`, `bnb-currency-rates.integration.test.ts` and
  the recurring-schedule tests. Live XML access is still blocked from this local
  host and must be verified on the deployment host.
- Generated repeat-job timestamps remain readable in the structured `jobId` field
  only. Secret/card redaction elsewhere is unchanged and has explicit regression
  tests in `structured-logger.service.test.ts`.
- New audit events hash the same JSON representation stored in PostgreSQL,
  including nested dates and omitted undefined properties. The canonical hash
  format and historical events remain unchanged. Real database round-trip and
  integrity coverage is in `audit-serialization.integration.test.ts`. The existing
  local historical warning remains visible and requires review, not rehashing.

Local verification: repository validation passed, all 330 API tests passed with
infrastructure enabled, and all 12 selected Finance/Sales/POS browser journeys
passed using installed Chromium. Migration `0083` rollback/reapply passed in the
disposable database. The final incomplete-feed guards also passed their targeted
tests and lint check. No hosted deployment or successful live BNB import is claimed.

## Finance gap reconciliation, 26 October 2026

AGENTS §§4.4, 6.1, 11–12; specification comparison F02, F04, F05 and F09:

- The source comparison had not caught up with already implemented work:
  settlement-triggered proforma conversion (including standalone proformas and
  partial bank settlement), official number ranges by location/register/operator,
  and configured company logos/signatures on financial PDFs and email are covered
  by current code and regression tests.
- The remaining F09 behavior was a single payment-status register across issued
  invoices/proformas and POS sales. It now reports paid POS invoices once, links
  their receipt and customer account, reflects returns/credits and payment
  reversals, filters/paginates results, and excludes drafts. PostgreSQL and
  browser regressions cover those paths.
- The account-page UI test fixture was updated to return the new payment-status
  endpoint contract. This fixes the fixture rather than hiding the endpoint or
  weakening the page.

Verification: `npm run validate` passes OpenAPI/client synchronization, format,
lint, workspace typechecks, all enabled unit suites and production builds. The
isolated PostgreSQL Sales/POS run passed 50 tests, including payment-status
scenarios, and migration `0087` rolled back and reapplied. The POS browser smoke
test passed with system Chromium. Local success does not claim hosted statutory,
mail, DATECS or accounting-package acceptance.

## Backup alerts and annual DR-test reminders, 28 October 2026

AGENTS §§4.6, 9.2 and 12; Manager QA BCK-01; traceability NTF-01 and
BAK-JOB-01:

- Verified backups, exhausted failures, and missed schedule slots now create
  deduplicated in-system and email notifications for active Backup-authorized
  employees. Missed slots are recorded once per policy and scheduled time.
- An optional Twilio SMS adapter is available behind configuration and remains
  off by default. Unit tests cover provider request construction, rejection,
  retryable errors, and disabled configuration. Live delivery is not claimed.
- Isolated PostgreSQL integration tests cover alert retries and duplicate
  detection alongside the existing backup/restore lifecycle.

Verification: the DR reminder regression covers no-record, upcoming, overdue,
freshly recorded, and replay cases across in-system, email and configured SMS.
The scheduler/handler tests pass (21 tests), isolated Backup PostgreSQL
integration passes (3 tests, including duplicate-safe in-system, email and
configured SMS queueing), and the Operations App suite passes (63 tests).
API/Operations typechecks and builds, localization tests, and Recovery build
pass. Annual plan-review UI and backend flows pass the isolated PostgreSQL
lifecycle regression. Other backup source adapters,
incremental/differential/system-image modes, deduplication, protected
independent copies, and broader recovery remain open
under BCK-01.

## Managed file-store backup and isolated restore, 28 October 2026

AGENTS §9.2; Manager QA BCK-01; traceability BAK-JOB-01 and BAK-RST-01:
encrypted, verified full backups now support Vista's managed S3-compatible file
store alongside PostgreSQL. The archive validates object metadata and source
consistency before and after streaming. A second-person-approved restore writes
to a generated prefix in backup storage; it cannot replace source files. Failed
restore cleanup is scoped to that generated prefix. Unit coverage passes 4/4,
the focused Backup PostgreSQL lifecycle passes 5/5, and the full isolated API
integration run passes 374/374. Recovery UI tests pass 17/17, and its production
build succeeds. Browser E2E is not claimed because Playwright Chromium is not
installed in this environment. Individual-file selection and remaining BCK-01
requirements are still open.

## S3-compatible backup sources, 28 October 2026

AGENTS §9.2; Manager QA BCK-01; BAK-JOB-01 and BAK-RST-01: configured
S3-compatible buckets use the encrypted, verified full/incremental/differential
and isolated file-recovery lifecycle. Source credentials remain in deployment
secrets. Migration 0117 retains existing managed-source mappings and binds new
runs to a non-secret source fingerprint. The local PostgreSQL lifecycle suite
passes 11 tests, including upgrade and source-loss recovery; a real local MinIO
protocol test also passes. Real provider configuration and site acceptance
remain external. This supersedes older backup progress notes above.

Additional PostgreSQL recovery accepts both PostgreSQL URL schemes and restores
non-Vista databases without requiring Vista's migration table. Archive inspection
and the primary-source check retain the Vista-ledger requirement where applicable.
An isolated integration test verifies a reporting database after its source
connection is removed.
