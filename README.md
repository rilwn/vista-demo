# Vista Integrated Information System

TypeScript monorepo for Vista Service's ERP, CRM, POS, and custom backup/DR
system under Project `BG16RFPR001-1.012-1324-C01`.

The authoritative requirements are in [`AGENTS.md`](AGENTS.md). Delivery status,
acceptance criteria, dependencies, and unresolved decisions are maintained in
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

## Prerequisites

- Linux-compatible environment
- Node.js 22 or newer and npm 10 or newer
- Docker with Docker Compose

## Local development

1. Copy `.env.example` to `.env` and replace all `change-me` values.
2. Install dependencies with `npm install`.
3. Start infrastructure and all applications with `npm run dev`.
4. Apply database migrations with `npm run db:migrate`.

Default development endpoints:

- API: `http://localhost:3000/api/v1`
- OpenAPI UI: `http://localhost:3000/api/docs`
- ERP/CRM: `http://localhost:5173`
- POS: `http://localhost:5174`
- Backup control: `http://localhost:5175`
- Mailpit: `http://localhost:8025`
- MinIO console: `http://localhost:9001`

The values above are local-development endpoints, not a production deployment
decision.

## Validation

Run the complete repository check with:

```sh
npm run validate
```

The command verifies formatting, lint rules, TypeScript, tests, and production
builds. Database-backed integration suites additionally require `npm run
infra:up` and an applied migration.
