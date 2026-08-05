# Environment Variable Reference

`.env.example` is the development template. Real secrets must be generated per
environment and injected by an approved secret manager; never commit `.env`.

| Variable                                   | Purpose                                           | Required                                     |
| ------------------------------------------ | ------------------------------------------------- | -------------------------------------------- |
| `NODE_ENV`                                 | development, test, or production behavior         | yes; development default                     |
| `API_HOST`, `API_PORT`, `API_PREFIX`       | API listener and versioned route prefix           | yes; local defaults                          |
| `BUSINESS_TIMEZONE`                        | presentation and business-date calculations       | yes; production value requires approval      |
| `CORS_ORIGINS`                             | comma-separated exact browser origins             | yes                                          |
| `LOG_LEVEL`                                | redacted structured log threshold                 | yes; info default                            |
| `POSTGRES_PORT`, `DATABASE_URL`            | Local PostgreSQL host port and connection URL     | yes                                          |
| `REDIS_PORT`, `REDIS_URL`                  | Local Redis host port and connection URL/database | yes                                          |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`    | S3-compatible storage destination                 | yes for current foundation configuration     |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | storage credentials                               | yes; secret manager in deployed environments |
| `S3_FORCE_PATH_STYLE`                      | enables MinIO-compatible addressing               | yes; true by default                         |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`      | email transport and sender                        | yes                                          |
| `SESSION_SECRET`                           | session signing/key derivation material           | yes; at least 32 characters                  |
| `TOTP_ENCRYPTION_KEY`                      | encryption material for 2FA secrets               | yes; at least 32 characters                  |
| `FEATURE_*`                                | explicit optional capability gates                | yes; disabled unless approved                |

The example uses `Europe/Sofia` because it is a development candidate for the
Bulgarian business timezone, not an approved production setting. Decision
`FIN-002` records the required confirmation.
