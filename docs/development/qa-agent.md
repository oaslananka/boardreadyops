# QA / E2E agent guide

This is the operating manual for `tests/e2e/`, `qa/audit/`, and the Playwright infrastructure
around them. It's written for a coding agent picking up this repo cold, not just a human
contributor — read this before exploring the app manually.

## Why this exists

Before this infrastructure, checking BoardReadyOps' UI required manually clicking through every
route. That's how the 2026-09-01 UI/UX audit findings (policy bypass, fake persistence, broken
focus management, 404s, duplicated titles...) got found by hand, one route at a time. This
system turns that into `pnpm qa:audit` — one command that checks every known route, every
critical viewport, for the failure classes that audit found, and reports actionable findings
instead of requiring someone to notice them.

`tests/unit/web/*.test.ts` (axe-core against `renderToStaticMarkup`/`happy-dom`) already covers
component-level accessibility and behavior; this layer exists for what only a real browser can
catch: actual hydration timing, real navigation and URL state, real computed CSS (contrast,
overflow, touch target size), and cross-page link integrity.

## Quick reference

| Command | What it does | When to run it |
| --- | --- | --- |
| `pnpm qa:smoke` | Desktop-only, critical-route subset of the audit | Every PR (also runs in CI) |
| `pnpm qa:audit` | Full route audit, 3 viewports (375/768/1440), one browser | Before a UI-heavy PR, or `pnpm qa` |
| `pnpm qa:e2e` | Review lifecycle, modal contract, tabs contract, regression suite | After touching review/modal/tab UI |
| `pnpm qa:a11y` | Just the axe pass from the audit, desktop, critical routes | Quick accessibility check |
| `pnpm qa:visual` | Screenshot regression against `tests/e2e/*-snapshots/` | After a visual change |
| `pnpm qa:visual:update` | Regenerates visual baselines | **Only** after reviewing the diff yourself |
| `pnpm qa:cross-browser` | Full audit + qa:e2e across Chromium/Firefox/WebKit | Nightly (also `qa-nightly.yml`) |
| `pnpm qa:route-coverage` | Fails if a `page.tsx` has no `qa/audit/routes.ts` entry | Runs as part of `qa:audit`'s file set |
| `pnpm qa:production-smoke` | Read-only synthetic checks against a real deployment | Manually, with `PLAYWRIGHT_BASE_URL` set |
| `pnpm qa:typecheck` | Type-checks `tests/e2e/**` and `qa/**` | Part of `pnpm run typecheck` already |

`pnpm test:e2e` (pre-existing) still runs the whole `tests/e2e/` directory with no filtering —
useful for "run literally everything once" locally, not for CI (too slow for a PR gate).

## Authenticated tests

`tests/e2e/global-setup.ts` mints a signed `brops_session` cookie directly — no live GitHub
OAuth round trip — using `encodeUserSession()` from `apps/web/lib/user-session.ts`, the exact
function the real callback route uses. It needs a `QA_SESSION_SECRET` (or `SESSION_SECRET`) of
at least 32 characters in the environment you invoke `pnpm qa:*` from; `playwright.config.ts`
forwards it to the dev server it starts, and falls back to a fixed local-only placeholder if
neither is set, so local runs work out of the box. In CI, set a real secret via repository
variables if you want the authenticated storageState to actually get written — otherwise
`global-setup.ts` logs a warning and authenticated specs fall back to running signed out.

A spec that needs to be signed in does:

```ts
import { authenticatedStorageState } from "./fixtures/auth.js";

test.use({ storageState: authenticatedStorageState });
```

