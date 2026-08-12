# Environment Variable Reference

`.env.example` is the development template. Real secrets must be generated per
environment and injected by an approved secret manager; never commit `.env`.

| Variable                                   | Purpose                                           | Required                                     |
| ------------------------------------------ | ------------------------------------------------- | -------------------------------------------- |
| `NODE_ENV`                                 | development, test, or production behavior         | yes; development default                     |
| `API_HOST`, `API_PORT`, `API_PREFIX`       | API listener and versioned route prefix           | yes; local defaults                          |
| `API_RATE_LIMIT_*_MAX`, `*_TTL_MS`         | Public/read/write/sensitive limits and window     | yes; conservative local defaults             |
| `API_RATE_LIMIT_STORE`, `*_REDIS_PREFIX`   | Memory/Redis counter store and deployment scope   | yes; Redis is mandatory in production        |
| `API_TRUST_PROXY_HOPS`                     | Exact trusted reverse-proxy hop count             | yes; zero unless deployment requires it      |
| `AUTH_LOGIN_RATE_LIMIT_MAX`, `*_TTL_MS`    | Redis login limit per client/account pair         | yes; conservative local defaults             |
| `AUTH_MAX_FAILED_ATTEMPTS`, `*_LOCKOUT_*`  | Failed-login threshold and lock duration          | yes; production values require IAM-001       |
| `BUSINESS_TIMEZONE`                        | presentation and business-date calculations       | yes; production value requires approval      |
| `CORS_ORIGINS`                             | comma-separated exact browser origins             | yes                                          |
| `VITE_API_BASE_URL`                        | ERP/CRM browser API path at build time            | no; defaults to same-origin `/api/v1`        |
| `DEPENDENCY_HEALTH_TIMEOUT_MS`             | Object-storage readiness timeout                  | yes; 2-second default                        |
| `LOG_LEVEL`                                | redacted structured log threshold                 | yes; info default                            |
| `REQUEST_LOGGING_ENABLED`                  | Structured request-completion event switch        | yes; enabled by default                      |
| `PASSWORD_*`                               | Complexity, history, and expiration controls      | yes; production values require IAM-001       |
| `POSTGRES_PORT`, `DATABASE_URL`            | Local PostgreSQL host port and connection URL     | yes                                          |
| `REDIS_PORT`, `REDIS_URL`                  | Local Redis host port and connection URL/database | yes                                          |
| `IDEMPOTENCY_TTL_SECONDS`                  | Retried-command result replay window              | yes; 24-hour development default             |
| `JOB_QUEUE_NAME`, `JOB_QUEUE_PREFIX`       | Stable BullMQ queue namespace                     | yes; environment-specific in deployment      |
| `JOB_DEFAULT_ATTEMPTS`, `*_BACKOFF_*`      | Retry count and exponential backoff base          | yes; bounded defaults                        |
| `SALES_SUBSCRIPTION_INVOICE_CRON`          | Recurring billing run time in the business zone   | yes; daily 01:15 development default         |
| `INTEGRATION_OUTBOX_*`                     | Outbox batch, polling, and stale-claim recovery   | yes; bounded defaults                        |
| `NOTIFICATION_*_MS`                        | Dispatcher poll and stale-claim recovery windows  | yes; bounded development defaults            |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`    | S3-compatible storage destination                 | yes for current foundation configuration     |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | storage credentials                               | yes; secret manager in deployed environments |
| `S3_FORCE_PATH_STYLE`                      | enables MinIO-compatible addressing               | yes; true by default                         |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`      | email transport and sender                        | yes                                          |
| `SESSION_SECRET`                           | reserved application session security material    | yes; at least 32 characters                  |
| `SESSION_TTL_SECONDS`                      | Absolute opaque-session lifetime                  | yes; production value requires IAM-001       |
| `TOTP_ENCRYPTION_KEY`                      | encryption material for 2FA secrets               | yes; at least 32 characters                  |
| `TOTP_ISSUER`, `TOTP_WINDOW_STEPS`         | Authenticator label and verification window       | yes; production values require IAM-001       |
| `FEATURE_*`                                | explicit optional capability gates                | yes; disabled unless approved                |

The example uses `Europe/Sofia` because it is a development candidate for the
Bulgarian business timezone, not an approved production setting. Decision
`FIN-002` records the required confirmation.

Request limiting has explicit public, read, write, and sensitive endpoint tiers.
The selected Redis store shares counters across replicas and fails closed when it
is unavailable; production configuration cannot select process memory. Use a
deployment-specific Redis prefix. If a reverse proxy is present, configure only
the exact trusted hop count. See
[`../architecture/rate-limiting.md`](../architecture/rate-limiting.md). Job payloads
should contain stable record identifiers, not credentials or full
financial/customer records; completed and failed jobs are retained until an
approved operational retention policy is implemented.

Authentication uses opaque bearer tokens. Only a SHA-256 digest is retained in
PostgreSQL metadata and live session state is stored in Redis with an absolute
TTL. Login throttling is Redis-backed and fails closed when its security
dependency is unavailable. Passwords use versioned salted scrypt hashes;
`PASSWORD_HISTORY_COUNT` controls the retained recent-hash window and defaults to
five for local development. TOTP factor secrets use authenticated AES-256-GCM
encryption. The example password, history, expiration, lockout, session, and TOTP
values are development candidates only; `IAM-001` must approve production policy
values.

The ERP/CRM frontend uses a same-origin `/api/v1` base by default, and local Vite
development proxies `/api` to port 3000. Set `VITE_API_BASE_URL` only when the
approved deployment serves the browser and API from different base paths; its
origin must also be present in `CORS_ORIGINS`. This is a build-time value and must
not contain credentials or secrets.
