# Premium Product UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the authenticated BoardReadyOps shell, dashboard, and run detail feel like a restrained precision-engineering control room without changing backend, auth, or run semantics.

**Architecture:** Preserve existing server loaders, routes, `AppShell`, `StatusBadge`, and accessible HTML. Reconcile the current Foundry/`--bro-*` CSS into one semantic graphite + identity-brass system, add one section-style `Panel` presentation, derive dashboard metrics from existing repository groups, and tighten the run first viewport and summary hierarchy.

**Tech Stack:** Next.js App Router, React server/client components, TypeScript, CSS custom properties, Vitest, happy-dom, axe-core, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-03-premium-product-ui-design.md`

## Global Constraints

- Keep Inter and JetBrains Mono; add no font or UI-framework dependency.
- Identity brass is brand/selection/focus only; success/warning/danger/info retain functional meaning.
- Do not invent backend metrics, trends, organization selectors, environment selectors, or release claims.
- Preserve auth, routing, repository authorization, run semantics, source-of-truth wording, skip links, focus restoration, and semantic tables.
- Desktop density targets 4/8/12/16/24/32/48px equivalents; common panel radius 8–10px; persistent shadows are removed from operational surfaces.
- Keep the existing mobile drawer and horizontal table/tab overflow behavior.
- Public landing-page behavior and metadata are out of scope.

---
### Task 1: Reconcile the visual foundation and section primitive

**Files:**
- Modify: `apps/web/app/styles.css`
- Modify: `apps/web/components/ui.tsx`
- Test: `tests/unit/web/foundry-ui-contract.test.ts`
- Test: `tests/unit/web/run-design-system.test.ts`

**Interfaces:**
- Consumes: existing `Panel({ title, description, actions, id, tone })`, existing `--bro-*` and status tokens.
- Produces: `PanelTone` includes `section`; `.surface-section` is transparent/flat; `--bro-accent*` and interactive selection aliases resolve to identity brass while `--success`, `--warning`, `--danger`, and `--info` stay status colors.

- [x] **Step 1: Write the failing visual-contract tests**

```ts
expect(css).toContain("--bro-accent: #c69a3e");
expect(css).toContain("--bro-focus: #d9b563");
expect(css).toContain(".surface-section");
expect(css).toMatch(/\.surface-section\s*\{[^}]*background:\s*transparent/su);
expect(css).not.toMatch(/\.panel\s*\{[^}]*box-shadow:\s*var\(--bro-shadow-soft\)/su);
```

Render `Panel tone="section"` and assert it retains `<section>` plus `aria-labelledby` while using `surface-section`.

- [x] **Step 2: Run focused tests and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/web/foundry-ui-contract.test.ts tests/unit/web/run-design-system.test.ts`
Expected: FAIL because brass is not the interactive accent and `surface-section` does not exist.

- [x] **Step 3: Implement the minimal token and primitive changes**

Set the authenticated semantic accent/focus aliases to identity brass, keep info blue independent, remove persistent panel shadows, normalize body operational density, and add `"section"` to `PanelTone` with flat section CSS. Do not change status mappings.
- [x] **Step 4: Verify GREEN and regressions**

Run: `corepack pnpm exec vitest run tests/unit/web/foundry-ui-contract.test.ts tests/unit/web/run-design-system.test.ts tests/unit/web/theme-contrast.test.ts`
Expected: PASS with WCAG contrast checks unchanged for functional status colors.

- [x] **Step 5: Commit**

```bash
git add apps/web/app/styles.css apps/web/components/ui.tsx tests/unit/web/foundry-ui-contract.test.ts tests/unit/web/run-design-system.test.ts
git commit -m "feat(web): refine premium design foundation"
```

### Task 2: Tighten the application shell and navigation hierarchy

**Files:**
- Modify: `apps/web/components/product-navigation.tsx`
- Modify: `apps/web/components/ui.tsx`
- Modify: `apps/web/app/styles.css`
- Test: `tests/unit/web/product-navigation.test.ts`
- Test: `tests/unit/web/product-app-accessibility.test.ts`

**Interfaces:**
- Consumes: `ProductNavigation({ viewerNav })`, `AppShell({ children, viewerNav })`.
- Produces: navigation groups `Overview`, `Engineering`, `Governance`, `Manage`; a useful static product context bar containing only truthful product-level context; unchanged compact/mobile behavior.

