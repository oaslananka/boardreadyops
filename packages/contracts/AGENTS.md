# Shared Contract Instructions

These instructions apply to `packages/contracts/**` and supplement the repository root instructions.

This package defines runtime wire contracts shared by the web control plane, self-hosted runner, DB adapters, review/billing/storage surfaces, and other consumers. Treat changes as compatibility work, not TypeScript refactoring.

## Contract rules

- Prefer explicit versioned contracts for protocol/state that crosses process or release boundaries.
- Keep runtime validation strict enough to reject malformed or ambiguous input.
- Do not widen enums, optionality, coercion, or unknown-field behavior merely to make one caller pass.
- Preserve backward compatibility when the documented protocol requires it; otherwise make the compatibility break explicit and update all consumers together.
- IDs, timestamps, digests, quantities, byte counts, versions, and bounded strings must retain their domain constraints.
- Security-sensitive defaults must fail closed.

## Change procedure

When a wire contract changes:

1. update the canonical Zod/runtime schema and exported TypeScript type together;
2. identify every producer and consumer;
3. update protocol/API docs and snapshots where applicable;
4. add compatibility/validation tests, including malformed and boundary cases;
5. run cloud and runner integration gates as relevant.

Do not create duplicate near-identical schemas in callers to avoid changing the shared contract.
