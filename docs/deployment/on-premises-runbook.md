# Vista on-premises checklist

Work on `vista-app` over WireGuard and SSH. Do not change Coolify or public DNS.
**Start at step 1. Do not deploy until step 2 is complete.**

## 1. Check the running server (read-only)

Run in SSH:

```bash
hostname
cd /srv/vista/vista/infrastructure/deployment || exit 1
git status --short
docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.project.config_files"}} {{.Config.Image}}' vista-api-1
docker ps --filter label=com.docker.compose.project=vista
docker exec vista-postgres-1 sh -c 'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) AS applied, max(id) AS latest FROM platform.schema_migrations;"'
```

**Stop** if the host, project, or Compose files differ from the handover. The
last reported baseline was project `vista`, tag `staging-2026-11-12`, and
121 migrations. Confirm the actual Compose environment file path with the
server owner; do not assume it is `.env`. Do not share its contents.

## 2. Take a checkpoint before changing anything

1. Record the running image tags. Save the live Compose and Caddy files and
   Caddy state to approved encrypted checkpoint storage. Keep credentials and
   encryption keys in the approved secret store. Leave the live files intact;
   compare them with the repository versions in a separate checkout.
2. In the approved maintenance window, pause writes (including background jobs)
   for a matching PostgreSQL and MinIO checkpoint. Run the following in Bash,
   entering the **mount point** of the approved encrypted checkpoint storage:

   ```bash
   (
     set -eu
     umask 077
     read -r -p 'Encrypted checkpoint mount point: ' ROOT
     mountpoint -q -- "${ROOT:?No checkpoint mount supplied}"
     CHECKPOINT=$(mktemp -d -- "$ROOT/vista-release.XXXXXXXX")
     docker exec vista-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$CHECKPOINT/vista.dump"
     test -s "$CHECKPOINT/vista.dump"
     docker exec -i vista-postgres-1 pg_restore --list < "$CHECKPOINT/vista.dump" > "$CHECKPOINT/vista.catalog"
     cd "$CHECKPOINT"
     sha256sum vista.dump > SHA256SUMS
     sha256sum -c SHA256SUMS
     pwd
   )
   ```

3. Export the matching managed MinIO bucket contents and metadata to the same
   checkpoint using the site's approved method. A dump listing is not a restore
   test. **Stop** if the checkpoint fails or no safe export method is available.

## 3. Set up storage and deploy the reviewed release

1. In MinIO, keep the existing file bucket and create a separate **private**
   backup bucket (`vista-backups` unless already configured under another name).
   Use the [file bucket policy](../../infrastructure/deployment/minio/vista-managed-files-policy.json)
   and [backup bucket policy](../../infrastructure/deployment/minio/vista-backup-policy.json)
   with two distinct non-admin accounts. Confirm each account can access only its own bucket.
2. Set the bucket and scoped credentials, the backup encryption key, an isolated
   PostgreSQL restore target, and a real TLS SMTP relay. Use the
   [environment template](../../infrastructure/deployment/.env.onprem.example)
   for exact variable names. Keep existing database, MinIO root, session, TOTP
   and backup encryption secrets. **Stop** if required values are missing.
3. Reconcile the [reference Compose override](../../infrastructure/deployment/compose.onprem.yml)
   with the live files; do not overwrite them. Keep the same Compose project,
   volumes, and Caddy CA. Keep `VISTA_DEPLOYMENT_STAGE=staging` and the fiscal
   simulator off while storage is same-host only.
4. Build or load the reviewed, tagged images before the service switch. In the
   live deployment directory, run in Bash with the confirmed environment file:

   ```bash
   read -r -p 'Confirmed Compose environment file path: ' ENV_FILE
   vista() { docker compose -p vista --env-file "${ENV_FILE:?No environment file supplied}" -f compose.yml -f compose.onprem.yml "$@"; }
   vista config --quiet &&
     vista up -d --no-build --no-deps --wait api &&
     vista up -d --no-build --no-deps --wait operations pos recovery &&
     vista ps
   ```

   This release adds no migration. Do not recreate Caddy, PostgreSQL, Redis or
   MinIO. Do not run `down -v`. If the switch fails, stop and inspect
   `vista logs --since 10m --tail 100 api`. With an unchanged schema, restore the
   saved config and previous image tag, then repeat the targeted service switch.
   If a later release changes the schema, do not roll it back live; rehearse
   recovery separately first.

5. On the VPN laptop, open Operations, POS and Recovery. Confirm each hostname
   resolves to the **on-premises** VPN address, HTTPS is trusted, and both
   `/healthz` and `/api/v1/health/ready` return 200 on each host. Sign in and
   open a known attachment. Do not bypass certificate checks.

## 4. Turn on Recovery and prove it works

1. **Sources & inventory:** add the database (`VISTA-DB-01`) and managed files
   (`VISTA-FILES-01`). Use the effective codes if the server overrides these
   defaults. For the file source, enter the managed bucket name, not the backup bucket.
2. **Policies & schedules:** create a database snapshot policy and a full file
   backup policy. Enable encryption and verification. Use agreed schedule,
   retention and RPO/RTO values. Select **Request approval**. A second
   MFA-verified user approves under **Policy approvals**. Select **Activate schedule**.
3. **Jobs & restore points:** wait for the scheduled runs. Confirm both show
   **Verified**, and check that the notification reaches the test recipient.
4. In **DR tests**, select **Plan test** from a verified database restore point.
   In **Jobs & restore points**, select **Request restore** for that point and
   for one file. A second user approves under **Restores & approvals**.
   Check a known record in the isolated database and compare the recovered file.
5. In **DR tests**, enter the measured RPO/RTO and attach the signed PDF. Obtain
   management sign-off in **Plan review**. See the
   [restore procedures](../disaster-recovery/procedures.md) for the full rehearsal.

## 5. What remains before production sign-off

- Review verified runs, missed jobs and disk space daily. Repeat the restore
  exercise annually and after major infrastructure changes.
- Confirm RAID, independent storage, the backup server and tape hardware,
  internal TLS, alert delivery, and a witnessed restore. A bucket on the same
  server does not protect against losing that server. See the
  [readiness audit](../backup/on-premises-readiness.md) for the remaining checks.
