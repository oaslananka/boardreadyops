# Cloud Core Instructions

These instructions apply to `packages/cloud-core/**` and supplement the repository root instructions.

Cloud core contains reusable hosted domain/security logic: policy and decision evaluation, runner request signatures, credential encryption, lifecycle planning/execution, GitHub mutations, storage, billing, notifications, component intelligence, sanitizers, and production outcomes.

## Boundary

Keep reusable domain/security logic independent of Next.js rendering and route mechanics. Web routes should adapt requests to this layer rather than reimplement its decisions.

## Security invariants

- Fail closed on malformed, unsupported, stale, replayed, or unverifiable security-sensitive input.
- Cryptographic verification must bind the exact canonical values documented by the protocol.
- Credential encryption/decryption changes are compatibility and security changes; never add plaintext fallback persistence.
- Archive/XML/delimited sanitizers must retain resource, traversal, entity/expansion, and size bounds.
- Provider and GitHub mutations must use server-derived authority and bounded/idempotent retry semantics.
- Error objects/logging must not expose credentials, signed tokens, private source, or provider secret material.

## Policy and product truth

- Policy/entitlement changes must not silently relax inherited or effective requirements.
- Unknown policy facts do not become permission.
- Supply, production-outcome, and readiness evidence may support a decision but must not be presented as causal proof unless the product contract explicitly establishes that.
- Keep deterministic release authority in the BoardReadyOps engine; hosted logic must not invent a hardware pass.

## Dependencies and contracts

Use `@boardreadyops/contracts` for shared runtime wire shapes. When a cloud-core change alters a persisted or cross-process contract, update contracts, stores, routes, docs, and tests coherently.

## Verification

Run package typecheck, focused tests, cloud coverage, and PostgreSQL integration when persistence/transition behavior is involved.
