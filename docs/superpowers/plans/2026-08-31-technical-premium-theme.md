# Technical Premium Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Foundry Editorial theme (warm ledger palette, serif display type, light+dark modes) with the Stitch-authored Technical Premium theme (cool charcoal dark, cobalt accent, Inter-only type, dark-only) across `apps/web`, by swapping the shared CSS token layer and removing light-mode/serif-font/theme-toggle infrastructure — without touching per-page component structure.

**Architecture:** The existing CSS already routes every component through a semantic alias layer (`--bro-*`) that reads from a primitive layer (`--foundry-*` plus a few standalone primitives). Because components only ever consume `--bro-*` names, the primitive layer can be redefined in one place (`:root` in `app/styles.css`) and the new palette propagates everywhere automatically — no per-component CSS edits needed for recoloring. Separately, a small number of *hardcoded* literal values (pill `border-radius: 999px`, the Newsreader font load, the light-mode blocks, the theme toggle) don't route through variables and need direct edits.

**Tech Stack:** Next.js app router, plain CSS custom properties (no CSS-in-JS, no Tailwind), `next/font/google` for font loading.

**Spec:** [docs/superpowers/specs/2026-08-31-technical-premium-theme-design.md](../specs/2026-08-31-technical-premium-theme-design.md)

## Global Constraints

- Keep all existing `--bro-*` semantic alias names unchanged — only their source values change. No component `.tsx`/`.css` file outside the ones listed below should need edits.
- Single dark theme only. No `data-theme` attribute, no `prefers-color-scheme: light` branch, no theme toggle UI.
- Inter for all UI/heading text; JetBrains Mono unchanged for technical/data values. No serif font anywhere.
- Standard radius 8px, small elements (badges/chips) 4px. No `border-radius: 999px` on text badges/chips. A circular *indicator dot* (not a text pill) is not a "pill" under this rule and stays round.
- No new npm dependencies.
- Preserve routes, APIs, auth, and data contracts — this is a visual-layer-only change.

---

### Task 1: Rewrite the root token block in `app/styles.css`

**Files:**
- Modify: `apps/web/app/styles.css:9-114` (the `:root` block)

**Interfaces:**
- Produces: every `--bro-*` and `--foundry-*` variable name unchanged in name, new hex/values per the Technical Premium palette. Every later task and every existing component relies on these exact names still existing: `--foundry-canvas`, `--foundry-canvas-subdued`, `--foundry-surface`, `--foundry-surface-strong`, `--foundry-ink`, `--foundry-ink-muted`, `--foundry-ink-subtle`, `--foundry-line`, `--foundry-line-strong`, `--foundry-copper`, `--foundry-copper-strong`, `--foundry-copper-soft`, `--foundry-brass`, `--bro-bg`, `--bro-bg-elevated`, `--bro-surface`, `--bro-surface-strong`, `--bro-surface-sunken`, `--bro-border`, `--bro-border-strong`, `--bro-border-accent`, `--bro-text`, `--bro-text-muted`, `--bro-text-subtle`, `--bro-accent`, `--bro-accent-strong`, `--bro-accent-soft`, `--bro-accent-contrast`, `--bro-focus`, `--bro-shadow`, `--bro-shadow-soft`, `--bro-radius-sm/md/lg/xl`, `--success/-surface/-border`, `--warning/-surface/-border`, `--danger/-surface/-border`, `--info/-surface/-border`, `--background-glow`, `--shadow-soft-color`, `--font-display`.

- [ ] **Step 1: Replace the `:root` block**

Replace `apps/web/app/styles.css` lines 9–114 (from `:root {` through the closing `}` right before the light-theme media query comment) with:

