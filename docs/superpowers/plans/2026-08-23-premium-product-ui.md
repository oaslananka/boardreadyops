# Premium Product UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the BoardReadyOps marketing, repository setup, run-investigation, and shared application states into one premium engineering-control-room design system without changing backend, API, or GitHub App contracts.

**Architecture:** Keep the existing Next.js App Router and server-rendered React structure. Consolidate visual tokens in `apps/web/app/styles.css`, keep landing-specific composition rules in `apps/web/app/landing.css`, and evolve existing `AppShell`, `Panel`, `Alert`, status, setup, and run components rather than introducing a new UI framework. Visual changes are CSS/SVG/semantic-markup driven; data loading and route contracts remain unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS, Vitest, happy-dom, axe-core, Puppeteer/Chrome via the repository toolchain.

**Spec:** `docs/superpowers/specs/2026-08-23-premium-ui-docs-design.md`

## Global Constraints

- Preserve existing API, GitHub App permission, setup, run, and data contracts.
- No large UI framework or animation dependency.
- Prefer server-rendered React, CSS, and inline/reusable SVG.
- No fabricated customer logos, metrics, testimonials, or usage claims.
- Keep keyboard navigation, visible focus, WCAG A/AA, reduced-motion, and responsive behavior first-class.
- Monospace is reserved for evidence, IDs, checks, code, and machine-readable values.
- Do not make evidence-heavy run pages load more data for visual purposes.
- No database schema change or destructive migration.
- Keep `docs.boardreadyops.com` delivery work in the separate docs plan.

---

## File structure

- `apps/web/app/styles.css` — shared product tokens, shell, primitives, setup, run, and state styling.
- `apps/web/app/landing.css` — landing-only composition and decorative hardware atmosphere; consumes shared tokens.
- `apps/web/app/page.tsx` — premium marketing composition using real BoardReadyOps capability copy.
- `apps/web/app/setup/page.tsx` — guided repository-setup journey using existing setup data/contracts.
- `apps/web/app/runs/[runId]/{loading,error,not-found}.tsx` — premium shared run states without changing behavior.
- `apps/web/components/brand-mark.tsx` — existing QFP-chip identity; no new brand dependency.
- `apps/web/components/ui.tsx` — shared shell and primitives.
- `apps/web/components/run-investigation.tsx` — evidence-control-room hierarchy; existing data contracts unchanged.
- `tests/unit/web/app-shell.test.ts` — new structural contract for the shared shell.
- `tests/unit/web/home-page.test.ts` — landing product/CTA/navigation contracts.
- `tests/unit/web/repository-setup-page.test.ts` — setup journey and accessibility contracts.
- `tests/unit/web/run-design-system.test.ts` — token/contrast/focus/reduced-motion contract.
- `tests/unit/web/run-investigation-accessibility.test.ts` — run semantic/accessibility/snapshot coverage.
- `tests/unit/web/run-state-pages.test.ts` — new loading/error/not-found structural contract.

### Task 1: Unify the shared visual token system and AppShell

**Files:**
- Modify: `apps/web/app/styles.css`
- Modify: `tsconfig.json`
- Modify: `apps/web/tsconfig.json`
- Modify: `apps/web/components/ui.tsx`
- Modify: `apps/web/components/brand-mark.tsx`
- Modify: `tests/unit/web/brand-mark.test.ts`
- Create: `tests/unit/web/app-shell.test.ts`
- Modify: `tests/unit/web/run-design-system.test.ts`
- Modify: `tests/unit/web/__snapshots__/run-investigation-accessibility.test.ts.snap`

**Interfaces:**
- Consumes: `BrandMarkLockup` from `apps/web/components/brand-mark.tsx`.
- Produces: shared `--bro-*` color/elevation/motion tokens; the existing `AppShell({ children })` signature remains unchanged.

- [ ] **Step 1: Write the failing shared-shell test**

Create `tests/unit/web/app-shell.test.ts`:

