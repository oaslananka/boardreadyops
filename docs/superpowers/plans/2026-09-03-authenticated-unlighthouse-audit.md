# Authenticated Unlighthouse Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure authenticated production UI audit using Unlighthouse without persisting or leaking the BoardReadyOps browser session.

**Architecture:** A testable Node route-discovery module fetches signed-in server-rendered pages with `brops_session`, allowlists representative product routes, and writes a secret-free manifest. A pinned Unlighthouse config consumes that manifest and cookie at runtime; package scripts and a manual read-only GitHub Actions workflow run the audit and upload a private artifact.

**Tech Stack:** Node.js 24, TypeScript 6, Vitest 4, pnpm 11, Unlighthouse 0.18.0, Puppeteer 25, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-03-authenticated-unlighthouse-audit-design.md`

## Global Constraints

- `BROPS_SESSION` / `BROPS_UNLIGHTHOUSE_SESSION` is ephemeral secret material and must never be written to repository files, manifests, logs, or artifacts.
- Route discovery is same-origin and allowlist-only; query strings and fragments are discarded.
- The workflow is `workflow_dispatch` only with `contents: read` and pinned actions.
- Existing `.github/workflows/lighthouse.yml` and `.lighthouserc.json` behavior stays unchanged.
- Authenticated categories are performance, accessibility, and best-practices with budgets 70/90/85.

---

### Task 1: Authenticated route discovery contract

**Files:**
- Create: `scripts/unlighthouse-auth-routes.mjs`
- Test: `tests/unit/scripts/unlighthouse-auth-routes.test.ts`

**Interfaces:**
- Produces `discoverAuthenticatedRoutes({ site, session, fetchImpl?, now? }): Promise<{ site: string; generatedAt: string; routes: string[] }>`.
- Produces pure helpers `extractHrefPaths`, `isAllowedAuthenticatedPath`, and `buildRepresentativeRoutes` for deterministic unit tests.
- [ ] **Step 1: Write failing route-policy tests**

Cover same-origin extraction, removal of query/fragment, rejection of auth/API/download/cross-origin paths, first representative repository/review/run selection, and synthesis of `/findings`, `/artifacts`, `/attempts`, `/audit`, and `/publication` for the selected run.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `corepack pnpm exec vitest run tests/unit/scripts/unlighthouse-auth-routes.test.ts`
Expected: FAIL because `scripts/unlighthouse-auth-routes.mjs` does not exist.

- [ ] **Step 3: Implement the pure route policy**

Use URL parsing instead of string-prefix trust. Accept only `/dashboard`, `/reviews`, the five approved settings pages, `/repositories/<single-segment-id>`, `/reviews/<single-segment-id>`, and `/runs/<single-segment-id>` route families. Decode HTML `&amp;` in hrefs before URL parsing and deduplicate while preserving discovery order.

- [ ] **Step 4: Add authenticated fetch/fail-closed tests**

Mock `fetchImpl` and assert every seed request sends exactly `Cookie: brops_session=<session>`, a redirect/login outcome is rejected, `/dashboard` must load successfully, HTTP failures name only the path/status, and no thrown message contains the supplied session string.

- [ ] **Step 5: Implement authenticated discovery**

Fetch `/dashboard`, `/reviews`, `/settings/billing`, `/settings/component-intelligence`, `/settings/data`, `/settings/security`, and `/settings/tokens` with `redirect: "manual"`. Treat 3xx, 401, and 403 as authentication failure. Return the secret-free manifest object.

- [ ] **Step 6: Re-run the focused test and confirm GREEN**

Run: `corepack pnpm exec vitest run tests/unit/scripts/unlighthouse-auth-routes.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit the route-discovery slice**

Run: `git add scripts/unlighthouse-auth-routes.mjs tests/unit/scripts/unlighthouse-auth-routes.test.ts && git commit -m "test(web): define authenticated audit route discovery"`

### Task 2: Unlighthouse config and orchestration

