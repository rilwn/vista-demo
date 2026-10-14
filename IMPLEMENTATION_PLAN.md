# Vista implementation plan: remaining work

Status date: 2026-10-14
Project: `BG16RFPR001-1.012-1324-C01`

[`AGENTS.md`](AGENTS.md) is authoritative. This plan lists only work that is
not yet accepted. The 12 October QA items named below are implemented and
verified locally; the QA register holds their evidence. Practical defaults are
in [the consolidated decision record](docs/architecture/decisions/README.md).
No client decision blocks the remaining software work. The 12 QA items listed
in the QA register are locally verified; hosted and hardware acceptance remain.

## 1. Release and hosted verification

**Work:** Deploy the current tested build; complete hosted retests for locally
verified QA findings; finish the hosted image vulnerability scan and resolve
findings; verify production mail, storage, notification and backup settings.

**Depends on:** Coolify deployment access, production secrets and provider
credentials.

**Accept when:** deployment and rollback are repeatable, the security scan has
no unreviewed findings, and hosted workflows pass without exposing secrets.

## 2. Finish ERP finance and operational integrations

**Work:** Complete statutory sales/purchase journal and VAT-report acceptance,
structured accounting export formats, accounting-period posting controls,
provider-backed reminders, and any remaining production email/SMS setup. Add
Econt and Speedy booking/tracking only behind the existing adapter interface;
keep unavailable providers clearly disabled. Populate production master data
and resolve detected partner duplicates through controlled review, never an
automatic merge.

**Depends on:** release environment, real operating data and any required
provider credentials. Use the adopted defaults where specific values are not
needed.

**Accept when:** finance totals reconcile to source documents, exports match
their defined fields, retries cannot duplicate postings or notifications, and
logistics failures remain visible and recoverable.

## 3. Accept the POS hardware path

**Work:** Use the reported DATECS FP-2000, Zebra DS2208 USB scanner and Dell
Pro 24 QC24250 / Windows 11 Pro as the target setup. Complete the local USB
connector, device configuration and physical tests for fiscal receipts,
reversals, barcode scans, serial capture and warranty-card printing. Keep the
development simulator available; do not claim H-18 certification before the
exact unit and registration are checked. PIN-pad connection remains disabled
until a terminal is selected.

**Depends on:** target equipment, DATECS protocol/driver and test access.

**Accept when:** the real terminal completes sale, receipt, reversal, restart
recovery and duplicate-retry checks, with matching ERP stock, payment and
customer records.

## 4. Complete POS offline selling

**Work:** Extend interrupted-checkout recovery into durable offline sales,
cached catalog/customer use, automatic resynchronization and server-side
reconciliation. Apply the documented conflict defaults for prices, stock,
customers, serials, promotions and transaction identifiers.

**Depends on:** stable online flows and accepted DATECS behavior on the target
terminal.

**Accept when:** offline sales, reconnect, interrupted sync, replay, stale
prices, unavailable serials and server rejection are tested without duplicate
sales or unsupported fiscal-readiness claims.

## 5. Complete custom Backup and disaster recovery

**Work:** Implement the adopted ADR-0004 baseline for the deployed Vista
database, object storage, Recovery configuration and backup catalog. Add real
company sources only when identified. Configure encrypted independent copies,
retention, monitoring, role separation and four-eyes approval; document restore
responsibilities; run and sign the implementation restore test. Keep destructive
production actions gated until verified.

**Depends on:** actual infrastructure/storage access and a witnessed restore
window. Tape integration is added when Vista selects and provides tape hardware.

**Accept when:** file, database and system restore procedures are demonstrated;
the signed evidence records achieved RPO/RTO, results and corrective actions;
critical actions are audited and require separate approvers.

## 6. Final hardening and handover

**Work:** Complete the end-to-end security, accessibility, performance and
data-migration checks; finish API, deployment, operations and concise
role-based user guides; train staff and transfer ownership of source, hosting,
credentials, backups and runbooks. Record any optional feature as enabled or
not selected.

**Depends on:** phases 1–5 and client-owned production environment.

**Accept when:** mandatory requirements are traceable to working evidence,
external hardware/restore acceptance is recorded, and Vista staff can operate
and support all four deliverables.

## External acceptance still open

- DATECS exact-unit H-18/protocol verification and witnessed terminal tests.
- Real company backup-source and storage inventory plus witnessed restore.
- Hosted deployment/security/provider retests.

These are infrastructure or evidence gates, not unresolved product decisions.
