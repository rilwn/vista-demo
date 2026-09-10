# Browser acceptance

## Complete local regression

Run `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm run test:acceptance` for
the combined browser suite and the full API suite, with database and
infrastructure checks enabled. The same command runs in CI. After the browser servers stop,
it rolls back and reapplies the latest migration in the disposable database.
This is not a production-data migration or disaster-recovery rehearsal.

Authentication tests respect the server's rate-limit cooldown and generate a
fresh MFA code after waiting. They do not disable throttling or reset its counters.
Generated browser reports and screenshots are excluded from source formatting
and linting; test source files remain checked.

Run `npm run validate` separately for API contract drift, formatting, lint,
workspace type checks, unit/component tests and application builds.
For both in order, use `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm run test:regression`.
Do not run builds or `validate` alongside browser acceptance: rebuilding shared
packages can hot-reload the browser apps and discard the journey's open panel.

Verified on 10 September 2026: full repository validation passed (329 enabled
workspace tests and all builds/checks). The final isolated acceptance run passed
241 API tests with no skips and 47 browser journeys in 8.2 minutes. Migration
`0064_reporting_hub` rolled back and reapplied successfully after the browser
servers stopped; the temporary project was removed. The CRM timeline suite also
verified rollback/reapply through its newer migration dependencies before running
all four timeline tests. Hosted security and external acceptance remain pending.

## Setup and isolation

Run `npm run test:e2e` from the repository root after `npm ci` and
`npx playwright install chromium`. Docker Compose is required. On Linux, install
browser OS dependencies with `npx playwright install --with-deps chromium` if needed.
The large-report PDF checks also need Poppler (`sudo apt-get install poppler-utils`
on Debian/Ubuntu). CI installs it before running the browser suite.
An existing compatible Chromium can be used with
`PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`.

The runner creates a random `vista-e2e-<uuid>` Docker project containing dedicated
PostgreSQL, Redis, private MinIO and mail capture. It ignores `.env`, applies
migrations and seeds only this project's `vista_e2e` database, then starts fresh
API/Operations/POS/Recovery processes. It never reuses running application servers.
Ports 58432, 58379, 58900, 58025, 5300, 5373, 5374 and 5375 must be free. Run one suite at a time.

Only that random test project and its disposable volumes are removed afterward,
including on normal failure or interruption. Existing development services, data
and credentials are not used. If the process is forcibly killed, inspect Docker
for the exact project printed during startup before removing that test project.

Tests use UI navigation and real APIs, not response mocks. The first acceptance
cases cover Finance draft attachment upload/replacement/original download/reopen,
narrow-screen attachment layout, platform monitoring, and denied viewer access.
These do not certify official Finance issuance or hardware behavior.

`trade.spec.ts` follows a connected UI journey: order two serialised fiscal
devices, receive one at a time, check both goods receipts, record the supplier
invoice and assert ordered/delivered/invoiced quantities match. It then sells
one of those received serials, checks confirmation requires serial selection,
records customer handover, prepares an invoice draft and reopens it after reload.
Receipt-line checkbox behaviour and phone-width overflow are also checked.
This covers AGENTS §15.3(2) and the implemented draft portion of §15.3(1), not
official invoice issuance. The same journey adds its Sales draft to collections,
rejects an amount above the balance, recovers payment entry after a pre-submit
browser disconnection, and records partial/final bank-transfer payments. It
checks the original source link, unpaid/partially paid/paid statuses, exact
balances, two payment references, and persistence after reload. These are manual
payment records, not bank-provider reconciliation. Lost acknowledgements after
server commit are not simulated by this disconnection test.
`service.spec.ts` dispatches a new request using a manager session, then completes
the assigned work in a separate technician session at phone width. It checks
mandatory signature capture, 45 minutes, one batch-tracked part, 106 BGN costs,
and technician stock falling from 5 to 4 through real reference-data responses.
The manager reopens the record from a stale list without refreshing and prepares
its linked Finance draft. This guards against reopening cached work-order details.
It covers the draft-document portion of AGENTS §15.3(4), not legal issuance.
`crm.spec.ts` qualifies a lead, converts it using an existing customer, links a
seeded customer quotation, drags the opportunity into Negotiation, records Won,
and verifies persistence and phone-width overflow. It also creates linked
ticket/Service pairs starting from each module and checks repeated round trips
return the same identifiers. New-customer conversion and Lost outcomes are also
covered: conversion and stage changes lose their successful response and retry
with the same key, retaining one customer/opportunity and one history entry.
The customer/contact remains in the shared partner registry. Duplicate detection
preserves the form and supports an explicit switch to the existing customer.
Phone screenshots cover conversion and the reopened Lost preview.