**Files:**
- Create: `unlighthouse.auth.config.ts`
- Create: `scripts/unlighthouse-authenticated.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`
- Test: `tests/unit/scripts/unlighthouse-authenticated.test.ts`
**Interfaces:**
- `scripts/unlighthouse-authenticated.mjs` reads `BROPS_SESSION` and optional `BROPS_UNLIGHTHOUSE_SITE`, writes `.unlighthouse/authenticated-routes.json`, then spawns `unlighthouse-ci --config-file unlighthouse.auth.config.ts --build-static`.
- `unlighthouse.auth.config.ts` reads the generated manifest, injects the `brops_session` cookie, and writes reports under `.unlighthouse/authenticated/`.

- [ ] **Step 1: Write failing orchestration tests**

Test missing/blank `BROPS_SESSION`, manifest path creation, child command/arguments, child exit-code propagation, debug-mode argument/environment behavior, and redaction of a sentinel session from stdout/stderr/error messages.

- [ ] **Step 2: Run the focused orchestration test and confirm RED**

Run: `corepack pnpm exec vitest run tests/unit/scripts/unlighthouse-authenticated.test.ts`
Expected: FAIL because the orchestrator/config do not exist.

- [ ] **Step 3: Add the pinned dependency and ignored output**

Run: `corepack pnpm add -D unlighthouse@0.18.0`
Add `/.unlighthouse/` to `.gitignore`. Add scripts `qa:unlighthouse:auth`, `qa:unlighthouse:auth:debug`, and `qa:unlighthouse:auth:routes` without embedding credentials.

- [ ] **Step 4: Implement the config**

Require `BROPS_SESSION`; derive cookie domain from the configured site; read `.unlighthouse/authenticated-routes.json`; set `scanner.device = "desktop"`, `scanner.samples = 1`, `puppeteerClusterOptions.maxConcurrency = 1`, `lighthouseOptions.disableStorageReset = true`, `lighthouseOptions.onlyCategories = ["performance", "accessibility", "best-practices"]`, and CI budgets 70/90/85 with `buildStatic: true`.

- [ ] **Step 5: Implement the orchestration script**

Validate HTTPS for the default production site, permit HTTP only for loopback test sites, call `discoverAuthenticatedRoutes`, atomically write the route manifest, and spawn the local `unlighthouse-ci` binary through pnpm. A `--routes-only` mode stops after discovery; `--debug` enables Unlighthouse debug/headful behavior without persisting browser state.

- [ ] **Step 6: Re-run focused tests and static checks**