- [x] **Step 1: Write the failing navigation and shell tests**

```ts
expect(markup).toContain("Overview");
expect(markup).toContain("Engineering");
expect(markup).toContain("Governance");
expect(markup).toContain("Manage");
expect(markup.indexOf("Dashboard")).toBeLessThan(markup.indexOf("My Work"));
expect(markup).not.toContain("Workspace");
expect(markup).not.toContain("Administration");
```

Add an `AppShell` static-render assertion for `BoardReadyOps Cloud` and `Engineering operations`, and ensure no fake `Production`, organization, or environment selector copy is introduced.
- [x] **Step 2: Run focused tests and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/web/product-navigation.test.ts tests/unit/web/product-app-accessibility.test.ts`
Expected: navigation test FAILS on the old group names/order; accessibility remains a guardrail.

- [x] **Step 3: Implement the minimal shell changes**

Reorder existing destinations without adding routes. Keep `Reviews` under Engineering; keep repository work reachable from Dashboard rather than adding a dead `/repositories` index route. Replace the one-line context kicker with a two-part product context treatment. Tighten rail/header/page-frame CSS, remove the rail shadow, and retain mobile drawer/focus behavior unchanged.

- [x] **Step 4: Verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/web/product-navigation.test.ts tests/unit/web/product-app-accessibility.test.ts`
Expected: PASS, including compact persistence and WCAG A/AA assertions.

- [x] **Step 5: Commit**

```bash
git add apps/web/components/product-navigation.tsx apps/web/components/ui.tsx apps/web/app/styles.css tests/unit/web/product-navigation.test.ts tests/unit/web/product-app-accessibility.test.ts
git commit -m "feat(web): tighten product shell hierarchy"
```

### Task 3: Add an honest operational dashboard summary

**Files:**
- Modify: `apps/web/lib/repository-dashboard.ts`
- Modify: `apps/web/app/dashboard/page.tsx`
- Modify: `apps/web/app/styles.css`
- Test: `tests/unit/web/repository-dashboard-unit.test.ts`
- Create: `tests/unit/web/dashboard-page-contract.test.ts`

**Interfaces:**
- Consumes: `RepositoryGroup[]` from `loadViewerRepositories`.
- Produces: `summarizeViewerRepositories(groups): DashboardRepositorySummary` with `{ repositories, repositoriesWithOpenFindings, supplyAlerts, repositoriesWithoutRuns, watchedBoards }`.

- [ ] **Step 1: Write the failing summary behavior test**

```ts
const summary = summarizeViewerRepositories([{ accountLogin: "acme", repositories: [
  { id: "a", accountLogin: "acme", owner: "acme", name: "power", private: true,
    latestRunId: "run-1", latestRunStatus: "completed", latestRunDecision: "pass", latestRunAt: "2026-09-03T00:00:00Z",
    openFindings: 3, watchedBoards: 2, openSupplyFindings: 1 },
  { id: "b", accountLogin: "acme", owner: "acme", name: "sensor", private: false,
    latestRunId: undefined, latestRunStatus: undefined, latestRunDecision: undefined, latestRunAt: undefined,
    openFindings: 0, watchedBoards: 1, openSupplyFindings: 0 },
]}]);
expect(summary).toEqual({ repositories: 2, repositoriesWithOpenFindings: 1, supplyAlerts: 1, repositoriesWithoutRuns: 1, watchedBoards: 3 });
```
- [ ] **Step 2: Add the failing dashboard markup contract**

Assert `dashboard/page.tsx` uses `summarizeViewerRepositories`, renders an `operational-summary` region before repository group tables, labels the derived values without trends, and uses `Panel tone="section"` for repository groups.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/web/repository-dashboard-unit.test.ts tests/unit/web/dashboard-page-contract.test.ts`
Expected: FAIL because the summarizer and operational summary markup do not exist.

- [ ] **Step 4: Implement the minimal dashboard behavior and presentation**

Add the pure summarizer beside `RepositoryGroup`. In `DashboardPage`, calculate the summary only from loaded groups and render compact metrics for Repositories, Repositories with findings, Supply alerts, No run yet, and Boards watched. Keep signed-out and empty states unchanged. Render organization groups as flat sections and preserve the accessible repository table.

- [ ] **Step 5: Verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/web/repository-dashboard-unit.test.ts tests/unit/web/dashboard-page-contract.test.ts tests/unit/web/product-app-accessibility.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/repository-dashboard.ts apps/web/app/dashboard/page.tsx apps/web/app/styles.css tests/unit/web/repository-dashboard-unit.test.ts tests/unit/web/dashboard-page-contract.test.ts
git commit -m "feat(web): add operational dashboard summary"
```

