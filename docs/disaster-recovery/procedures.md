# Disaster Recovery Procedures

Status: **draft template — no restore procedure has been accepted**  
Controlling decision: `BAK-005`

Separate witnessed procedures must be completed for:

1. individual file restore;
2. database restore, including granular record recovery;
3. individual email restore;
4. entire server/bare-metal restore to different hardware;
5. entire infrastructure restore.

Each procedure must identify who initiates, who approves, who informs management,
who informs customers, required MFA/four-eyes checks, prerequisites, source
restore point, integrity validation, ordered actions, rollback/abort conditions,
security controls, reconciliation, evidence, and RPO/RTO calculation.

At least one implementation-time DR test must produce a signed protocol covering
successful restore evidence, RTO compliance, RPO compliance, identified
non-conformities, and corrective actions. Subsequent tests are scheduled at least
annually. A successful backup without a tested restore is not acceptance.
