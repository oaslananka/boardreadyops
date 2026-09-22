# Security, Tenancy, and Governance Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make database evolution immutable, tenant isolation database-backed, route authorization structurally mandatory, API tokens least-privilege, and critical trust changes human-reviewed.

**Architecture:** Strengthen the lowest enforceable layer first: migration ledger/checksums, then schema assertions, then PostgreSQL tenant policies, then route wrappers and token scopes. Plugin/security documentation is generated or checked against a capability registry. Repository ruleset policy requires human review for critical paths without bypassing existing CI.

**Tech Stack:** PostgreSQL, Node migration runner, TypeScript, Next.js route handlers, Vitest/integration tests, GitHub Rulesets.

**Spec:** `docs/superpowers/specs/2026-09-22-assurance-hardening-program-design.md`

## Global Constraints

- Existing production migrations are never silently rewritten.
- Schema mismatches fail closed instead of succeeding through `IF NOT EXISTS`.
- Tenant A cannot read/write/list/search Tenant B resources.
- Authorization wrappers do not trust request-supplied tenant identifiers without membership resolution.
- Token creation requires explicit scopes.
- Plugin execution remains documented as trusted in-process until true isolation exists.
- Critical-path review requirements cannot weaken existing required checks.

## Review Focus

- Editing one already-applied migration byte must be detected.
- A table-name collision with incompatible columns must fail migration.
- A valid token from another tenant must receive a denial, not an empty successful result that leaks metadata.
- Omitting token scopes must not grant write access.
- A security/provenance migration PR must not merge with zero human approvals.

---

### Task B1: Add immutable migration checksums and derive schema truth

**Files:**
- Modify: `packages/db/scripts/apply-migrations.mjs`
- Modify: migration metadata/ledger bootstrap SQL as required
- Modify: `packages/db/src/index.ts`
- Modify: `tests/unit/db/migrations.test.ts`
- Add integration test: `tests/integration/db/migration-ledger.test.ts`

**Interfaces:**
- Migration ledger stores `migration_name`, `sha256`, `applied_at`, and runner/tool identity.
- Latest migration/schema identity is derived from the migration directory or generated metadata, not a hand-maintained stale integer.

- [ ] **Step 1: Write RED tests** that apply a fixture migration, alter one byte, and require the runner to fail with checksum drift.
- [ ] **Step 2: Add RED test** that compares published latest schema version with the highest canonical migration number.
- [ ] **Step 3: Extend the migration ledger** to persist SHA-256 before marking a migration applied.
- [ ] **Step 4: For existing ledger rows without checksums**, implement an explicit one-time bootstrap policy; do not silently trust changed local files after checksum adoption.
- [ ] **Step 5: Derive or generate `cloudDatabaseSchemaVersion`** from canonical migration metadata; remove the stale exact `56` assertion if migration 69 is the actual latest schema.
- [ ] **Step 6: Run migration unit/integration suites** and commit `feat(db): verify immutable migration history`.

### Task B2: Make semantic migration expectations fail loudly

**Files:**
- Review/modify: migrations using `CREATE TABLE IF NOT EXISTS` for semantic schema creation
- Add: migration structure tests near `tests/unit/db/*migration.test.ts`
- Document: `packages/db/README.md` or migration authoring guide

**Interfaces:**
- Idempotent migration guards validate expected columns/types/constraints before treating an existing object as success.

- [ ] **Step 1: Encode the 0063/0064 collision as a regression fixture** that creates an incompatible same-name table before the target migration.
- [ ] **Step 2: Run and preserve RED** if the current helper would accept the incompatible object.
- [ ] **Step 3: Add reusable SQL assertion pattern** for semantically important tables: existing object must match required shape or raise.
- [ ] **Step 4: Apply the pattern only to migrations where silent no-op would weaken authorization/data integrity; avoid rewriting historical migrations already shipped unless the checksum/bootstrap policy explicitly permits it. Prefer a new corrective migration.**
- [ ] **Step 5: Document the rule**: `IF NOT EXISTS` is allowed only when pre-existing semantics are truly equivalent.
- [ ] **Step 6: Commit `fix(db): fail closed on incompatible migration state`.

### Task B3: Add database-level tenant isolation

**Files:**
- Create new numbered migration(s) under `packages/db/migrations/`
- Modify DB session/context helper modules
- Add: `tests/integration/db/tenant-isolation.test.ts`
- Update: security/data-lifecycle docs

**Interfaces:**
- Request/worker transaction establishes trusted tenant/repository context using `SET LOCAL` or an equivalent parameterized session mechanism.
- RLS policies cover tenant-owned tables selected by an explicit inventory.