Run: `corepack pnpm exec vitest run tests/unit/scripts/unlighthouse-auth-routes.test.ts tests/unit/scripts/unlighthouse-authenticated.test.ts`
Run: `corepack pnpm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit the executable audit slice**

Run: `git add package.json pnpm-lock.yaml .gitignore unlighthouse.auth.config.ts scripts/unlighthouse-authenticated.mjs tests/unit/scripts/unlighthouse-authenticated.test.ts && git commit -m "feat(web): add authenticated Unlighthouse audit"`
### Task 3: Manual authenticated audit workflow

**Files:**
- Create: `.github/workflows/unlighthouse-authenticated.yml`
- Test: `tests/unit/scripts/unlighthouse-authenticated-workflow.test.ts`

**Interfaces:**
- Consumes repository/environment secret `BROPS_UNLIGHTHOUSE_SESSION`.
- Produces a private GitHub Actions artifact named `unlighthouse-authenticated-report` containing only `.unlighthouse/authenticated/` and the secret-free route manifest.

- [ ] **Step 1: Write the failing workflow contract test**

Assert `workflow_dispatch` is present, `pull_request`, `push`, and `schedule` are absent, top-level permissions are exactly `contents: read`, checkout/setup-node/upload-artifact are SHA pinned with `persist-credentials: false`, the audit step maps the secret to `BROPS_SESSION`, and artifact retention is finite.

- [ ] **Step 2: Run the workflow test and confirm RED**

Run: `corepack pnpm exec vitest run tests/unit/scripts/unlighthouse-authenticated-workflow.test.ts`
Expected: FAIL because the workflow does not exist.

- [ ] **Step 3: Implement the workflow**

Use `ubuntu-24.04`, Node `24.20.0`, a 20-minute timeout, concurrency `unlighthouse-authenticated-production`, dependency install through `deps:install-ci`, and `corepack pnpm run qa:unlighthouse:auth`. Fail explicitly when the session secret is blank or expired. Upload the report with the repository's pinned `actions/upload-artifact` SHA and `retention-days: 14`.

- [ ] **Step 4: Verify workflow contracts and repository workflow lint**

Run: `corepack pnpm exec vitest run tests/unit/scripts/unlighthouse-authenticated-workflow.test.ts`
Run: `corepack pnpm run workflow:lint`
Expected: PASS.

- [ ] **Step 5: Commit the workflow slice**

Run: `git add .github/workflows/unlighthouse-authenticated.yml tests/unit/scripts/unlighthouse-authenticated-workflow.test.ts && git commit -m "ci(web): add manual authenticated UI audit"`

### Task 4: Operator documentation and final verification

**Files:**
- Create: `docs/development/authenticated-ui-audit.md`
- Modify: `docs/superpowers/specs/2026-09-03-authenticated-unlighthouse-audit-design.md`
- Modify: `docs/superpowers/plans/2026-09-03-authenticated-unlighthouse-audit.md`

**Interfaces:**
- Documents local cookie acquisition, PowerShell/bash invocation, route-only debugging, report location, manual workflow secret refresh, and the explicit boundary that no real production scan can run without a valid current session.
- [ ] **Step 1: Write the operator guide**

Document Chrome DevTools → Application → Cookies → `brops_session`, shell-only environment assignment, `corepack pnpm run qa:unlighthouse:auth`, `qa:unlighthouse:auth:routes`, and `qa:unlighthouse:auth:debug`. State that the session expires after the application's normal browser-session lifetime and must never be committed or pasted into issue/PR text.

- [ ] **Step 2: Run a synthetic authenticated end-to-end fixture**

Start a local HTTP fixture server that requires `brops_session=test-session`, serves dashboard/repository/run/review links, and exposes the synthesized run subroutes. Run the route discovery/orchestrator against loopback with the sentinel session and assert the manifest includes the intended routes while repository grep confirms the sentinel never appears in tracked/untracked report files.

- [ ] **Step 3: Run repository verification**

Run: `corepack pnpm run lint`
Run: `corepack pnpm run typecheck`
Run: `corepack pnpm run workflow:lint`
Run: `corepack pnpm run verify:structure`
Run: `corepack pnpm run test:unit`
Run: `corepack pnpm run security`
Run: `git diff --check`
Expected: all PASS.

- [ ] **Step 4: Verify Unlighthouse CLI/config wiring without a production secret**

Run: `corepack pnpm exec unlighthouse-ci --version`
Run the local synthetic authenticated fixture through `qa:unlighthouse:auth:routes`; if Chrome is available, run one full loopback Unlighthouse scan and confirm a static report is generated under `.unlighthouse/authenticated/`.

- [ ] **Step 5: Commit documentation and plan/spec**

Run: `git add docs/development/authenticated-ui-audit.md docs/superpowers/specs/2026-09-03-authenticated-unlighthouse-audit-design.md docs/superpowers/plans/2026-09-03-authenticated-unlighthouse-audit.md && git commit -m "docs(web): document authenticated UI audits"`

- [ ] **Step 6: Push and open PR**

Push `feat/authenticated-unlighthouse-audit`, open a PR describing the credential boundary and exact verification evidence, then add `queue-me` only after required checks are green.

- [ ] **Step 7: Merge and post-merge verify**

Let Mergify perform the normal squash merge. Verify `mergedBy` is `app/mergify`, the merge SHA is on `origin/main`, main CI/security workflows are healthy for the resulting SHA, and the existing public Lighthouse workflow remains unchanged.

- [ ] **Step 8: Production runtime audit when a valid session exists**

If `BROPS_UNLIGHTHOUSE_SESSION` is currently configured and valid, dispatch the manual workflow and inspect the uploaded authenticated report. If not, record only this runtime evidence step as externally blocked; do not mint or recover a production user session from signing keys or browser credential stores.
