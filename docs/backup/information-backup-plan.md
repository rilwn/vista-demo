# Information Backup Plan

Status: **draft template — not approved and not operational**  
Controlling decisions: `BAK-001`–`BAK-005`

This document preserves the mandatory plan structure from `AGENTS.md` without
inventing Vista Service's infrastructure, classifications, or recovery targets.
Management approval must name the approver and date before any retention or
destructive behavior is enabled.

## Source inventory

Inventory physical servers, virtual servers, workstations, laptops, tablets,
company phones, databases, file shares, email, cloud services, and other approved
sources. For every source record owner, location, data steward, dependencies,
volume/growth, credentials custody, encryption, and restore prerequisites.

Status: blocked by `BAK-001`.

## Classification and objectives

Classify every source as Critical, Important, or Standard. Record approved RPO
and RTO for every class and any source-specific override.

Status: blocked by `BAK-001` and `BAK-002`.

## Policy schedule

For each source/class define:

- full, incremental, and/or differential backup type;
- frequency and schedule;
- retention periods and legal holds;
- primary, secondary, off-site, tape, and/or air-gapped storage locations;
- deduplication, compression, and encryption requirements;
- responsible operator, administrator, security officer, and approvers;
- verification method, restore sampling, and evidence retention;
- success, failure, and missed-backup email/SMS recipients and escalation.

Status: blocked by `BAK-002`–`BAK-004` and `INT-001`.

## Hardware and isolation

Document the selected physical information-storage server and tape drive/library,
capacity model, retention assumptions, tape rotation, off-site/air-gapped
handling, encryption, ownership, maintenance, and restore compatibility. Define
the separate account/domain/network structure and primary-AD-compromise response.

Status: blocked by `BAK-003` and `BAK-004`.

## Review and approval

The approved plan is reviewed at least annually and whenever infrastructure
changes. Record management approver, approval date, next review, changes,
non-conformities, and corrective actions here. No approval has been supplied.
