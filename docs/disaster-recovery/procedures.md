# Disaster Recovery Procedures

Status: **isolated PostgreSQL/MySQL database restore, individual database-record
export, email-message restore, S3/WebDAV/mounted-file restore, exported server
image recovery and signed DR-test recording are implemented and locally tested;
source-device and witnessed site acceptance remain pending**
Controlling decision: Backup defaults in
[`docs/architecture/decisions/README.md`](../architecture/decisions/README.md)

## Database restore to an isolated target

1. Configure `BACKUP_RESTORE_DATABASE_URL` with credentials for a separate,
   private PostgreSQL restore target. Do not point it at the live application
   database. Set `BACKUP_ENCRYPTION_KEY` to the key used by the backup artifacts.
2. In Vista Recovery, open **Jobs & restore points** and confirm the selected
   backup is marked **Verified**.
3. Select **Request restore**, enter the reason, and send it for approval.
4. A different MFA-verified Backup Administrator or Security Officer opens
   **Restores & approvals** and approves or declines the request. The requester
   cannot approve their own request.
5. After approval, the worker creates a new uniquely named database, checks the
   artifact hash and encryption tag, decrypts the archive in a private temporary
   directory, restores it, and checks the restored database. Vista backups also
   require their migration ledger; other PostgreSQL databases do not.
6. Review the final status and audit events. A failed attempt removes only the
   generated temporary target database. A completed restore remains isolated;
   it does not overwrite or switch the live Vista application.

Automated integration tests execute this workflow against disposable local
PostgreSQL databases, verify restored data, and remove the disposable database.
This is software evidence only, not the witnessed site test.

## S3-compatible file-store restore to an isolated prefix

1. Confirm the Recovery service has access to the configured backup bucket and
   the same `BACKUP_ENCRYPTION_KEY` used to create the artifact. Do not change
   the live file-store bucket or point recovery at a live-file destination.
2. In Vista Recovery, open **Jobs & restore points** and choose a verified run
   whose source is the required managed or external file-store bucket.
3. Select **Request restore**. Choose **Complete file-store snapshot** to copy
   every file, or choose **One file**, search by filename/folder and select the
   exact file from that verified snapshot.
4. Enter the reason and send the request for approval.
5. A different MFA-verified Backup Administrator or Security Officer opens
   **Restores & approvals** and approves or declines the request. The requester
   cannot approve their own restore.
6. The worker checks the artifact checksum and encryption tag, validates the
   archive and source bucket, then writes the recovered objects under a new
   `restores/<request-uuid-without-hyphens>/attempt-<number>/` prefix in backup
   storage. A one-file request writes only the selected file; a complete-snapshot
   request writes every archived file.
7. Confirm the run is complete, review the selected file or full-snapshot scope,
   and inspect its audit record. The restore does not replace or change live
   files. A failed attempt removes only its generated recovery prefix;
   investigate any recorded cleanup failure before retrying.

The source bucket and its credentials are not required during verification or
recovery. The backup bucket and its encryption key remain required. Review the
isolated result before any separately authorized copy to a live system.

## Mounted shared-folder restore to an isolated prefix

1. On the VPS, mount the approved source read-only before starting Vista. Set
   Coolify's `BACKUP_FILE_SOURCE_HOST_PATH` to that host-side mount root; the API
   sees it only as `/protected-sources`, read-only. Do not expose a wider host
   path than the approved source inventory requires.
2. In Vista Recovery, add a **Shared folder** source. Enter a unique source code
   and a path relative to `/protected-sources`, such as `finance`; use `.` only
   when the complete mounted root is the approved source. Approval is blocked if
   the configured path is absent or unsafe.
3. Create a backup policy for that single source and choose full, incremental,
   or differential. The first successful incremental/differential run creates
   a full baseline; later incremental runs use the preceding verified run and
   differential runs use the latest full baseline. Have a different
   MFA-verified Backup Administrator or Security Officer review and approve the
   policy, then activate it.
4. Run the policy and wait until its restore point is marked **Verified**. A
   changed source, unsafe file, failed checksum, or failed verification is not a
   usable restore point.
