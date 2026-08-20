# Go-to-Market and Pricing Strategy

**Status:** hypotheses for validation; do not publish exact prices from this document until customer evidence and billing implementation support them.

## Initial wedge

Target GitHub/KiCad hardware teams that ship real PCBs and feel concrete release/procurement/manufacturing risk.

Lead with a workflow outcome:

> Catch risky hardware changes before production and create verifiable releases.

Do not lead with “control plane,” “AI,” or a long feature matrix.

## Acquisition paths

### Open source

- GitHub repository;
- npm/CLI;
- GitHub Action;
- technical docs/examples;
- bad-board/golden demo;
- engineering content around release failures, DFM/BOM/reproducibility.

### GitHub-native

- Marketplace/App listing when trust gates allow;
- PR checks as viral team surface;
- evidence links shared in review/release workflows.

### Design-partner outbound

Target teams visibly using KiCad/GitHub and manufacturing products. Ask about real release incidents rather than pitching all features.

### Technical credibility

Publish useful evidence-driven content:

- how to create reproducible hardware releases;
- BOM/release identity;
- GitHub Actions trust boundaries for hardware;
- manufacturing handoff mistakes;
- hardware SBOM/HBOM/attestation;
- CRA evidence implications without compliance overclaim.

## Conversion journey

```text
Discover OSS
  ↓
Run locally/CI
  ↓
See useful finding/release evidence
  ↓
Install Cloud App
  ↓
Persist history / monitor products
  ↓
Invite team / centralize policy
  ↓
Pay for recurring organization value
```

Cloud should amplify proven local value, not require faith before the engine is useful.

## Packaging hypothesis

Keep early packaging simple.

### Community / OSS

- deterministic CLI/Action;
- local release/evidence/verification;
- local policies/rules;
- schemas/SDK as defined by final OSS boundary.

### Team

Candidate value:

- hosted history/dashboard;
- multiple repositories;
- evidence registry;
- notifications;
- continuous monitoring;
- collaboration.

### Business

Candidate value:

- organization policy;
- portfolio views;
- advanced retention/audit;
- richer supply-chain monitoring/integrations;
- support.

### Enterprise

Demand-triggered:

- customer-hosted execution;
- SSO/SCIM;
- data/deployment controls;
- contractual support/SLA;
- procurement/security assistance.

## Pricing metric hypothesis

Avoid assuming seat-only pricing. Hardware release value correlates with production exposure more than editor count.

Candidate metrics to test:

- active protected repositories;
- active products;
- monitored components/BOMs;
- protected releases/changes;
- organization tier with generous collaborators;
- hybrid base platform + usage/scale bands.

### Metric selection criteria

A good value metric is:

- easy for customer to predict;
- correlated with received value;
- difficult to game accidentally;
- measurable reliably;
- not punitive for collaboration;
- compatible with procurement/budgeting.

## Avoid early pricing complexity

Do not initially combine seats + repos + actions minutes + BOM rows + artifact GB + API calls unless economics prove necessary. Complexity slows learning and sales.

## Design-partner commercial questions

Ask:

- What budget owns this problem: engineering tools, DevOps, quality, supply chain, compliance?
- What does one prevented release/manufacturing mistake cost?
- Would you pay for local gates, ongoing monitoring, organization policy, or audit history?
- Which unit feels fairest: product, repo, organization, component scale, or seat?
- What approval threshold changes self-serve vs sales-led purchase?

## Willingness-to-pay evidence ladder

Strongest to weakest:

1. signed paid contract/subscription;
2. procurement/security process initiated;
3. written budget/price acceptance;
4. design-partner commitment with real production use;
5. repeated high-engagement usage;
6. verbal “I would pay”;
7. generic feature enthusiasm.

Optimize for evidence near the top.

## Sales proof

The strongest early case study is not “ran 10,000 checks.” It is:

> BoardReadyOps caught X before boards were ordered / proved release Y / detected component risk Z across N affected products, saving time/cost/risk.

Track these outcomes from day one.
