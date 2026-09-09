# Auto-Probe After Setup PR Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make zero-touch setup reach persisted `ready/ready` automatically after the canonical setup PR is merged, then allow `release-preview` to run without operator intervention.

**Architecture:** Repair the generated readiness workflow so setup probes can publish the existing OIDC callback, with the trusted public cloud origin embedded at PR-generation time. Add a dedicated `setup_probe.dispatch` lifecycle interaction for canonical merged setup PRs and route it through the existing repository setup store/GitHub client from the control-plane worker.

**Tech Stack:** TypeScript, Vitest, GitHub App webhooks, GitHub Actions workflow_dispatch, PostgreSQL-backed repository setup store, GitHub Actions OIDC.

**Spec:** `docs/superpowers/specs/2026-09-09-auto-probe-after-setup-merge-design.md`

## Global Constraints

- Never mark a repository ready because a PR merged; only the existing OIDC-authenticated probe callback can establish `ready/ready`.
- Do not add new GitHub App permissions, database migrations, callback endpoints, or direct default-branch mutations.
- Generated setup workflows must require no repository secret or Actions variable.
- Callback URLs must be pinned to the trusted HTTPS public app origin at setup-PR generation time.
- Ordinary PRs and non-canonical setup branches must not trigger setup probes.

---
### Task 1: Generate a working, origin-pinned setup probe workflow

**Files:**
- Modify: `packages/cloud-core/src/repository-setup.ts`
- Modify: `apps/web/lib/repository-setup-automation.ts`
- Modify: `apps/web/lib/repository-setup-routes.ts`
- Test: `tests/unit/cloud-core/repository-setup-pr.test.ts`

**Interfaces:**
- Produce `repositorySetupBranchName = "boardreadyops/setup"`.
- Extend `generateSetupPrPlan` with `cloudOrigin?: string`; custom `workflowContent` still overrides generation.
- Production callers pass `BOARDREADYOPS_PUBLIC_URL ?? NEXT_PUBLIC_APP_URL` so self-hosted deployments pin their own trusted origin.

- [ ] **Step 1: Write RED tests** asserting generated workflow has `jobs.setup-probe`, `contents: read`, `id-token: write`, no write repository permission, no `vars.BOARDREADYOPS_CLOUD_ORIGIN`, and an exact trusted callback origin.
- [ ] **Step 2: Run** `corepack pnpm exec vitest run tests/unit/cloud-core/repository-setup-pr.test.ts` and confirm the new assertions fail because the generated template has no setup-probe job.
- [ ] **Step 3: Implement minimal workflow generation** with validation equivalent to:
```ts
const origin = new URL(input.cloudOrigin ?? "https://boardreadyops.com");
if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
  throw new Error("repository setup cloud origin must be an HTTPS origin");
}
```
Append a `setup-probe` job that checks out the default branch, validates tracked `boardreadyops.yml` with the pinned CLI, builds the existing `{contractVersion, configStatus, configVersion?, observedSha, diagnostics}` payload, requests audience `boardreadyops-setup:${probeId}`, and POSTs only to `${origin}/api/v1/setup-probes/result?probe_id=${probeId}`.
- [ ] **Step 4: Pass the production origin** from both setup-PR creation call sites and rerun the focused tests.
- [ ] **Step 5: Commit** `fix(cloud): generate runnable setup probe workflow`.
### Task 2: Normalize canonical setup-PR merges into a durable probe intent

**Files:**
- Modify: `packages/cloud-core/src/lifecycle.ts`
- Test: `tests/unit/cloud-core/lifecycle.test.ts`

**Interfaces:**
- Add lifecycle action:
```ts
{
  type: "setup_probe.dispatch";
  installation: GitHubInstallationRef;
  repository: GitHubRepositoryRef;
  pullRequestNumber: number;
  commitSha: string;
  requestedBy?: string;
}
```
- Consume `repositorySetupBranchName` from `repository-setup.ts` rather than duplicating the branch string.