- [ ] **Step 1: Build the tenant-owned table inventory** from workspace/repository/project/run/review/artifact/token/notification/runner stores.
- [ ] **Step 2: Write RED adversarial tests** for cross-tenant select, insert, update, delete, list, and join traversal.
- [ ] **Step 3: Add RLS policies** table by table; start with highest-impact customer data and API tokens.
- [ ] **Step 4: Add a DB context helper** that sets trusted tenant identity inside each transaction; reject operations without required context rather than defaulting to broad access.
- [ ] **Step 5: Add service-role exceptions only for explicit background operations** and cover each exception with tests.
- [ ] **Step 6: Run real PostgreSQL integration tests** and commit `feat(db): enforce tenant isolation with RLS`.

### Task B4: Make route authorization structural

**Files:**
- Create or extend: `apps/web/lib/api-route.ts` / existing route-wrapper module
- Modify: protected `apps/web/app/api/v1/**/route.ts` incrementally
- Add: `tests/unit/web/api-route-inventory.test.ts`
- Extend: auth route tests

**Interfaces:**
- Provide wrappers such as:
```ts
withRepositoryApiRoute({ requiredScope, handler })
withWorkspaceApiRoute({ requiredRole, handler })
withOperatorApiRoute({ handler })
```
- Wrapper resolves authentication, tenant context, authorization, and normalized error handling before invoking domain logic.

- [ ] **Step 1: Write a RED inventory test** listing protected route files and requiring one approved wrapper marker/import per route.
- [ ] **Step 2: Implement the wrapper around existing `authenticateApiRequest` / `resolveRepositoryApiContext` primitives.
- [ ] **Step 3: Migrate one representative read route and one write route**; prove behavior unchanged for authorized callers and denied for cross-tenant callers.
- [ ] **Step 4: Migrate remaining protected routes in reviewable batches**; do not mix route business-logic refactors into the same commits.
- [ ] **Step 5: Make the inventory test discover new route files** so future unwrapped protected endpoints fail CI.
- [ ] **Step 6: Commit batches under `refactor(cloud): centralize API authorization`.

### Task B5: Make API token scope explicit and least-privilege

**Files:**
- Modify: `packages/db/src/api-token-store.ts`
- Add corrective migration after `0069` as needed
- Modify: `apps/web/app/api/v1/tokens/route.ts`
- Modify: `apps/web/app/settings/tokens/actions.ts`
- Modify: `apps/web/lib/api-token-admin.ts`
- Modify: `docs/api-tokens.md`
- Test: token store/route/UI action tests

**Interfaces:**
- Token create input requires a non-empty allowlisted `scopes` array.
- Database column has no broad write default.
- Admin remains explicit, not implied by omission.

- [ ] **Step 1: Write RED tests** for omitted scopes, empty scopes, unknown scopes, explicit read-only scopes, and explicit write scopes.
- [ ] **Step 2: Remove the broad DB default** `['runs:write','reviews:read','reviews:write']` through a new migration.
- [ ] **Step 3: Require scopes in API and Server Action validation** and render scope selection explicitly in settings UI.
- [ ] **Step 4: Keep existing tokens behavior-compatible** unless a migration/revocation policy is explicitly approved; do not silently broaden or shrink deployed token scopes.
- [ ] **Step 5: Update docs/examples** to create minimum required scopes.
- [ ] **Step 6: Commit `fix(cloud): require explicit API token scopes`.

### Task B6: Align plugin/security capability claims and enforce human review

**Files:**
- Create: `docs/security/capabilities.json` or equivalent machine-readable source
- Modify: `SECURITY.md`
- Modify: plugin ADR/docs and GTM/security questionnaire docs
- Modify: `.github/rulesets/main.json`
- Modify: `tests/unit/scripts/governance-ruleset.test.ts`
- Add/extend documentation contract tests

**Interfaces:**
- Capability registry records at least upload modes, external API capability, plugin isolation model, source upload support, and tenant isolation model.
- Ruleset requires at least one approving review for protected main; critical CODEOWNERS can be introduced if maintainable.

- [ ] **Step 1: Write RED governance test** expecting `required_approving_review_count >= 1`.
- [ ] **Step 2: Add capability registry assertions** preventing docs from calling trusted in-process plugins a sandbox and preventing obsolete "no external supplier API" claims.
- [ ] **Step 3: Set ruleset required approvals to 1** without removing status checks/thread resolution/signed commit/squash policy.
- [ ] **Step 4: Keep CODEOWNERS realistic**: do not add nonexistent reviewers; document bootstrap ownership if the repository remains single-maintainer.
- [ ] **Step 5: Update security/plugin docs** to say trusted in-process execution until OS/process isolation is actually implemented.
- [ ] **Step 6: Run governance/security/docs validation** and commit `chore(repo): harden trust governance`.
