# Vista architecture and operating decisions

`AGENTS.md` is authoritative. This file consolidates the selected defaults and
their remaining acceptance conditions. There are no unanswered business
decisions blocking the current implementation.

## Decisions in use

POS receipt invoices display existing checkout payments, account charges and
refund evidence rather than posting the same money into Finance again.
On-account credit remains a debt, not a received payment. Returns release the
unpaid part of that debt and track any previously collected part as a separate
amount owed back to the customer. If an issued POS invoice exists, issue a linked
credit note from the exact return amounts before recording the repayment. A
Finance approver records the repayment only after it has actually been made,
allocating it to the original collections. Vista does not send the money or
change the POS drawer. Original invoices and payments stay unchanged; the return,
credit note, repayment and allocations are append-only and retry-safe. Payment
reversal is blocked once a collected return exists, directing Finance to the
linked repayment workflow. Demo-role approval is not broadened.

| Record                            | Adopted choice                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0001 · Architecture           | TypeScript npm-workspaces monorepo; modular NestJS API; separate Operations, POS and Recovery React/Vite apps; PostgreSQL, Redis, S3-compatible storage, versioned API contracts, migrations, Docker Compose for local infrastructure and portable CI. Keep framework-independent domain/contracts separate.                                                                                                                       |
| ADR-0002 · Staging                | Hostinger VPS with the existing Coolify instance. Expose only Operations, POS and Recovery through approved domains/TLS; keep API, PostgreSQL, Redis, MinIO and Mailpit private. This approves staging, not production security or recovery acceptance.                                                                                                                                                                            |
| ADR-0003 · Currency               | EUR is the accounting currency effective 1 Jan 2026. Reject BGN in new transactions. Convert local development/test data at EUR 1 = BGN 1.95583, with reconciliation; do not relabel amounts. Keep supported foreign-currency source amounts and dated BNB rate snapshots. Rehearse hosted migration and restore before cutover.                                                                                                   |
| ADR-0004 · Finance                | Use the standard Bulgarian invoice review layout and required VAT treatments; no accountant approval gate for the current workflow. Keep branding configurable. Reverse posted payments through a reasoned, linked correction; do not rewrite the original. Import ordinary CSV/XLS bank statements with a column mapper; review duplicates and uncertain matches. Leave unknown accounting codes blank in Income/Outcome exports. |
| ADR-0004 · Security and warehouse | Require verified TOTP for administrators; allow other roles to opt in. Warn, without blocking receipt, at a 10% or greater cost variance against the latest supplier-invoice cost, falling back to latest product cost. Do not show a variance without a baseline.                                                                                                                                                                 |
| ADR-0004 · Service and CRM        | Warranty customer charges cover labor and parts only. Keep customer charges separate from internal work costs. Use configurable `Europe/Sofia` weekdays, 09:00–17:00; respond within 4 business hours, resolve within 2 business days, alert at 75%, and notify the assignee and CRM manager when overdue. Public holidays are excluded initially.                                                                                 |
| ADR-0004 · POS hardware           | Target DATECS FP-2000 through a local USB connector; keep the protocol behind the fiscal adapter and use the simulator in development. Use the reported Zebra DS2208 USB scanner and Dell Pro 24 QC24250 with Windows 11 Pro. The original minimum hardware scope also requires a communication router with backup Internet; use automatic 4G/5G failover as the practical baseline.                                               |
| ADR-0004 · Backup                 | Start with the deployed Vista database and approved object storage as Critical (hourly database recovery points, daily full, RPO 1h/RTO 4h); Recovery configuration/catalog as Important (daily, 24h/24h); later-identified sources as Standard (daily, 24h/72h). Keep 35 daily and 12 monthly copies, encryption, independent storage, separate roles and four-eyes approval. Add only sources actually identified.               |

## Remaining acceptance and deferred integrations

Official Finance number series reserve 1,000-number ranges by location, optional
register and operator. The legal-entity high watermark prevents overlaps with
existing numbers; exhausted series reserve another range. This setting is
configurable through `FINANCE_OFFICIAL_NUMBER_BLOCK_SIZE`. Issued non-POS
invoices/proformas enter Collections automatically; receipt-backed POS invoices
are excluded to avoid collecting an already-settled sale twice.

- **Fiscal device:** Verify the exact DATECS unit's H-18 registration and
  protocol, then test a real receipt and reversal on the target terminal. The
  simulator does not establish certification.
- **Backup and recovery:** Local software supports the configured database,
  email, cloud and mounted-file source paths, backup modes, encrypted copies,
  granular recovery, approvals, audit and DR-test records. Add Vista's actual
  assets and selected storage/tape hardware, verify independent isolation, then
  complete and sign a witnessed replacement-hardware/site restore. Keep
  destructive production actions gated until then.
- **Directory sign-in:** Provider-neutral LDAP/Active Directory, OIDC/Entra ID,
  and SAML sign-in with group-to-existing-role mapping is implemented and
  disabled by default. Configure one provider with real credentials and test
  its account, group mappings and emergency fallback before enabling it.
- **Courier services:** Econt and Speedy adapters, booking and tracking are
  implemented with deterministic tests. Provider credentials gate live
  booking/tracking acceptance only.
- **Hosted rollout:** Complete hosted migration/restore rehearsal, provider
  configuration, security checks and QA retests before production acceptance.

Financial document images are configured per issuing legal entity by a Finance
editor. Use optional PNG/JPEG logos and explicitly authorized signature images;
do not invent a client logo or signature or claim certificate-based signing.
Drafts show only the logo. Issuance freezes exact image versions/checksums and
signer name. Later changes affect new issuances, not existing documents. Email
delivery retries retain the already-rendered PDF attachment.

These are evidence, infrastructure or provider-integration tasks, not pending
choices about the defaults above.

Issued credit/debit notes adjust the original non-POS collection through a
separate append-only ledger. Keep the original invoice and actual payments
unchanged. A credit after settlement may leave an explicit customer credit;
do not automatically create a refund or advance. A later debit can reopen the
remaining balance. POS fiscal/settlement reconciliation stays a separate step.

## History

Recurring subscription invoices use explicit Finance approval per contract
revision, issuer, VAT and payment terms. The default payment term is 14 days and
VAT is 20%; both are editable before approval. Existing contracts remain manual
until enabled, and earlier billing periods are not issued retroactively by that
approval. The existing daily billing worker issues enabled due periods and opens
their collections transactionally. Contract changes or lost approver access stop
further issuance. Manually prepared drafts still require manual review. Issued
records retain their snapshots when a profile is edited or disabled.

- **ADR-0001** recorded the initial modular TypeScript monorepo baseline.
- **ADR-0002** recorded Hostinger/Coolify as the staging target.
- **ADR-0003** recorded the EUR transition and migration controls.
- **ADR-0004** records the practical defaults accepted by the project owner.
- Client responses and clarifications were incorporated into these choices;
  no separate response log is needed.

The EUR rate is based on the official rate published by the
[Bulgarian National Bank](https://www.bnb.bg/AboutUs/AUEurosystem/AUAccessionToTheEuroArea/AUAEFIQuestionsAndAnswers/POAEFI_QUESTIONSANDANS15_BG).
