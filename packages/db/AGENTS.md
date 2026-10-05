# Database and Migration Instructions

These instructions apply to `packages/db/**` and supplement the repository root instructions.

This package persists tenant, repository, review, runner, billing, lifecycle, artifact, audit, notification, supply, and control-plane state. Store logic and migrations are security boundaries.

## Tenant isolation

- Every tenant/repository/workspace query must preserve the canonical tenant scope for that model.
- Do not trust a caller-provided tenant, installation, repository, workspace, run, or review ID without the authoritative relationship check required by the store contract.
- Keep cross-tenant failures non-enumerating where the API contract requires not-found behavior.
- A missing tenant predicate is a security defect, not a performance optimization.

## SQL and transactions

- Use parameterized SQL for untrusted values.
- Preserve atomic state transitions, leases, idempotency keys, uniqueness rules, compare-and-set/version guards, and `FOR UPDATE SKIP LOCKED` semantics where documented.
- Do not split one transactional invariant across unrelated calls without an explicit recovery design.
- Keep audit writes and protected state transitions ordered according to their canonical contract.

## Migrations

Migrations are ordered, additive history.

- Add a new numbered migration; do not rewrite an already applied migration to change production history.
- Make retry/restart behavior safe and document irreversible/destructive operations.
- Keep schema/migration expectations synchronized with store code and integration tests.
- Never point migration/integration tests at production or a shared database.
- PostgreSQL integration suites require explicit disposable-database opt-in.

## Retention, erasure, and audit

- Retention/erasure changes are data-lifecycle changes and must preserve legal-hold/reference semantics.
- Do not delete audit/evidence history merely to simplify cleanup unless the product policy explicitly requires that deletion.
- Do not persist plaintext secrets when the model specifies encrypted or hashed material.

## Verification

Run DB typecheck, focused store/migration tests, and the relevant PostgreSQL-backed integration suite.
