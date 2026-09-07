# ADR-0017: Brand Identity and Design Token System ("Graphite & Iris")

- **Status:** Accepted
- **Date:** 2026-09-06
- **Supersedes:** the *Visual direction* section of [ADR-0016 — UI/UX Design System Migration](0016-ui-ux-design-system-migration.md). ADR-0016's colour-discipline rules, dual-theme requirement, information architecture, and guided empty-state pattern are **retained unchanged**.

---

## Context

ADR-0016 moved the app onto Tailwind + shadcn/ui and picked a visual direction described as "the GitHub-dark neighbourhood (`#0d1117` family)" with "a single electric blue (`#58a6ff` family)". The migration shipped on 2026-09-05/06. A follow-up audit of the shipped result found the direction was implemented literally — the palette is a value-for-value clone of GitHub Primer — and that the token system underneath it is incomplete in ways that make a premium result unreachable no matter how the individual pages are styled:

- **`globals.css` is 113 lines.** It defines colour and one radius. There are **no elevation tokens** (`shadow-lg` is applied ad hoc in 17 places with no system behind it), **no type-scale tokens** (the de-facto scale is `text-sm` × 279 and `text-xs` × 178 with arbitrary escapes), and no motion tokens.
- **The loaded fonts are unreachable.** `app/layout.tsx` loads Inter as `--font-ui-loaded` and JetBrains Mono as `--font-mono-loaded`, but neither is registered in `@theme`, so every `font-sans` / `font-mono` utility in the app silently resolves to the Tailwind default stack. The product has been shipping without the typeface it pays to download.
- **`--accent` aliases `--primary`.** shadcn's `outline` and `ghost` button variants use `hover:bg-accent`, which therefore fills the button with solid interaction blue on hover. Call sites worked around it with `hover:bg-accent/10`, which is the same bug wearing a hat.
- **`--info` also aliases `--primary`.** ADR-0016 reserved one accent for interaction; an info badge that renders in exactly the interaction colour defeats that.
- **Three conflicting brand marks.** `docs/assets/boardreadyops-mark.svg` is mint green (`#5cf5a0`), `apps/web/components/brand-mark.tsx` is electric blue (`#58a6ff`), and its checkmark stroke is warm cream (`#ece5d3`) left over from a retired copper theme. They are the same drawing in three palettes with no single source of truth.
- **Two nested `ThemeProvider`s.** `app/layout.tsx` mounts one and `components/app-shell.tsx` mounts a second, both writing the same storage key and the same class.

A clone of another product's palette cannot read as a distinctive premium tool, and the missing token layers are what prevent per-page polish from adding up to a coherent system.

## Decision

Replace the Primer-derived palette with a distinct identity, **Graphite & Iris**, and complete the token system beneath it.

### Colour

A warm graphite neutral ramp (hue ≈ 40°, very low saturation) carrying one cool iris accent. The warm/cool tension is what makes it read as designed rather than defaulted, and it is immediately distinguishable from Primer's blue-black.

**`.dark` (default theme)**

| token | value | token | value |
| --- | --- | --- | --- |
| `--background` | `#0e0d0c` | `--danger` | `#ff8a7a` |
| `--foreground` | `#f4f0e9` | `--danger-surface` | `#2a1613` |
| `--card` | `#171614` | `--danger-foreground` | `#2a1613` |
| `--card-foreground` | `#f4f0e9` | `--success` | `#5dd98a` |
| `--popover` | `#1c1a17` | `--success-surface` | `#10241a` |
| `--popover-foreground` | `#f4f0e9` | `--warning` | `#e8b44a` |
| `--primary` | `#9e93ff` | `--warning-surface` | `#2a2010` |
| `--primary-foreground` | `#141021` | `--info` | `#7cc4ff` |
| `--secondary` | `#232019` | `--info-surface` | `#10202e` |
| `--secondary-foreground` | `#f4f0e9` | `--border` | `#332f29` |
| `--muted` | `#171614` | `--border-strong` | `#4a443c` |
| `--muted-foreground` | `#a9a096` | `--input` | `#232019` |
| `--accent` | `#232019` | `--ring` | `#9e93ff` |
| `--accent-foreground` | `#f4f0e9` | | |

**`:root` (light theme)**