```sh
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --crm-integration tests/e2e/crm.spec.ts
```

On 10 September 2026, four CRM browser journeys, five CRM API integration tests
and 104 Operations component tests passed in their targeted runs. The integration
suite checks migration rollback/reapply against the current latest migration,
conversion replay, audited stages, Lost probability/weighted value, stale-version
rejection and read-only command denial. API/Operations typechecks, browser-test
typecheck, affected-file ESLint and the Operations build also passed.

`pos.spec.ts` opens a cashier shift, sells a customer-linked serialised device for
cash, checks missing-serial blocking and change, downloads its warranty PDF,
prepares a linked Finance draft and checks the same draft after a history reload.
It returns the device against the original sale, checks restocking and full-return
status, and closes with the original opening cash. Checkout viewport access and
horizontal overflow are checked. Fiscal receipts
and reversals use the development simulator, not certified hardware.

`pos-commercial.spec.ts` adds two cashier journeys using real protected APIs:
quantity offers, rejected self-approval, manager-approved percentage discounts,
loyalty redemption/earning with exactly two sale-linked ledger entries, split
cash/card payment and change; then advance plus contracted credit with persistent
balances and an unchanged cash drawer. Excessive advance inputs remain visible
and block checkout with an associated field error. A screenshot captures that
validation state. Thirty browser tests run in total. Card authorization uses the
development PIN-pad simulator, not a bank or certified payment terminal.

Failure traces/screenshots are under `test-results/browser`; the HTML report is
under `playwright-report`. These ignored files may contain disposable fixture
credentials and test records. Never run this suite against production or share
traces as public artifacts. CI artifacts should be private and short-lived.

Remaining acceptance work is tracked in `IMPLEMENTATION_PLAN.md`, including
action-level denial, large-list/export and other evidenced hardening gaps.
Offline/fiscal and Backup/DR cases require their approved dependencies.
Existing API integration tests remain complementary.

`pos-recovery-returns.spec.ts` covers bundle/card payments with a fixed discount,
full refunds and loyalty reversal, plus serialised returns to Service with POS
document references in Operations' serial history. The recovery case lets the real
server commit a sale, drops its HTTP acknowledgement, blocks lookup temporarily,
and reloads before recovering the same receipt. It verifies one sale submission,
one history record and the expected closing cash. This is interrupted online
checkout recovery, not offline selling or fiscal certification.

Repeated sign-ins may reach the real login limit. The cashier, report, Service
and trade journeys respect the server's cooldown and retry once, with a bounded timeout. Production
limits are not raised or disabled for the suite. Successful screenshots capture
the discounted return, Service serial history and recovered receipt.

`auth.spec.ts` provisions an administrator through the existing controlled
provisioning function in the disposable database and temporarily enrolls the
fixture Operations manager, cashier and backup operator. It verifies MFA challenges and invalid codes,
phone-width form access, session restoration, API rejection before authentication,
server revocation after sign-out, and denied POS access with a real 403 response.
An unassigned viewer cannot enter POS or Recovery. A password-only backup session
receives authenticator-setup guidance instead of the console. This is console
access acceptance, not backend Backup/DR or critical-operation authorization.
Temporary fixture factors are removed before the remaining cashier journeys.
Generated keys and session tokens are never printed; captured traces remain private.

The same suite creates two separate employee fixtures for authenticator setup and
removal, and password change/expiry/recovery. It uses the account menu and Security
directory, checks invalid inputs, verifies prior-session revocation, and rejects
reuse of the administrator-issued recovery code with `RECOVERY_CODE_INVALID`.
Only the fixture password-expiry timestamp is advanced directly in the database;
all password, authenticator and recovery changes go through the real application.
Setup screenshots are captured before secrets are entered or displayed.

