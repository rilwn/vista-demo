# Vista: remaining implementation work

Status: 28 October 2026. `AGENTS.md` is authoritative. This is the finite,
pending-only plan reconciled with the 128-row [specification comparison](docs/qa/specification-comparison-2026-10-23.md)
and the [Manager QA register](docs/qa/operations-2026-10.md). The active project
goal is to close these local gaps and then verify every requirement row. No
client decisions are being awaited. Completed work and dated progress logs do
not belong in this file.

## Goal

Implement and validate every remaining locally achievable mandatory
requirement in the specification and QA register. Do not add features that
cannot be tied to those sources. Keep real-device, hosted-service, physical
infrastructure, statutory, and witnessed tests as separate acceptance gates.

## 1. Close the specification and handover audit

Reconcile every AGENTS.md, Manager QA and specification-comparison row against
current behavior, tests and user-facing documentation. Fix only an evidenced,
locally implementable mismatch; keep actual infrastructure, provider,
statutory, hardware and witnessed evidence gates separate. Refresh traceability,
OpenAPI, deployment/backup/DR instructions and the role-based user guide.

**Accept when:** each requirement has current evidence and status, no mandatory
local software gap remains, and external acceptance items are clearly assigned
to deployment/hardware/site testing rather than represented as completed code.

## External acceptance gates

- DATECS FP-2000 H-18 registration and real receipt, reversal, offline cash
  receipt/reconnect, payment-terminal and X/Z tests on the selected POS PC;
  Zebra DS2208 scanning and router failover.
- Actual bank CAMT.053/MT940 file compatibility and configured SMTP, SMS,
  BNB, Econt/Speedy, bank or directory connections.
- Vista's final protected-source inventory, physical backup server/tape target,
  independent/air-gapped storage verification, and witnessed replacement-
  hardware restore with measured RPO/RTO and signed protocol.
- Hosted security and regression retest, Vista-owned repository/access
  handover, and staff training.

Optional FIFO, customer portal, Electronic Shelf Labels and e-commerce
fiscalization remain out of scope unless selected. No new phase may be proposed
unless it maps to an unmet requirement in the named source documents.