```css
:root {
  color-scheme: dark;
  /* Technical Premium material system (Stitch project 2256533212898015536).
     Existing --bro-* semantic aliases below consume these primitives, so component
     CSS never references --foundry-* directly except through the aliases. */
  --foundry-canvas: #0b0e14;
  --foundry-canvas-subdued: #111827;
  --foundry-surface: #111827;
  --foundry-surface-strong: #1f2937;
  --foundry-ink: #e1e2eb;
  --foundry-ink-muted: #c2c6d6;
  --foundry-ink-subtle: #8c909f;
  --foundry-line: #1f2937;
  --foundry-line-strong: #374151;
  --foundry-copper: #3b82f6;
  --foundry-copper-strong: #4d8eff;
  --foundry-copper-soft: rgba(59, 130, 246, 0.12);
  --foundry-brass: #4d8eff;
  --rail-width: 248px;
  --rail-width-compact: 72px;
  --bro-bg: #0b0e14;
  --bro-bg-elevated: #111827;
  --bro-surface: #111827;
  --bro-surface-strong: #1f2937;
  --bro-surface-sunken: #070a0f;
  --bro-border: #1f2937;
  --bro-border-strong: #374151;
  --bro-border-accent: rgba(59, 130, 246, 0.5);
  --bro-text: #e1e2eb;
  --bro-text-muted: #c2c6d6;
  --bro-text-subtle: #8c909f;
  --bro-accent: #3b82f6;
  --bro-accent-strong: #4d8eff;
  --bro-accent-soft: #4d8eff;
  --bro-accent-contrast: #ffffff;
  --bro-focus: #3b82f6;
  /* Technical Premium reads elevation from border + tonal layering, not shadow.
     These stay defined (every panel/header/card references them) but are
     flattened to near-nothing so nothing needs a per-selector edit. */
  --bro-shadow: none;
  --bro-shadow-soft: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  /* Ledger geometry is gone: 8px is the universal standard, 4px for small elements. */
  --bro-radius-sm: 4px;
  --bro-radius-md: 8px;
  --bro-radius-lg: 8px;
  --bro-radius-xl: 8px;
  --bro-motion-fast: 140ms;
  --bro-motion-medium: 220ms;
  --bro-ease: cubic-bezier(0.2, 0.8, 0.2, 1);

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
  --radius-sm: var(--bro-radius-sm);
  --radius-md: var(--bro-radius-md);
  --radius-lg: var(--bro-radius-lg);
  --shadow: var(--bro-shadow);

  --code: #c2c6d6;
  --skip-text: #0b0e14;
  /*
   * Status badge/alert fills follow the Stitch rule: ~10% opacity of the semantic
   * hue for the surface, full-intensity hue for border and text.
   */
  --success: #10b981;
  --success-surface: color-mix(in srgb, #10b981 10%, transparent);
  --success-border: #10b981;
  --warning: #f59e0b;
  --warning-surface: color-mix(in srgb, #f59e0b 10%, transparent);
  --warning-border: #f59e0b;
  --danger: #ef4444;
  --danger-surface: color-mix(in srgb, #ef4444 10%, transparent);
  --danger-border: #ef4444;
  --info: #3b82f6;
  --info-surface: color-mix(in srgb, #3b82f6 10%, transparent);
  --info-border: #3b82f6;
  --background-glow: transparent;
  --header-backdrop: rgba(11, 14, 20, 0.9);
  --header-border: rgba(31, 41, 55, 0.9);
  --shadow-soft-color: rgba(0, 0, 0, 0.35);
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-7: 3rem;
  --content-width: 78rem;
  /*
   * Technical Premium uses Inter for every text role, including headings — no
   * separate display face. --font-display is kept only so the small number of
   * consumers below don't need edits; it now resolves to the same stack as --font-ui.
   */
  --font-display: var(--font-ui-loaded, Inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-ui: var(--font-ui-loaded, Inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: var(--font-mono-loaded, "JetBrains Mono"), "SFMono-Regular", Consolas, monospace;
}
```

- [ ] **Step 2: Verify the file still parses as valid CSS**

