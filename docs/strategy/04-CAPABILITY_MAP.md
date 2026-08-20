# Capability Map

This map separates the product into capability domains so roadmap decisions do not become a flat feature list.

## 1. Change Intelligence

Purpose: explain the production-relevant effect of a revision.

Capabilities:

- schematic delta;
- PCB/layout delta;
- BOM delta;
- placement/footprint delta;
- firmware contract delta;
- manufacturing-readiness delta;
- policy delta;
- risk increase/decrease summary;
- PR annotations/checks;
- machine-readable agent planning and verification commands.

## 2. Manufacturing Readiness

Purpose: determine whether a design/release satisfies manufacturing expectations.

Capabilities:

- DRC/ERC evidence;
- DFM/DFA rules;
- fabrication/assembly artifact completeness;
- vendor profiles;
- BOM/CPL consistency;
- readiness scoring as a transparent summary;
- policy-enforced blockers/warnings;
- waivers and expiry.

## 3. Release Trust

Purpose: create a durable, verifiable release identity.

Capabilities:

- release preparation;
- exact artifact manifest;
- checksums/hashes;
- signatures;
- provenance/attestation;
- approvals/waivers;
- offline verification;
- manufacturer handoff;
- release diff;
- proposed Hardware Release Passport representation.

## 4. Supply-Chain Intelligence

Purpose: detect risk that changes outside the repository.

Capabilities:

- component identity and normalized MPNs;
- lifecycle;
- availability;
- lead time;
- supplier count/single-source risk;
- alternates;
- restricted substances/compliance notes;
- provider trust/freshness;
- affected-product/release graph;
- policy response and notifications.

## 5. Organization Governance

Purpose: scale release policy without duplicating repository configuration.

Capabilities:

- organization defaults;
- policy inheritance;
- repository overrides;
- role/approval rules;
- waiver governance;
- policy version history;
- audit trail;
- portfolio-level policy posture.

## 6. Cloud Control Plane

Purpose: orchestrate, persist, reconcile, and present trusted state.

Capabilities:

- GitHub App installation lifecycle;
- durable webhook intake;
- run orchestration;
- jobs/outbox/retry/reconciliation;
- OIDC-authenticated result ingestion;
- tenant-scoped persistence;
- artifact metadata and direct signed access;
- dashboards/history;
- notifications;
- monitoring and SLOs.

## 7. Enterprise Trust

Purpose: support stricter customer identity/data/execution requirements.

Capabilities pulled by demand:

- outbound customer-hosted agent;
- SSO/SAML and later SCIM if required;
- enhanced audit/retention;
- customer-managed/dedicated key patterns;
- data residency/dedicated deployment where contractual triggers exist;
- enterprise support/SLA.

## 8. Manufacturing Feedback

Purpose: connect release decisions to physical outcomes.

Minimum useful inputs:

- production lot/batch;
- release ID;
- quantity;
- first-pass yield;
- rework;
- AOI/SPI defect categories;
- functional-test outcome;
- NCR/RMA/corrective action.

Do not build a full MES. Ingest enough evidence to correlate release changes with outcomes.

## 9. Evidence Graph / Hardware Memory

Long-term relationship model:

`Product → Revision → Change → Component → Supplier Observation → Policy → Approval → Release → Manufacturing Batch → Test Result → Failure → Corrective Action`

This graph is a product/data model, not necessarily a graph database requirement.

## 10. Assisted Intelligence

Purpose: reduce human interpretation cost without weakening deterministic trust.

Capabilities:

- explain findings;
- summarize PR/release impact;
- prioritize investigation;
- suggest next steps/verification commands;
- correlate historical evidence;
- agent safety/governance surface.

Final policy decisions remain deterministic and inspectable.
