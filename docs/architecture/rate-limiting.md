# Request rate limiting

Every HTTP route except the liveness and readiness probes has an explicit request
risk policy. Limits are evaluated per route and client IP, so activity on one
endpoint does not consume another endpoint's allowance.

| Policy      | Current development default | Applied to                                              |
| ----------- | --------------------------- | ------------------------------------------------------- |
| `public`    | 60 requests/minute          | Platform identification and sign-in's general IP tier   |
| `read`      | 240 requests/minute         | Authenticated lists, details, status, and notifications |
| `write`     | 60 requests/minute          | Ordinary create, edit, and reversible lifecycle actions |
| `sensitive` | 20 requests/minute          | Security administration and approval-level operations   |
| fallback    | 120 requests/minute         | Defensive limit for a future route missing a policy     |

The login endpoint also retains its stricter Redis counter for each client-IP and
normalized-account pair. Account lockout remains a separate authentication
control.

## Distributed store

`API_RATE_LIMIT_STORE` selects `memory` or `redis`. Memory is intended only for
tests and an explicitly single-process non-production deployment. Configuration
validation refuses to start a production API with the memory store.

The Redis implementation uses one atomic Lua operation to increment a fixed
window, apply the block period, and return remaining lifecycle times. Every API
replica using the same Redis URL and `API_RATE_LIMIT_REDIS_PREFIX` therefore sees
the same counter. Redis keys contain the framework's hashed route/tracker key, not
the request body, bearer token, email address, or other business data. If Redis
cannot protect a request, non-health routes fail closed with HTTP 503 and stable
code `RATE_LIMIT_UNAVAILABLE`.

Set a different prefix per environment sharing one Redis database. Do not use a
prefix shared by unrelated deployments.

## Proxy and response behavior

`API_TRUST_PROXY_HOPS` defaults to zero. When the API is behind a reverse proxy,
set it to the exact number of trusted proxy hops so Express derives the client IP
correctly. Do not enable an open-ended proxy trust rule; an incorrect value can
let a client spoof the address used for throttling and audit metadata.

Accepted responses expose `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
`X-RateLimit-Reset`. Blocked responses return HTTP 429, `Retry-After`, and the
normal correlation-aware API error envelope. Health probes deliberately bypass
the limiter so an unavailable Redis store does not hide process/dependency health
from the orchestrator.

Tests enforce policy coverage for every current non-health controller, policy
override behavior, stable errors, Redis-result validation, fail-closed behavior,
shared counters across separate API module instances, and window expiry.
