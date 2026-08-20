# Metrics

Metrics exist to test the product thesis, not to decorate dashboards.

## Measurement principles

- Define event semantics before plotting trends.
- Separate adoption, engagement, value, reliability, and commercial metrics.
- Prefer customer outcomes over activity counts.
- Segment internal/demo repositories from external users.
- Do not optimize a metric that can rise while release trust falls.
- Record denominator and eligibility rules so metrics remain comparable.

## North Star — Protected Hardware Changes / Month

### Definition

A **protected hardware change** is a unique meaningful hardware revision evaluated by BoardReadyOps before a merge/release/production boundary, with a deterministic decision and evidence record.

Exclude:

- duplicate retries of the same candidate;
- docs-only/non-hardware changes unless they genuinely affect release evidence;
- internal synthetic canaries from customer adoption totals;
- repeated manual reruns with identical source/effective policy unless separately measuring reliability.

### Why it matters

It combines adoption and actual workflow use. It is stronger than raw check count because the unit is a meaningful protected engineering change.

## Activation metrics

### Install → repository activation rate

`organizations with >=1 enabled repository / organizations completing App installation`

### Time to first successful run

Timestamp from completed installation/onboarding start to first terminal successful run.

### Time to first useful finding

Time until the user sees a finding/change/evidence item that influences or is explicitly acknowledged in review.

Operational proxy may start as first non-trivial finding viewed/clicked, but qualitative validation is required.

### Setup intervention rate

`external activations requiring maintainer support / external activation attempts`

Goal: trend down before self-serve GA.

## Engagement metrics

- weekly active external repositories;
- protected changes per active repository;
- verified releases per active organization;
- repositories active for 4/8/12 consecutive weeks;
- PR check/evidence view rate;
- release verification events;
- organization members interacting with evidence/policy.

## Product-value metrics

### Pre-production issues caught

Count only findings that users confirm would otherwise have reached procurement/manufacturing or required later manual detection.

Categorize:

- electrical/design;
- manufacturing/DFM/DFA;
- BOM/component identity;
- supply chain;
- release artifact/evidence;
- policy/governance.

### Issues caught before purchase/manufacturing

High-value outcome metric. Capture estimated impact when user can provide it:

- avoided board spin;
- avoided component purchase;
- avoided scrap/rework;
- schedule time saved;
- audit/release reconstruction avoided.

Do not fabricate monetary savings.

### Decision influence rate

`protected changes where user reports BoardReadyOps changed/confirmed a decision / protected changes with feedback opportunity`

Use sampling/design-partner interviews initially.

## Continuous monitoring metrics

- monitored active products/releases;
- monitored normalized component identities;
- observation refresh success/freshness;
- alerts generated;
- alerts viewed;
- alerts acted upon;
- alerts dismissed as not useful;
- affected-product mapping accuracy;
- provider cost per monitored organization/product;
- false/noisy alert rate.

A high alert count is not success.

## Release Passport/evidence metrics

- verified releases created;
- offline verifications;
- evidence bundle downloads/accesses;
- release identity used in manufacturer/customer/audit handoff;
- later “what shipped?” investigations resolved from stored evidence;
- evidence verification failures by cause.

## Organization/policy metrics

- organizations with central policy enabled;
- repositories inheriting policy;
- policy overrides/waivers;
- expired waivers blocked;
- policy changes affecting multiple repositories;
- portfolio users/review frequency;
- time to explain effective policy for a repository.

## Manufacturing-feedback metrics

- releases linked to manufacturing batches;
- batches with valid outcome data;
- mapping/error rate;
- correlations reviewed by engineer;
- engineer-confirmed root causes;
- rule/policy/design changes resulting from feedback;
- repeat usage by quality/manufacturing stakeholders.

## Reliability/SLO metrics

Track at minimum:

- webhook accepted/rejected/error rate;
- webhook processing latency;
- control-plane job queue age;
- job retries/dead letters;
- reconciliation backlog;
- dispatch success rate;
- result-ingestion success/rejection rate by reason;
- run terminal latency;
- duplicate/ambiguous transition count (target: zero);
- cross-tenant security event count (target: zero);
- worker uptime/liveness;
- database error/capacity indicators;
- signed artifact access failures;
- restore RPO/RTO drill results.

SLO targets belong in operational docs/issue #190 and should be based on measured workload rather than invented here.

## Security/trust metrics

- least-privilege permission drift checks;
- OIDC rejection categories;
- security scan/release gate pass rate;
- vulnerability remediation age by severity;
- restore/isolation exercise freshness;
- secrets/private data accidentally present in public evidence (target: zero);
- incident count/time to detect/time to mitigate where applicable.

## Commercial metrics

Before revenue:

- qualified design partners;
- external activated organizations;
- weekly retained organizations;
- pricing conversations;
- written willingness-to-pay evidence;
- procurement/security reviews initiated.

After charging:

- trial/design-partner → paid conversion;
- MRR/ARR;
- expansion/contraction;
- gross retention/net retention when sample is meaningful;
- churn reason;
- support cost;
- supplier/storage/compute COGS;
- gross margin by package when useful.

## Metrics review cadence

Weekly:

- activation;
- protected changes;
- reliability;
- external user blockers.

Monthly:

- retention;
- product-value evidence;
- design-partner learning;
- commercial signals;
- monitoring economics;
- roadmap assumptions.

Quarterly or when data is meaningful:

- pricing/value metric;
- cohort behavior;
- enterprise expansion;
- long-term moat indicators.

## Anti-metrics

Do not use these alone as evidence of PMF:

- GitHub stars;
- npm downloads without retained usage;
- total CI check count;
- total findings generated;
- dashboard page views;
- lines of code;
- number of integrations;
- number of roadmap issues closed.

They may be useful diagnostics, not product success.
