# Vision and Positioning

## Vision

**Every physical product deserves a verifiable release.**

BoardReadyOps exists to reduce the distance between a hardware design change and a trustworthy production decision.

## Category thesis

Preferred external category language:

- hardware release trust platform;
- manufacturing readiness and release evidence;
- independent trust layer between hardware change and physical production.

Preferred internal architecture language:

- hardware engineering control plane.

Avoid leading with “hardware CI” as the full category. CI is an adoption surface, not the end-state value.

## Positioning statement

> BoardReadyOps determines whether a hardware change is safe to manufacture and preserves the evidence needed to verify that decision later.

Alternative short promise:

> Know what changed. Know if it is safe. Prove what shipped.

## Why this wedge

Hardware teams already use Git, pull requests, CI, EDA tools, component data, manufacturers, and sometimes PLM/ERP systems. BoardReadyOps should not require replacement of those systems. It should connect evidence across them and own the release-trust decision boundary.

## Differentiation

BoardReadyOps should win by combining:

1. deterministic, inspectable release gates;
2. source-local execution and strong trust boundaries;
3. portable release evidence and offline verification;
4. hardware-aware change impact;
5. longitudinal release/product history;
6. continuous post-commit risk monitoring;
7. organization policy;
8. eventual manufacturing outcome correlation.

## Competitive posture

Do not compete primarily on:

- collaborative EDA editing;
- Git visualization;
- component search breadth;
- PLM workflow breadth;
- generic CI orchestration.

Compete on the question competitors often leave fragmented: **Can this exact hardware state safely become a physical product, and can we prove why?**

## Messaging hierarchy

### Homepage

1. Outcome: safe, verifiable manufacturing releases.
2. Workflow: GitHub PR/release gates.
3. Trust: source stays in customer execution boundary by default.
4. Evidence: deterministic findings, policies, signatures, release identity.
5. Recurring value: monitor risk after release.

### Engineer message

“Catch hardware, BOM, and manufacturing risk before merge/release.”

### Engineering manager message

“Know which products are ready, blocked, or exposed — with evidence.”

### Security/enterprise message

“Least privilege, bounded identities, auditable execution, portable evidence, and customer-controlled execution paths.”

## Naming discipline

- `BoardReadyOps` remains the master brand unless brand/legal work proves a conflict.
- “Release Passport” is a proposed product concept; do not claim trademark or standard status.
- “Hardware Health” is a summary/navigation concept, not a magical proprietary score.
- AI features are assistants, not the release authority.

## Proof before claims

Marketing copy must never outrun deployed behavior. Claims about isolation, permissions, compliance, data handling, supported EDA versions, security, and retention require evidence and matching docs.