Run: `node -e "require('node:fs').readFileSync('apps/web/app/styles.css','utf8')"` from the repo root (a cheap sanity read that the file is still there and readable; the real check is the build in Task 7).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/styles.css
git commit -m "feat(web): swap Foundry Editorial tokens for Technical Premium palette"
```

---

### Task 2: Remove the light-mode CSS blocks

**Files:**
- Modify: `apps/web/app/styles.css` (the `@media (prefers-color-scheme: light)` block and the `:root[data-theme="light"]` block that follow the `:root` block from Task 1)

**Interfaces:**
- Consumes: nothing new.
- Produces: no `data-theme` or `prefers-color-scheme: light` selectors remain in the file (verified in Task 7).

- [ ] **Step 1: Delete both blocks**

Find and delete the entire comment + `@media (prefers-color-scheme: light) { :root:not([data-theme="light"]) { ... } }` block (originally lines 116–181, right after the `:root` block edited in Task 1), **and** the entire `:root[data-theme="light"] { ... }` block that immediately follows it (originally lines 183–234). After deletion, the next rule after the `:root` block from Task 1 should be:

```css
* {
  box-sizing: border-box;
}
```

- [ ] **Step 2: Grep to confirm removal**

Run: `grep -n "prefers-color-scheme: light\|data-theme" apps/web/app/styles.css`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/styles.css
git commit -m "feat(web): drop light-mode theme from styles.css"
```

---

### Task 3: Remove the ledger paper-grain/glow background

**Files:**
- Modify: `apps/web/app/styles.css` (the `body { ... }` rule, originally around lines 245–263)

**Interfaces:**
- Consumes: `--background` (from Task 1).
- Produces: flat body background, no `repeating-linear-gradient`/`radial-gradient` layers.

- [ ] **Step 1: Replace the `body` rule's `background` declaration**

Find:

```css
body {
  min-width: 20rem;
  margin: 0;
  /* A faint ruled grain, the way a ledger page is ruled, instead of an ambient accent glow. */
  background:
    repeating-linear-gradient(
      180deg,
      color-mix(in srgb, var(--bro-text) 2%, transparent) 0 1px,
      transparent 1px 2.25rem
    ),
    radial-gradient(ellipse 60% 40% at 50% -8%, var(--background-glow), transparent 70%), var(--background);
  color: var(--text);
```

Replace with:

```css
body {
  min-width: 20rem;
  margin: 0;
  background: var(--background);
  color: var(--text);
```

- [ ] **Step 2: Grep to confirm removal**

Run: `grep -n "repeating-linear-gradient" apps/web/app/styles.css`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/styles.css
git commit -m "feat(web): remove ledger paper-grain body background"
```

---

### Task 4: Flatten hardcoded pill shapes to the standard radius token

**Files:**
- Modify: `apps/web/app/styles.css:900` (`.status-badge`)
- Modify: `apps/web/app/styles.css:1548` (`.result-count`)
- Modify: `apps/web/app/styles.css:2165` (`.setup-preset-state`)
- Modify: `apps/web/app/styles.css:2320` (`.run-repository-kind`)
- Modify: `apps/web/app/landing.css:368` (`.landing-state-pill, .landing-row-state`)

**Interfaces:**
- Consumes: `--bro-radius-sm` (4px, from Task 1).
- Produces: no text-chip/badge in the app uses `border-radius: 999px`. `.live-refresh-indicator` (`apps/web/app/styles.css:2026`, a round status dot, not a text chip) is explicitly left untouched — it must stay circular.

- [ ] **Step 1: Edit `.status-badge`**

In `apps/web/app/styles.css`, in the `.status-badge` rule:

```css
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--surface-muted);
```

becomes:

```css
  border: 1px solid var(--border-strong);
  border-radius: var(--bro-radius-sm);
  background: var(--surface-muted);
```

- [ ] **Step 2: Edit `.result-count`**

In `apps/web/app/styles.css`, in the `.result-count` rule:

```css
  border: 1px solid var(--bro-border);
  border-radius: 999px;
  margin: var(--space-4) 0;
  background: var(--bro-bg-elevated);
