# Premium Product UI Design

**Date:** 2026-09-03
**Branch:** `feat/premium-product-ui`
**Baseline:** `origin/main@0b810e8cffe1f889d34707a98732c3132f5c4ca3`

## Purpose

BoardReadyOps should feel like a precision engineering control room: dense enough for hardware engineers, calm enough for release owners, and visually trustworthy enough for enterprise evaluation.

This work is not a decorative recolor. It establishes a coherent visual hierarchy for the authenticated product and applies it first to the four surfaces with the highest leverage: the design system foundation, application shell, dashboard, and run detail experience.

The existing semantic structure, accessibility behavior, authorization model, route model, and product data remain authoritative. The redesign changes presentation and information hierarchy without inventing unsupported backend capabilities.

## Product Principles

1. **Every pixel communicates engineering state.** Decorative elements are rare and purposeful.
2. **Brand color is not status color.** Brass identifies BoardReadyOps, selection, focus, and signature moments; green/amber/red retain functional meaning.
3. **Dense, not cramped.** The product prioritizes scanability and comparison over oversized marketing-style spacing.
4. **Borders and surface contrast before shadows.** Shadows are reserved for floating UI such as dialogs and menus.
5. **Technical data looks technical.** IDs, hashes, coordinates, versions, timestamps, and comparable numerals use the mono face and tabular figures.
6. **The answer appears before the detail.** Dashboard and run pages lead with operational state and required action.
## Chosen Approach

Three approaches were considered:

- **CSS-only facelift:** lowest risk, but it would preserve the current page hierarchy and card-heavy composition, so the visible improvement would remain incremental.
- **Full authenticated-web rewrite:** maximum freedom, but unnecessarily replaces accessible and tested structures that already work.
- **Progressive system redesign — chosen:** preserve route/data semantics and tested primitives, normalize the visual system, then restructure the highest-value surfaces using those primitives.

The chosen approach keeps `AppShell`, `StatusBadge`, `Panel`, existing navigation behavior, server loaders, and run semantics as foundations. Components may gain small presentation-oriented props or wrappers, but data contracts are not redesigned in this phase.

## Scope

### In scope

- Semantic design tokens and density rules in `apps/web/app/styles.css`.
- Authenticated product typography and technical-data typography.
- Product navigation grouping, rail styling, context bar, page framing, and mobile behavior.
- Shared primitives needed by the four target surfaces: compact metrics, section headers, status presentation, and table styling.
- `/dashboard` information hierarchy and repository overview.
- Run header, verdict, primary metrics, navigation, and summary composition for `/runs/[runId]`.
- Responsive layouts, keyboard/focus behavior, reduced motion, dark-mode contrast, and existing accessibility semantics.
- Visual-regression-friendly stable class contracts and unit/accessibility tests.

### Out of scope

- New backend data, aggregate APIs, billing behavior, auth behavior, repository permissions, or release semantics.
- Command palette implementation, saved filters, resizable table columns, or executive/engineer mode switching.
- Large PCB canvas feature additions such as layer switching or Open in KiCad deep links.
- Redesigning every settings/review/policy page in the first PR.
- Light mode.
## Visual System

### Color roles

The current `--foundry-*` primitives are reconciled into one semantic system rather than layered with another generation of aliases.

- Canvas: near-black graphite.
- Surface: cool graphite one step above canvas.
- Raised surface: used sparingly for selected/important regions.
- Lines: low-contrast neutral borders, with a stronger variant for table headers and focus boundaries.
- Identity brass: BoardReadyOps brand, active navigation indicator, selected hardware markers, and readiness signature treatment.
- Success green: verified/pass only.
- Warning amber: conditional, stale, waived, or requires attention.
- Danger red: blocking/fail/critical only.
- Info blue/cyan: running, queued, processing, informational state.

Identity brass must never replace functional status color. Existing accessible status semantics remain intact.

### Typography

Keep the already-loaded Inter and JetBrains Mono fonts to avoid another font/runtime dependency.