5. In **Jobs & restore points**, request either the complete folder or one file.
   Enter the reason. A different MFA-verified approver reviews the exact scope
   and approves or declines it.
6. The worker reconstructs the selected snapshot from its verified full/delta
   lineage, then restores it to a generated isolated prefix in backup storage.
   A selected-file restore reconstructs that file across the chain. Confirm the
   scope and audit record. Required base runs cannot be deleted while dependent
   runs remain. The original mounted folder is not changed; never treat the
   isolated result as a live replacement.

## Recover one email message

1. Configure the approved IMAP source with TLS and a read-only account in the
   deployment secret store. Add the mailbox source in Vista Recovery and run an
   approved full, incremental or differential policy until its restore point is
   **Verified**.
2. In **Jobs & restore points**, search the verified email snapshot by subject,
   sender, date or mailbox. Select the exact message and choose **One file**.
3. Enter the recovery reason. A different MFA-verified Backup Administrator or
   Security Officer reviews and approves the request.
4. After completion, select **Download recovered file**. The result is an
   `.eml` copy in isolated storage; it is not inserted into or sent from the
   live mailbox. Open it only in an approved mail client and handle attachments
   as untrusted files.
5. Confirm the audit entry records the selected item and download. Do not copy
   the message into the live mailbox without a separately authorized action.

## Recover one database record

1. Set `BACKUP_RESTORE_DATABASE_URL` to a private target with the same engine
   as the selected PostgreSQL or MySQL/MariaDB backup. The account must create
   and remove generated `vista_restore_*` databases. Never use the live database.
2. Request recovery from a **Verified** database restore point and enter the
   reason. A different MFA-verified Backup Administrator or Security Officer
   approves it.
3. After the full database has been restored and verified in isolation, open
   the completed request under **Restores & approvals** and select
   **Recover one database record**.
4. Select the table, enter every primary-key value exactly as stored, then
   download the JSON record. The record is read from the isolated copy only;
   this action does not modify either database. The export is audit logged.
5. Validate the record with the responsible application owner before any
   separately authorized re-entry into a live system.

## Recover an exported server or workstation image

1. The source owner creates an approved image export and makes it available
   under the read-only mounted-source root. Vista accepts common exported image
   files such as `.img`, `.iso`, `.qcow2`, `.raw`, `.vhd`, `.vhdx` and `.vmdk`;
   it does not image a running host itself.
2. Register the server or workstation source with a relative mount path. Create
   a **System image** policy, obtain separate approval, run it and confirm the
   restore point is **Verified**.
3. From **Jobs & restore points**, request **One file**, search for the image,
   choose the exact export, and enter the recovery reason. A different
   MFA-verified approver approves it.
4. When the isolated restore finishes, download the image file and check its
   size and checksum against the recovery evidence. Keep it on a restricted
   staging device.
5. To recover hardware, the authorized infrastructure operator uses the
   organization's approved imaging tool and maintenance procedure on a
   replacement device. Confirm the target disk and obtain a second-person
   check before writing; this write can erase the target. Boot and validate the
   replacement, record actual RTO/RPO, and attach the signed protocol to the DR
   test. Vista Recovery does not directly write to or boot replacement hardware.

## Rebuild the Vista service on clean infrastructure

Use this sequence after loss or compromise of the application host. It rebuilds
Operations, POS, Recovery and their shared services; it is not a failover
procedure. The actual host, source inventory, credentials and recovery times
must be rehearsed with Vista before this runbook can be accepted for production.

1. The incident lead records the start time, affected services and known data
   loss. The security officer isolates the affected host and preserves evidence.
   Do not reconnect a compromised host or reuse its administrator accounts,
   passwords, keys, tokens, database credentials or storage credentials.
2. The incident lead appoints a Recovery operator and a different approver,
   assigns the database, file-store, infrastructure and business checks, and
   informs management. Notify affected customers when the incident plan or
   applicable rules require it. Record the approved recovery point and the
   latest verified backup times before restoring.
3. The infrastructure operator provisions a clean, patched host and a separate
   Coolify installation or verified recovery environment. Reapply the firewall,
   HTTPS, private data-service networking and monitoring from the
   [deployment guide](../../infrastructure/deployment/README.md). Rotate deployment secrets and create empty PostgreSQL, Redis and
   S3-compatible services. Keep public application domains in maintenance mode;
   never expose PostgreSQL, Redis or object storage.