The administrator recovery journey uses a separate disposable administrator.
Another verified administrator issues its handoff through Security. The test loses
the first successful handoff response and verifies a same-key retry, then resets
the password through the recovery screen. Old sessions are rejected, password-only
login stays forbidden, invalid authenticator codes fail, and successful enrollment
permits a verified administrative login. The consumed code cannot start another
enrollment. The completed recovery screen is checked at phone width.

On 10 September 2026, all eight authentication browser journeys and 16 authentication
API integration tests passed together. Six authentication unit tests and all 104
Operations component tests also passed. API, Operations and browser typechecks,
affected-file ESLint and the Operations build passed. The API suite now proves
four concurrent same-key handoff requests return one code and one audit event,
and rejects retrieval of consumed or replaced handoffs. Recovery lookup loads
the consumed/revoked state and serializes the initial request lookup. No API
contract, migration, real account or development credential change was required.

To include the authentication database suite, which also checks administrator
recovery, mandatory MFA, lockout, password history and migration rollback/reapply:

```sh
npm run test:e2e -- --auth-integration
```

The runner builds shared packages and the API before loading these tests. When
running the browser TypeScript check separately on a clean checkout, run
`npm run build:packages` and `npm run build -w @vista/api` first.

To also run the POS database integration tests inside the disposable environment:

```sh
npm run test:e2e -- --pos-integration
```

To include both Sales and POS database suites (including ERP report definitions,
private downloads, concurrent scheduled dispatch and worker replay):

```sh
npm run test:e2e -- --sales-integration --pos-integration
```

