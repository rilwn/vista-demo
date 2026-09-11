# Deployment preparation

`compose.yml` is a **local rehearsal**, not a public production configuration. It builds
versioned API, Operations, POS and Recovery images. The web images serve deep
links and proxy `/api/` to the API. Processes run without root; application
filesystems are read-only. No development accounts or credentials are included.

## One-command verification

From the repository root, with Node 22+, npm 10+ and Docker Compose installed:

```sh
npm ci
npm run test:deployment
```

Leave ports **5473, 5474 and 5475** free. The command generates temporary secrets,
builds all images, starts isolated storage, applies migrations, checks all three
apps and their API proxy, then rehearses the latest migration down/up and
restarts the applications. It removes only its own disposable containers and
volumes, including their test data. Built images remain cached. Your `.env` and
development database are not used. This is infrastructure verification; business
and sign-in journeys are covered by `npm run test:acceptance`.

## Keep a local installation for review

1. Copy this directory's `.env.example` to `.env` **in this directory**, not the
   repository root. Set each blank secret to a different `openssl rand -hex 32`
   output, set a unique image tag, and restrict the file with `chmod 600`.
2. From this directory run:

   ```sh
   docker compose --env-file .env -p vista-review build
   docker compose --env-file .env -p vista-review up -d --wait postgres redis minio mailpit
   docker compose --env-file .env -p vista-review run --rm minio-init
   docker compose --env-file .env -p vista-review run --rm --no-deps api node apps/api/dist/database/migrate.js up
   docker compose --env-file .env -p vista-review up -d --wait api operations pos recovery
   ```

3. Provision the first administrator using the existing
   [administrator settings](../../docs/deployment/environment.md).
   Run its compiled command inside the API container, passing `INITIAL_ADMIN_*`
   through environment variables; never add credentials to the image. Enrol
   the returned key privately, then complete sign-in with the authenticator code.

   After exporting the five settings listed in that guide in your private terminal:

   ```sh
   docker compose --env-file .env -p vista-review run --rm --no-deps \
     -e INITIAL_ADMIN_PROVISIONING_ENABLED -e INITIAL_ADMIN_EMAIL \
     -e INITIAL_ADMIN_DISPLAY_NAME -e INITIAL_ADMIN_EMPLOYEE_NUMBER \
     -e INITIAL_ADMIN_PASSWORD api node apps/api/dist/database/provision-initial-administrator.js
   unset INITIAL_ADMIN_PROVISIONING_ENABLED INITIAL_ADMIN_PASSWORD
   ```

4. Open Operations **http://127.0.0.1:5473**, POS **http://127.0.0.1:5474**, or
   Recovery **http://127.0.0.1:5475**. Access depends on the assigned account roles.
   `docker compose --env-file .env -p vista-review ps` must show healthy apps.
5. To stop without deleting data:
   `docker compose --env-file .env -p vista-review down`.

## Recovery and troubleshooting

- **Build fails:** check Docker registry/npm connectivity and available disk space.
- **Unhealthy API:** inspect API logs privately, confirm storage health, then
  confirm migrations completed. Never publish secrets or full environment dumps.
- **Port occupied:** stop the rehearsal; choose unused ports in the review env
  file. Do not stop unrelated applications.
- **Release rollback:** retain the previous image tag and a verified database
  backup. Stop application writes, check schema compatibility, select that tag
  and run `up -d --no-build --wait api operations pos recovery`. Do not run a
  migration down against real data without a reviewed restoration plan. The
  automated down/up test uses an empty disposable database, not a production
  restore test or proof of compatibility with every older release.

Public deployment still requires `DEP-001`: approved VPS, domain/DNS, TLS and
HSTS, firewall, trusted proxy configuration, real mail/storage, monitoring,
backup arrangements and ownership. This file publishes **loopback ports only**,
uses captured local email and is unsuitable for direct public exposure. Fiscal
certification, full offline selling and operational Backup/DR remain gated.

CI builds and vulnerability-scans all four application images as well as the
existing infrastructure images. A configured scan is not a passing scan; retain
the hosted results before release.

## Coolify staging deployment

Use [`compose.coolify.yml`](compose.coolify.yml) only through a Git-based
Docker Compose resource in the approved shared Coolify Team. It runs migrations
before the API, keeps all data services internal and exposes only the three web
services through Coolify's proxy. Configure the values in
[`.env.coolify.example`](.env.coolify.example) as Coolify variables; never upload
an environment file. Assign the Operations, POS and Recovery domains in Coolify
to internal port `8080`. Do not assign domains or host ports to API, PostgreSQL,
Redis, MinIO or Mailpit. The staging stack captures email in its private Mailpit
container; no email leaves the VPS. Replace it with the approved SMTP adapter
only after `INT-001` is decided.
