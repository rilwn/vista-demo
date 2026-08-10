# Architecture and Business Decision Register

`AGENTS.md` is authoritative. This register captures choices that it explicitly
requires the project to confirm or that are necessary to implement its behavior
without inventing business policy.

## Decision states

- `proposed`: reversible technical direction recorded for review.
- `required`: business/vendor/infrastructure input is missing.
- `accepted`: authorized decision with date and decision-maker recorded in an ADR.
- `superseded`: replaced by a later ADR; history is retained.

## Open decisions

| ID       | State    | Decision required                                                                                                                                | Requirements affected | Safe treatment until decided                                               |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------- |
| BUS-001  | required | Client values and final ownership for legal business entities, branches, locations, warehouses, technician warehouses, registers, and operators  | 4.1, 4.4, 5, 6.3, 8.1 | Empty immutable configurable topology implemented; no production seed data |
| BUS-002  | required | Number formats, reset periods, allocation scope, and initial values per branch/location/register/operator                                        | 4.4, 6.1, 7.4, 8.1    | Implement sequence model and concurrency guarantees only                   |
| CAT-001  | proposed | Approved initial category tree, units, product-code/barcode convention, and per-category serial/batch/expiry tracking policy                     | 5, 6.3, 8.2           | Configurable category policy; no hard-coded seed data                      |
| FIN-001  | required | Effective tax configuration and rules for 20%, 9%, 0%, exempt, and intra-community acquisition                                                   | 4.4, 6.1              | Model all required treatments; do not post documents before approved rules |
| FIN-002  | required | Supported document currencies, BNB source schedule/fallback, rounding, rate effective-time behavior, and business timezone                       | 4.4, 6.1              | Store explicit rate snapshots; require environment/configuration           |
| FIN-003  | required | Structured accounting export products/formats and Bulgarian bank statement formats                                                               | 6.1                   | Use adapter interfaces; no vendor parser selected                          |
| DOC-001  | required | Company logo, authorized signature assets, document wording/layout, and email templates                                                          | 4.5, 6.1, 6.4         | Provide versioned template/asset interfaces only                           |
| IAM-001  | required | Initial employee roles/assignments, password complexity/expiration values, selected 2FA method, and non-admin 2FA policy                         | 4.2, 6.8, 10          | Secure configurable policies; admin 2FA remains mandatory                  |
| IAM-002  | required | Central identity providers and group mappings: AD, LDAP, Entra ID, SAML, OAuth 2.0/OIDC                                                          | 4.7, 9.4              | Local development adapter only; provider-neutral ports                     |
| IAM-003  | required | Whether protected local emergency access is enabled and its custodians/process                                                                   | 9.4                   | Disabled until explicitly approved                                         |
| SLA-001  | required | Customer/contract SLA response and resolution rules, warning thresholds, calendars, and escalation paths                                         | 7.4                   | Data model only; no invented deadlines                                     |
| CRM-001  | required | Customer portal selection and access model                                                                                                       | 7.4                   | Disabled feature flag                                                      |
| CRM-002  | required | Partner duplicate-resolution authority, required evidence, field precedence, linked-record migration, and retention of source records            | 7.1                   | Block exact legal-name/UIC duplicates; never merge or override silently    |
| KPI-001  | required | Date windows, statuses, segmentation, and formulas for retention, churn, CLV, pipeline, NPS, and employee KPIs                                   | 7.5, 7.6              | Keep formulas versioned/configurable; do not publish values                |
| SVC-001  | required | Warranty duration/extension, inspection frequencies, labor/transport costing, service plans, and signature policy                                | 6.4, 6.5, 7.5         | Configurable domain policies; no production defaults                       |
| INT-001  | required | Email and backup SMS providers, sender identities, escalation recipients, and delivery requirements                                              | 4.5, 4.6, 9.2         | Development email capture; SMS adapter disabled                            |
| INT-002  | required | Econt and Speedy contracts, API products, credentials, label/tracking/return workflows, and environments                                         | 4.7, 6.6              | Provider ports and disabled feature flags                                  |
| POS-001  | required | Certified Ordinance H-18 fiscal device models/protocols, PIN pad, barcode scanner, POS terminal/register topology, and access to hardware        | 4.7, 8.1–8.9, 15.4    | Simulator contracts only; no readiness claim                               |
| POS-002  | required | Offline conflict rules for prices, stock, customers, serials, promotions, document numbering, and fiscal behavior                                | 8.6                   | Record as blocked; do not infer conflict winners                           |
| POS-003  | required | Return exception authorization, discount limits, loyalty earning/redemption/expiry, and corporate-pricing precedence                             | 8.4, 8.5              | Only invariant models and permission hooks                                 |
| OPT-001  | required | Select or decline FIFO, customer portal, kiosk, backup router, ESL, and online-store fiscalization                                               | 6.3, 7.4, 8.9         | Disabled feature flags                                                     |
| FILE-001 | required | Production S3-compatible storage, retention, size/type rules, malware scanner/quarantine, and encryption keys                                    | 4.5, 10               | MinIO for development only; secure adapter boundaries                      |
| DEP-001  | required | Client-owned/on-premises or approved cloud target, network topology, domains/certificates, CI provider, observability stack, and environments    | 3.2, 3.4, 10, 18      | Portable containers and GitHub Actions baseline; no production deployment  |
| BAK-001  | required | Complete source inventory and Critical/Important/Standard classification                                                                         | 9.1                   | Backup execution cannot be accepted                                        |
| BAK-002  | required | RPO, RTO, backup type/frequency, retention, storage, responsible people, verification, and management approval by class/source                   | 9.1                   | No destructive/retention automation enabled                                |
| BAK-003  | required | Physical storage server and tape drive/library: capacity, ownership, encryption, maintenance, compatibility, rotation, off-site/air-gap handling | 9.3, 9.6, 15.4        | Hardware integration stays blocked                                         |
| BAK-004  | required | Separate backup accounts/domain/network, primary-AD compromise model, role-group mappings, four-eyes approvers, and critical-action policy       | 9.3, 9.4              | Deny critical production actions by default                                |
| BAK-005  | required | Restore initiator/approver and management/customer communications responsibilities; DR test participants/signatories                             | 9.5                   | Procedures remain draft and no destructive restore is enabled              |

## Recorded technical decisions

- [ADR-0001: TypeScript npm-workspaces modular monorepo](0001-typescript-npm-workspaces-monorepo.md) — proposed.

When an open decision is approved, add a dated ADR that names the decision-maker,
scope, consequences, migration needs, and traceability rows, then update this table.