| token | value | token | value |
| --- | --- | --- | --- |
| `--background` | `#fbf9f6` | `--danger` | `#b42318` |
| `--foreground` | `#16130f` | `--danger-surface` | `#fdecea` |
| `--card` | `#ffffff` | `--danger-foreground` | `#ffffff` |
| `--card-foreground` | `#16130f` | `--success` | `#12704a` |
| `--popover` | `#ffffff` | `--success-surface` | `#e8f6ee` |
| `--popover-foreground` | `#16130f` | `--warning` | `#8a5a00` |
| `--primary` | `#4a3fd4` | `--warning-surface` | `#fdf2d8` |
| `--primary-foreground` | `#ffffff` | `--info` | `#0b5fa5` |
| `--secondary` | `#efeae1` | `--info-surface` | `#e4f1fc` |
| `--secondary-foreground` | `#16130f` | `--border` | `#ded6c9` |
| `--muted` | `#f2eee7` | `--border-strong` | `#c4b9a8` |
| `--muted-foreground` | `#6b6259` | `--input` | `#ded6c9` |
| `--accent` | `#f2eee7` | `--ring` | `#4a3fd4` |
| `--accent-foreground` | `#16130f` | | |

**Measured contrast.** Pairs marked ★ are asserted by `tests/unit/web/theme-contrast.test.ts` and `run-design-system.test.ts` in both blocks.

| pair | dark | light |
| --- | --- | --- |
| ★ `foreground` / `background` | 17.09 | 17.62 |
| ★ `card-foreground` / `card` | 15.92 | 18.52 |
| ★ `muted-foreground` / `background` | 7.54 | 5.68 |
| ★ `danger` / `danger-surface` | 7.50 | 5.75 |
| ★ `success` / `success-surface` | 9.12 | 5.48 |
| ★ `warning` / `warning-surface` | 8.43 | 5.33 |
| ★ `info` / `info-surface` | 8.83 | 5.72 |
| ★ `danger-foreground` / `danger` | 7.50 | 6.57 |
| ★ `primary-foreground` / `primary` | 7.17 | 7.11 |
| `muted-foreground` / `card` | 7.02 | 5.97 |
| `popover-foreground` / `popover` | 15.29 | 18.52 |
| `primary` / `background` (non-text ≥ 3) | 7.46 | 6.77 |
| `danger` / `card` | 7.89 | 6.57 |
| `success` / `card` | 10.12 | 6.10 |
| `warning` / `card` | 9.52 | 5.93 |
| `info` / `card` | 9.64 | 6.57 |

Every asserted pair clears WCAG AA (4.5:1) in both themes with headroom; the tightest is 5.33. `--border` is a deliberately low-contrast divider — axe's `color-contrast` rule evaluates text only — and `--border-strong` exists for table rules, chart gridlines, and anything that must actually be seen.

**Two semantic changes carried by this ADR:**

1. `--accent` is no longer an alias of `--primary`. It is the subtle hover surface shadcn's variants assume. Call sites that wrote `hover:bg-accent/10` to work around the old aliasing now write `hover:bg-accent`.
2. `--info` is no longer an alias of `--primary`, so an info badge can never be mistaken for a primary control.
3. `--danger-foreground` is added. `--danger` is tuned as *text on* `--danger-surface`; the destructive button
   inverts that and fills with it, and the previous `bg-danger text-white` pairing failed contrast at 2.29:1 in
   dark (it failed under the old palette too). Only `danger` needs this — no other status colour has a solid fill.

**Colour tokens must remain 6-digit hex.** The two contrast tests parse them with `--name:\s*(#[0-9a-fA-F]{6})` and read each theme block with `[^}]*`. `oklch()` / `hsl()` values throw, and a nested rule inside either block truncates the parse.

### Geometry, type, elevation, motion

