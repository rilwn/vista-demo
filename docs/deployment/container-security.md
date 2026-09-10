# Container vulnerability checks

CI scans every distinct image in the development and browser-test Compose files.
It discovers versions directly from those files, without reading `.env`, starting
services or connecting to application databases. The current scope is PostgreSQL,
Redis, MinIO server, MinIO client and Mailpit. Application images must be added
when the deployment Dockerfiles are delivered under A4.

The existing npm dependency audit remains unchanged.

## What happens in CI

1. `container-inventory` validates the image list and emits the scan matrix.
2. `container-security` scans each image independently using Trivy 0.70.0.
3. High or critical OS/library vulnerabilities fail the job, even without an
   available fix. Other matrix entries continue so one finding does not hide
   results from the remaining images.
4. A JSON report is retained for seven days, including on findings. Scanner,
   registry or vulnerability-database failures also fail the job; a missing
   report is not a clean scan.

The scanner action is commit-pinned to the verified v0.36.0 release. Configuration
follows the [official Trivy action documentation](https://github.com/aquasecurity/trivy-action/tree/v0.36.0).
No code-scanning upload permission, production secret or paid GitHub feature is
required. Public image registries and the vulnerability database must be reachable.

## Local checks

From the project folder, with Docker Compose installed:

```sh
npm run test:container-security
node --import tsx tests/security/container-images.ts
npx tsc -p tests/security/tsconfig.json
```

Expected: five tests pass and the matrix contains five distinct image references.
The count grows when images are added to the Compose files. These commands test
inventory, not image safety, and do not start services.

To reproduce one scan without mounting application data or the Docker socket:

```sh
docker run --rm aquasec/trivy:0.70.0 image \
  --image-src remote --scanners vuln --severity HIGH,CRITICAL \
  --exit-code 1 --format json --timeout 15m redis:7.4.5-alpine
```

Use another exact image reference from the matrix to check it. Exit zero means
no findings at the configured severities in that scan, not a permanent security
guarantee. Keep the image digest, scan date, database metadata and findings from
the JSON report when investigating results.

## Responding to failures

Open **GitHub → Actions → CI → container-security**, select the failed image and
download its `container-N-vulnerabilities` artifact. Review the artifact image
name, package, installed version, advisory and fixed version if supplied.

Upgrade a candidate image in an isolated environment and rerun migrations,
integration and browser tests before changing the development/deployment version.
Do not upgrade running services or data volumes just to clear the scanner.
Do not suppress findings or add `continue-on-error` to make CI green. Any proposed
exception needs an explicit reviewed rationale, owner and expiry. No exceptions
are supplied by this change.

If the registry or vulnerability database is unavailable, restore connectivity
and rerun. Do not describe an incomplete scan as a vulnerability-free image.
The first hosted CI run still needs to confirm GitHub runner execution; local
inventory tests alone cannot prove that run.

## Local validation, 10 September 2026

Five inventory tests, TypeScript, ESLint, formatting and CI YAML parsing passed.
The real Redis scan started successfully with Trivy 0.70.0, but the 112 MiB
vulnerability-database download was too slow to finish the check promptly and
the temporary scanner was stopped. No vulnerability result was produced.
It had no mounted application files, sockets or data volumes. Repeat the real
scan on a connection that can complete the database download; do not treat this
attempt as a pass.
