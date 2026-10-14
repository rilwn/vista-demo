# Vista architecture and operating decisions

`AGENTS.md` is authoritative. This file consolidates the selected defaults and
their remaining acceptance conditions. There are no unanswered business
decisions blocking the current implementation.

## Decisions in use

| Record                            | Adopted choice                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0001 · Architecture           | TypeScript npm-workspaces monorepo; modular NestJS API; separate Operations, POS and Recovery React/Vite apps; PostgreSQL, Redis, S3-compatible storage, versioned API contracts, migrations, Docker Compose for local infrastructure and portable CI. Keep framework-independent domain/contracts separate.                                                                                                                       |
| ADR-0002 · Staging                | Hostinger VPS with the existing Coolify instance. Expose only Operations, POS and Recovery through approved domains/TLS; keep API, PostgreSQL, Redis, MinIO and Mailpit private. This approves staging, not production security or recovery acceptance.                                                                                                                                                                            |
| ADR-0003 · Currency               | EUR is the accounting currency effective 1 Jan 2026. Reject BGN in new transactions. Convert local development/test data at EUR 1 = BGN 1.95583, with reconciliation; do not relabel amounts. Keep supported foreign-currency source amounts and dated BNB rate snapshots. Rehearse hosted migration and restore before cutover.                                                                                                   |
| ADR-0004 · Finance                | Use the standard Bulgarian invoice review layout and required VAT treatments; no accountant approval gate for the current workflow. Keep branding configurable. Reverse posted payments through a reasoned, linked correction; do not rewrite the original. Import ordinary CSV/XLS bank statements with a column mapper; review duplicates and uncertain matches. Leave unknown accounting codes blank in Income/Outcome exports. |
| ADR-0004 · Security and warehouse | Require verified TOTP for administrators; allow other roles to opt in. Warn, without blocking receipt, at a 10% or greater cost variance against the latest supplier-invoice cost, falling back to latest product cost. Do not show a variance without a baseline.                                                                                                                                                                 |
| ADR-0004 · Service and CRM        | Warranty customer charges cover labor and parts only. Keep customer charges separate from internal work costs. Use configurable `Europe/Sofia` weekdays, 09:00–17:00; respond within 4 business hours, resolve within 2 business days, alert at 75%, and notify the assignee and CRM manager when overdue. Public holidays are excluded initially.                                                                                 |
| ADR-0004 · POS hardware           | Target DATECS FP-2000 through a local USB connector; keep the protocol behind the fiscal adapter and use the simulator in development. The reported scanner is Zebra DS2208 USB; the target workstation is Dell Pro 24 QC24250 with Windows 11 Pro.                                                                                                                                                                                |
| ADR-0004 · Backup                 | Start with the deployed Vista database and approved object storage as Critical (hourly database recovery points, daily full, RPO 1h/RTO 4h); Recovery configuration/catalog as Important (daily, 24h/24h); later-identified sources as Standard (daily, 24h/72h). Keep 35 daily and 12 monthly copies, encryption, independent storage, separate roles and four-eyes approval. Add only sources actually identified.               |

## Remaining acceptance and deferred integrations

- **Fiscal device:** Verify the exact DATECS unit's H-18 registration and
  protocol, then test a real receipt and reversal on the target terminal. The
  simulator does not establish certification.
- **Backup and recovery:** Add Vista's actual assets and selected storage/tape
  hardware, then complete and sign a witnessed restore test. Keep destructive
  production actions gated until then.
- **Courier services:** Econt and Speedy adapters remain deferred until provider
  access and test details are available.
- **Hosted rollout:** Complete hosted migration/restore rehearsal, provider
  configuration, security checks and QA retests before production acceptance.

These are evidence, infrastructure or provider-integration tasks, not pending
choices about the defaults above.

## History

- **ADR-0001** recorded the initial modular TypeScript monorepo baseline.
- **ADR-0002** recorded Hostinger/Coolify as the staging target.
- **ADR-0003** recorded the EUR transition and migration controls.
- **ADR-0004** records the practical defaults accepted by the project owner.
- Client responses and clarifications were incorporated into these choices;
  no separate response log is needed.

The EUR rate is based on the official rate published by the
[Bulgarian National Bank](https://www.bnb.bg/AboutUs/AUEurosystem/AUAccessionToTheEuroArea/AUAEFIQuestionsAndAnswers/POAEFI_QUESTIONSANDANS15_BG).
