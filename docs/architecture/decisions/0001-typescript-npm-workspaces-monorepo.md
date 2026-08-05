# ADR-0001: TypeScript npm-workspaces modular monorepo

- Status: proposed
- Date: 2026-08-05
- Specification: `AGENTS.md` Sections 3.1–3.4, 11, 14, and 19

## Context

The system requires NestJS, React/Vite, PostgreSQL, Redis, separate ERP/CRM, POS,
and backup capabilities, shared contracts/domain rules, and reproducible Linux
commands. The repository has no pre-existing package-manager convention.

## Decision

Use npm workspaces with `apps/*` and `packages/*`. Keep one NestJS API initially,
with strict module boundaries and provider-neutral adapters. Keep ERP/CRM, POS,
and backup-control as separate Vite applications. Share only framework-neutral
contracts/domain rules, authorization helpers, configuration, and reusable UI.

Use PostgreSQL migrations as the authoritative schema change mechanism, Redis for
sessions/transient state, and an S3-compatible storage adapter. Provide Docker
Compose for local supporting services and GitHub Actions as a portable initial CI
baseline. Neither the CI choice nor local Compose selects the production host.

## Consequences

- The repository has one dependency lock and consistent validation commands.
- POS remains deployable and testable independently for offline/hardware work.
- Domain and contract packages cannot import NestJS or React.
- A later move to separate services remains possible through API/outbox boundaries.
- Production deployment, storage, identity, and hardware choices remain open in
  the decision register.

## Acceptance evidence

- All workspaces format, lint, typecheck, test, and build in CI.
- Each application runs independently and imports shared packages through declared
  workspace dependencies.
- No production secrets or identifiers are present in source control.