### Task 4: Recompose the run signature viewport and summary

**Files:**
- Modify: `apps/web/components/run-investigation.tsx`
- Modify: `apps/web/app/styles.css`
- Test: `tests/unit/web/run-dashboard-page.test.ts`
- Test: `tests/unit/web/run-investigation-accessibility.test.ts`
- Test: `tests/unit/web/run-design-system.test.ts`

**Interfaces:**
- Consumes: existing `RunDetail`, `runVerdict(run)`, `RunStateNotice`, `Panel tone="section"`.
- Produces: compact `RunHeader`; mono `run-identity-meta`; readiness signature block; flat tab strip; section-style summary/source areas while preserving all links and evidence.

- [ ] **Step 1: Write the failing first-viewport hierarchy tests**

```ts
const markup = viewMarkup("summary");
expect(markup).toContain('class="run-identity-meta"');
expect(markup).toContain('class="run-readiness-signature"');
expect(markup.indexOf("Ready to fabricate")).toBeLessThan(markup.indexOf('aria-label="Run investigation"'));
expect(markup.indexOf('aria-label="Run investigation"')).toBeLessThan(markup.indexOf("Source and runtime"));
expect(markup).not.toContain("Decision: Pass");
```

Also assert the source and run-summary containers use `surface-section`, while Findings/Artifacts can remain bounded panels because they are distinct drill-down summaries.
- [ ] **Step 2: Run focused tests and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/web/run-dashboard-page.test.ts tests/unit/web/run-investigation-accessibility.test.ts tests/unit/web/run-design-system.test.ts`
Expected: FAIL on the new hierarchy/classes while existing axe coverage remains a guardrail.

- [ ] **Step 3: Implement the minimal run recomposition**

Change `RunHeader` markup so repository privacy is secondary text, run/commit/ref identity is a compact mono metadata line, and readiness uses `run-readiness-signature`. Keep the verdict immediately after the header and before navigation. Change `Run summary` and `Source and runtime` to `Panel tone="section"`, leaving truly distinct evidence/action panels bounded.

- [ ] **Step 4: Tighten run CSS without changing semantics**

Remove the hero-card gradient/large shadow, cap repository title near 26px on desktop, reduce header padding, render readiness as a compact brass-framed signature, and make `.run-navigation` a border-bottom tab strip with no enclosing card background or shadow. Preserve horizontal overflow and focus-visible rules.

- [ ] **Step 5: Verify GREEN and update snapshots intentionally**

Run: `corepack pnpm exec vitest run tests/unit/web/run-dashboard-page.test.ts tests/unit/web/run-investigation-accessibility.test.ts tests/unit/web/run-design-system.test.ts -u`
Expected: PASS; snapshot changes are limited to intended hierarchy/class changes and preserved evidence content.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/run-investigation.tsx apps/web/app/styles.css tests/unit/web/run-dashboard-page.test.ts tests/unit/web/run-investigation-accessibility.test.ts tests/unit/web/run-design-system.test.ts tests/unit/web/__snapshots__/run-investigation-accessibility.test.ts.snap
git commit -m "feat(web): refine run investigation hierarchy"
```
### Task 5: Prove responsive, accessible, and visually coherent behavior

**Files:**
- Modify only if a regression is found: target files from Tasks 1–4.
- Test: existing `tests/unit/web/product-app-accessibility.test.ts`
- Test: existing `tests/unit/web/run-investigation-accessibility.test.ts`
- Temporary verification artifact only: `TEMP/premium-ui-preview.*` (never commit).

**Interfaces:**
- Consumes: final shell/dashboard/run markup and CSS.
- Produces: evidence that desktop/mobile structure, focus, status semantics, and the intended visual hierarchy hold without requiring production credentials.

