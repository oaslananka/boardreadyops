# Foundry Editorial Product UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic horizontal-navigation/card-grid product UI with the approved Foundry Editorial system across every `apps/web` route while preserving behavior, accessibility, and runtime contracts.

**Architecture:** Keep Next.js App Router and current server/client boundaries. Add one focused client navigation component, one settings layout, and small reusable presentation components; express most visual change through the existing global stylesheet and route-specific class names. Preserve current data sources during this phase so visual work does not conceal backend scope.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS custom properties, Vitest, React DOM server rendering, Playwright Chromium, axe-core, Biome.

**Spec:** `docs/superpowers/specs/2026-08-28-foundry-editorial-product-ui-design.md`

## Global Constraints

- No backend, database, billing, storage, authentication, route, or API contract changes.
- No new component library or large UI dependency.
- Use existing `Newsreader`, `Inter`, and `JetBrains Mono` fonts from `apps/web/app/layout.tsx`.
- No glassmorphism, neon styling, purple gradients, ornamental charts, decorative AI imagery, or fabricated product proof.
- Server Components remain default; client code is limited to actual interaction.
- Preserve skip links, semantic landmarks, keyboard workflows, reduced-motion behavior, and WCAG 2.2 AA contrast.
- Do not present decorative settings pages as functional when no backing interaction exists.
- Do not mix real-data wiring into this visual phase.
- Every production code change follows a witnessed red-green test cycle.
- Every task ends with an independently reviewable commit.

---

## File Structure

### New files

- `apps/web/components/product-navigation.tsx` — grouped product navigation, current-route state, desktop collapse control, and accessible mobile drawer.
- `apps/web/components/product-icons.tsx` — small dependency-free typed SVG icon set used by product navigation and high-value status/action surfaces.
- `apps/web/components/review/review-list-item.tsx` — shared dense review summary used by Reviews and My Work.
- `apps/web/app/settings/layout.tsx` — settings section frame and secondary navigation.
- `tests/unit/web/foundry-ui-contract.test.ts` — token, shell, primitive, and anti-regression design contracts.
- `tests/unit/web/product-navigation.test.tsx` — navigation grouping and accessible state tests.
- `tests/unit/web/review-list-item.test.tsx` — review summary hierarchy tests.
- `tests/unit/web/product-app-accessibility.test.tsx` — axe coverage for representative product surfaces.

### Primary modified files

- `apps/web/app/styles.css` — Foundry tokens, shell, primitives, route layouts, responsive rules, dark theme, reduced-motion, and forced-colors behavior.
- `apps/web/components/ui.tsx` — AppShell composition and compatible shared primitive variants.
- `apps/web/app/work/page.tsx` — daily engineering queue composition.
- `apps/web/app/reviews/page.tsx` — dense review registry composition.
- `apps/web/components/review/review-header.tsx` — sticky review command header.
- `apps/web/components/review/review-view.tsx` — workspace frame and section navigation.
- `apps/web/components/review/overview-tab.tsx` — decision-first overview.
- `apps/web/components/review/findings-tab.tsx` — scan/focus hierarchy and compact controls.
- `apps/web/components/review/changes-tab.tsx` — canvas-first hierarchy.
- `apps/web/components/review/review-canvas.tsx` — instrument-style controls and layout.
- `apps/web/components/review/discussion-tab.tsx` — engineering thread hierarchy.
- `apps/web/components/review/checklist-approvals-tab.tsx` — requirement/sign-off hierarchy.
- `apps/web/components/review/evidence-tab.tsx` — provenance-chain hierarchy.
- `apps/web/app/dashboard/page.tsx`, `apps/web/app/setup/page.tsx`, `apps/web/app/policies/page.tsx`, `apps/web/app/evidence/page.tsx`, `apps/web/app/insights/page.tsx` — shared page frame adoption.
- `apps/web/app/settings/*/page.tsx` — settings frame and honest functional/decorative states.
- `apps/web/app/landing.css`, `apps/web/app/page.tsx` — token and shell harmonization only.
- `tests/e2e/review-lifecycle.spec.ts` — responsive, navigation, focus, theme, and overflow coverage.

---

### Task 1: Lock Foundry Tokens and Anti-Regression Contracts

**Files:**

- Create: `tests/unit/web/foundry-ui-contract.test.ts`
- Modify: `apps/web/app/styles.css:1-214`
- Modify: `tests/unit/web/theme-contrast.test.ts`

**Interfaces:**

- Consumes: existing `:root`, light-theme blocks, and semantic token aliases.
- Produces: stable `--foundry-*` tokens plus aliases consumed by all later CSS tasks.