- [ ] **Step 1: Write RED tests** for `pull_request.closed`: merged canonical setup branch into `repository.defaultBranch` emits exactly one `setup_probe.dispatch`; unmerged, wrong head branch, wrong base, and ordinary merged PRs emit no setup probe.
- [ ] **Step 2: Run** `corepack pnpm exec vitest run tests/unit/cloud-core/lifecycle.test.ts` and confirm RED.
- [ ] **Step 3: Implement normalization** before the ordinary queued-PR action filter. Require `merged === true`, a full `merge_commit_sha`, canonical head ref, and matching default-branch base ref; preserve sender login as `requestedBy` when present.
- [ ] **Step 4: Rerun lifecycle tests and existing check-run/lifecycle-event tests to GREEN.**
- [ ] **Step 5: Commit** `feat(cloud): emit setup probe after setup merge`.
### Task 3: Execute setup-probe intents through the existing durable store/client

**Files:**
- Modify: `apps/web/lib/repository-setup-automation.ts`
- Modify: `apps/web/lib/control-plane-worker.ts`
- Modify: `apps/web/worker.ts`
- Test: `tests/unit/web/repository-setup-automation.test.ts`
- Test: `tests/unit/web/control-plane-worker.test.ts`

**Interfaces:**
- Add `probeSetup(action, context): Promise<void>` to `RepositorySetupLifecycleExecutor` and worker interactions.
- Add `githubClient: RepositorySetupGitHubClient` and `now(): Date` to executor dependencies; production uses `createRepositorySetupGitHubClient({ environment })`.

- [ ] **Step 1: Write RED automation tests** for created probe → dispatch → mark dispatched, replayed dispatched/completed → no second dispatch, replayed pending → safe redispatch, disabled/incompatible/actions-disabled → fail-closed revision, and missing workflow → retryable error.
- [ ] **Step 2: Write RED worker test** proving `setup_probe.dispatch` calls `probeSetup` with delivery context and completes the job when the interaction succeeds.
- [ ] **Step 3: Run both focused test files and confirm RED.**
- [ ] **Step 4: Implement `probeSetup`** using `getContextByGitHub`, `githubClient.inspect`, `store.createProbe`, `store.getProbe`, `githubClient.dispatchProbe`, and `store.markProbeDispatched`. Use `requestId(context.deliveryId)` as the idempotency key and a 15-minute expiry; never call `completeProbe` directly.
- [ ] **Step 5: Preserve bounded retries:** throw on `missing` and transport/database failures; leave an ambiguous dispatch probe pending so a worker retry can reuse the same probe ID. For terminal workflow states apply a revision with `configStatus: "unknown"` and return.
- [ ] **Step 6: Wire the interaction in `control-plane-worker.ts` and `apps/web/worker.ts`, then rerun focused tests to GREEN.**
- [ ] **Step 7: Commit** `feat(cloud): auto-dispatch setup probe after merge`.
### Task 4: Verify regression surface, ship, and prove production zero-touch flow

**Files:**
- Test: `tests/unit/web/repository-setup-github.test.ts`
- Test: `tests/unit/web/repository-setup-probe-route.test.ts`
- Test: existing lifecycle/setup suites touched above

- [ ] **Step 1: Run focused cross-layer suite:** lifecycle, setup PR generation, setup GitHub client, setup automation, control-plane worker, and setup-probe callback.
- [ ] **Step 2: Run** root typecheck, Biome on touched files, `git diff --check`, then `corepack pnpm run verify:all` from the exact feature tree.
- [ ] **Step 3: Push and open a PR**; monitor required CI, SonarCloud, security gate, and Mergify auto-queue. Do not add `queue-me` and do not bypass protected main.
- [ ] **Step 4: After merge/release automation settles, deploy the exact latest `origin/main` with normal production `cloud-deploy` (`dry_run=false`) and verify web/worker image revision, health, and disk.
- [ ] **Step 5: Re-run the real test-repo flow** from a clean post-setup state: `/boardreadyops setup` opens a PR whose diff remains allowlisted and whose generated workflow contains `setup-probe`; merge it; verify an automatic probe workflow run posts an OIDC result and production DB becomes `workflowStatus=ready, configStatus=ready` without manual DB writes.
- [ ] **Step 6: Post `/boardreadyops release-preview` on PR #1** and verify the real `issue_comment` webhook completes once, creates an exact-head-SHA readiness Check Run, dispatches the target workflow, and does not publish a tag or GitHub Release.
- [ ] **Step 7: Fresh final verification** of latest main CI/security, production revision/health, E2E DB state, Check Run, and workflow run before declaring completion.