- Page title: approximately 22–26px, semibold; no oversized marketing headlines inside the authenticated app.
- Section title: 15–17px, semibold.
- Body: 13–14px for operational surfaces.
- Metadata: 12px.
- Technical values: JetBrains Mono, 12–13px, tabular figures.
- Readiness score may be larger as the single signature numeric element, but should not compete with the verdict.

### Geometry and density

Use the existing spacing scale but converge common controls and surfaces on 4/8/12/16/24/32/48px equivalents. Standard panel radii should visually land around 8–10px; buttons around 6–8px; pill radius is reserved for true badges. Remove decorative large-radius cards and most persistent shadows.
## Application Shell

The authenticated shell remains a left rail plus content stage, but it becomes a stronger navigation and context system.

Navigation groups are renamed and reordered around user intent:

- **Overview:** Dashboard, My Work.
- **Engineering:** Reviews and repository-centric work already reachable through the dashboard/repository pages.
- **Governance:** Policies, Evidence, Insights.
- **Manage:** Setup, Settings.

Do not add dead navigation entries for routes that do not exist. The rail retains compact mode and mobile drawer behavior.

The sticky context bar becomes useful instead of displaying only “Hardware release workspace.” It should provide a stable product-level context region and a visually consistent home for future repository/run context, while this phase avoids introducing fake organization/environment selectors.

Page framing becomes tighter and more consistent: smaller top padding, restrained page headings, stable max width, and clear separators between context, primary answer, and details. The global footer remains but should visually recede on authenticated operational pages.

## Dashboard

The dashboard must answer: **What needs my attention, and which repositories are healthy?**

No new aggregate backend endpoint is introduced. All summary values must be derived only from the repository groups already returned by `loadViewerRepositories`.

When data exists, the page gains an operational summary band above repository tables. It may show counts derivable from existing fields, such as repositories watched, repositories with blocking/open findings, supply alerts, and repositories without a run. Labels must accurately describe the available data; no trend percentages or historical claims are invented.

Repository groups remain tables because comparison is the correct interaction model. Tables become denser and more premium: clearer header separation, stronger row hover/focus, mono/tabular operational numbers, compact status alignment, and reduced card framing. Group containers should read as sections rather than floating dashboard cards.
## Run Detail

The run page is the signature product surface. Its first viewport should communicate repository, run identity, verdict, readiness, lifecycle state, and the path to investigation without requiring the user to scan multiple cards.

### Header hierarchy

Replace the oversized hero-card feeling with a compact operational header:

- repository name as the primary title;
- run ID and shortened commit SHA as mono metadata;
- public/private repository status as secondary metadata, not a prominent badge;
- readiness score in a restrained signature block using identity brass only as decorative framing;
- no gradient-heavy hero treatment or persistent large shadow.

### Verdict and navigation

`RunVerdictBanner` remains the authoritative “answer first” element and keeps functional success/warning/danger/info color. Its typography becomes tighter and its action remains explicit.

Run navigation stays semantic `<nav>`/links but visually becomes a compact tab strip integrated with the run context rather than a rounded card containing buttons. Active state uses identity brass for selection while preserving status colors elsewhere.

### Summary composition

Existing summary data is reorganized into fewer, stronger sections. Repeated `Panel` wrappers should be removed where a section divider or grouped definition block communicates hierarchy more clearly. Existing detail panels remain available when they represent genuinely distinct evidence or actions.

No score, domain breakdown, trend, or release claim may be added unless already present in `RunDetail`. The redesign must never make inferred state look verified.
## Interaction and Motion

Motion is limited to state transitions that improve orientation: rail collapse, menu/drawer transitions, hover/focus, tab selection, and selected hardware markers. Target duration is roughly 150–220ms using the existing motion variables.

`prefers-reduced-motion` behavior remains authoritative. No infinite glow, bouncing, parallax, animated gradients, or decorative loading motion is introduced.

Loading states must continue to communicate actual execution state where known. Generic skeletons are appropriate only for content whose state is not yet available; they must not replace meaningful run lifecycle labels.

## Responsive Behavior

