# Product Principles

These principles guide tradeoffs when feature requests conflict.

## P1 — Deterministic before intelligent

The release decision must be reproducible from rules, policy, inputs, and evidence. AI can summarize, explain, prioritize, and suggest; it cannot silently redefine the release gate.

## P2 — Evidence before opinion

Every material PASS/WARN/BLOCK outcome should connect to:

`input → finding → evidence → policy → decision`

If a user cannot understand why a decision happened, the product is incomplete.

## P3 — Source stays near the customer

Default hosted execution belongs in the target repository GitHub Actions boundary. Central source cloning or a shared KiCad worker fleet requires an explicit new decision and customer/economic evidence.

## P4 — Portable trust over proprietary lock-in

Use stable schemas, checksums, signatures, attestations, SBOM/HBOM/MBOM-compatible exports, and offline verification. The UI may be proprietary; the evidence should remain inspectable.

## P5 — KiCad-first, EDA-neutral

Focus GTM and product quality on KiCad until the wedge is validated. Keep the internal model/adapters clean enough that another EDA does not require rewriting the policy/evidence system.

## P6 — Local value survives without Cloud

The CLI/Action should remain useful for local/CI release readiness and verification. Cloud earns money by continuity, history, collaboration, monitoring, portfolio, and enterprise controls rather than by making the open engine intentionally incomplete.

## P7 — The workflow comes before the dashboard

Engineers live in PRs, checks, terminals, and release workflows. The dashboard should deepen investigation and history, not become the only place where value exists.

## P8 — Fail closed at trust boundaries

Unknown installation, repository, workflow, SHA, attempt, event, environment, or tenant identity should not be accepted by convenience.

## P9 — Time is a product input

Hardware risk changes when source code does not. Supplier lifecycle, availability, policy, release age, waivers, and manufacturing outcomes make continuous monitoring a first-class cloud capability.

## P10 — Scores summarize; they do not replace evidence

A health/readiness score may help prioritization. It must be decomposable into evidence and should never hide a blocker behind an averaged number.

## P11 — Provider neutrality at data boundaries

Supplier intelligence and external evidence should be normalized behind contracts/adapters. Core logic should not become inseparable from one commercial API.

## P12 — Build infrastructure only against measured pressure

PostgreSQL queue first, then external broker only if thresholds are crossed. Existing state machine first, workflow engine only if complexity demands it. Profile before language rewrites.

## P13 — Security is part of product UX

Permissions, data boundaries, retention, provenance, and verification should be understandable to a customer. Trust should not require reading source code.

## P14 — Every phase needs a user outcome

A technically complete subsystem without an observable customer outcome is not a successful product milestone.

## P15 — Optimize for learning before breadth

Prefer a deep KiCad/GitHub/design-partner loop to many shallow integrations. Expand only after repeated evidence of demand.
