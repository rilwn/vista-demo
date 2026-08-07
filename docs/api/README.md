# API Documentation

The NestJS application exposes versioned routes below `/api/v1` and interactive
OpenAPI at `/api/docs`. The raw document is served at `/api/docs-json`.

Generate the same document without opening a network listener:

```sh
npm run openapi:generate -w @vista/api
```

The generated `apps/api/openapi.json` is a build artifact and is intentionally
ignored. CI regenerates it to catch metadata/configuration failures. Published
API compatibility and generated clients will be added as versioned domain
operations begin.

Every HTTP response carries `x-correlation-id`; a valid inbound identifier is
preserved. Errors use the shared stable envelope and code vocabulary, including
`RATE_LIMITED` for HTTP 429. Health routes are deliberately excluded from request
throttling so orchestrator probes remain available.

Request-completion logs are JSON and contain method, path without query string,
status, duration, and correlation identifier. Bodies, query values, cookies,
authorization headers, and client card/PIN data are not request-log fields.

## Authentication foundation

- `POST /api/v1/auth/login` accepts email/password and an optional six-digit TOTP
  code. It returns an opaque bearer token only after Redis session creation,
  PostgreSQL lifecycle recording, and audit capture succeed.
- `POST /api/v1/auth/logout` revokes the current session in PostgreSQL and Redis.
- `GET /api/v1/auth/me` returns the authenticated employee/session context.
- `GET /api/v1/auth/me/permissions` demonstrates backend enforcement of the
  controlled `platform:view` permission.

Routes are protected by default. Health, platform identification, and login are
explicitly public; future controllers must use the public marker deliberately or
receive a valid bearer session. Administrative accounts cannot create or resolve
a session without a verified second factor. TOTP enrollment/provisioning and
password reset/change APIs remain pending and are not implied by these endpoints.

The ERP/CRM browser uses these routes through a same-origin `/api/v1` client by
default; local Vite development proxies `/api` to the NestJS server. A deployment
may set the build-time `VITE_API_BASE_URL` override. The client uses stable error
codes for recovery text, shows a shortened correlation reference for support, and
never treats permission-aware navigation as a replacement for backend guards.

## Partner master data

The ERP-owned canonical partner registry currently exposes:

- `GET /api/v1/master-data/partners` with page/page-size, search, role, type,
  sort-field, and direction parameters. It requires `crm:view`.
- `GET /api/v1/master-data/partners/:id` for one immutable partner identifier. It
  requires `crm:view`.
- `GET /api/v1/master-data/partners/:id/profile` for the canonical partner plus
  its active addresses, contacts, and bank accounts. It requires `crm:view`.
- `GET /api/v1/master-data/partners/duplicates` for exact normalized legal-name
  or UIC candidates. It warns only and never merges records.
- `POST /api/v1/master-data/partners` for legal entities or individuals with one
  or more customer/supplier/business-partner roles. It requires `crm:create` and
  an `Idempotency-Key` header of 8–128 safe characters.
- `POST /api/v1/master-data/partners/:id/addresses`, `/contacts`, and
  `/bank-accounts` to add profile records. Each requires `crm:edit` and the same
  idempotency-header contract. Contacts require an email or telephone; bank
  accounts validate IBAN, optional BIC, and globally reject a duplicate IBAN.

Create replays return the original response when the same normalized command and
key are retried. Reusing a key for a different command returns
`IDEMPOTENCY_KEY_CONFLICT`. Exact normalized legal-company names or UICs return
`PARTNER_DUPLICATE_CANDIDATE` with existing record references; there is no
override, merge, edit, or delete endpoint in this slice. Successful creation,
its audit event, and `master_data.partner.created` outbox event commit in one
PostgreSQL transaction.

The profile child commands use a partner-and-resource-specific idempotency scope,
so a retry returns the original child record without creating another audit or
outbox event. Each successful command increments the parent partner version and
commits its `master_data.partner.address.created`, `.contact.created`, or
`.bank_account.created` event with the audit record. These routes only create new
profile records. Update, deactivation, deletion, duplicate resolution, and merge
remain unavailable until their controlling policy is approved.

## Product category master data

The catalog hierarchy currently exposes:

- `GET /api/v1/master-data/product-categories`, requiring `erp.warehouse:view`.
- `POST /api/v1/master-data/product-categories`, requiring `erp.warehouse:create`
  and an `Idempotency-Key`. A category has a name and optional existing active
  parent UUID.

Names are whitespace-normalized and unique within the selected parent. The command
is transactionally paired with an audit event and
`master_data.product_category.created` outbox event. It is deliberately an empty
configuration hierarchy: the system does not seed assumed Vista categories
or stock data.

## Product and unit master data

The authorized catalog routes are:

- `GET /api/v1/master-data/catalog/units`, requiring `erp.warehouse:view`.
- `POST /api/v1/master-data/catalog/units`, requiring `erp.warehouse:create` and an
  `Idempotency-Key`.
- `GET /api/v1/master-data/catalog/products`, requiring `erp.warehouse:view`.
- `POST /api/v1/master-data/catalog/products`, requiring `erp.warehouse:create` and an
  `Idempotency-Key`.

Unit codes and product codes are whitespace-normalized and uppercased. A product
requires an active category and unit; its category policy is returned on reads.
Each supplied barcode has an explicit type and is globally unique. A successful
unit or product command writes its audit event and respective
`master_data.unit.created` or `master_data.product.created` outbox event in the
same transaction, and an identical retry returns the original resource without
duplicating those side effects. Duplicate unit/product codes and barcode values
return stable conflict codes.

The available routes establish product identity only. Pricing, serialised items,
batches, expiry dates, warehouse balances, and stock posting are not exposed yet;
their enforcement belongs to the next warehouse vertical slice.
