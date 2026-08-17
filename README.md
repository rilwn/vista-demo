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
2. For a local demonstration environment, keep `NODE_ENV=development` and set:

   ```dotenv
   DEV_FIXTURES_ENABLED=true
   DEV_FIXTURES_PASSWORD=ChooseYourOwn!2026
   ```

   The bootstrap requires explicit development-mode opt-in and a loopback
   PostgreSQL URL. That safeguard does not prove the database is isolated: never
   use it with shared, staging, or production credentials or data. Replace the
   example with a private password that meets the configured password policy.
   If a reserved demo identifier belongs to another record, the fixture
   transaction stops without applying a partial setup.

3. Install dependencies with `npm install`.
4. Start the local environment with `npm run dev`. It starts infrastructure,
   applies pending migrations, prepares the development fixtures when enabled,
   and then starts the applications. No separate seed command is needed for
   normal local browser testing.

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

### Development fixture accounts

When `DEV_FIXTURES_ENABLED=true`, each account below is created in the ERP/CRM
application with the value of `DEV_FIXTURES_PASSWORD` from the local `.env`
file. Later changes to that value deliberately do not reset an existing fixture
account's password. The fixture set includes the related local organization,
warehouse, catalog, partner, equipment, and Service data needed for the
implemented ERP/CRM workflows. It is not production data.

| Account                        | Intended testing scope                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `manager@vista.local`          | Broad, non-administrative access across currently implemented ERP/CRM workflows.         |
| `platform.manager@vista.local` | Read-only Security review and business-structure workflows.                              |
| `crm@vista.local`              | Partner, location, contact, and equipment workflows.                                     |
| `warehouse@vista.local`        | Catalog, warehouse, stock, reservation, and traceability workflows.                      |
| `procurement@vista.local`      | Supplier, purchase-order, goods-receipt, supplier-invoice, and supplier-claim workflows. |
| `sales@vista.local`            | Quotation, order, shipment, handover, pricing, and subscription workflows.               |
| `finance@vista.local`          | Finance collection and payment-allocation workflows.                                     |
| `dispatcher@vista.local`       | Service-request intake and technician-dispatch workflows.                                |
| `technician@vista.local`       | Assigned Service work, time, parts, evidence, signature, and completion workflows.       |
| `viewer@vista.local`           | Read-only review of ERP/CRM registers outside restricted Service work.                   |

Administrative roles still require a configured second factor, so this local
fixture set deliberately does not create a generally usable administrator.
POS and Backup Control do not yet have a login-wired operational backend; these
accounts must not be treated as POS or backup test accounts.

## Validation

Run the complete repository check with:

```sh
npm run validate
```

The command verifies formatting, lint rules, TypeScript, tests, and production
builds. Database-backed integration suites additionally require `npm run
infra:up` and an applied migration.