```

becomes:

```css
  border: 1px solid var(--bro-border);
  border-radius: var(--bro-radius-sm);
  margin: var(--space-4) 0;
  background: var(--bro-bg-elevated);
```

- [ ] **Step 3: Edit `.setup-preset-state`**

In `apps/web/app/styles.css`, in the `.setup-preset-state` rule:

```css
  border: 1px solid var(--bro-border);
  border-radius: 999px;
  margin: var(--space-3) 0 0;
  color: var(--bro-text-subtle);
```

becomes:

```css
  border: 1px solid var(--bro-border);
  border-radius: var(--bro-radius-sm);
  margin: var(--space-3) 0 0;
  color: var(--bro-text-subtle);
```

- [ ] **Step 4: Edit `.run-repository-kind`**

In `apps/web/app/styles.css`, in the `.run-repository-kind` rule:

```css
  border: 1px solid var(--bro-border);
  border-radius: 999px;
  margin: 0 0 var(--space-3);
  background: color-mix(in srgb, var(--bro-surface) 82%, transparent);
```

becomes:

```css
  border: 1px solid var(--bro-border);
  border-radius: var(--bro-radius-sm);
  margin: 0 0 var(--space-3);
  background: color-mix(in srgb, var(--bro-surface) 82%, transparent);
```

- [ ] **Step 5: Edit `.landing-state-pill, .landing-row-state`**

In `apps/web/app/landing.css`, in the `.landing-state-pill, .landing-row-state` rule:

```css
  border: 1px solid var(--bro-border-accent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bro-accent) 10%, transparent);
```

becomes:

```css
  border: 1px solid var(--bro-border-accent);
  border-radius: var(--bro-radius-sm);
  background: color-mix(in srgb, var(--bro-accent) 10%, transparent);
```

- [ ] **Step 6: Grep to confirm only the indicator dot remains circular**

Run: `grep -n "999px" apps/web/app/styles.css apps/web/app/landing.css`
Expected: exactly one match, `apps/web/app/styles.css:2026` (`.live-refresh-indicator`, unchanged by design).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/styles.css apps/web/app/landing.css
git commit -m "feat(web): flatten pill-shaped badges to standard radius"
```

---

### Task 5: Remove the Newsreader serif font

**Files:**
- Modify: `apps/web/app/layout.tsx`

**Interfaces:**
- Consumes: nothing new (Task 1 already repointed `--font-display` to the Inter stack).
- Produces: `RootLayout` no longer loads or references a display font; `<html>` no longer carries a `display.variable` class.

- [ ] **Step 1: Remove the `Newsreader` import and `display` font config**

In `apps/web/app/layout.tsx`, change:

```tsx
import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import "./styles.css";

// Self-hosted at build time, so no request leaves the reader's browser to a font host.
const display = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600"],
  variable: "--font-display-loaded",
  display: "swap",
});

const body = Inter({
```

to:

```tsx
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./styles.css";

const body = Inter({
```

- [ ] **Step 2: Drop `display.variable` from the `<html>` class list**

Change:

```tsx
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
```

to:

```tsx
    <html lang="en" className={`${body.variable} ${mono.variable}`}>
```

(`suppressHydrationWarning` is dropped here too — its sole purpose per the existing comment was to allow the pre-paint theme script to set `data-theme` without a hydration mismatch; Task 6 removes that script.)

- [ ] **Step 3: Verify no other file references the removed font variable**

Run: `grep -rn "font-display-loaded\|Newsreader" apps/web`
Expected: no output (Task 1 already changed the one CSS reference to the loaded-var name away from Newsreader as a literal fallback; this checks nothing else names the old font).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/layout.tsx
git commit -m "feat(web): remove Newsreader display font, Inter-only typography"
```

---

### Task 6: Remove the theme toggle and pre-paint theme script

**Files:**
- Delete: `apps/web/components/theme-toggle.tsx`
- Modify: `apps/web/components/product-navigation.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/layout.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: no component imports or renders `ThemeToggle`; `RootLayout`'s `<head>` no longer sets `data-theme` from `localStorage`.

