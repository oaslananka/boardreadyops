# Marketing Landing Page Design

**Date:** 2026-08-23
**Scope:** The public root route (`/`) served at `boardreadyops.com`, plus a new product mark (icon/logo) and its favicon/OG usage
**Status:** Approved design (visual direction validated interactively; written spec pending user review)

## 1. Problem

The current root page (`apps/web/app/page.tsx`) is a bare `AppShell`-wrapped block: one heading, one paragraph, two links, and a three-item plain-text grid. It carries no visual identity — no logo beyond a two-letter "BR" text mark, no color system of its own (it inherits the dashboard's light-blue `--accent`), no illustration, no social-preview image. Now that `boardreadyops.com` is live (see the production DNS/tunnel commissioning done earlier this session), this page is the product's public front door and reads as an unfinished internal tool rather than a product.

## 2. Goals

The redesigned landing page MUST:

1. Read as a real product front door for **hardware engineers** evaluating BoardReadyOps, not an internal dashboard fragment.
2. Drive toward a single primary conversion action: **installing the GitHub App**.
3. Establish a **new, from-scratch visual identity** (palette, mark, wordmark) distinct from the current dashboard's light-blue theme, since no prior brand identity exists.
4. Ship a matching **favicon and Open Graph share image** so links posted externally look intentional.
5. Stay self-contained: it MUST NOT change the visual appearance of `/setup` or `/runs/*`, which keep their current `AppShell`/`styles.css` look until they get their own design cycles.

## 3. Non-goals

This design does NOT cover:

- The `/setup` onboarding flow (separate design cycle, not started).
- The `/runs/*` dashboard (separate design cycle, not started).
- PR comment or Check Run rendering (GitHub-native surfaces, out of scope here).
- A light/dark theme toggle — the landing page ships one theme (dark).
- A full brand guideline document — this spec fixes the tokens needed to build the page and mark; it is not a general brand book.
- Any backend/API change. This is a static-content route; no new server logic is required.

## 4. Visual identity

### 4.1 Direction

**Terminal / circuit-board.** Dark background, a single green accent, a faint PCB-trace grid texture, monospace accents for small labels. Validated against two other directions (a light "clean SaaS" style and a navy "blueprint" style) in an interactive mockup review; this direction was selected because it reads as authentic to KiCad/EDA tooling culture rather than generic SaaS, and it's consistent with the existing GitHub App icon's green.

### 4.2 Tokens

| Token | Value | Use |
|---|---|---|
| `--landing-bg` | `#0a0f0d` | Page background |
| `--landing-surface` | `#0f1713` | Cards, PR-preview panel |
| `--landing-border` | `#1e2e26` | Hairline borders |
| `--landing-accent` | `#3fe08a` | Primary accent (buttons, links, icon strokes) |
| `--landing-accent-soft` | `#9fc9ae` | Secondary/body text on dark |
| `--landing-accent-gradient` | `linear-gradient(135deg, #5CF5A0, #1CB876)` | Icon fills, progress/ring accents |
| `--landing-fg` | `#f4fff8` | Headings, high-emphasis text |
| `--landing-muted` | `#5a7a68` | Micro-copy, footnotes |

These are **scoped to the landing route** (see §6.2) — they do not replace `--accent`/`--accent-strong` in `apps/web/app/styles.css`, which the dashboard and setup flow keep using unchanged.

Background texture: a repeating 28px grid of 1px lines at ~7% opacity of the accent, used behind the hero and full-bleed sections — evokes a PCB layout grid without competing with content.

### 4.3 Mark

Selected concept: **QFP chip mark** (four-sided quad-flat-package silhouette) — a rounded square tile containing a smaller square "chip body" with comb-style pins on all four edges and a pin-1 indicator dot at the top-left corner (the standard orientation marker on a real IC package), with a checkmark drawn inside the chip body. This reads unambiguously as an integrated circuit rather than an abstract shape or a phone silhouette (two earlier iterations were rejected for looking hand-drawn and for reading as a phone, respectively, before converging on this one).

- **Icon-only** (favicon, small UI use): the tile alone, no wordmark.
- **Lockup** (nav, footer, OG image): icon at 24–32px next to the "BoardReadyOps" wordmark in a bold sans-serif (system font stack — no new font dependency), set in `--landing-fg`.
- Deliver as inline SVG (component, not a rasterized asset) so it scales cleanly from favicon to hero sizes; generate PNG/ICO favicon variants from the same SVG at build time.

### 4.4 Typography

System font stack (`-apple-system, "Segoe UI", Inter, sans-serif` — matches what's already implied by the mockups; no new web font to avoid a render-blocking font fetch on a marketing page where load speed matters). One monospace fallback (`ui-monospace, "SFMono-Regular", Consolas, monospace`) for the small status-badge label and the PR-preview panel.

## 5. Page structure

Single scrolling page, sections top to bottom, validated end-to-end in the mockup review:

1. **Nav** — mark + wordmark (left), links: Product / How it works / Docs (center-right), "Install on GitHub" button (right, always visible).
2. **Hero** — small pill badge ("Early access — built for KiCad"), H1 ("Release evidence that leads to a decision."), one-sentence subhead, two CTAs (primary "Install on GitHub", secondary "See an example PR"), one micro-trust line ("Free · Unlimited for open-source repositories").
3. **PR preview strip** — a mock GitHub PR check panel (traffic-light window chrome + a realistic BoardReadyOps pass/fail summary line) showing the product in its actual habitat (a pull request), not a generic screenshot.
4. **How it works** — three numbered steps (Install the GitHub App → Every PR is scanned automatically → Decide with evidence).
5. **Feature grid** — three cards, reusing the existing, already-good copy from the current page: "Decision first", "Bounded investigation", "Authoritative sources".
6. **Footer CTA** — short headline + one "Install on GitHub" button.
7. **Site footer** — keep the existing one-line disclosure from `AppShell` ("BoardReadyOps presents normalized release evidence...") since it's accurate and short; render it in the new dark theme rather than reusing `AppShell`'s footer markup (see §6.2).

Copy ships in **English** (confirmed) — the mockups used Turkish placeholder text in one iteration for review speed only; production copy matches the English strings shown in the final approved iteration (§5 items above give the substance of each section's copy).

## 6. Implementation approach

### 6.1 Route ownership

`apps/web/app/page.tsx` stops rendering `<AppShell>`. It gets its own root element and its own layout — a marketing page and a product dashboard are different surfaces and forcing them through the same shell is exactly what produced the current "dashboard fragment" look. `AppShell` remains unchanged and is still used by `/setup` and `/runs/*`.

### 6.2 Styling scope

New styles live in a **separate stylesheet** (e.g. `apps/web/app/(marketing)/landing.css` or a colocated CSS module — final filename is an implementation detail, not a design decision) imported only by the landing route, not appended to the shared `apps/web/app/styles.css`. This is what keeps §2.5 (no effect on `/setup` or `/runs/*`) true by construction rather than by discipline.

If the root route needs a route-group move (e.g. `app/(marketing)/page.tsx`) to cleanly separate layouts in the Next.js App Router, that's an acceptable implementation detail as long as `/` continues to resolve to this page.

### 6.3 Mark delivery

- New component, e.g. `apps/web/components/brand-mark.tsx`, exporting the SVG icon (parameterized size) and a lockup variant. Reused by the landing nav/footer and by favicon/OG generation.
- `apps/web/app/layout.tsx` gains `metadata.icons` (favicon) and `metadata.openGraph`/`metadata.twitter` (title, description, image) — currently absent entirely. The OG image is a simplified, static rendering of the hero concept (mark + headline on the dark/accent background), generated once as a build asset (Next.js `opengraph-image` convention is a reasonable fit) rather than hand-exported, so it can be regenerated if copy changes.

## 7. Accessibility

No automated accessibility test currently covers this route (`test:a11y` targets docs and report-HTML output, not the Next.js app). Manual verification is required before calling this done:

- Text-on-background contrast meets WCAG AA (the palette in §4.2 was chosen with this in mind: `--landing-fg` on `--landing-bg` and `--landing-accent-soft` on `--landing-bg` both need a contrast check against the final rendered CSS, not just the hex values, since `filter`/opacity layers can shift effective contrast).
- Full keyboard reachability of both CTAs and all nav links; visible focus states (the current `skip-link`/focus patterns in `styles.css` are a reasonable reference even though this route won't import that file directly).
- Semantic landmarks (`nav`, `main`, `footer`) and one `h1` per page, matching what the current page already does correctly.

## 8. Testing

This is a static content route with no new business logic, so the existing unit/integration suites are not the primary signal. Verification is:

1. `pnpm run cloud:dev` (or the project's equivalent dev-server script) and manually check the page renders correctly at common breakpoints (mobile/tablet/desktop) and in an actual browser — the mockups were reviewed as static HTML approximations, not the real Next.js/CSS render.
2. Manual accessibility pass per §7.
3. `pnpm run typecheck` / `pnpm run lint` — the route and new component must pass the project's existing static checks.
4. Confirm `/setup` and `/runs/*` are visually unchanged after the change (regression check for §2.5 / §6.2).
5. Verify the OG image renders correctly when the URL is shared (e.g., a social-card debugger) since this has no automated coverage.

## 9. Open questions for implementation

- Exact final copy for the "See an example PR" secondary CTA target (a real example PR/repo does not exist yet publicly) — needs a real link or should point to the docs walkthrough instead. Flag during implementation rather than block the design on it.
- Whether the mark also replaces the current "BR" text mark in `AppShell` immediately, or only ships on the landing route for now and migrates to `AppShell` when `/setup`/`/runs` get their own design pass. Recommendation: ship it in `AppShell` too, since it's a strict improvement over "BR" and carries no visual-direction risk for those routes — but this is a small enough call that it can be made during implementation rather than requiring another approval round.