```ts
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "../../../apps/web/components/ui.js";

describe("AppShell", () => {
  it("uses the BoardReadyOps brand lockup and stable global destinations", () => {
    const markup = renderToStaticMarkup(
      <AppShell>
        <main id="main-content">content</main>
      </AppShell>,
    );

    expect(markup).toContain("BoardReadyOps");
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/setup"');
    expect(markup).toContain('href="https://docs.boardreadyops.com"');
    expect(markup).toContain('href="#main-content"');
    expect(markup).not.toContain(">BR<");
  });
});
```

- [ ] **Step 2: Extend the design-system test with the new token contract**

Add assertions to `tests/unit/web/run-design-system.test.ts`:

```ts
expect(css).toContain("--bro-bg:");
expect(css).toContain("--bro-surface:");
expect(css).toContain("--bro-accent:");
expect(css).toContain("--bro-text:");
expect(css).toContain("--bro-motion-fast:");
expect(css).toContain("color-scheme: dark");
```

Change the `variable()` helper calls in the contrast test to the final shared names:

```ts
expect(contrast(variable("bro-text"), variable("bro-bg"))).toBeGreaterThanOrEqual(4.5);
expect(contrast(variable("bro-text-muted"), variable("bro-bg"))).toBeGreaterThanOrEqual(4.5);
expect(contrast(variable("bro-text-subtle"), variable("bro-bg"))).toBeGreaterThanOrEqual(4.5);
```