4. The Recovery operator restores the selected PostgreSQL backup to a new,
   private database using the isolated database-restore procedure. A separate
   approver confirms the source, target and restore scope. Verify the restored
   database and its Vista migration ledger before it is considered for service.
   Do not point an application at the isolated Recovery database.
5. Restore the managed file-store snapshot to an isolated prefix using the
   S3-compatible restore procedure. Restore any approved mounted folders,
   email, cloud and other databases using their matching procedures. Check
   each selected source, verified point, file count or database result and
   checksum. Rebuild Redis empty; sessions and transient cache are not copied
   from an untrusted host.
6. Before promotion, take a protected copy of the new empty application
   database and storage target. The Recovery operator and independent approver
   review the restored data, attachment references, chosen application
   release, and recorded RPO/RTO. Promote only into the new, empty service
   database and file bucket, using the approved database and object-storage
   client procedures. Do not overwrite an existing database or file bucket.
   Keep the verified isolated restore unchanged for rollback and evidence.
7. Deploy the reviewed Vista release with the rotated secrets. Run the database
   migration command against the restored application database, then start the
   API and the three browser apps. Check service health, sign-in with a
   non-emergency account, partner and product records, a linked document and
   attachment, stock, and the required reports. Confirm the access log and
   backup jobs are healthy before opening public traffic.
8. The incident lead approves reopening service, removes maintenance mode,
   records the actual recovery duration and last recoverable transaction time,
   and informs management and affected customers as required. Attach the
   approval, backup identifiers, checksums, test results, RPO/RTO, issues and
   corrective actions to the DR test record.

The software supports the isolated restore and audit steps. The exact
database/file promotion procedure, real-world sequence, availability targets
and successful whole-service recovery must be verified on Vista's chosen host;
this written sequence is not evidence of a witnessed site restore.

## Record the DR test in Vista Recovery

1. Open **DR tests** and plan an exercise from a verified database restore point.
   The test record captures the selected policy's RPO and RTO targets.
2. Request the isolated restore. A different MFA-verified Recovery approver
   reviews it in **Restores & approvals**; the requester cannot approve it.
3. After the worker reports a final result, record the measured RPO/RTO, checks
   performed, non-conformities, and corrective actions. Do not estimate elapsed
   recovery times; use the observed start and completion times.
4. Attach the signed protocol as an available PDF. The completed record is
   immutable, and authorized staff can download the attached protocol.

The application records and tests this workflow, but a software test is not a
witnessed company-site restore. Keep the signed site protocol and evidence in
the approved protected records location.

Vista Recovery checks the latest recorded or planned exercise daily. It alerts
Backup-authorized staff when the next annual exercise is within 30 days, when a
planned test is overdue, or when no exercise has yet been scheduled. Each notice
is idempotent; retries and repeated daily checks do not create duplicates.

## Reduce retention on an approved schedule

1. In Vista Recovery, open **Policies & schedules** and select an active or
   paused schedule. Choose **Request lower retention**.
2. Enter lower daily and/or monthly copy counts and explain the reason. The
   form does not allow either count to increase. Send the request.
3. Confirm the current counts remain in effect while the request is pending.
4. A different MFA-verified Backup Administrator or Security Officer opens
   **Policy approvals**, checks the current and proposed counts, then approves
   or declines. The requester cannot approve their own change.
5. After approval, confirm the schedule shows the new counts. Rejection or
   expiry leaves the previous counts in place. The next retention run may remove
   eligible older copies, but backup run history and audit evidence remain.

## Site and hardware acceptance

The supported artifact procedures above have automated local coverage. Before
claiming operational readiness, identify and configure Vista's real mail,
cloud, database, server and device sources; verify the separate/air-gapped
storage target; and test the selected server image on replacement hardware.
Management and the independent witness must record a successful restore, actual
RTO/RPO, non-conformities and corrective actions in the signed protocol. Repeat
the witnessed exercise at least annually. A software test alone is not site
acceptance.
