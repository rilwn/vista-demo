# Backup Infrastructure

The custom service follows the defaults in `docs/architecture/decisions/README.md`
and `docs/backup/information-backup-plan.md`. Encrypted, verified backups cover
PostgreSQL and MySQL/MariaDB databases, IMAP email, WebDAV cloud folders, S3-
compatible storage, and read-only mounted file/server/workstation/mobile-device
snapshots. Email, WebDAV, S3 and mounted snapshots support full, incremental and
differential runs; database adapters use full database snapshots. An exported
server/workstation disk image can be backed up and restored as an isolated image
file. Granular database recovery exports one selected primary-key record as
JSON; email recovery exports one selected message as `.eml`. All restores
require independent approval and write only to a separate database or generated
backup-storage prefix. They do not overwrite a live source.

Mounted server/device snapshots must be created or exported by the approved
source-side process and mounted read-only under the configured protected-source
root. The service does not install source agents or capture a live disk image
from a running host. For system images, it stores and recovers an exported image
file; an authorized imaging procedure must write it to replacement hardware.
Tested local workflows do not prove live provider, endpoint-device, or physical
hardware compatibility. Managed object-store archives deduplicate identical
4 MiB blocks; mounted folders reuse matching file payloads. The encrypted
independent-copy pipeline verifies the destination re-read against source
SHA-256 and size; actual provider/account isolation and air-gap controls are
still site acceptance items.

## File and shared-folder source

The adapter backs up one configured directory under a mounted source root per
policy. It rejects path traversal, symbolic links and special files, records a
source-bound manifest with per-file hashes, and fails if the tree changes during
the backup. A run is not available for recovery until its artifact is verified.

For incremental S3 file-store and mounted-share policies, the first
successful run establishes a full baseline. Later incremental runs use the
preceding verified run, while differential runs use the latest full baseline.
Restore replays the required lineage into an isolated prefix; retention protects
a baseline while dependent runs remain. Matching payloads are reused across
verified object-store and mounted-share runs, including when a file moves to a
different key; restore verifies the prior content before writing the new key.
For Coolify, mount the approved host directory on the VPS before deployment and
set `BACKUP_FILE_SOURCE_HOST_PATH` to that host-side mount root. Compose passes
it into the API container as `/protected-sources`, read-only. The default
`/srv/vista/protected-sources` is only an empty directory unless an administrator
mounts/copies an approved source there; do not treat it as protected until a
verified run exists. In Vista Recovery, record each source location as a
relative subfolder under that root, such as `finance`; do not enter an absolute
host path. Keep network-share credentials and mount configuration on the host,
not in Vista or its logs.

## Additional database sources

Set `BACKUP_PRIMARY_DATABASE_SOURCE_CODE` to the protected-source code for the
application database (default `VISTA-DB-01`). For each additional PostgreSQL or
MySQL/MariaDB source, add a code-to-connection-URL entry to
`BACKUP_DATABASE_SOURCE_URLS_JSON` in Coolify's secret/environment settings,
for example `{"REPORTING-DB":"postgresql://backup_user:secret@db-host:5432/reporting"}`
or `{"LEGACY-DB":"mariadb://backup_user:secret@db-host/reporting?ssl-mode=VERIFY_IDENTITY"}`.
Use a restricted backup account, require TLS for remote MySQL/MariaDB sources,
and keep the URL out of source records, logs and Git. The app refuses to activate
a database policy until its source code has a configured URL. A successful
scheduled run is still required before the source is counted as protected.
Restores use `BACKUP_RESTORE_DATABASE_URL`, configured for the same engine, and
always create a new isolated database. The original source connection is not
needed for recovery. Vista PostgreSQL archives are checked for the Vista
migration ledger after restoration.

## IMAP email sources

Set `BACKUP_EMAIL_SOURCE_CONFIGS_JSON` in the deployment secret manager. Each
entry is keyed by the Recovery source code and includes the host, port, TLS
mode (`implicit`, `starttls` or `none`), username, password and an explicit
mailbox list. Example shape:

