# EDA Strategy and Canonical Hardware Model

## Strategic stance

**KiCad-first go-to-market, EDA-neutral architecture.**

BoardReadyOps should become exceptionally useful for KiCad before expanding breadth. Supporting many EDAs too early risks weak parsers, duplicated rules, and no product-market fit in any one workflow.

## Why a canonical model matters

Without an internal model, each future EDA adapter can leak tool-specific representation into:

- rules;
- diff logic;
- BOM intelligence;
- release identity;
- policy;
- reports;
- manufacturing feedback.

That creates N×M maintenance as EDAs and capabilities grow.

## Canonical model responsibilities

The canonical hardware model should represent only concepts BoardReadyOps needs to reason about, for example:

### Project/revision

- source identity;
- EDA/tool/version;
- board/schematic identities;
- variant/configuration;
- normalized artifact/release references.

### Components

- reference designator;
- value/function metadata where useful;
- MPN/manufacturer;
- footprint/package;
- placement/side/rotation when available;
- DNP/variant state;
- attributes needed by policy/rules.

### Nets/connectivity

Only the normalized connectivity needed for supported checks/contracts; do not attempt to clone an entire EDA data model without a product requirement.

### Board/manufacturing geometry

Represent the measurements/relationships needed by current DFM/DFA rules. Avoid a universal CAD kernel unless evidence demands it.

### Firmware contracts

Normalize pins/peripherals/connectors/expected interfaces independently from any one firmware ecosystem.

## Adapter boundary

```text
KiCad parser/adaptor -----\
Altium adaptor (future) ----> Canonical Hardware Model -> rules/diff/policy/evidence
Cadence adaptor (future) ---/
```

EDA adapters own translation and tool-specific diagnostics. Core product logic consumes canonical types where practical.

## Versioning

Canonical-model changes should distinguish:

- additive compatible fields;
- semantic changes;
- fields used in signed/release evidence;
- adapter capability availability.

Do not promise a public canonical schema before the model stabilizes enough to support external users.

## Capability negotiation

Not every EDA provides identical information. An adapter should declare capabilities so the engine can distinguish:

- unsupported;
- unavailable from source;
- parse failure;
- intentionally not evaluated.

Never convert missing adapter capability into a false PASS.

## Second-EDA gate

Do not commit to a second EDA until most of the following are true:

- KiCad onboarding and change/release workflow is working for real users;
- meaningful active/retained repository count exists;
- repeated customer/prospect demand identifies a specific EDA;
- commercial/design-partner value justifies maintenance cost;
- canonical model can represent the required comparison without duplicating rule logic;
- test fixtures/licensing/tool automation are feasible.

## Selection criteria

Score candidate EDA integrations on:

- repeated customer demand;
- target customer value/ACV;
- accessible file/API format;
- CI/headless automation feasibility;
- legal/licensing constraints;
- fixture/testability;
- canonical-model fit;
- support burden.

Do not select solely by installed market share.

## Success criterion

The second EDA should demonstrate that BoardReadyOps' release/policy/evidence model survives an adapter change. If adding it requires forking the product logic, the canonical boundary is not mature enough.