- [ ] **Step 1: Run all focused product UI tests**

Run:
```bash
corepack pnpm exec vitest run tests/unit/web/foundry-ui-contract.test.ts tests/unit/web/product-navigation.test.ts tests/unit/web/repository-dashboard-unit.test.ts tests/unit/web/dashboard-page-contract.test.ts tests/unit/web/run-dashboard-page.test.ts tests/unit/web/run-investigation-accessibility.test.ts tests/unit/web/product-app-accessibility.test.ts tests/unit/web/run-design-system.test.ts tests/unit/web/theme-contrast.test.ts
```
Expected: PASS.

- [ ] **Step 2: Create a temporary static preview from real components**

Use `renderToStaticMarkup` with representative repository/run fixtures already present in tests, include the real `apps/web/app/styles.css`, and serve the generated HTML only on loopback. Do not add preview code to production or commit `TEMP/` files.

- [ ] **Step 3: Capture desktop and mobile screenshots with the repository Chrome**

Capture at 1440×1000 and 390×844. Inspect for: no clipping, compact first viewport, readable brass selection, functional status colors, section hierarchy instead of card soup, horizontally usable tables/tabs, and no accidental marketing-page styling changes.
- [ ] **Step 4: Fix any visual defect through a new RED→GREEN regression**

If clipping, focus loss, contrast, or hierarchy regressions appear, add the smallest structural/CSS test that fails for that defect before changing production CSS/markup. Re-run the focused suite and recapture only the affected viewport.

- [ ] **Step 5: Commit any verification-driven fix**

```bash
git add <only files changed by the regression fix>
git commit -m "fix(web): polish premium product UI"
```

Skip this commit when no defect is found.

### Task 6: Canonical verification, PR, Mergify, deploy, and production audit

**Files:**
- No planned source changes; failures discovered here get their own TDD fix and commit.

**Interfaces:**
- Consumes: complete feature branch.
- Produces: merged `main`, green canonical gates, deployed authenticated product, and post-deploy audit evidence.

- [ ] **Step 1: Refresh the base before final verification**

Run: `git fetch origin main` and compare `git merge-base HEAD origin/main` with `origin/main`. If main advanced, rebase the isolated branch, resolve only feature-branch conflicts, and rerun focused tests.

- [ ] **Step 2: Run repository verification**

Run in order:
```bash
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run verify:structure
corepack pnpm run test:unit
corepack pnpm run security
corepack pnpm run verify
git diff --check
```
Expected: all green; generated tracked files remain deterministic.
- [ ] **Step 3: Push and open one coherent PR**

Push `feat/premium-product-ui`, open a conventional PR describing the design intent, data/auth non-changes, visual verification, accessibility evidence, and canonical verification results. Do not split shell/token/dashboard/run changes into separate PRs.

- [ ] **Step 4: Repair CI autonomously until required gates are green**

For every failure, reproduce locally where practical, identify root cause, add a regression test when behavior changes, commit, push, and repeat. Do not bypass ruleset, security, dependency, or accessibility gates.

- [ ] **Step 5: Merge through Mergify only**

After the required ruleset contexts are SUCCESS, add `queue-me`. Verify `Mergify Merge Queue`, queue rule, and Summary all succeed and confirm the PR is merged by `app/mergify`.

- [ ] **Step 6: Verify exact main SHA and deploy**

Confirm `origin/main` equals the Mergify squash SHA and its `ci` and `security` push workflows complete successfully. Because this feature changes authenticated product presentation, trigger the normal `cloud-deploy` workflow for that exact main SHA and verify deployment success.

- [ ] **Step 7: Run post-deploy authenticated UI audit when the session secret is still valid**

Dispatch `.github/workflows/unlighthouse-authenticated.yml` on `main`. If `BROPS_UNLIGHTHOUSE_SESSION` has expired, report that single external credential boundary rather than weakening auth or minting a session. When valid, require the authenticated audit workflow to complete SUCCESS and retain its artifact according to the existing workflow policy.

- [ ] **Step 8: Final evidence report**

Report merge SHA, deployment run, main CI/security status, authenticated audit status, focused/full test counts, and any intentional follow-up scope (reviews/findings/repository/settings/PCB canvas) without claiming those later phases are complete.