```json
{
  "VISTA-MAIL-01": {
    "host": "imap.example.invalid",
    "port": 993,
    "tlsMode": "implicit",
    "username": "backup@example.invalid",
    "password": "SECRET",
    "mailboxes": ["INBOX"]
  }
}
```

Use a read-only mailbox account and TLS in staging/production. In Vista
Recovery, register the source code with location `imaps://imap.example.invalid:993`.
Do not put credentials or sensitive mailbox names in the source record or Git.

## WebDAV cloud-folder sources

Set `BACKUP_WEBDAV_SOURCE_CONFIGS_JSON` in the deployment secret manager. Each
entry contains a TLS-protected endpoint, username and password, keyed by the
Recovery source code. For example:

```json
{
  "CLOUD-DOCS": {
    "endpoint": "https://cloud.example.invalid/remote.php/dav/files/backup/",
    "username": "backup-reader",
    "password": "SECRET"
  }
}
```

Use a read-only account scoped to the approved folder. Register `CLOUD-DOCS` in
Vista Recovery and enter a location relative to the configured endpoint.
Staging/production require HTTPS. Never put credentials in a source record or
Git.

## Additional S3-compatible buckets

1. In the deployment secret manager, set `BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON`
   to a JSON object keyed by the Recovery source code. Each entry has `endpoint`,
   `region`, `bucket`, `accessKeyId`, `secretAccessKey`, and optionally the
   boolean `forcePathStyle`. Use read-only list/get credentials. Do not put the
   real JSON or credentials in Git or in a source record. For example:

   ```json
   {
     "CLOUD-DOCS": {
       "endpoint": "https://s3.example.com",
       "region": "eu-central-1",
       "bucket": "vista-documents",
       "accessKeyId": "READ_ONLY_KEY",
       "secretAccessKey": "SECRET",
       "forcePathStyle": false
     }
   }
   ```

2. In Vista Recovery, add an **Object storage** source with code `CLOUD-DOCS`
   and location `vista-documents`, then create, approve and activate its policy.
   Staging and production endpoints must use HTTPS. A source cannot be the
   configured backup destination bucket.
3. Verify a completed backup and an independently approved isolated restore.
   A successful configuration alone is not proof that the provider is protected.

The managed Vista file bucket uses `BACKUP_PRIMARY_OBJECT_STORAGE_SOURCE_CODE`
(default `VISTA-FILES-01`); existing managed-source registrations are retained
by the upgrade. An endpoint, region or bucket change starts a new full baseline.
Credential rotation does not. Stored artifacts can be verified and restored
without connecting to the original source or retaining its credentials.

File and full-folder recovery are written to a new isolated prefix in backup
storage after independent approval. Review the result before any separate,
authorized operational copy-back. The application never overwrites the mounted
source.

`BACKUP_ENCRYPTION_KEY` must be a private 32-byte key encoded as 64 hex
characters. `BACKUP_RESTORE_DATABASE_URL` is optional; when configured, it must
point to a private, separate PostgreSQL or MySQL/MariaDB restore target with
permission to create and remove generated `vista_restore_*` databases. It must
match the source engine. Do not use the live application database as the restore
target. Without this setting, database restore requests stay disabled. Keep
secrets in the deployment secret manager, never in source control or logs.

Do not include credentials in source control or logs. Configure
`BACKUP_REPLICA_S3_ENDPOINT`, `BACKUP_REPLICA_S3_BUCKET`,
`BACKUP_REPLICA_S3_ACCESS_KEY_ID`, and `BACKUP_REPLICA_S3_SECRET_ACCESS_KEY` in
the deployment secret manager. Production requires HTTPS, a different endpoint
host and bucket, and credentials distinct from the primary store. The configured
credentials need permission to create, read, and remove replica objects. Do not
use a second bucket on the primary storage endpoint as an independent copy.
Production readiness still requires notification controls, additional source adapters, a
verified independent storage target, identified company assets, management
approval, and a witnessed restore. A completed backup job alone is not evidence
that recovery works.