- [ ] **Step 1: Delete the theme toggle component**

Delete `apps/web/components/theme-toggle.tsx`.

- [ ] **Step 2: Remove its use from `product-navigation.tsx`**

In `apps/web/components/product-navigation.tsx`, remove the import:

```tsx
import { ThemeToggle } from "./theme-toggle.js";
```

and remove the `<ThemeToggle />` usage:

```tsx
          <div className="product-rail-actions">
            <ThemeToggle />
            <button
```

becomes:

```tsx
          <div className="product-rail-actions">
            <button
```

- [ ] **Step 3: Remove its use from `page.tsx`**

In `apps/web/app/page.tsx`, remove the import:

```tsx
import { ThemeToggle } from "../components/theme-toggle.js";
```

and remove the `<ThemeToggle />` usage:

```tsx
          <Suspense fallback={null}>
            <LandingNavActions />
            <ThemeToggle />
          </Suspense>
```

becomes:

```tsx
          <Suspense fallback={null}>
            <LandingNavActions />
          </Suspense>
```

- [ ] **Step 4: Remove the pre-paint theme script from `layout.tsx`**

In `apps/web/app/layout.tsx`, remove the entire `<head>` block:

```tsx
      <head>
        {/* Runs before the first paint so a reader who chose a theme never sees the other one
            flash first. <html> carries the page background, so the attribute has to land here
            rather than once the body renders. Readers who never chose are left alone, and the
            stylesheet answers their system preference instead. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a literal with no interpolation, and it has to run before paint.
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("boardreadyops-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}',
          }}
        />
      </head>
      <body>{children}</body>
```

becomes:

```tsx
      <body>{children}</body>
```

- [ ] **Step 5: Grep to confirm no leftover references**

Run: `grep -rln "ThemeToggle\|theme-toggle\|boardreadyops-theme" apps/web`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/components/theme-toggle.tsx apps/web/components/product-navigation.tsx apps/web/app/page.tsx apps/web/app/layout.tsx
git commit -m "feat(web): remove theme toggle, ship dark-only Technical Premium theme"
```

---

### Task 7: Build, lint, and visual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the web app's checks**

From the repo root:

```bash
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm --filter @boardreadyops/web run build
```

(`lint` and `typecheck` are root-level repo-wide scripts — biome and `tsc --noEmit` across the whole monorepo, from `package.json`. `build` is run scoped to the web app since the root `build` script builds the CLI bundle, not the Next.js app; `apps/web/package.json`'s `build` script is `next build --webpack && node ../../scripts/build-control-plane-worker.mjs`.)

Expected: all three exit 0.

- [ ] **Step 2: Full-repo sweep for leftover theme artifacts**

```bash
grep -rn "data-theme\|prefers-color-scheme: light\|ThemeToggle\|Newsreader\|boardreadyops-theme" apps/web --include="*.ts" --include="*.tsx" --include="*.css"
```

Expected: no output.

```bash
grep -n "999px" apps/web/app/styles.css apps/web/app/landing.css
```

Expected: exactly one match (`.live-refresh-indicator`).

- [ ] **Step 3: Manual visual smoke test**

Start the dev server (`corepack pnpm --filter @boardreadyops/web run dev`, or the project's usual `run`/`dev` task) and open, at minimum: `/`, `/dashboard`, `/reviews`, `/runs/[any seeded run]`, `/policies`, `/settings/billing`, `/setup`. Confirm: dark charcoal background (not warm/black ledger tone), cobalt-blue accents on buttons/active nav/focus rings, no light-mode flash, no pill-shaped badges except the small round `live-refresh-indicator` dot, headings render in Inter (no serif). Stop the dev server when done.

- [ ] **Step 4: Commit only if Step 1–3 required fixes**

If any verification step required a code fix, stage and commit it with a message describing what broke and why (e.g. `fix(web): correct selector missed in pill-radius sweep`). If everything passed clean, there is nothing to commit for this task.