- **Radius `0.25rem`** (up from `0.125rem`). Still editorial rather than friendly-SaaS, but 2px read as an artifact rather than a decision at the sizes this UI actually uses.
- **Elevation:** three tokens per theme (`--elevation-1..3` → `shadow-e1..e3`), replacing ad-hoc `shadow-lg`. The dark ramp pairs shadow with a hairline light inset, because pure shadow is invisible on a near-black ground.
- **Type scale:** `--text-{display,title,heading,body,meta,micro}`, **additive**. Overriding `--text-sm` would silently restyle 279 existing call sites in one change; new surfaces adopt the semantic names and old ones migrate opportunistically.
- **Motion:** `--ease-out-expo`, `--ease-emphasis`, and a 150ms default transition duration, plus a global `prefers-reduced-motion` reset in `@layer base`.
- **Fonts:** `--font-sans` / `--font-mono` / `--font-display` are registered in `@theme inline`, which is what finally connects the app to the faces `next/font` already downloads. `Instrument_Serif` is added as the display face, used only for page titles and the wordmark.

### Brand mark

One drawing, no literal hex in the app version. A quad-flat-pack silhouette — chip body, three pins per side, pin-1 dot — with the outline following `currentColor` and the accent following `var(--primary)`, so light, dark, and the compact 16px rail are all served by the same file. `docs/assets/boardreadyops-mark.svg` is redrawn with identical geometry against a light docs ground.

The checkmark is **removed**. A check is what every status badge in the app already means; ADR-0016 reserved that vocabulary for status, and spending it on the logo dilutes the one signal the product exists to deliver.

`app/icon.tsx` and `app/opengraph-image.tsx` render through Satori, which cannot resolve CSS custom properties, so `BrandMarkIcon` accepts explicit `accentColor` / `outlineColor` overrides for those two call sites only.

### Theme wiring

- The nested `ThemeProvider` in `components/app-shell.tsx` is **deleted**. `app/layout.tsx` mounts the single provider, now with an explicit `storageKey` and `disableTransitionOnChange`.
- `class="dark"` **stays** on `<html>`. It is not a bug: it is the SSR default matching `defaultTheme="dark"` and it is what prevents a light flash before the bootstrap script runs.
- `enableSystem` **stays off**. Playwright's default emulated preference is `prefers-color-scheme: light`; enabling system preference would silently move the entire E2E, axe, and visual-baseline suite to the light theme in one step. Light-theme coverage is added deliberately, with an explicit `test.use({ colorScheme })`, as its own change.

## Consequences

- The three colour-token contract tests are updated to the new values, and `foundry-ui-contract.test.ts` is upgraded from a hex allowlist into a **structural** contract (fonts wired, elevation present in both themes, `--accent` and `--info` distinct from `--primary`) so a future rebrand fails on structure rather than on a string.
- `tests/unit/web/__snapshots__/run-investigation-accessibility.test.ts.snap` is regenerated. The diff must contain only class-string changes, the removed nested next-themes bootstrap script, and the new brand SVG.
- The five visual baselines in `tests/e2e/visual.spec.ts-snapshots/` were already stale (last updated 2026-09-04, before the Tailwind migration landed). They are deleted here and regenerated from a `qa-nightly` dispatch after merge rather than kept as known-bad references.
- Fonts now render as Inter and JetBrains Mono for the first time, which changes metrics on every page. This is the intended fix, not a regression.

## Accepted debt

Recorded here so it is not rediscovered:

1. **`components/dialog.tsx` remains bespoke rather than Radix.** `tests/unit/web/dialog.test.ts` is coupled to its happy-dom implementation, and the in-code comment at `dialog.tsx:54-62` documents why the native/Radix path is not reproducible there. Converging it costs one test rewrite, three modal call sites, and snapshot churn — sequenced as its own change.
2. **Four of the seven hand-rolled tables are not migrated to `DataTable`** in this pass: `review/changes-tab.tsx`, `run-investigation.tsx`, `checklist-approvals-tab.tsx`, `review/evidence-tab.tsx`. All four sit under snapshot or keyboard-triage tests whose diffs would become unreviewable alongside a rebrand.
3. **`apps/web/app/page.tsx` (the landing page) is not redesigned here.** It inherits the new tokens automatically. A structural redesign has to clear `visibleTextRatio > 0.15`, an exact structured-data `@graph`, and a Lighthouse accessibility error gate, which makes it the highest-risk file in the repository and worth isolating.
4. **`components/intake/manufacturer-intake-widget.tsx` still simulates its analysis** with a `setTimeout`. Its dead CSS is repaired here and an explicit "Demo preview" alert now states that nothing is uploaded, but the route either becomes real or is removed.
5. **`--text-sm` / `--text-xs` call sites are not migrated** to the semantic scale.