This session has **no GitHub App installations** (`installationIds: []`), so it satisfies
routes that only check "is someone signed in" (Policies, My Work, Settings). It does **not**
unlock `/dashboard` or `/repositories/:id` — those also need `DATABASE_URL` pointed at a
Postgres instance with a real installation/repository seeded, because
`apps/web/lib/repository-dashboard.ts`'s `loadRepositoryDetail()` has no demo fallback at all
(see `qa/audit/routes.ts`'s `requiresDb`/`skipWithoutDb` flags — those routes are skipped, not
faked, when `DATABASE_URL` isn't set). Standing up that seeded Postgres tenant for full
authenticated DB-backed E2E is intentionally **not** built by this infrastructure yet — see
"What's not done" below.

## Adding a route

1. Add the `page.tsx`.
2. Add an entry to `qa/audit/routes.ts` (`id`, `path` with fixture ids already substituted,
   `auth`, `requiresDb`). `pnpm qa:route-coverage` fails the build otherwise — that's
   deliberate, matching the task's "route exists but has no coverage" requirement.
3. If it's a route worth a screenshot baseline, add its `id` to `visualRoutes` in the same file
   and run `pnpm qa:visual:update` once, then commit the new `.png`.

## Adding a new component/interaction state

- If it's a **modal/dialog**, run it through `expectDialogContract()` from
  `qa/audit/dialog-contract.ts` (see `tests/e2e/modal-contract.spec.ts` for the pattern) — it
  checks the same WAI-ARIA dialog contract (initial focus, focus trap, Escape, focus restore)
  every modal in this app is expected to satisfy.
- If it's a **tab pattern**, mirror `tests/e2e/tabs-contract.spec.ts`: roving tabindex, arrow
  keys, URL-backing, back/forward.
- Otherwise, a targeted `test()` in the relevant spec file is usually enough. Don't reach for a
  Page Object abstraction for a one-off interaction — see "Test quality" below.

## Updating visual baselines

`pnpm qa:visual:update` overwrites `tests/e2e/*-snapshots/*.png`. **Never** run this to make a
failing CI run pass without first opening the diff (`playwright show-report` after a failed run
shows before/after/diff images) and confirming the change is the *intended* UI change, not a
regression. Commit baseline updates in the same PR as the UI change that caused them, with a
one-line note on why in the commit message.

Playwright names snapshots per-OS (`<id>-chromium-<platform>.png`). The baselines currently
committed were generated on Windows (`-win32`) because this repo's dev environment has no
Docker/Linux available. `qa-nightly`'s `visual` job runs on `ubuntu-24.04`, so its **first** run
will fail with "no baseline found" for every route -- expected, not a regression. To fix: run
`qa-nightly` once (`workflow_dispatch`), download the `qa-visual-diffs` artifact from the failed
run (already wired up via `actions/upload-artifact` on failure), copy the `-chromium-linux.png`
actual-screenshot files it contains into `tests/e2e/visual.spec.ts-snapshots/`, review them, and
commit. After that one-time step, both the Windows and Linux baselines are present and the job
diffs normally on every subsequent run.

## Inspecting a failure

Every CI run uploads `playwright-report/` as an artifact (`ci / qa-e2e` on PRs,
`qa-nightly-report-<browser>` nightly). Locally:

```bash
pnpm exec playwright show-report
```

opens the last HTML report — timeline, screenshots on failure, and (on retry) a full trace you
can step through frame by frame with `pnpm exec playwright show-trace <trace.zip>`.

## Exploratory / agent-driven QA (Playwright MCP)

There's no `--agent` CLI flag in the installed Playwright version (1.55.1) for the
Planner/Generator/Healer workflow the original task envisioned — that's a separate, newer
Playwright feature this repo doesn't currently depend on. The practical equivalent, wired up
here, is **Playwright MCP** (`.mcp.json` at the repo root, `npx @playwright/mcp@latest`): any
MCP-capable coding agent (Claude Code, etc.) opened in this repo can drive a real browser
directly — navigate, read the accessibility tree, click, fill forms, screenshot — without
writing a script first.

The intended agent workflow:

1. **Explore.** Use the Playwright MCP browser tools to navigate to the route/state in question
   against `pnpm dev` (or let Playwright's own `webServer` start one). Read the accessibility
   tree and DOM rather than guessing from the source.
2. **Generate.** Once you've confirmed the expected behavior by hand, write it as a real
   Playwright Test spec under `tests/e2e/` — `getByRole`/`getByLabel` selectors, no
   `waitForTimeout` sleeps where an assertion-based wait will do (see "No flaky tests" below).
   Add the route to `qa/audit/routes.ts` if it's new.
3. **Heal.** When an existing spec starts failing, don't loosen the assertion. Run it with
   `--debug` or inspect its trace, confirm whether the app changed on purpose or regressed, and
   either update the spec to match an intended change (with the same review discipline as a
   visual baseline update) or fix the regression.

## Production synthetic monitoring

`tests/e2e/production-smoke.spec.ts` + `playwright.production.config.ts` — read-only checks
against a real deployed instance:

```bash
PLAYWRIGHT_BASE_URL=https://boardreadyops.com pnpm run qa:production-smoke
```

`playwright.production.config.ts` refuses to run at all without `PLAYWRIGHT_BASE_URL` set (no
default that could accidentally point at production), has no `webServer` (it's not starting a
local instance), and every test in that file only performs GET/navigation checks —
`qa/audit/production-guard.ts`'s `guardProductionSafety()` is called at the top of the file as a
standing marker that nothing in it may mutate production state. If you ever add a check that
needs to write anything, it cannot go in this file.

This suite is structured to be portable to Checkly or similar synthetic-monitoring platforms
later — each `test()` is self-contained with no shared mutable state between them, matching how
a browser-check platform runs them. No Checkly account is configured in this repo; this is the
local/CI equivalent until one is.

## Cross-browser

`playwright.config.ts` only defines the `chromium` project by default (PRs stay fast). Setting
`QA_CROSS_BROWSER=1` (which `pnpm qa:cross-browser` does via `scripts/qa-cross-browser.mjs` —
a small Node wrapper rather than `cross-env`, since this repo avoids adding a dependency for one
script and needs it to work on Windows too) also defines `firefox` and `webkit` projects. BrowserStack
isn't configured — `use: { ...devices[...] }` from `@playwright/test` is what each project uses, so
pointing a project at BrowserStack's remote Chromium/Safari/Edge later is a `connectOptions`
change to `playwright.config.ts`, not a rewrite; see
[Playwright's BrowserStack guide](https://playwright.dev) if that becomes necessary.

## Visual regression: native Playwright only

`tests/e2e/visual.spec.ts` uses `expect(page).toHaveScreenshot()` — no Chromatic/Percy
dependency. If Storybook is added later (see "What's not done"), Chromatic pairs naturally with
it; if a different SaaS is chosen, make sure it isn't just duplicating what this file already
covers.

## No flaky tests

- Selectors: `getByRole` / `getByLabel` first, `getByText` when there's no better role, a
  `data-testid`/class selector only when nothing semantic exists (a few already do, matching
  what's on the actual DOM — e.g. `.finding-triage-card`, `.disposition-select`).
- No `waitForTimeout` as a substitute for an assertion. The few `waitForTimeout` calls that
  exist in this suite (e.g. after opening a review) wait out a known post-hydration settle
  window documented inline, not a guess at how long an async operation takes — prefer a
  `waitFor({ state: "visible" })` or `expect(...).toBeVisible()` instead when you can.
- Fixture ids (`qa/audit/routes.ts`'s `demoReviewId`, `demoRunId`) are stable, checked-in
  constants, not generated per run — see "What's not done" for the larger seeded-tenant gap
  this doesn't yet solve for authenticated/DB-backed routes.

## Test quality

- One helper function reused 3+ times earns a shared home in `qa/audit/`; a one-off
  interaction stays inline in its spec.
- No Page Object Model layer — this app's DOM is stable enough (and Playwright's locators
  already lazy-resolve) that POM would be an abstraction with no real payoff yet. Revisit if
  spec files start duplicating the same 10-line interaction verbatim.
- Assert the actual outcome (a value changed, a request was made, state survived reload), not
  just "the element became visible" where a stronger assertion is available for free.

## Security

- `tests/e2e/.auth/` (storageState with the signed test session) is gitignored — never commit it.
- The QA session (`global-setup.ts`) carries a synthetic `userId`/`login`, never a real
  credential, and is signed with a secret you provide, not one baked into the repo.
- `qa/audit/checks.ts`'s console-error allowlist is a short, exact-substring list, on purpose —
  broadening it to a prefix or regex defeats the point of catching real console errors.
- Production-facing tests are read-only by construction (see above); there is no code path in
  this infrastructure that can mutate `https://boardreadyops.com`.

## What's not done

Built deliberately, not by accident — see the setup task's own instruction not to make large
unrelated changes while standing this up:

- **Seeded Postgres QA tenant** (task section 5): the ~30 repository/review/run/policy fixture
  combinations the original task describes need real rows in a disposable Postgres database,
  not just the existing `DEMO_REVIEWS`/`buildDemoRun` in-memory fixtures this suite reuses.
  `docker-compose.yml` under `deploy/` and the `DATABASE_URL=postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_toolchain`
  convention already used by `test:int` are the natural starting point for that follow-up; it's
  sized as its own task, not a quick addition here.
- **Playwright Test Agents** (Planner/Generator/Healer as a native feature): not available in
  the installed Playwright version; Playwright MCP (above) is the practical substitute wired up
  in this pass.
- **Storybook**: evaluated, not added. `tests/unit/web/*.test.ts` (axe + `renderToStaticMarkup`)
  and this E2E layer already give the state-heavy components listed in the original task
  (ApprovalModal, FindingsTab, etc.) real coverage in the context they actually render in; a
  component gallery would add value for isolated visual QA and design review, but is a
  standalone toolchain addition (new build config, new CI job, dozens of story files) better
  scoped as its own task than folded into this one.
- **Lighthouse CI**: see `.github/workflows/lighthouse.yml` and `.lighthouserc.json` — wired up
  for a handful of key routes, accessibility regressions fail the run, performance/best-practices/SEO
  are warn-level baselines rather than a score target, per the original task's explicit
  "don't chase Lighthouse scores" instruction.
- **Checkly**: documented above as the migration target for `production-smoke.spec.ts`, not
  integrated — no account/credentials available in this environment.
- **Real authenticated-session coverage in `qa:audit`**: without `QA_SESSION_SECRET` configured
  (the default locally), `auth: "authenticated"` routes run signed out, and `qa/audit/checks.ts`
  allowlists the resulting "responded with a status of 401" console errors as expected fail-closed
  behavior. That allowlist entry would also hide a *real* session-plumbing regression if a secret
  *is* configured and an authenticated route still 401s — CI/nightly should set the secret and
  someone should periodically confirm the audit still passes with it set, since this local pass
  never exercised that path.
- **Visual baselines are Windows-only** (`-win32` suffix); see "Updating visual baselines" above
  for the one-time step to add the Linux (`-linux`) baselines `qa-nightly`'s Ubuntu runner needs.