- [ ] **Step 1: Write the failing token and design-language test**

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const css = await readFile("apps/web/app/styles.css", "utf8");

describe("Foundry Editorial UI contract", () => {
  it("declares the approved material, geometry, and typography tokens", () => {
    for (const token of [
      "--foundry-canvas",
      "--foundry-surface",
      "--foundry-ink",
      "--foundry-copper",
      "--foundry-brass",
      "--foundry-line",
      "--rail-width",
      "--rail-width-compact",
    ]) {
      expect(css).toContain(`${token}:`);
    }
    expect(css).toContain("--font-display: var(--font-display-loaded");
    expect(css).not.toMatch(/linear-gradient\([^;]*(purple|#7c3aed|#8b5cf6)/i);
  });

  it("uses restrained geometry and exposes accessibility states", () => {
    expect(css).toContain("--bro-radius-lg: 12px");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (forced-colors: active)");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/web/foundry-ui-contract.test.ts`

Expected: FAIL because `--foundry-canvas`, rail tokens, and the forced-colors block do not exist.

- [ ] **Step 3: Replace the palette and geometry roots with exact approved tokens**

```css
:root {
  color-scheme: dark;
  --foundry-canvas: #13120f;
  --foundry-canvas-subdued: #191713;
  --foundry-surface: #1e1b17;
  --foundry-surface-strong: #27231d;
  --foundry-ink: #f2ecde;
  --foundry-ink-muted: #afa590;
  --foundry-ink-subtle: #807766;
  --foundry-line: #3b352b;
  --foundry-line-strong: #655b49;
  --foundry-copper: #d16a4d;
  --foundry-copper-strong: #e48060;
  --foundry-copper-soft: #46261e;
  --foundry-brass: #d2a64a;
  --rail-width: 248px;
  --rail-width-compact: 72px;
  --bro-radius-sm: 4px;
  --bro-radius-md: 8px;
  --bro-radius-lg: 12px;
}

:root[data-theme="light"] {
  color-scheme: light;
  --foundry-canvas: #f1ede3;
  --foundry-canvas-subdued: #e9e2d4;
  --foundry-surface: #fbf8f0;
  --foundry-surface-strong: #fffdf8;
  --foundry-ink: #1a1915;
  --foundry-ink-muted: #686154;
  --foundry-ink-subtle: #8b8374;
  --foundry-line: #d8cfbd;
  --foundry-line-strong: #a99c83;
  --foundry-copper: #a44730;
  --foundry-copper-strong: #7d3323;
  --foundry-copper-soft: #f1d8cd;
  --foundry-brass: #9a701e;
}
```

Keep the system-light block byte-equivalent to the explicit light block so `theme-contrast.test.ts` remains authoritative. Alias existing tokens such as `--background`, `--surface`, `--text`, and `--accent` to the new Foundry values instead of rewriting every consumer in one task.

- [ ] **Step 4: Extend contrast pairs for copper, brass, rail, and focus surfaces**

Add pairs to `TEXT_PAIRS` for `--accent` and semantic text against both the rail and raised surface aliases. Keep the required ratios at 4.5:1 for text and 3:1 for focus/non-text boundaries.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/web/foundry-ui-contract.test.ts tests/unit/web/theme-contrast.test.ts`

Expected: both files pass with zero contrast failures.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/styles.css tests/unit/web/foundry-ui-contract.test.ts tests/unit/web/theme-contrast.test.ts
git commit -m "feat(ui): establish Foundry Editorial tokens"
```

---

### Task 2: Build Product Navigation and Application Shell

**Files:**

- Create: `apps/web/components/product-icons.tsx`
- Create: `apps/web/components/product-navigation.tsx`
- Create: `tests/unit/web/product-navigation.test.tsx`
- Modify: `apps/web/components/ui.tsx:95-140`
- Modify: `tests/unit/web/app-shell.test.ts`
- Modify: `apps/web/app/styles.css`

**Interfaces:**

- Consumes: `BrandMarkLockup`, `ThemeToggle`, optional `viewerNav`, existing route destinations.
- Produces: `ProductNavigation({ viewerNav }: { viewerNav?: ReactNode })`, `ProductIcon({ name, size }: ProductIconProps)`, and the `.product-shell` layout used by every application route.

- [ ] **Step 1: Write failing navigation tests**

```tsx
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/reviews" }));

describe("ProductNavigation", () => {
  it("groups work, governance, and administration destinations", async () => {
    const { ProductNavigation } = await import("../../../apps/web/components/product-navigation.js");
    const markup = renderToStaticMarkup(createElement(ProductNavigation));
    expect(markup).toContain('aria-label="Product navigation"');
    expect(markup).toContain("My Work");
    expect(markup).toContain("Reviews");
    expect(markup).toContain("Projects");
    expect(markup).toContain("Governance");
    expect(markup).toContain("Settings");
    expect(markup).toContain('aria-current="page"');
    expect(markup).not.toContain(">Billing<");
  });
});
```

Update `app-shell.test.ts` to expect `.product-shell`, `.product-rail`, `.product-context-bar`, and a single Settings destination.

- [ ] **Step 2: Run navigation tests and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/web/product-navigation.test.tsx tests/unit/web/app-shell.test.ts`

Expected: FAIL because the component and new shell classes do not exist.

- [ ] **Step 3: Implement the typed icon set**

```tsx
export type ProductIconName =
  | "work"
  | "reviews"
  | "projects"
  | "policies"
  | "evidence"
  | "insights"
  | "setup"
  | "settings"
  | "docs"
  | "menu"
  | "close";

export function ProductIcon({ name, size = 18 }: { name: ProductIconName; size?: number }) {
  return (
    <svg aria-hidden="true" className="product-icon" width={size} height={size} viewBox="0 0 24 24">
      <path d={paths[name]} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
```

Define a fixed `Record<ProductIconName, string>` at module scope. Do not use emoji or inject raw SVG markup.

- [ ] **Step 4: Implement grouped navigation and drawer state**

```tsx
"use client";

const groups = [
  { label: "Workspace", items: [["My Work", "/work", "work"], ["Reviews", "/reviews", "reviews"], ["Projects", "/dashboard", "projects"]] },
  { label: "Governance", items: [["Policies", "/policies", "policies"], ["Evidence", "/evidence", "evidence"], ["Insights", "/insights", "insights"]] },
] as const;
```

Use `usePathname`, `useState`, `useEffect`, and refs to provide:

- route-aware `aria-current="page"`;
- mobile menu trigger with `aria-expanded` and `aria-controls`;
- Escape close;
- focus moved to the first nav link on open and restored to the trigger on close;
- body scroll lock only while the mobile drawer is open;
- a compact desktop rail toggle whose label describes the next state.

- [ ] **Step 5: Recompose AppShell**

```tsx
export function AppShell({ children, viewerNav }: Readonly<{ children: ReactNode; viewerNav?: ReactNode }>) {
  return (
    <div className="product-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <ProductNavigation viewerNav={viewerNav} />
      <div className="product-stage">
        <header className="product-context-bar" aria-label="Workspace context">
          <span className="context-kicker">Hardware release workspace</span>
          <span className="command-hint" aria-hidden="true">Search <kbd>⌘</kbd><kbd>K</kbd></span>
        </header>
        {children}
        <footer className="site-footer">...</footer>
      </div>
    </div>
  );
}
```

The command hint is visual only and must not be rendered as a button because this phase does not implement a command palette.

- [ ] **Step 6: Add shell CSS**

Implement `.product-shell`, `.product-rail`, grouped nav labels, selected copper rule, `.product-stage`, `.product-context-bar`, mobile backdrop/drawer, compact rail state, and print behavior. At `max-width: 820px`, make the rail off-canvas and remove its reserved grid column.

- [ ] **Step 7: Run tests and verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/web/product-navigation.test.tsx tests/unit/web/app-shell.test.ts tests/unit/web/theme-contrast.test.ts`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/product-icons.tsx apps/web/components/product-navigation.tsx apps/web/components/ui.tsx apps/web/app/styles.css tests/unit/web/product-navigation.test.tsx tests/unit/web/app-shell.test.ts
git commit -m "feat(ui): replace link wall with product navigation"
```

---

### Task 3: Rebuild Shared Surfaces, Buttons, Forms, and Page Rhythm

**Files:**

- Modify: `apps/web/components/ui.tsx:1-220`
- Modify: `apps/web/app/styles.css`
- Modify: `tests/unit/web/foundry-ui-contract.test.ts`
- Modify: `tests/unit/web/run-dashboard-page.test.ts`

**Interfaces:**

- Consumes: existing `Panel`, `StatusBadge`, `Alert`, `DefinitionGrid`, `EmptyState`, and `Breadcrumbs` call sites.
- Produces: backward-compatible `Panel` with `tone?: "default" | "raised" | "inset" | "critical"` and stable `.page-frame`, `.page-intro`, `.decision-band`, `.metric-strip`, and form classes.

- [ ] **Step 1: Write failing primitive tests**

Extend `foundry-ui-contract.test.ts`:

```ts
it("defines intentional surface roles without oversized SaaS geometry", () => {
  for (const selector of [".surface-raised", ".surface-inset", ".decision-band", ".metric-strip", ".page-intro"]) {
    expect(css).toContain(selector);
  }
  expect(css).not.toMatch(/border-radius:\s*(2[0-9]|[3-9][0-9])px/);
});
```

Add a static-render test proving `<Panel tone="critical">` produces `surface-critical` and retains `aria-labelledby`.

- [ ] **Step 2: Run tests and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/web/foundry-ui-contract.test.ts tests/unit/web/run-dashboard-page.test.ts`

Expected: FAIL on missing variants/selectors.

- [ ] **Step 3: Implement the compatible Panel variant**

```tsx
export function Panel({ children, title, description, actions, id, tone = "default" }: Readonly<PanelProps>) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section className={`panel surface-${tone}`} id={id} aria-labelledby={headingId}>
      <header className="panel-header">...</header>
      {children}
    </section>
  );
}
```

Do not change existing required props or callers.

- [ ] **Step 4: Implement shared visual primitives in CSS**

Cover:

- page frame and application title scale;
- breadcrumbs and metadata labels;
- surface variants and restrained shadows;
- primary/secondary/quiet/danger buttons;
- status badges and decision bands;
- metric strips with tabular figures;
- inputs, selects, textareas, labels, help, invalid, disabled, and loading states;
- table rules, sticky headings, scroll containers;
- empty/error/loading states;
- code, hashes, paths, and evidence values;
- focus-visible, forced-colors, and reduced-motion behavior.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/web/foundry-ui-contract.test.ts tests/unit/web/run-dashboard-page.test.ts tests/unit/web/theme-contrast.test.ts`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/ui.tsx apps/web/app/styles.css tests/unit/web/foundry-ui-contract.test.ts tests/unit/web/run-dashboard-page.test.ts
git commit -m "feat(ui): rebuild shared product surfaces"
```

---

### Task 4: Redesign My Work and Reviews Registry

**Files:**

- Create: `apps/web/components/review/review-list-item.tsx`
- Create: `tests/unit/web/review-list-item.test.tsx`
- Modify: `apps/web/app/work/page.tsx`
- Modify: `apps/web/app/reviews/page.tsx`
- Modify: `tests/unit/web/my-work-page.test.ts`
- Modify: `tests/unit/web/reviews-list-page.test.ts`
- Modify: `apps/web/app/styles.css`

**Interfaces:**

- Consumes: `DemoReview`, `StatusBadge`, route links, existing review/finding counts.
- Produces: `ReviewListItem({ review, context }: { review: DemoReview; context: "registry" | "work" })` and dense `.review-registry-row` structure.

- [ ] **Step 1: Write failing hierarchy tests**

```tsx
it("puts blockers and decision before secondary lifecycle counts", () => {
  const markup = renderToStaticMarkup(<ReviewListItem review={DEMO_REVIEWS[0]!} context="registry" />);
  expect(markup).toContain("review-registry-row");
  expect(markup).toContain("Awaiting decision");
  expect(markup).toContain("3 blockers");
  expect(markup).toContain("PR #42");
  expect(markup.indexOf("3 blockers")).toBeLessThan(markup.indexOf("persistent"));
});
```

Update page source tests to expect `.work-queue-summary`, `.work-primary-queue`, `.review-registry-toolbar`, and use of `ReviewListItem`.

- [ ] **Step 2: Run tests and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/web/review-list-item.test.tsx tests/unit/web/my-work-page.test.ts tests/unit/web/reviews-list-page.test.ts`

Expected: FAIL because the shared component and new structure do not exist.

- [ ] **Step 3: Implement ReviewListItem**

Render one link with this order:

1. repository and PR;
2. title;
3. decision and blocker status;
4. revision/base/head/author;
5. compact new/persistent/resolved counts.

Use text labels `Awaiting decision`, `Approved`, or `Changes requested`; do not encode them solely in icons.

- [ ] **Step 4: Recompose My Work**

Build:

- `.work-queue-summary` with assigned, awaiting, and requested-change counts;
- `.work-primary-queue` containing assigned finding rows;
- `.work-secondary-queues` containing review requests and requested changes;
- rows with severity, repository/PR, message, path, and one explicit next action.

Do not alter demo-data selection rules.

- [ ] **Step 5: Recompose Reviews**

Build a page intro, compact inset filter summary, result count, and a single registry list using `ReviewListItem`. Do not create decorative metric cards for counts already visible in the list.

- [ ] **Step 6: Add responsive list CSS**

At desktop, align identity, decision, evidence, and age/count columns. Below 820px, keep title and decision first and move technical metadata into a wrapped footer.

- [ ] **Step 7: Run tests and verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/web/review-list-item.test.tsx tests/unit/web/my-work-page.test.ts tests/unit/web/reviews-list-page.test.ts`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/review/review-list-item.tsx apps/web/app/work/page.tsx apps/web/app/reviews/page.tsx apps/web/app/styles.css tests/unit/web/review-list-item.test.tsx tests/unit/web/my-work-page.test.ts tests/unit/web/reviews-list-page.test.ts
git commit -m "feat(ui): turn work and reviews into engineering queues"
```

---

### Task 5: Rebuild the Review Command Header and Workspace Frame

**Files:**

- Modify: `apps/web/components/review/review-header.tsx`
- Modify: `apps/web/components/review/review-view.tsx`
- Modify: `apps/web/components/review/overview-tab.tsx`
- Modify: `tests/unit/web/review-detail-tabs.test.ts`
- Modify: `tests/unit/web/keyboard-triage.test.ts`
- Modify: `apps/web/app/styles.css`

**Interfaces:**

- Consumes: existing `ReviewHeaderProps`, six `ReviewTabKey` values, approval handlers, and review counts.
- Produces: sticky `.review-command-header`, `.review-decision-summary`, `.review-workspace-nav`, and decision-first overview without changing callback signatures.

- [ ] **Step 1: Write failing structural tests**

Update `review-detail-tabs.test.ts` to require:

```ts
expect(header).toContain("review-command-header");
expect(header).toContain("review-decision-summary");
expect(view).toContain('aria-label="Review workspace"');
expect(view).toContain('aria-selected={activeTab === "overview"}');
expect(view).toContain('role="tablist"');
expect(view).toContain('role="tabpanel"');
```

Retain assertions for all six sections and both approval actions.

- [ ] **Step 2: Run tests and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/web/review-detail-tabs.test.ts tests/unit/web/keyboard-triage.test.ts`

Expected: FAIL on missing command header and tab semantics.

- [ ] **Step 3: Recompose ReviewHeader**

Keep the existing prop interface. Render:

- repository/PR/revision context;
- title and decision summary;
- blocker/evidence state area;
- base/head and digest details;
- primary `Approve review` and secondary-danger `Request changes` actions.

Make the header sticky only at desktop widths where it does not obscure content. Preserve `CopyButton` and textual evidence state.

- [ ] **Step 4: Add complete tab semantics**

Give each tab `id`, `role="tab"`, `aria-selected`, and `aria-controls`. Give the active body `role="tabpanel"`, `aria-labelledby`, and a stable id. Keep the existing button-driven state and keyboard triage handler behavior.

- [ ] **Step 5: Recompose OverviewTab**

Order content:

1. decision band;
2. blockers and next required action;
3. checklist/approval progress;
4. changed hardware surfaces;
5. technical metadata.

Do not change review calculations.

- [ ] **Step 6: Add workspace CSS**

Implement sticky command header, compact tabs, selected copper rule, horizontally scrollable tabs on narrow widths, decision band, and overview metric/evidence hierarchy.

- [ ] **Step 7: Run tests and verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/web/review-detail-tabs.test.ts tests/unit/web/keyboard-triage.test.ts tests/unit/web/review-canvas.test.ts`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/review/review-header.tsx apps/web/components/review/review-view.tsx apps/web/components/review/overview-tab.tsx apps/web/app/styles.css tests/unit/web/review-detail-tabs.test.ts tests/unit/web/keyboard-triage.test.ts
git commit -m "feat(ui): make review decisions the primary workspace signal"
```

---

### Task 6: Redesign Review Changes, Findings, Discussion, Checklist, and Evidence

**Files:**

- Modify: `apps/web/components/review/changes-tab.tsx`
- Modify: `apps/web/components/review/review-canvas.tsx`
- Modify: `apps/web/components/review/findings-tab.tsx`
- Modify: `apps/web/components/review/discussion-tab.tsx`
- Modify: `apps/web/components/review/checklist-approvals-tab.tsx`
- Modify: `apps/web/components/review/evidence-tab.tsx`
- Modify: `apps/web/components/review/decision-modal.tsx`
- Modify: `apps/web/components/review/approval-modal.tsx`
- Modify: `tests/unit/web/review-canvas.test.ts`
- Modify: `tests/unit/web/keyboard-triage.test.ts`
- Modify: `tests/e2e/review-lifecycle.spec.ts`
- Modify: `apps/web/app/styles.css`

**Interfaces:**

- Consumes: every existing tab prop and callback unchanged.
- Produces: canvas instrument toolbar, scan-first finding rows, engineering thread, explicit checklist/sign-off groups, evidence provenance chain, and accessible modal presentation.

- [ ] **Step 1: Add failing review-surface assertions**

Require these stable structures in unit/source tests:

```ts
expect(canvas).toContain('aria-label="Canvas instruments"');
expect(findings).toContain("finding-scan-row");
expect(findings).toContain("finding-detail-grid");
expect(discussion).toContain("engineering-thread");
expect(checklist).toContain("signoff-ledger");
expect(evidence).toContain("provenance-chain");
```

Add an E2E assertion that selecting a finding adds `data-selected="true"` and does not move focus unexpectedly.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/web/review-canvas.test.ts tests/unit/web/keyboard-triage.test.ts tests/unit/web/review-detail-tabs.test.ts`

Expected: FAIL on missing structures.

- [ ] **Step 3: Recompose Changes and canvas controls**

- Put canvas before BOM/file delta detail.
- Group layer/sheet, view mode, opacity, zoom, and reset controls beneath `aria-label="Canvas instruments"`.
- Use visible labels for every control.
- Preserve pointer, keyboard, zoom, pan, overlay, and snapshot behavior.

- [ ] **Step 4: Recompose Findings**

- Replace repeated nested `.panel` cards with `.finding-scan-row` articles.
- Put severity, diff state, rule, message, and disposition in the scan line.
- Put path, decision note, and assignment in `.finding-detail-grid`.
- Add `data-selected={isSelected}` and retain existing `j/k/e/f/o` behavior.
- Keep `content-visibility: auto` and `contain-intrinsic-size` on rows; do not claim true virtualization.

- [ ] **Step 5: Recompose Discussion, Checklist, and Evidence**

- Discussion: ordered engineering thread with author type, anchor, timestamp, status, body, and reply form.
- Checklist: requirement list separated from `.signoff-ledger`; invalidated approvals remain visibly historical.
- Evidence: ordered `.provenance-chain` containing source commit, run/revision, digest, artifact inventory, and offline verify command.
- Preserve all existing callbacks and demo state behavior.

- [ ] **Step 6: Rebuild modal presentation**

Keep current validation and callbacks. Ensure `role="dialog"`, `aria-modal="true"`, labelled title, close action, visible reason requirements, and mobile-safe action stacking.

- [ ] **Step 7: Add route CSS**

Implement dense scan rows, selected copper rule, split detail grid, canvas instrument bar, engineering thread rules, sign-off ledger, provenance chain, modal overlay, and responsive single-column behavior.

- [ ] **Step 8: Run unit and existing E2E tests**

Run: `corepack pnpm exec vitest run tests/unit/web/review-canvas.test.ts tests/unit/web/keyboard-triage.test.ts tests/unit/web/review-detail-tabs.test.ts && corepack pnpm exec playwright test tests/e2e/review-lifecycle.spec.ts`

Expected: all unit tests and all existing review lifecycle tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/components/review apps/web/app/styles.css tests/unit/web/review-canvas.test.ts tests/unit/web/keyboard-triage.test.ts tests/unit/web/review-detail-tabs.test.ts tests/e2e/review-lifecycle.spec.ts
git commit -m "feat(ui): rebuild the hardware review workspace"
```

---

### Task 7: Align Operational Routes and Add Settings Navigation

**Files:**

- Create: `apps/web/app/settings/layout.tsx`
- Modify: `apps/web/app/dashboard/page.tsx`
- Modify: `apps/web/app/setup/page.tsx`
- Modify: `apps/web/app/policies/page.tsx`
- Modify: `apps/web/app/evidence/page.tsx`
- Modify: `apps/web/app/insights/page.tsx`
- Modify: `apps/web/app/settings/billing/page.tsx`
- Modify: `apps/web/app/settings/security/page.tsx`
- Modify: `apps/web/app/settings/data/page.tsx`
- Modify: `apps/web/app/settings/tokens/page.tsx`
- Modify: `apps/web/app/settings/component-intelligence/page.tsx`
- Modify: `apps/web/components/run-investigation.tsx`
- Modify: `tests/unit/web/repository-setup-page.test.ts`
- Modify: `tests/unit/web/run-dashboard-page.test.ts`
- Modify: `apps/web/app/styles.css`

**Interfaces:**

- Consumes: current route content and server-side data behavior.
- Produces: `SettingsLayout({ children }: { children: ReactNode })`, `.settings-navigation`, `.operational-page`, and shared evidence/timeline/table styling.

- [ ] **Step 1: Write failing settings and route-frame tests**

Add assertions:

```ts
const settingsLayout = await readFile("apps/web/app/settings/layout.tsx", "utf8");
for (const route of ["billing", "security", "data", "tokens", "component-intelligence"]) {
  expect(settingsLayout).toContain(`/settings/${route}`);
}
expect(settingsLayout).toContain('aria-label="Settings navigation"');
expect(setupPage).toContain("setup-progress-index");
expect(runStyles).toContain("operational-page");
```

- [ ] **Step 2: Run tests and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/web/repository-setup-page.test.ts tests/unit/web/run-dashboard-page.test.ts tests/unit/web/app-shell.test.ts`

Expected: FAIL because settings layout and progress/frame classes do not exist.

- [ ] **Step 3: Implement settings layout**

```tsx
const destinations = [
  ["Billing", "/settings/billing"],
  ["Security", "/settings/security"],
  ["Data & retention", "/settings/data"],
  ["API tokens", "/settings/tokens"],
  ["Component intelligence", "/settings/component-intelligence"],
] as const;

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="settings-frame">
      <nav className="settings-navigation" aria-label="Settings navigation">...</nav>
      <div className="settings-content">{children}</div>
    </div>
  );
}
```

Do not add fake save controls to decorative pages.

- [ ] **Step 4: Adopt shared page framing**

Apply `.page-frame`, `.page-intro`, and `.operational-page` to dashboard, setup, policies, evidence, insights, settings, and run investigation pages. Preserve all forms, data fetches, actions, and route navigation.

- [ ] **Step 5: Make setup a guided sequence**

Add a visible `.setup-progress-index` for Select policy, Review files, Validate readiness, and Review permissions. Keep server-rendered query/form behavior unchanged.

- [ ] **Step 6: Style route-specific structures**

- Dashboard: repository readiness rows and current release risk first.
- Policies: registry rows with scope/inheritance/enforcement.
- Evidence: provenance registry rather than generic cards.
- Insights: textual WDRR state and table-compatible layout; no decorative empty chart.
- Runs: decision header, evidence rows, timelines, tables, tabs, and non-happy states aligned to shared tokens.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/web/repository-setup-page.test.ts tests/unit/web/run-dashboard-page.test.ts tests/unit/web/app-shell.test.ts tests/unit/web/run-state-pages.test.ts`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/dashboard apps/web/app/setup apps/web/app/policies apps/web/app/evidence apps/web/app/insights apps/web/app/settings apps/web/components/run-investigation.tsx apps/web/app/styles.css tests/unit/web/repository-setup-page.test.ts tests/unit/web/run-dashboard-page.test.ts tests/unit/web/app-shell.test.ts tests/unit/web/run-state-pages.test.ts
git commit -m "feat(ui): align operational and settings surfaces"
```

---

### Task 8: Harmonize the Public Landing Page

**Files:**

- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/landing.css`
- Modify: `tests/unit/web/home-page.test.ts`
- Modify: `tests/unit/web/layout-metadata.test.ts`

**Interfaces:**

- Consumes: current factual landing copy, installation/setup links, brand mark, theme toggle.
- Produces: a landing surface that shares Foundry tokens, geometry, buttons, and product screenshot language without adopting the application rail.

- [ ] **Step 1: Write failing alignment tests**

```ts
expect(landingCss).toContain("var(--foundry-canvas)");
expect(landingCss).toContain("var(--foundry-copper)");
expect(page).toContain("landing-product-proof");
expect(page).not.toMatch(/trusted by|customers|teams worldwide/i);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/web/home-page.test.ts tests/unit/web/layout-metadata.test.ts`

Expected: FAIL on missing shared tokens/proof class.

- [ ] **Step 3: Harmonize landing CSS and product proof**

- Replace independent palette values with Foundry aliases.
- Keep the strong Newsreader hero and existing factual narrative.
- Render product proof with the same decision band, status, evidence, and surface vocabulary as the product.
- Match button geometry, focus, and dark/light behavior.
- Remove any remaining oversized SaaS pills or ornamental effects.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/web/home-page.test.ts tests/unit/web/layout-metadata.test.ts tests/unit/web/theme-contrast.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/page.tsx apps/web/app/landing.css tests/unit/web/home-page.test.ts tests/unit/web/layout-metadata.test.ts
git commit -m "feat(ui): unify landing and product identity"
```

---

### Task 9: Add Product Accessibility and Responsive Browser Gates

**Files:**

- Create: `tests/unit/web/product-app-accessibility.test.tsx`
- Modify: `tests/e2e/review-lifecycle.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `apps/web/app/styles.css`

**Interfaces:**

- Consumes: completed application shell and route layouts.
- Produces: reproducible axe, keyboard, theme, viewport, and body-overflow gates.

- [ ] **Step 1: Write failing axe tests for representative product markup**

```tsx
it("has no WCAG A/AA violations in the review workspace", async () => {
  const html = renderToStaticMarkup(<ReviewView initialReview={DEMO_REVIEWS[0]!} />);
  document.body.innerHTML = html;
  const result = await axe(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
  expect(result.violations).toEqual([]);
});
```

Add representative shell, review, and settings structures. Configure only unavoidable DOM APIs already handled by existing axe tests; do not disable accessibility rules.

- [ ] **Step 2: Add failing Playwright mobile and shell tests**

```ts
test("mobile navigation is operable and the review page has no body overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/reviews/demo-review-1");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Product navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
```

Add a dark-theme screenshot/state test and desktop Reviews/review-detail navigation smoke.

- [ ] **Step 3: Run tests and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/web/product-app-accessibility.test.tsx && corepack pnpm exec playwright test tests/e2e/review-lifecycle.spec.ts`

Expected: at least the new drawer/overflow or axe assertions fail before final CSS/accessibility corrections.

- [ ] **Step 4: Fix only demonstrated accessibility and responsive failures**

Typical permitted fixes include label association, tab roles, focus order, mobile width constraints, table wrappers, dialog naming, and forced-colors visibility. Each fix must trace to a failing assertion.

- [ ] **Step 5: Run focused gates and verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/web/product-app-accessibility.test.tsx tests/unit/web/theme-contrast.test.ts && corepack pnpm exec playwright test tests/e2e/review-lifecycle.spec.ts`

Expected: zero axe violations and all Playwright tests pass at configured viewports.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/web/product-app-accessibility.test.tsx tests/e2e/review-lifecycle.spec.ts playwright.config.ts apps/web/app/styles.css
git commit -m "test(ui): enforce product accessibility and responsive behavior"
```

---

### Task 10: React Review, Browser Proof, and Full Verification

**Files:**

- Modify only files implicated by fresh failures.
- Do not add new product scope.

**Interfaces:**

- Consumes: all prior tasks.
- Produces: clean review, browser screenshots, and repository verification evidence.

- [ ] **Step 1: Run React best-practices review**

Review every modified TSX file for:

- unnecessary client boundaries;
- effect-derived state;
- unstable callbacks in global listeners;
- avoidable rerenders in findings/canvas;
- inline component declarations;
- accessible interactive semantics;
- serialized server-to-client payload growth.

Apply only findings tied to this UI change and run the nearest focused test after each correction.

- [ ] **Step 2: Run formatting, lint, and types**

Run:

```bash
corepack pnpm exec biome check apps/web tests/unit/web tests/e2e playwright.config.ts
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run cloud:typecheck
```

Expected: exit 0 for every command with no formatting changes left.

- [ ] **Step 3: Run unit and E2E suites**

Run:

```bash
corepack pnpm run test:unit
corepack pnpm run test:e2e
```

Expected: all test files pass; only pre-existing explicitly skipped tests remain skipped.

- [ ] **Step 4: Run production build and coverage**

Run:

```bash
corepack pnpm run cloud:build
corepack pnpm run coverage:cloud
```

Expected: standalone verification passes and all configured coverage thresholds pass, including `apps/web/**` statements and lines.

- [ ] **Step 5: Perform browser verification in both themes**

Start the dev server, then use `agent-browser` to verify `/`, `/work`, `/reviews`, `/reviews/demo-review-1`, `/dashboard`, and `/settings/billing`.

For every route:

- body has meaningful content;
- no Next.js error overlay;
- no console error;
- key navigation/actions appear in the interactive snapshot;
- screenshot at 1440px light and dark where the route is representative;
- review route screenshot at 375px.

Save screenshots under `TEMP/ui-verification/`; do not commit generated screenshots.

- [ ] **Step 6: Verify clean generated state**

Run:

```bash
git diff --check
git status --short
corepack pnpm run verify:dist
```

Revert only generated changes created by verification, such as `apps/web/next-env.d.ts`, when they differ solely because Next development mode rewrote the generated import. Never discard unrelated user changes.

- [ ] **Step 7: Commit final verified corrections**

```bash
git add <only-files-changed-by-final-corrections>
git commit -m "fix(ui): close Foundry verification findings"
```

Skip this commit when no final correction exists.

- [ ] **Step 8: Final acceptance audit**

Re-read all 10 acceptance criteria from the specification. For each criterion, cite one implementation file and one fresh verification command or browser observation. Report any unmet criterion as incomplete rather than weakening it.