Desktop is the primary operational layout, but the redesign must preserve full functionality at the existing mobile breakpoint.

- Rail becomes the current accessible mobile drawer.
- Operational metrics wrap into one or two columns without horizontal clipping.
- Repository tables remain horizontally scrollable rather than collapsing into ambiguous cards.
- Run tabs remain horizontally scrollable with a visible active state.
- The first viewport must not require a fixed minimum desktop width.

## Accessibility Requirements

Existing semantic headings, landmarks, skip link, `aria-current`, status text, focus restoration, and keyboard navigation are preserved or improved.

- WCAG A/AA axe coverage already present for product and run flows must remain green.
- Focus indicators must remain visible against every new surface.
- Status may never be communicated by color alone.
- Brass decorative treatments must meet contrast requirements where they carry interactive meaning.
- Reduced-motion behavior must be tested or covered by existing global CSS contracts.
- Tables retain correct `<th>`, scope, and row semantics.
## Implementation Boundaries

The first implementation should prefer editing existing files over introducing a new component library. Expected primary files are:

- `apps/web/app/styles.css`
- `apps/web/components/ui.tsx`
- `apps/web/components/product-navigation.tsx`
- `apps/web/app/dashboard/page.tsx`
- `apps/web/components/run-investigation.tsx`
- focused tests under `tests/unit/web/`

A small new component file is acceptable only when it creates a reusable, clearly bounded primitive rather than moving markup for cosmetic reasons.

The landing page is intentionally not redesigned in this phase. Authenticated product CSS changes must be scoped so public marketing behavior and metadata remain stable unless a shared token change is intentionally compatible.

## Testing Strategy

Implementation follows test-first development for behavior and stable UI contracts.

1. Add or adjust structural tests for navigation groups, dashboard summary semantics, run header hierarchy, and status vocabulary.
2. Preserve and extend axe-based accessibility tests for product shell and run investigation.
3. Add CSS/design-contract tests only for meaningful semantic guarantees, not exact pixel snapshots.
4. Run focused web tests during each slice.
5. Run lint, typecheck, structure, full unit, accessibility, build, and canonical `pnpm run verify` before PR.
6. Use the authenticated production audit workflow after merge if a valid short-lived session is available; this is verification, not a merge prerequisite.

Visual review should compare the authenticated dashboard and a representative run page at desktop and mobile widths. The review checks hierarchy, density, clipping, focus states, and accidental public-page regressions.
## Acceptance Criteria

The first premium UI phase is complete when all of the following are true:

- Authenticated pages present a coherent graphite + identity-brass visual system with functional status colors unchanged in meaning.
- Navigation, page frame, panels/sections, controls, tables, and run tabs share one density/radius/border language.
- Dashboard shows a useful operational summary derived only from existing repository data and keeps repository comparison in accessible tables.
- Run detail first viewport clearly exposes repository, run/commit identity, verdict, readiness, lifecycle notice when applicable, and investigation navigation.
- Major surfaces no longer read as a collection of large rounded shadow cards.
- Desktop and mobile layouts remain usable without content clipping or inaccessible navigation.
- Existing auth, routing, run semantics, and source-of-truth language are unchanged.
- Focus, keyboard, status-text, and axe A/AA tests remain green.
- Canonical repository verification and security gates pass.

## Rollout

This design is intentionally the first phase of a broader product polish program. After it ships and is visually reviewed in production, later phases can apply the same system to reviews/findings, repository detail, settings/governance surfaces, and signature PCB-canvas interactions.

The first phase should ship as one coherent PR because shell/token changes and the dashboard/run applications must be reviewed together. Follow-up feature additions such as command palette, advanced table interaction, and engineer/executive modes should remain separate PRs with their own product requirements.

## Non-goals and Guardrails

Premium does not mean more gradients, more animation, more rounded cards, or ornamental illustrations. The visual target is restrained, technical, and information-led.

No implementation step may weaken existing release/security gates, invent unavailable product data, expose tenant information, change authorization behavior, or use an unreliable heuristic as a verified status.
