# Technical Premium Theme — Design Specification

Status: Approved design direction
Date: 2026-08-31
Scope: Shared visual token layer and global chrome of `apps/web` (`app/styles.css`, `app/landing.css`, `app/layout.tsx`, `components/theme-toggle.tsx`, `components/product-navigation.tsx`, `app/page.tsx`). Supersedes [2026-08-28-foundry-editorial-product-ui-design.md](2026-08-28-foundry-editorial-product-ui-design.md) as the active visual direction.

## 1. Product intent

Replace the current **Foundry Editorial** theme (warm ledger/paper material, copper/brass accent, serif display type, light+dark modes) with **Technical Premium**, a design system authored in Stitch (Google) for this project (`projects/2256533212898015536`, "BoardReadyOps Next Gen Concept"). Technical Premium reads as an engineering instrument panel rather than an editorial ledger: cool charcoal dark surfaces, cobalt-blue action color, structural borders instead of soft shadows, and a single dark mode.

This is a token-and-principle migration, not a page-by-page redesign. Existing page structure, components, and copy stay as-is; the shared CSS variable layer and a handful of global-chrome files change underneath them.

## 2. Problems being solved

- The product currently ships two material systems in spirit: a ledger/paper identity in the app shell and inconsistent treatment elsewhere.
- Maintaining both a light and dark palette doubles token surface area for a product whose Stitch reference design only specifies dark.
- Decorative ledger effects (paper grain, copper glow washes, soft shadows) fight with the "engineering instrument" positioning the Stitch reference establishes.
- Pill-shaped badges/chips and soft elevation shadows are inconsistent with the Stitch system's explicit rules (no pill shapes on interactive elements; elevation via border + tonal layering, not shadow).

## 3. Goals

1. Swap the CSS custom-property primitive layer to the Technical Premium palette without changing the semantic alias names (`--bro-*`) that every component already consumes.
2. Drop light mode entirely; ship one dark theme, matching the Stitch reference.
3. Replace serif display typography (Newsreader) with Inter everywhere; keep JetBrains Mono for technical/data values.
4. Apply Stitch's shape and elevation rules: 8px standard radius, 4px for small elements (badges/tooltips), no pill shapes, border-and-tone elevation instead of soft shadows.
5. Remove ledger-specific decorative effects (paper-grain background, copper glow washes) that don't fit the new material language.
6. Preserve all existing routes, data, component structure, and accessibility behavior (focus rings, skip link, reduced-motion handling).

## 4. Non-goals

- No per-screen redesign against the 29 individual Stitch screens — this pass changes the shared token/shape/typography layer only, not page layout or information architecture.
- No new UI dependencies; continue using plain CSS and existing React components.
- No changes to routes, APIs, auth, or data contracts.
- No redesign of the documentation site.
- Keeping light mode is out of scope (explicitly decided against in favor of dark-only).

## 5. Visual identity

### 5.1 Material language

