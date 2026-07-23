# Control-Plane Dead-Letter Operator API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, tenant-scoped, metadata-only operator API for listing and safely replaying control-plane dead letters.

**Architecture:** A focused authentication helper validates server configuration and compares bearer tokens in constant time. A route handler validates path/query/header inputs, constructs `ControlPlaneOperationsStore`, maps store outcomes to stable HTTP responses, and exposes no payload-bearing fields. Thin Next.js route modules delegate dynamic parameters to the handler.

**Tech Stack:** TypeScript 6, Next.js 16 route handlers, Node.js `crypto`, PostgreSQL store functions, Vitest 4.

## Global Constraints

- Do not expose webhook actions, outbox payloads, source content, findings, credentials, or raw database errors.
- Obtain actor identity only from `BOARDREADYOPS_OPERATOR_ACTOR_ID`.
- Require `BOARDREADYOPS_OPERATOR_API_TOKEN` and compare bearer tokens in constant time.
- Require a caller-supplied `Idempotency-Key` for replay.
- Keep list limits between 1 and 100.
- Preserve installation scoping in every store call.
- Use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on every response.

---

### Task 1: Operator authentication boundary

**Files:**
- Create: `apps/web/lib/control-plane-operator-auth.ts`
- Test: `tests/unit/web/control-plane-operator-auth.test.ts`

**Interfaces:**
- Produces `configuredControlPlaneOperator(environment)` returning `{ token, actorId } | undefined`.
- Produces `authenticateControlPlaneOperator(request, environment)` returning `{ actorId } | "disabled" | "unauthorized"`.

- [ ] Write tests for disabled configuration, malformed authorization, wrong token, exact token, actor validation, and non-ASCII/length mismatch behavior.
- [ ] Run `node scripts/toolchain.mjs run corepack pnpm exec vitest run tests/unit/web/control-plane-operator-auth.test.ts` and confirm RED because the module does not exist.
- [ ] Implement strict bearer parsing, identifier validation, and `timingSafeEqual` comparison.
- [ ] Re-run the focused test and confirm GREEN.
- [ ] Run Biome on the two files.

### Task 2: Dead-letter list and replay handlers

**Files:**
- Create: `apps/web/lib/control-plane-dead-letter-routes.ts`
- Test: `tests/unit/web/control-plane-dead-letter-routes.test.ts`

**Interfaces:**
- Consumes `authenticateControlPlaneOperator`.
- Consumes `createSqlControlPlaneOperationsStore` and `SqlQueryExecutor`.
- Produces `handleControlPlaneDeadLetterListRequest(request, installationId, dependencies?)`.
- Produces `handleControlPlaneDeadLetterReplayRequest(request, params, dependencies?)`.

- [ ] Write list-handler tests for disabled/unauthorized requests, invalid pagination, metadata-only output, cursor forwarding, database absence, and store failure.
- [ ] Run the focused test and confirm RED.
- [ ] Implement the minimal list handler and shared secure JSON response helper.
- [ ] Re-run the list tests and confirm GREEN.
- [ ] Write replay-handler tests for required idempotency key, invalid item type/identifiers, configured actor forwarding, and `replayed`, `already_applied`, `not_found`, `not_replayable` mappings.
- [ ] Run the focused test and confirm RED for replay behavior.
- [ ] Implement the minimal replay handler.
- [ ] Re-run the focused route tests and confirm GREEN.
- [ ] Run both new unit test files together.

### Task 3: Next.js route integration

**Files:**
- Create: `apps/web/app/api/v1/operator/installations/[installationId]/dead-letters/route.ts`
- Create: `apps/web/app/api/v1/operator/installations/[installationId]/dead-letters/[itemType]/[itemId]/replay/route.ts`
- Modify: `tests/unit/web/control-plane-dead-letter-routes.test.ts`

**Interfaces:**
- GET route awaits `{ installationId }` and delegates to the list handler.
- POST route awaits `{ installationId, itemType, itemId }` and delegates to the replay handler.

- [ ] Add source-level tests that import both route modules and verify delegation-compatible exports and `runtime = "nodejs"`.
- [ ] Run the focused test and confirm RED because route modules do not exist.
- [ ] Add thin route modules.
- [ ] Re-run the focused test and confirm GREEN.
- [ ] Run `pnpm run cloud:typecheck` through the repository toolchain.

### Task 4: Configuration and operations documentation

**Files:**
- Modify: `deploy/env.example`
- Create: `docs/operations/control-plane-reconciliation.md`
- Modify: `mkdocs.yml`
- Test: `tests/unit/docs-accessibility.test.ts`

**Interfaces:**
- Documents token generation, private network exposure, actor naming, endpoint contracts, pagination, replay outcomes, audit behavior, and credential rotation.

- [ ] Add a documentation assertion for the two operator variables and both endpoint paths.
- [ ] Run the focused documentation test and confirm RED.
- [ ] Add environment placeholders and the operations runbook page.
- [ ] Add the page to MkDocs navigation.
- [ ] Re-run documentation tests and confirm GREEN.
- [ ] Run `pnpm run docs:build` through the repository toolchain.

### Task 5: Verification and delivery

**Files:**
- Modify only files changed by Tasks 1-4 if verification finds defects.

- [ ] Run Biome on all changed source/test/config files.
- [ ] Run root typecheck and cloud typecheck.
- [ ] Run the new unit tests plus existing operations-store and migration tests.
- [ ] Run cloud coverage to ensure the new route layer is included.
- [ ] Run `git diff --check` and inspect the complete diff.
- [ ] Commit with repository hooks, push the branch, and open a public PR referencing #190.
- [ ] Inspect all PR comments, reviews, inline comments, CodeQL, Semgrep, SonarCloud, Codecov, Socket, and required GitHub checks.
- [ ] Resolve findings, merge only after all required evidence is green, then clean the temporary branch/worktree.
