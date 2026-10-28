# Information Backup Plan

Status: **local software paths implemented and verified; live-source, physical
infrastructure and witnessed site acceptance remain pending**
Controlling decision: `ADR-0004 · Backup` in
[`docs/architecture/decisions/README.md`](../architecture/decisions/README.md)

Software supports PostgreSQL and MySQL/MariaDB database snapshots; read-only
IMAP email; WebDAV cloud folders; S3-compatible buckets; Vista's managed file
store; and read-only mounted file, server, workstation and mobile-device
snapshots. Database backups use a full/database-snapshot dump. Email, WebDAV,
S3-compatible and mounted-folder sources support full, incremental and
differential runs with verified lineage. Server and workstation system-image
policies accept exported disk-image files from a mounted snapshot; the software
does not capture a live disk image from a running machine. Actual hosts and
devices must provide an approved, read-only snapshot or export under the
configured mount root.

MySQL/MariaDB engine identity is saved immutably with each execution so archive
verification, isolated restore and record recovery do not depend on the original
source credentials. A separately configured matching-engine target is used to
create a disposable, isolated database. Authorized staff can select a table and
primary-key values and download one recovered row as an audited JSON file. Email
recovery can select one archived message and deliver its `.eml` file to an
isolated storage prefix for audited download; it never inserts mail into a live
mailbox. Server/workstation image recovery restores the selected exported image
as an isolated file copy for secure download. Vista's approved imaging procedure
must perform any eventual write to replacement hardware.

Every recovery requires second-person approval and writes to an isolated target;
the application does not overwrite a live database, mailbox, file share, server
or device. For incremental/differential sources, the first run establishes a
full baseline; incremental runs reference the preceding verified run and
differential runs the latest full baseline. Recovery replays the required chain,
retention protects ancestors, and deduplicated payloads are integrity checked.
Object-store archive v3 also stores identical 4 MiB content blocks once; older
archive versions remain readable. The independent-copy software path writes
encrypted artifacts to a separately configured S3 endpoint and verifies the
copy by re-reading it. Provider/account isolation and an actual air gap are not
established until the real destination is configured and tested.

Local software checks use disposable PostgreSQL and MariaDB databases,
simulated IMAP, WebDAV and object storage, and mounted fixture snapshots. They do
not establish coverage of Vista's live sources or physical recovery hardware.
Do not claim protection for an asset until its approved source is configured,
a run is verified, and its isolated recovery has been exercised.

## Source inventory

Start with the deployed Vista database and approved object storage as **Critical**.
Protect the Recovery configuration/catalog as **Important**. For each real
server, workstation, laptop, tablet or phone, identify its supported export or
read-only mounted snapshot location before scheduling it. Record source owner,
location, data steward, dependencies, volume/growth, credential custody,
encryption, and restore prerequisites.

For an additional PostgreSQL or MySQL/MariaDB instance, create a protected source
with a unique source code, then add that exact code to
`BACKUP_DATABASE_SOURCE_URLS_JSON` in the secret manager. Use a restricted
backup account; require TLS for remote MySQL/MariaDB connections and never save
a connection URL in a source description or Git. The primary application
source code defaults to `VISTA-DB-01` and uses `DATABASE_URL`. A schedule cannot
be activated unless its source code resolves to a supported database URL. Set
`BACKUP_RESTORE_DATABASE_URL` to a separate target using the same engine as the
source.

For an additional S3-compatible bucket, register an **Object storage** source
with its exact bucket name as the location. Map its source code to read-only
credentials in `BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON` in the deployment
secret manager. Existing Vista managed-file sources retain their previous mapping;
new managed sources use `VISTA-FILES-01` by default. Changing a source endpoint,
region or bucket starts a new full baseline. Credential rotation alone does not.
Verification and isolated recovery use the saved bucket identity and do not
need the original source or its credentials.

## Classification and objectives

Use the adopted defaults: Critical sources receive hourly database recovery
points and daily full backups, with 1-hour RPO and 4-hour RTO; Important sources
are backed up daily, with 24-hour RPO/RTO; later-identified Standard sources are
backed up daily, with 24-hour RPO and 72-hour RTO. Record approved overrides
against the affected source.

## Policy schedule

For each source/class define:

- full, incremental, and/or differential backup type;
- frequency and schedule;
- 35 daily and 12 monthly retained copies;
- primary and separate S3-compatible replica locations, plus independent
  provider/account isolation and tape/air-gap handling when site targets exist;
- policy-controlled compression (PostgreSQL custom-format or object-store gzip),
  encryption, and verification requirements;
- responsible backup operator, administrator, security officer, and approvers;
- restore sampling, evidence retention, and success/failure/missed-run alerts.
- annual review evidence and reminders for the backup plan and recovery tests.

Current code records the selected compression format on each backup run and
checks the original archive size before verification or restore. Managed
object-store archives deduplicate identical 4 MiB blocks; mounted-share
archives deduplicate identical file payloads. The SRS does not mandate a
particular deduplication unit.

In-system and email alerts for verified, final-failure, and missed-run events,
plus initial/upcoming/overdue DR-test and backup-plan review reminders, are
implemented and covered by the isolated PostgreSQL lifecycle regression (4/4
tests pass).
An optional Twilio SMS adapter is implemented and tested with provider calls
stubbed. Configure and verify live email/SMS delivery and the independent
storage target before marking those production controls operational.

## Hardware and isolation

The physical storage server and tape drive/library have not been supplied. Once
selected, record their capacity, tape rotation, off-site/air-gapped handling,
encryption, ownership, maintenance, and restore compatibility. Keep production
backup credentials and storage separate from primary application credentials.

## Review and approval

Management must approve the operational plan, review it at least annually and
whenever infrastructure changes, and record the approver, date, next review,
changes, non-conformities, and corrective actions. The Recovery review screen
captures this sign-off with an immutable copy of the current inventory and
policies. The application also retains signed DR-test evidence; no witnessed
site restore has yet been completed.