Runner configuration follows [Playwright web-server lifecycle guidance](https://playwright.dev/docs/test-webserver).

`reports.spec.ts` adds five report journeys for Procurement, Warehouse, Sales and
Logistics. The Logistics case first creates a company-transport delivery through
the UI. The tests cover empty-result recovery, invalid date ranges, saved-search
restoration after reload, and twelve real queued CSV/Excel/PDF downloads. They
check filenames, CSV text and binary file signatures, not legal report compliance
or every exported cell. A dropped Warehouse download is retried without preparing
a second export. A viewer sees the stock report but cannot prepare exports, and a
direct authenticated create request receives HTTP 403. Narrow-screen overflow and
screenshots are included. Run only these cases with `npm run test:e2e -- reports.spec.ts`.

`reporting-more.spec.ts` adds saved-period restoration and twelve real report
downloads across Finance, Service, CRM and POS. It verifies Finance/Service/CRM
ownership using a second employee who can access that module, then rejects access
to the first employee's file. A central-library journey saves its own Warehouse
view, exports it, creates a past-due daily schedule, downloads the actual run and
checks pause/resume persistence. The schedule is left paused before disposable
cleanup. It also guards against the opening click immediately submitting the
schedule form. These are representative report journeys, not exhaustive report
definition or statutory-output acceptance. The standalone POS case permits an empty
register; the full suite has prior cashier transactions. Run this slice with
`npm run test:e2e -- reporting-more.spec.ts`.

`pos-report-history.spec.ts` verifies seven exports across two history pages,
an older CSV download, return to the first page after a fresh request, and repeated
identical report requests producing fresh files after confirmed success. It drops
the first acknowledgement after the server commits and verifies that a retry uses
the same request key and export. Desktop/tablet screenshots accompany the test.
`PosExportHistory.test.tsx` also covers history-load failure and Refresh recovery.

`report-history.spec.ts` covers Finance, Service and CRM export panels. Each journey
prepares seven distinct CSV exports using unchanged options, retrieves an older
file from the second page, interrupts the history refresh, recovers on the same
page, and returns to the first page after another export. Tablet and phone
screenshots check the panel width and paging layout; the phone check also activates
the previous-page button with the keyboard. Run alongside `reporting-more.spec.ts` for saved
options and cross-account download checks. The POS integration suite additionally
checks that a second POS-authorized employee cannot list, download or retry another
employee's export. Only its isolated database receives that temporary role assignment.

The reporting run on 10 September 2026 passed nine browser journeys and all four
POS integration tests. All 99 Operations component tests passed. No production
data or development-account credentials were changed.

The Service journey also rejects a fake PNG, loses the acknowledgement of a
committed photo upload, retries to the same photo ID, recovers an individual image
fetch and downloads exact bytes. It completes the signed repair and reopens the
photo as a manager. A phone screenshot includes the evidence gallery.
`ServiceEvidenceGallery.test.tsx` checks independent image failures and late-response
cleanup. Sales integration denies both new and replayed uploads from an unassigned
Service editor; authorization runs before replay lookup.

Run the shared managed-file database tests with `--files-integration`. They cover
parent permissions, invalid file content, immutable versions, exact downloads and
audit payloads. For example:

```sh
npm run test:e2e -- --files-integration --sales-integration tests/e2e/service.spec.ts tests/e2e/operations.spec.ts
```

On 10 September 2026, all 101 Operations component tests, six managed-file
integration tests and 21 Sales/Service integration tests passed. The Service
journey and Finance attachment browser journey passed in their targeted runs.

### Partner, interaction and warranty attachments

`attachments.spec.ts` covers all three screens through UI navigation. Each upload
loses its first successful server response, then retries with the same key and
appears once. Partner and interaction replacement preserve downloadable original
bytes; all three records reopen with their files intact. A separately signed-in
viewer can download permitted content but receives HTTP 403 on an upload attempt.
The partner list also recovers from a failed request through **Try again**.
Phone screenshots and overflow assertions cover each preview.

```sh
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --files-integration tests/e2e/attachments.spec.ts
```

On 10 September 2026, the three attachment browser journeys passed, alongside
six managed-file API integration tests and 104 Operations component tests in
their targeted runs. TypeScript, ESLint and the Operations production build passed.
`PartnerDocumentsPanel.test.tsx` covers list recovery, stable upload retries and
state isolation when switching parent/account. Warranty upload retries retain
their key in both CRM and Service; the browser journey exercises the CRM surface.

### ERP report bounds and permissions

```sh
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- tests/e2e/report-hardening.spec.ts
npm run test -w @vista/api -- src/jobs/erp-report-data.service.test.ts
```

The browser fixture creates 1,001 products only in the disposable test database.
It checks 41 preview pages for missing/duplicate rows, explicitly selects the
Product code column, and compares the downloaded CSV against every preview row.
Keyboard paging and a 390-pixel viewport are included. Timing measurements are
attached to the Playwright result, not treated as production performance targets.

A read-only employee navigates Procurement, Warehouse, Sales and Logistics
reports. All twelve save/export/retry API attempts must return HTTP 403.
The API unit tests cover the 100,000-row export boundary, bounded larger previews,
parameterized search, read-only snapshot transactions and connection cleanup.

### Finance, Service, CRM and POS large exports

`report-families.spec.ts` creates 1,001 supplier invoices, Service requests,
employee-performance entries and closed POS shifts in the disposable database.
All use 15 January 2026 so the UI selects an exact, reproducible date window.
The synthetic employees are disabled and cannot sign in. Fixture setup rolls
back on failure, and teardown removes these fixtures before later browser files.

For each family, UI navigation requests CSV, Excel and PDF. The downloaded files
must contain every expected record exactly once; Excel cells are read with
ExcelJS and PDF text with Poppler. PDF exports must span multiple pages.
The first CSV request loses its successful acknowledgement; retry must reuse
the same key and return the same export ID before download. Local row counts,
file sizes and elapsed times are attached to the HTML report, not used as
production performance targets. Phone checks cover the three Operations panels.

A viewer receives HTTP 403 for save, create and retry across all four families.
Finance/CRM checks exercise the read-versus-create boundary; Service retains its
approval permission requirement and the viewer has no POS module access.
`reporting-access.test.ts` separately checks read-without-create for every scope.

Run the full report browser group:

```sh
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e:reports
```

This also covers existing saved views, older export pages, personal ownership,
filtering, file-download recovery and scheduled exports. It does not certify
official accounting outputs, fiscal devices or production-scale capacity.

Verified on 10 September 2026: all 21 browser checks and 4 POS database
integration tests passed with `-- --pos-integration`. The related 71 API unit
tests and 31 Operations/POS component tests also passed. Generated PDF first
and last pages were visually reviewed, including POS business-time display.
