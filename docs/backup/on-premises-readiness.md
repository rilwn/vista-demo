# Vista Recovery: on-premises readiness audit

Scope: the on-premises commissioning brief and `AGENTS.md` §§4, 9, 10, 12
and 15. This is an implementation review with reported site observations,
not an SSH inspection or site acceptance report.

| Requirement                                        | Implemented and covered locally                                                                                                                                                                                                                                                                                                        | Site work or limitation                                                                                                                                                                                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sources, schedules and approvals (§9.1–9.3)        | Inventory/classification, draft policy, separate MFA-verified approver, activation, pause and retention-reduction approvals; plan review captures a snapshot of recorded policies.                                                                                                                                                     | Configure real sources and agree schedule, capacity, retention, RPO/RTO and named owners. Infrastructure credentials and mounts are not created by the UI.                                                                                       |
| Scheduled backup and retention (§9.2, §12)         | BullMQ dispatch, execution, verify and missed-run detection; persisted statuses, errors, retries and audit. Retention protects chain ancestors. PostgreSQL and MySQL/MariaDB are logical dumps, not point-in-time recovery.                                                                                                            | Scheduler entries do not prove any source is protected. Confirm verified runs for the database and file store before commissioning other sources.                                                                                                |
| Storage, compression and integrity (§9.2–9.3, §10) | Managed S3 source and backup destinations use separate buckets; the primary backup destination now supports dedicated credentials. AES-256-GCM archive encryption, checksums, verification by re-reading, compression, and content deduplication for file/object archive types. Independent S3 copies are re-read and verified.        | Create both private bucket policies, provision the key, run actual MinIO credential and restore checks, and verify transport and storage encryption. Same-host storage is not isolated or immutable.                                             |
| Additional sources and restore (§9.2, §9.5)        | S3, WebDAV, read-only IMAP and mounted file/device/server snapshot adapters; full and incremental/differential file-style archives. Verified restores go to an isolated DB or private prefix. Granular DB records and original emails are available as files. System-image support archives and recovers an externally captured image. | Wire the real approved sources. The engine does not capture a running system disk or write an image onto hardware. A whole-server/bare-metal recovery still requires an approved imaging workflow and a witnessed replacement-hardware exercise. |
| Controls and notifications (§9.2–9.4)              | Backup RBAC and MFA, independent approvals, audited job and restore history, queued in-app/email and optional Twilio SMS; directory integration supports configured providers and role mapping.                                                                                                                                        | Provision individual roles, test actual SMTP/SMS and directory credentials where applicable, and keep an external monitoring path. Application-level audit does not protect against a compromised host administrator.                            |
| DR and mandatory hardware (§9.3, §9.5–9.6)         | Signed-test evidence, recorded measurements and review/reminder workflows are available.                                                                                                                                                                                                                                               | Confirm site inventory and RAID, physically independent/air-gapped copies, storage server and tape drive/library, protected restore catalog and key custody, and a signed site restore with measured RPO/RTO.                                    |

## Interpreting the empty dashboard

`BACKUP_S3_BUCKET` defaults to `vista-backups` even if absent from the process
environment. That value does not create the bucket or activate a policy. The
base Compose bootstrap can provision buckets with admin credentials; the API
runtime only checks and uses existing buckets. The existing application
database and managed file sources map to `VISTA-DB-01` and `VISTA-FILES-01`
unless overridden. They must be registered and assigned to approved, active
policies. Missing schedules explain a healthy recurring dispatcher with no
`backup.execute` or `backup.verify` entries.

The production-stage validation still requires an independently configured
S3 copy. The same-server destination is a first operational backup tier only.
An independent object copy by itself is also insufficient: restore uses the
matching catalog data (artifact key, checksum, encryption nonce and tag,
source identity, and any required chain ancestors). Protect a recoverable
catalog checkpoint separately and test recovery with the primary host absent.

Use the [on-premises operations runbook](../deployment/on-premises-runbook.md)
for the sequence and the [approved backup plan template](information-backup-plan.md)
for policy preparation.
