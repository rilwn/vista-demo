# Service-to-Finance handoff

Completed out-of-warranty Service work with a positive calculated cost can be
used as the source of an internal Finance invoice draft.

## Ownership and controls

- Service owns the labor, used-part, transport, and total-cost basis.
- Finance selects the issuer context, dates, and VAT treatment before saving.
- The API reloads the completed work order under a transaction and rejects a
  changed quantity, product, unit, description, discount, or price.
- One active draft of each financial-document type can reference a work order.
  Idempotency protects retries, and the database constraint protects concurrent
  duplicate creation.
- The saved document exposes the Service work-order ID and number; the work
  order exposes its active invoice-draft ID and number.
- Draft preparation is not legal issuance. Official numbering, posting, PDF,
  email, and approved VAT/accounting policy remain controlled by Phase 3
  decisions.

## Evidence

- Migration: `0041_service_finance_link`
- API integration: `apps/api/test/sales.integration.test.ts`
- Browser navigation: `apps/erp-crm-web/src/App.test.tsx`
- Manual acceptance: `TESTME.md`