Source: Stitch project `2256533212898015536`, design system "Technical Premium" (`designMd` on the project's `designTheme`).

- Foundation is a deep charcoal/navy dark mode (`#0b0e14` canvas, `#111827`-family elevated surfaces) — not the current near-black warm ledger tone.
- Structure comes from 1px borders and tonal layering, not soft shadows or blur. Level 2 surfaces (modals, dropdowns, overlays) get a lighter background and a more prominent border to read as "closer," never a drop shadow.
- Color is strictly functional: cobalt blue for action/selection/focus, and semantic hues reserved for status only (never decorative).
- Data density is prioritized: compact spacing, monospace for identifiers/technical values, sticky table headers.

### 5.2 Color tokens

Single dark theme (no light variant). Primitive values, to be substituted for the current `--foundry-*` block in `app/styles.css` while keeping the downstream `--bro-*` alias names unchanged so component CSS needs no edits:

| Token | Value | Role |
|---|---|---|
| Canvas (Level 0) | `#0b0e14` | Page background |
| Elevated surface (Level 1) | `#111827` | Cards, sidebar, header, panels |
| Overlay surface (Level 2) | `#1f2937` | Modals, dropdowns, floating menus |
| Sunken surface | `#070a0f` | Inputs, code previews, recessed wells |
| Border (universal) | `#1f2937` | Default separators |
| Border, strong/overlay | `#374151` | Level 2 borders, emphasized dividers |
| Text, primary | `#e1e2eb` | Body/heading text |
| Text, muted | `#c2c6d6` | Secondary text |
| Text, subtle | `#8c909f` | Tertiary/label text |
| Accent (primary action) | `#3b82f6` | Buttons, links, active nav, focus |
| Accent, strong/hover | `#4d8eff` | Hover/emphasis state of accent |
| Accent contrast | `#ffffff` | Text on solid accent buttons |
| Success | `#10b981` | Manufacturing-ready / pass states |
| Warning | `#f59e0b` | Sourcing risk / partial states |
| Danger | `#ef4444` | DRC violations / failures |
| Info | `#3b82f6` (shares accent hue) | Informational states — Stitch defines no separate info hue |

Status badge / alert fills follow the Stitch component rule: background is the semantic color at ~10% opacity (`color-mix(in srgb, var(--X) 10%, transparent)`), border and text are the full-intensity semantic color. This replaces the current fixed `--success-surface`/`--success-border`-style hex pairs with values derived from the single semantic hue, cutting redundant tokens.

### 5.3 Typography

- UI and headings: Inter only. Remove `Newsreader` from `app/layout.tsx` and the `--font-display` variable; headings render in Inter at semi-bold weight instead of serif normal-weight.
- Data/identifiers: JetBrains Mono, unchanged — part numbers, run IDs, checksums, timestamps.
- No other typography-stack changes; existing type scale (clamp-based heading sizes) stays.

### 5.4 Shape and elevation

- Standard radius: 8px for cards, buttons, inputs, panels (`--bro-radius-md`/`lg`/`xl` collapse to 8px).
- Small elements (badges, tooltips): 4px (`--bro-radius-sm`).
- No pill shapes (`border-radius: 999px`) on interactive or status elements. Current pill usages (`status-badge`, `result-count`, `link-list` items, `setup-preset-state`) move to 4–8px.
- Elevation comes from border + surface-level tone shift, not `box-shadow`. Existing `--bro-shadow`/`--bro-shadow-soft` usages are removed or reduced to a minimal 1px inset highlight consistent with the Level 2 overlay treatment — no ambient glow shadows.
- Decorative gradient washes tied to the copper/brass accent (grain background repeat, glow radial-gradients, `linear-gradient` accent washes on panels/heroes) are removed; surfaces rely on flat tone + border per the new material language.

### 5.5 Dark-only mode

- Delete `components/theme-toggle.tsx` and its usages in `components/product-navigation.tsx` and `app/page.tsx`.
- Delete the `@media (prefers-color-scheme: light)` block and the `:root[data-theme="light"]` block from `app/styles.css`.
- `color-scheme: dark` stays the sole value; no `data-theme` attribute branching remains.

## 6. Files touched

- `apps/web/app/styles.css` — primitive token block, light-mode blocks, pill-shape and shadow/gradient rules, radius scale.
- `apps/web/app/landing.css` — any Foundry-specific primitives/decoration referenced on the public landing page, brought in line with the same token values.
- `apps/web/app/layout.tsx` — remove `Newsreader` font loading and `--font-display-loaded` variable wiring.
- `apps/web/components/theme-toggle.tsx` — deleted.
- `apps/web/components/product-navigation.tsx` — remove `ThemeToggle` usage.
- `apps/web/app/page.tsx` — remove `ThemeToggle` usage.
- No other component files are expected to need edits, since they consume the unchanged `--bro-*` alias names.

## 7. Testing / acceptance

1. `pnpm run lint` and `pnpm run typecheck` and `pnpm run build` pass in `apps/web`.
2. Manual visual pass (dev server) across dashboard, reviews, run detail, policies, settings, and setup pages: no light-mode remnants, no pill-shaped badges, no leftover serif headings, acceptable contrast on the new dark palette.
3. Confirm no references to `data-theme`, `theme-toggle`, or `prefers-color-scheme: light` remain in `apps/web`.
4. Confirm focus-visible outline, skip link, and reduced-motion behavior still work (these are theme-token driven, not structural, so should carry over unchanged).
