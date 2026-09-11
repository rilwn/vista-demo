# ADR-0002: Hostinger VPS and Coolify staging target

Status: accepted for staging only  
Date: 2026-09-11  
Decision-maker: Vista project owner

## Decision

Deploy Vista's first shared staging environment to the approved Hostinger VPS
through its existing self-hosted Coolify instance. Use a separate `Vista`
project/environment in the shared Coolify Team and a normal Git-based Docker
Compose resource. Route only Operations, POS and Recovery through Coolify's
proxy on their approved domains. Keep API, PostgreSQL, Redis, MinIO and Mailpit
private to the resource network.

## Consequences

- The VPS server is reused, not re-added or revalidated from the Vista Team.
- Compose-owned named volumes persist staging database, Redis and file data.
- Staging email is captured privately; no real SMTP provider is selected.
- Public TLS, backup/restore, monitoring, SMTP, production retention and
  hardware/fiscal acceptance remain outside this staging decision.

## Traceability

AGENTS §§3.2–3.4, 4.5, 9, 10 and 18; decision `DEP-001` remains open for the
remaining production infrastructure and operational controls.
