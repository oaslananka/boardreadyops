# Supply-Chain Intelligence Strategy

## Product thesis

Supply-chain intelligence is valuable to BoardReadyOps when it answers a release decision question, not when it merely duplicates component search.

The differentiation should be:

> External component risk changed → these released products/repositories are affected → this policy now applies → here is the evidence and action.

## Do not become a supplier-data company

Avoid competing on raw catalog breadth, search UX, scraping, or being the authoritative commercial data source.

BoardReadyOps should own:

- normalization;
- component identity mapping;
- observation history;
- provider trust/freshness metadata;
- product/release impact mapping;
- policy evaluation;
- notifications/evidence.

Providers own the underlying commercial/intelligence data.

## Provider-neutral contract

A supplier-intelligence provider may contribute normalized observations such as:

- lifecycle state;
- availability/stock signal;
- lead time;
- supplier count;
- price bands only where product use is justified;
- alternates;
- compliance/restricted-substance notes;
- source/provider identity;
- observed/fetched time;
- confidence/trust/freshness.

Core logic must not require one named provider.

## Observation model

Prefer appendable observations over overwriting “current truth.”

Example conceptual identity:

`component identity + provider + observation type + observed_at + value + provenance`

This enables:

- freshness reasoning;
- conflicting-provider comparison;
- historical explanation;
- audit of why a release/policy changed.

## Continuous watch

Cloud should periodically or event-driven refresh relevant observations for active products/releases.

A useful alert includes:

1. what external fact changed;
2. how confident/fresh it is;
3. which products/releases are affected;
4. which policy condition changed;
5. recommended next deterministic action.

Avoid alerts that merely say “part risk changed” without product context.

## Initial risk categories

Prioritize explainable, actionable signals:

- ACTIVE → NRND/EOL lifecycle transitions;
- no approved alternate;
- single-source critical component;
- supplier count drop;
- extreme lead-time/availability degradation if data quality supports it;
- compliance/restriction change where source is authoritative enough;
- approved-alternate status changes.

## Cost control

External data can become a material COGS driver. Track:

- API calls per active component/product;
- cache hit/freshness policy;
- provider cost per monitored organization;
- duplicate MPN normalization rate;
- alert usefulness/false-positive rate.

Only increase refresh frequency when user value justifies cost.

## Data trust

Every observation should make it possible to answer:

- provider/source;
- observed/fetched time;
- freshness policy;
- confidence/trust class;
- whether value is authoritative, inferred, or unavailable.

Do not present stale or inferred data as deterministic truth.

## MVP

1. Normalize component identity and MPNs.
2. Support one static/test provider plus one production-capable provider adapter.
3. Store time-stamped observations.
4. Link observations to active releases/products.
5. Evaluate a small number of deterministic policies.
6. Send actionable notifications.
7. Record whether users acted/dismissed the alert.

## Exit criteria for recurring SaaS value

- design partners keep monitoring enabled across multiple weeks;
- at least one external change produces a useful pre-procurement/pre-release action;
- affected-product mapping is trusted;
- alert volume is low enough to avoid fatigue;
- provider cost supports plausible pricing.

## Standards/export

Where useful, map hardware/component information to CycloneDX HBOM/MBOM/SBOM-compatible outputs through versioned adapters. Keep internal observation history richer than any one export format.