Keep the semantic success/warning/danger/info contrast assertions.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
corepack pnpm exec vitest run tests/unit/web/app-shell.test.ts tests/unit/web/run-design-system.test.ts
```

Expected: FAIL because `AppShell` still renders the `BR` square and the `--bro-*` tokens do not exist.

- [ ] **Step 4: Implement the shared token vocabulary**

Replace the root palette in `apps/web/app/styles.css` with one coherent dark product vocabulary. Use these exact base values unless contrast calculation forces a stricter text shade:

```css
:root {
  color-scheme: dark;
  --bro-bg: #070d0a;
  --bro-bg-elevated: #0b1310;
  --bro-surface: #0f1914;
  --bro-surface-strong: #14231b;
  --bro-surface-sunken: #08100c;
  --bro-border: #24362c;
  --bro-border-strong: #3d5948;
  --bro-border-accent: rgba(63, 224, 138, 0.45);
  --bro-text: #f4fff8;
  --bro-text-muted: #b9cfbf;
  --bro-text-subtle: #8fa596;
  --bro-accent: #3fe08a;
  --bro-accent-strong: #5cf5a0;
  --bro-accent-soft: #9fc9ae;
  --bro-accent-contrast: #06130c;
  --bro-focus: #f8e16c;
  --bro-shadow: 0 24px 72px rgba(0, 0, 0, 0.34);
  --bro-shadow-soft: 0 14px 36px rgba(0, 0, 0, 0.2);
  --bro-radius-sm: 0.625rem;
  --bro-radius-md: 0.9rem;
  --bro-radius-lg: 1.25rem;
  --bro-radius-xl: 1.75rem;
  --bro-motion-fast: 140ms;
  --bro-motion-medium: 220ms;
  --bro-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

Map existing semantic variables to these shared tokens so existing component selectors need incremental rather than wholesale replacement:

```css
:root {
  --background: var(--bro-bg);
  --background-elevated: var(--bro-bg-elevated);
  --surface: var(--bro-surface);
  --surface-strong: var(--bro-surface-strong);
  --surface-muted: var(--bro-surface);
  --surface-raised: var(--bro-surface-strong);
  --surface-sunken: var(--bro-surface-sunken);
  --border: var(--bro-border);
  --border-strong: var(--bro-border-strong);
  --text: var(--bro-text);
  --text-muted: var(--bro-text-muted);
  --text-subtle: var(--bro-text-subtle);
  --accent: var(--bro-accent);
  --accent-strong: var(--bro-accent-strong);
  --accent-contrast: var(--bro-accent-contrast);
  --focus: var(--bro-focus);
}
```

Do not introduce raw colors outside the `:root` token declaration; preserve the existing `run-design-system.test.ts` raw-color guard.

- [ ] **Step 5: Rebuild `AppShell` around the real brand mark**

First update `BrandMarkLockup` in `apps/web/components/brand-mark.tsx` so the lockup delegates typography/color to CSS instead of hardcoded inline visual values. Keep the public props unchanged:

```tsx
export function BrandMarkLockup({ size = 24, className }: BrandMarkProps) {
  return (
    <span className={className ?? "brand-lockup"}>
      <BrandMarkIcon size={size} />
      <span className="brand-mark-wordmark">BoardReadyOps</span>
    </span>
  );
}
```

Extend `tests/unit/web/brand-mark.test.ts` with:

```ts
expect(wordmark.props.className).toBe("brand-mark-wordmark");
```

Then in `apps/web/components/ui.tsx`, import `BrandMarkLockup` and render this header navigation while keeping the `AppShell` signature unchanged:

```tsx
<header className="site-header">
  <div className="site-header-inner">
    <Link className="brand" href="/" aria-label="BoardReadyOps home">
      <BrandMarkLockup size={24} className="brand-lockup" />
    </Link>
    <nav className="site-navigation" aria-label="Global navigation">
      <Link href="/setup">Repository setup</Link>
      <a href="https://docs.boardreadyops.com">Documentation</a>
    </nav>
  </div>
</header>
```

Retain the existing skip link and footer evidence disclaimer.

- [ ] **Step 6: Style the shell as one premium application frame**

Update `.site-header`, `.site-header-inner`, `.brand`, `.site-navigation`, `.site-footer`, `.shell`, `.panel`, `.alert`, `.button`, `.status-badge`, and focus rules to consume tokens. Use restrained border highlight and elevation, not glow-heavy effects. Add transitions only to interactive elements:

```css
.button,
.site-navigation a,
.panel a {
  transition:
    color var(--bro-motion-fast) var(--bro-ease),
    border-color var(--bro-motion-fast) var(--bro-ease),
    background-color var(--bro-motion-fast) var(--bro-ease),
    transform var(--bro-motion-fast) var(--bro-ease);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto;
    animation: none;
    transition-duration: 0.01ms;
  }
}
```

- [ ] **Step 7: Run Task 1 tests and verify GREEN**

Run:

```bash
corepack pnpm exec vitest run tests/unit/web/app-shell.test.ts tests/unit/web/run-design-system.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add tsconfig.json apps/web/tsconfig.json apps/web/app/styles.css apps/web/components/ui.tsx apps/web/components/brand-mark.tsx tests/unit/web/brand-mark.test.ts tests/unit/web/app-shell.test.ts tests/unit/web/run-design-system.test.ts tests/unit/web/__snapshots__/run-investigation-accessibility.test.ts.snap docs/superpowers/plans/2026-08-23-premium-product-ui.md
git commit -m "feat(web): unify the premium application shell"
```

### Task 2: Recompose the landing page as a premium product narrative

**Files:**
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/landing.css`
- Modify: `tests/unit/web/home-page.test.ts`

**Interfaces:**
- Consumes: shared `--bro-*` tokens from Task 1 and existing `BrandMarkIcon`.
- Produces: public `/` markup only; install URL and `/setup` CTA contracts remain unchanged.

- [ ] **Step 1: Add failing content/structure tests**

Extend `tests/unit/web/home-page.test.ts`:

```ts
it("shows real product proof without fabricated social proof", () => {
  const text = collectText(HomePage());
  expect(text).toContain("Pull request evidence");
  expect(text).toContain("Manufacturing readiness");
  expect(text).toContain("Authoritative in GitHub");
  expect(text).not.toMatch(/trusted by|customers|teams worldwide|10,000|fortune 500/iu);
});

it("links documentation from the premium landing navigation", () => {
  expect(collectLinks(HomePage())).toContain("https://docs.boardreadyops.com");
});
```

- [ ] **Step 2: Run landing tests and verify RED**

```bash
corepack pnpm exec vitest run tests/unit/web/home-page.test.ts
```

Expected: the new product-proof copy assertions fail.

- [ ] **Step 3: Recompose `page.tsx` with the final section order**

Keep the current install URL constant. Use this semantic section order and these concrete headings/copy anchors:

```tsx
<main id="main-content">
  <section className="landing-hero" aria-labelledby="landing-heading">
    <p className="landing-kicker">Hardware release intelligence for KiCad</p>
    <h1 id="landing-heading">Release evidence that leads to a decision.</h1>
    <p>Turn every pull request into a traceable manufacturing-readiness decision without moving repository authority out of GitHub.</p>
  </section>
  <section className="landing-proof" aria-labelledby="proof-heading">
    <h2 id="proof-heading">Pull request evidence, normalized for a release decision.</h2>
  </section>
  <section className="landing-workflow" id="how-it-works" aria-labelledby="workflow-heading">
    <h2 id="workflow-heading">From design change to release decision.</h2>
  </section>
  <section className="landing-control-room" id="product" aria-labelledby="control-room-heading">
    <h2 id="control-room-heading">An evidence control room for hardware releases.</h2>
  </section>
  <section className="landing-capabilities" aria-labelledby="capabilities-heading">
    <h2 id="capabilities-heading">Checks that stay tied to the source revision.</h2>
  </section>
  <section className="landing-trust-boundary" aria-labelledby="trust-heading">
    <h2 id="trust-heading">Authoritative in GitHub.</h2>
  </section>
  <section className="landing-footer-cta" aria-labelledby="landing-cta-heading">
    <h2 id="landing-cta-heading">Bring release evidence into your next pull request.</h2>
  </section>
</main>
```

Use real capability copy, including these visible anchors:

```tsx
<p className="landing-kicker">Hardware release intelligence for KiCad</p>
<h1>Release evidence that leads to a decision.</h1>
<p>Turn every pull request into a traceable manufacturing-readiness decision without moving repository authority out of GitHub.</p>
```

The product-proof panel must show concrete evidence categories rather than fake customer numbers:

```tsx
<h2 id="proof-heading">Pull request evidence, normalized for a release decision.</h2>
<ul className="landing-proof-list">
  <li>DRC / ERC and design-rule evidence</li>
  <li>BOM and sourcing integrity</li>
  <li>Manufacturing package completeness</li>
  <li>Versioned findings, artifacts, and checksums</li>
</ul>
```

The trust-boundary section must visibly state `Authoritative in GitHub`.

- [ ] **Step 4: Rebuild `landing.css` using shared tokens**

Remove duplicate landing color constants and consume `--bro-*`. Implement:

```css
.landing {
  min-height: 100vh;
  background:
    radial-gradient(circle at 50% -12rem, color-mix(in srgb, var(--bro-accent) 12%, transparent), transparent 34rem),
    var(--bro-bg);
  color: var(--bro-text);
}

.landing-hero {
  position: relative;
  isolation: isolate;
  overflow: clip;
  padding: clamp(5rem, 10vw, 8.5rem) 1.5rem 5rem;
}

.landing-hero::before {
  position: absolute;
  z-index: -1;
  inset: 0;
  background-image:
    linear-gradient(color-mix(in srgb, var(--bro-accent) 7%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--bro-accent) 7%, transparent) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: linear-gradient(to bottom, black, transparent 78%);
  content: "";
}
```

Use `clamp()` typography, asymmetric desktop layouts, a real product-control-room panel, and stacked mobile layouts. Do not add JavaScript animation.

- [ ] **Step 5: Run landing tests and format check**

```bash
corepack pnpm exec vitest run tests/unit/web/home-page.test.ts
corepack pnpm exec biome check apps/web/app/page.tsx apps/web/app/landing.css tests/unit/web/home-page.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/web/app/page.tsx apps/web/app/landing.css tests/unit/web/home-page.test.ts
git commit -m "feat(web): elevate the marketing product narrative"
```

### Task 3: Turn `/setup` into a guided engineering setup journey

**Files:**
- Modify: `apps/web/app/setup/page.tsx`
- Modify: `apps/web/app/styles.css`
- Modify: `tests/unit/web/repository-setup-page.test.ts`

**Interfaces:**
- Consumes: existing repository setup presets and contracts from `@boardreadyops/cloud-core/repository-setup`.
- Produces: the same query-string preset selection and same GitHub handoff behavior; no writes are introduced.

- [ ] **Step 1: Add a failing guided-journey test**

Extend `tests/unit/web/repository-setup-page.test.ts`:

```ts
it("presents setup as a three-step guided journey", async () => {
  const markup = await render({ preset: "prototype" });
  expect(markup).toContain("1. Choose a release policy");
  expect(markup).toContain("2. Review repository-owned files");
  expect(markup).toContain("3. Validate readiness in GitHub Actions");
  expect(markup).toContain('href="#policy-preset"');
  expect(markup).toContain('href="#proposed-files"');
  expect(markup).toContain('href="#readiness"');
});
```

- [ ] **Step 2: Verify RED**

```bash
corepack pnpm exec vitest run tests/unit/web/repository-setup-page.test.ts
```

Expected: FAIL because current headings/cross-step navigation do not match the guided journey.

- [ ] **Step 3: Add a compact setup journey rail**

After the page heading, add:

```tsx
<nav className="setup-journey" aria-label="Repository setup steps">
  <a href="#policy-preset"><span>01</span><strong>Choose a release policy</strong></a>
  <a href="#proposed-files"><span>02</span><strong>Review repository-owned files</strong></a>
  <a href="#readiness"><span>03</span><strong>Validate readiness in GitHub Actions</strong></a>
</nav>
```

Change the three principal panel titles exactly to:

```tsx
title="1. Choose a release policy"
title="2. Review repository-owned files"
title="3. Validate readiness in GitHub Actions"
```

Keep `installation_id` private and all current permission text unchanged.

- [ ] **Step 4: Improve preset cards without adding client state**

Preserve query-string navigation. Inside each preset card, add a semantic selected-state line and keep `aria-current="page"` on the selected preview link. Do not convert preset selection into client-side state.

- [ ] **Step 5: Add premium setup styling**

In `styles.css`, implement `setup-journey` as a responsive grid with visible number markers, selected/panel depth, code-preview header chrome, and stronger content grouping. Example base:

```css
.setup-journey {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}

.setup-journey a {
  display: grid;
  min-height: 7rem;
  align-content: space-between;
  padding: var(--space-4);
  border: 1px solid var(--bro-border);
  border-radius: var(--bro-radius-lg);
  background: linear-gradient(145deg, var(--bro-surface-strong), var(--bro-bg-elevated));
  color: var(--bro-text);
  text-decoration: none;
}

.setup-journey span {
  color: var(--bro-accent);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
}
```

At `max-width: 48rem`, collapse it to one column. Keep code blocks horizontally scrollable and keyboard-focusable.

- [ ] **Step 6: Verify setup behavior and accessibility**

```bash
corepack pnpm exec vitest run tests/unit/web/repository-setup-page.test.ts
```

Expected: all setup behavior and axe checks PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/web/app/setup/page.tsx apps/web/app/styles.css tests/unit/web/repository-setup-page.test.ts
git commit -m "feat(web): guide the repository setup experience"
```

### Task 4: Upgrade run investigation into an evidence control room

**Files:**
- Modify: `apps/web/components/run-investigation.tsx`
- Modify: `apps/web/app/styles.css`
- Modify: `tests/unit/web/run-investigation-accessibility.test.ts`

**Interfaces:**
- Consumes: `RunDetail` and all existing filter/query contracts unchanged.
- Produces: same exported component names and route behavior; only hierarchy/markup classes and presentation change.

- [ ] **Step 1: Add failing semantic expectations for the control-room header**

In `tests/unit/web/run-investigation-accessibility.test.ts`, add:

```ts
it("puts decision and evidence identity ahead of secondary metadata", () => {
  const markup = viewMarkup("summary");
  expect(markup).toContain("Evidence control room");
  expect(markup).toContain("Release decision");
  expect(markup).toContain("Readiness score");
  expect(markup).toContain("Authoritative GitHub sources");
});
```

- [ ] **Step 2: Verify RED**

```bash
corepack pnpm exec vitest run tests/unit/web/run-investigation-accessibility.test.ts
```

Expected: FAIL because `Evidence control room` and visible `Readiness score` copy are absent.

- [ ] **Step 3: Recompose `RunHeader` without changing data**

Use this structure:

```tsx
<header className="run-header">
  <div className="run-header-copy">
    <p className="run-context">Evidence control room</p>
    <p className="run-repository-kind">{run.repositoryPrivate ? "Private repository" : "Public repository"}</p>
    <h1>{run.repository}</h1>
    <p className="run-subtitle">Run <code>{run.id}</code> · commit <code>{run.commitSha.slice(0, 12)}</code></p>
  </div>
  <fieldset className="run-header-status">
    <legend className="sr-only">Run status summary</legend>
    <div className="score">
      <strong>{run.readinessScore ?? "—"}</strong>
      <span>Readiness score</span>
    </div>
    <StatusBadge value={run.decision} label={`Decision: ${humanize(run.decision)}`} />
    <StatusBadge value={run.status} />
  </fieldset>
</header>
```

Keep the existing screen-reader score explanation.

- [ ] **Step 4: Strengthen SummaryView hierarchy**

Keep the existing `Panel` API and data sources. Add `className` support to `Panel` only if needed by passing an optional `className?: string` prop; if added, cover it in `app-shell.test.ts`. The decision panel should remain first and use existing `SummaryDecisionAction` behavior. Move visual prominence to decision, blocking count, readiness, and authoritative source links; do not delete metadata.

- [ ] **Step 5: Style run navigation and evidence surfaces**

Make `.run-navigation` a compact segmented rail, `.run-header` a layered control-room header, `.decision-layout` a high-priority decision surface, and findings/artifact tables dense but legible. Preserve horizontal table scrolling and bounded pagination.

- [ ] **Step 6: Update structural snapshots intentionally**

Run:

```bash
corepack pnpm exec vitest run tests/unit/web/run-investigation-accessibility.test.ts -u
```

Review the snapshot diff manually. Reject updates that remove current links, status text, definitions, filters, pagination, or authoritative GitHub URLs.

- [ ] **Step 7: Re-run accessibility without snapshot update mode**

```bash
corepack pnpm exec vitest run tests/unit/web/run-investigation-accessibility.test.ts
```

Expected: all summary/attempt/findings/artifacts axe checks PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add apps/web/components/run-investigation.tsx apps/web/app/styles.css tests/unit/web/run-investigation-accessibility.test.ts tests/unit/web/__snapshots__/run-investigation-accessibility.test.ts.snap
git commit -m "feat(web): elevate the run evidence control room"
```

### Task 5: Polish findings, artifacts, attempts, publication, and audit density

**Files:**
- Modify: `apps/web/components/run-investigation.tsx`
- Modify: `apps/web/app/styles.css`
- Modify: `tests/unit/web/run-investigation-accessibility.test.ts`

**Interfaces:**
- Consumes/produces: no query, filter, pagination, download, audit, or publication contract changes.

- [ ] **Step 1: Add a preservation test for operational controls**

Add:

```ts
it("preserves bounded evidence controls while changing presentation", () => {
  const findings = viewMarkup("findings");
  const artifacts = viewMarkup("artifacts");
  expect(findings).toContain('name="findingSearch"');
  expect(findings).toContain('name="findingSeverity"');
  expect(findings).toContain('name="findingGroup"');
  expect(artifacts).toContain('name="artifactSearch"');
  expect(artifacts).toContain("Download signed copy");
});
```

- [ ] **Step 2: Run the preservation test before markup changes**

```bash
corepack pnpm exec vitest run tests/unit/web/run-investigation-accessibility.test.ts
```

Expected: PASS. This is a regression guard for a presentation-only refactor.

- [ ] **Step 3: Refine list/table/timeline markup only where semantic grouping improves**

Keep all form names and URLs unchanged. Add presentation-only wrappers/classes such as `evidence-toolbar`, `evidence-table-shell`, `timeline-card`, and `evidence-meta` when they reduce CSS coupling. Do not add client-side sorting/filtering.

- [ ] **Step 4: Add density/responsive styles**

Desktop tables should remain tables. On narrow screens, retain horizontal scroll instead of semantically rewriting rows into unrelated cards. Use sticky table headings only if they do not obscure focus targets.

- [ ] **Step 5: Run run-suite regression coverage**

```bash
corepack pnpm exec vitest run tests/unit/web/run-investigation-accessibility.test.ts tests/unit/web/run-dashboard.test.ts tests/unit/web/run-dashboard-page.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/web/components/run-investigation.tsx apps/web/app/styles.css tests/unit/web/run-investigation-accessibility.test.ts
git commit -m "feat(web): refine evidence investigation surfaces"
```

### Task 6: Premium loading, error, unavailable, and empty states

**Files:**
- Modify: `apps/web/app/runs/[runId]/loading.tsx`
- Modify: `apps/web/app/runs/[runId]/error.tsx`
- Modify: `apps/web/app/runs/[runId]/not-found.tsx`
- Modify: `apps/web/components/ui.tsx`
- Modify: `apps/web/app/styles.css`
- Create: `tests/unit/web/run-state-pages.test.ts`

**Interfaces:**
- Existing Next.js error boundary `reset()` behavior and route semantics remain unchanged.

- [ ] **Step 1: Write failing state-page structural tests**

Create `tests/unit/web/run-state-pages.test.ts` with server-render checks for loading and not-found and a direct component check for error copy. Assert these visible strings:

```ts
expect(loadingMarkup).toContain("Loading run investigation");
expect(loadingMarkup).toContain('aria-busy="true"');
expect(notFoundMarkup).toContain("Run not found or no longer available");
expect(notFoundMarkup).toContain("Return home");
expect(loadingMarkup).toContain("run-state-surface");
expect(notFoundMarkup).toContain("run-state-surface");
```

- [ ] **Step 2: Verify RED**

```bash
corepack pnpm exec vitest run tests/unit/web/run-state-pages.test.ts
```

Expected: FAIL on the new `run-state-surface` contract.

- [ ] **Step 3: Add a consistent state surface**

Wrap each route state with the same surface class while preserving its existing content. For loading:

```tsx
<section className="run-state-surface">
  <div className="loading-header skeleton" />
  <Panel title="Loading run investigation" description="Fetching normalized run state and bounded evidence.">
    <div className="skeleton skeleton-line" />
    <div className="skeleton skeleton-line short" />
  </Panel>
</section>
```

For the error boundary, place the existing danger `Alert` and Retry button inside:

```tsx
<section className="run-state-surface">
  <Alert title="Run investigation could not be loaded" tone="danger">
    <p>The request failed without exposing database or tenant details. Retry the bounded dashboard query.</p>
    {error.digest ? <p>Support reference: <code>{error.digest}</code></p> : null}
    <button className="button button-primary" type="button" onClick={reset}>Retry</button>
  </Alert>
</section>
```

For not-found, place the existing `EmptyState` inside:

```tsx
<section className="run-state-surface">
  <EmptyState
    title="Run not found or no longer available"
    action={<Link className="button button-primary" href="/">Return home</Link>}
  >
    <p>The identifier is invalid, unauthorized for this deployment, expired, or removed by a lifecycle operation.</p>
  </EmptyState>
</section>
```

Retain current security copy: do not expose database/tenant details and keep support digest behavior.

- [ ] **Step 4: Polish `EmptyState` without changing its signature**

Keep `EmptyState({ title, children, action })`. Update only the icon/markup classes if required and style it with the shared premium surface tokens.

- [ ] **Step 5: Verify state tests**

```bash
corepack pnpm exec vitest run tests/unit/web/run-state-pages.test.ts tests/unit/web/run-investigation-accessibility.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add apps/web/app/runs apps/web/components/ui.tsx apps/web/app/styles.css tests/unit/web/run-state-pages.test.ts
git commit -m "feat(web): polish investigation state surfaces"
```

### Task 7: Production browser and accessibility verification

**Files:**
- Modify only if verification finds a real UI defect.

**Interfaces:**
- Verification-only task.

- [ ] **Step 1: Run targeted unit and accessibility tests**

```bash
corepack pnpm exec vitest run \
  tests/unit/web/app-shell.test.ts \
  tests/unit/web/home-page.test.ts \
  tests/unit/web/repository-setup-page.test.ts \
  tests/unit/web/run-design-system.test.ts \
  tests/unit/web/run-investigation-accessibility.test.ts \
  tests/unit/web/run-state-pages.test.ts \
  tests/unit/web/layout-metadata.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck, lint, duplicate-code, build, and dist verification**

```bash
corepack pnpm run typecheck
corepack pnpm run cloud:typecheck
corepack pnpm run lint
corepack pnpm run gc
corepack pnpm --filter @boardreadyops/web build
corepack pnpm run verify:dist
```

Expected: all exit 0.

- [ ] **Step 3: Run the complete unit suite**

```bash
corepack pnpm exec vitest run tests/unit
```

Expected: no new failure or skip. Record the exact passed/skipped counts.

- [ ] **Step 4: Start the production Next.js build locally**

Use the repository-built web app on localhost only. Do not bind a public interface. Run the built server on an unused localhost port and record the port.

- [ ] **Step 5: Verify desktop and mobile routes in real Chrome**

Using the repository Puppeteer Chrome, inspect at least:

```text
/
/setup
/setup?preset=production
/icon
/opengraph-image
```

For `/` and `/setup`, capture viewport checks at 1440×900, 1024×768, and 375×812. Verify no horizontal body overflow, keyboard focus order, visible focus, CTA targets, and readable hierarchy. Use the existing unit-rendered run fixtures for run routes if no safe live run fixture exists locally.

- [ ] **Step 6: Run Axe against locally rendered `/` and `/setup`**

Expected: zero WCAG A/AA violations. Existing unit Axe coverage remains the primary run-screen accessibility guard if a live run fixture is not available.

- [ ] **Step 7: Review the complete branch diff**

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- apps/web tests/unit/web
```

Reject debug code, hardcoded secrets, generated build drift, unrelated formatting, and any backend/data-contract change.

- [ ] **Step 8: Commit verification fixes only if needed**

If verification required a real fix, stage only those files and commit:

```bash
git commit -m "fix(web): address premium UI verification findings"
```

If no fix was required, do not create an empty commit.

### Task 8: PR and post-merge product rollout

**Files:**
- No source change unless CI/review identifies a defect.

**Interfaces:**
- GitHub PR and production rollout only.

- [ ] **Step 1: Push the feature branch and open a PR to `main`**

PR body must cite the spec and this plan, list the exact local verification results, and explicitly state that backend/API/database contracts are unchanged.

- [ ] **Step 2: Inspect every PR gate**

Require success for lint, typecheck, unit/integration tests, web standalone Windows, accessibility, build, verify-dist, SonarCloud, CodeQL, Semgrep, Gitleaks, dependency review, Socket, DeepScan, Codecov, and the repository security gate. Resolve valid review comments at the root cause.

- [ ] **Step 3: Merge only when the PR is genuinely ready**

Use repository-normal squash/queue behavior. Do not bypass branch rules or required approvals.

- [ ] **Step 4: Verify post-merge `main` workflows**

Inspect the exact merge SHA across CI, security, docs, benchmark, and release-please workflows.

- [ ] **Step 5: Deploy only after the deployment-topology hardening prerequisite is satisfied or the existing production topology is independently proven clean**

Before rollout, verify the production checkout SHA, Compose ownership of web/worker/caddy, backup status, and rollback identity. Do not repeat a rollout against an ambiguous topology.

- [ ] **Step 6: Verify production after rollout**

Require:

```text
https://boardreadyops.com/ -> 200 and premium landing marker
https://boardreadyops.com/setup -> 200 and premium setup journey
http://boardreadyops.com/ -> 301/308 to HTTPS
/api/health/ready -> ready
web + worker -> healthy, restart_count unchanged
```

Inspect recent web/worker logs for new `error`, `fatal`, `panic`, or unhandled exception entries.
