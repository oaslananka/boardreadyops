# OSS / Cloud Boundary

**Status:** PROPOSED strategic model; final licensing/commercial boundary is an explicit open decision.

The repository root is currently MIT licensed. Do not assume that an npm package marked `private: true` creates a proprietary licensing boundary.

## Recommended product model

**Open-source deterministic engine + paid managed continuity/intelligence.**

The intent is to keep trust-producing local capabilities useful and inspectable while monetizing persistent cross-time/cross-repository operations.

## Candidate OSS core

- CLI and local pipeline;
- KiCad discovery/adapters and deterministic checks;
- manufacturing/readiness rule engine;
- local BOM analysis;
- release generation and manufacturer handoff;
- evidence bundle format;
- checksums/signatures and offline verification;
- local policy/waivers;
- schemas/contracts needed for interoperability;
- GitHub Action;
- plugin SDK and rule-pack mechanisms;
- documented standard exports.

## Candidate Cloud value

- hosted GitHub App/control plane;
- run/release history;
- continuous monitoring;
- cross-repository/product portfolio;
- organization policy management/inheritance;
- hosted evidence registry and collaboration;
- BOM/supply-chain watch and notifications;
- role/approval/audit workflows;
- billing/account lifecycle;
- enterprise identity/data controls;
- assisted review/history summarization;
- managed integrations and operational SLOs.

## Principle

Cloud should answer questions the local CLI cannot answer naturally:

- What changed across all products this week?
- Which released products are affected by today's supplier/lifecycle event?
- Which repositories violate organization policy?
- What is the full history of this release and its approvals?
- Which production failures correlate with a design/release change?

## Repository strategy

### Current recommendation

Keep the existing monorepo while Cloud contracts, data model, and product are changing rapidly together.

Benefits:

- one PR can update contracts, cloud-core, db, web, tests, and docs;
- integration tests catch drift;
- lower dependency/release overhead;
- faster iteration during pre-GA validation.

### Do not split by frontend/backend

Avoid separate frontend, API, worker, and CLI repositories merely for technical layering. That creates dependency/version choreography without solving a product boundary.

### Reconsider a public/private repository split when one or more are true

- the commercial Cloud is intentionally proprietary and the legal/license decision is complete;
- separate teams/permissions require code visibility separation;
- Cloud release cadence becomes materially independent;
- customers/contracts require a distinct delivery boundary;
- public OSS contribution workflows are harmed by commercial-only code;
- internal proprietary integrations/data models become substantial.

Potential future shape:

```text
boardreadyops          PUBLIC
  CLI / Action / rules / evidence / schemas / SDK

boardreadyops-cloud    PRIVATE or separately licensed
  web / API / worker / DB / billing / monitoring / enterprise
```

## Required decisions before proprietary separation

- legal review of current MIT-covered history and intended future licensing;
- contributor/license policy;
- which shared contracts remain public;
- version compatibility policy between OSS engine and Cloud;
- release/publish automation after split;
- security disclosure ownership;
- self-hosted Cloud position, if any.

## Self-hosting question

Do not decide “fully open self-hosted Cloud” or “managed only” by ideology. Validate which customers need self-hosting and why. Customer-hosted **execution** is already strategically distinct from customer-hosted **control plane**.

## Decision gate

Record the final OSS/Cloud licensing model in `19-DECISION_LOG.md` and, if it changes architecture/distribution materially, create an ADR before moving code.
