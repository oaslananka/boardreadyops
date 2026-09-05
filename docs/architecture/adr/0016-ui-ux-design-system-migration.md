# ADR-0016: UI/UX Design System Migration (Tailwind + shadcn/ui)

- **Status:** Proposed
- **Date:** 2026-09-05
- **Relates to:** [ADR-0015 — Enterprise governance, SSO, SCIM blueprint](0015-enterprise-governance-sso-scim.md)

---

## Context

A manual, page-by-page production audit (logged-in session, every top-level nav destination) on 2026-09-05 surfaced two classes of problem beyond the individual bugs found and fixed separately (invisible `diff-pill` text, an unlabeled installation-ID fallback, a page-title mismatch):

1. **Visual quality.** The product has been through multiple prior visual passes (Foundry Editorial theme, then Technical Premium theme, then a "copper" brand-accent system), but the result still reads as generic and low-effort rather than as a tool worth paying for.
2. **Usability / information architecture.** The sidebar groups destinations by category (Overview / Engineering / Governance / Manage) rather than by the task sequence a new user actually follows, and every empty state ("No projects configured yet", "No active BOM parts registered", ...) is a passive sentence with no guided next action — which matters because a fresh installation spends most of its early life in these empty states.

The entire authenticated app's styling lives in one hand-written `apps/web/app/styles.css` (~5,000 lines, ~659 top-level selectors/custom-property declarations). There is no Tailwind, no component library, and no centralized design-token system — every visual decision is a bespoke class. This is both the reason prior visual passes were expensive to execute consistently and the reason this ADR proposes a structural change to the styling approach rather than another pass over the same hand-rolled CSS.

## Decision

Replace the hand-rolled CSS system with **Tailwind CSS + shadcn/ui** (Radix-based primitives), and use that migration as the vehicle for a new visual direction, a restructured navigation, and a guided (rather than passive) empty-state pattern. Scope covers both the authenticated app and the public marketing site. This is executed as a single large migration (not an incremental strangler-fig rollout) per explicit product direction, with a mandatory pre-deploy verification gate substituting for incremental risk reduction.

### Why Tailwind + shadcn/ui

Utility-first CSS plus Radix-based accessible primitives is the dominant stack for this class of product in 2026 (Linear, Vercel's own dashboard, and Stripe's dashboard all sit on functionally equivalent stacks). It gives:

- A single source of truth for design tokens (color, radius, spacing, typography) instead of ~659 independent declarations.
- Accessible primitives (dialog, dropdown, tabs, tooltip) out of the box, replacing hand-rolled equivalents in `apps/web/components/ui.tsx`.
- A large, well-understood component vocabulary, which matters for velocity on a full-surface migration this size.

### Visual direction

Synthesized from two design-companion mockup rounds (four initial directions, then a targeted combination) reviewed and approved 2026-09-05:

- **Base:** graphite/near-black (`#0d1117` family — the GitHub-dark neighborhood), not the current warmer near-black + copper.
- **Accent:** a single electric blue (`#58a6ff` family) used for interactive/active state, not decoration.
- **Shape:** sharp corners (2px radius, not the current rounded cards) — an intentionally "editorial," not "friendly SaaS," feel.
- **Typography:** bold, high-contrast headings; restrained body weight.
- **Color discipline:** saturated color (red / green / amber) is reserved **exclusively** for status signals (finding severity, approval state, blockers). Nothing else in the UI uses saturated color — no decorative accent chips, no colored icons for non-status purposes.
- **Theme modes:** both dark and light, derived from the same token set (shadcn's CSS-variable light/dark convention), not independently designed. Dark is the default; light is a full first-class mode, not an afterthought — same component set, same information density, same status-color semantics.

### Information architecture

Sidebar navigation moves from category grouping to task-sequence grouping:

| Today (category) | New (task sequence) |
| --- | --- |
| Overview: Dashboard, Projects, My Work | Dashboard (ungrouped, always visible) |
| Engineering: Reviews, Deliveries, Parts | **1. Get a board in** — Projects, Setup |
| Governance: Policies, Evidence, Insights | **2. Work the findings** — My Work, Reviews |
| Manage: Setup, Settings | **3. Ship it** — Deliveries, Parts |
| | **Govern** — Policies, Evidence, Insights |
| | (unchanged) Settings |

The grouping communicates workflow order to a first-time user rather than assuming they already know which category a task belongs to.

### Empty-state pattern

Replace passive "No X configured yet" cards with a **guided setup checklist**: numbered steps, completed steps checked off, the next actionable step visually emphasized with a direct action link, remaining steps visible but de-emphasized. Copy must stay **CAD-format-neutral** — the product ingests KiCad, Altium, EasyEDA, Fusion 360, Gerber, and IPC-2581 packages (`src/multicad/*`), so checklist copy says "link a repository with a hardware project" / "upload a manufacturing package," never "KiCad project" specifically. This was an explicit correction during design review — an earlier mockup draft said "KiCad project" and was flagged as inaccurate.

This pattern applies wherever an empty state currently exists: Projects, Parts, Deliveries, and the per-repository detail page's "no runs yet" state.

### Scope

**In scope**, migrated to the new Tailwind/shadcn system in this initiative:

- Authenticated app: Dashboard, Projects (+ New Project wizard), My Work, Reviews (+ review detail), Deliveries (+ delivery detail), Parts, Policies, Evidence, Insights, Setup, Settings (Billing & Seats, Security & Access, Data & Retention, API Tokens, Component Intelligence), repository detail pages.
- Public marketing site: the root `apps/web/app/page.tsx` landing page, currently styled by its own separate `apps/web/app/landing.css` (a second bespoke stylesheet, distinct from `styles.css`, in scope for the same replacement). There is no separate public pricing route today — plan/pricing presentation lives on the landing page and in the authenticated Settings → Billing & Seats tab, both covered above.
- `apps/web/components/ui.tsx` and every component under `apps/web/components/` that renders a class from `styles.css`.

**Out of scope for this ADR** (explicitly deferred to a separate future ADR, per product direction 2026-09-05): expanding the GitHub App's permission scopes to allow deeper in-app configuration/control comparable to other GitHub-connected apps. That is a distinct authorization/integration-surface decision, not a visual one, and is sequenced after this migration completes.

### Rollout strategy

Single large migration branch, one production deploy at cutover — not an incremental per-page strangler-fig rollout. This was an explicit product decision made after the trade-off (a smaller number of larger, harder-to-review changes vs. continuous low-risk shipping) was presented. Because incremental risk-reduction is not available here, the safety net moves entirely to **pre-deploy verification**:

1. `pnpm lint`, `pnpm typecheck`, `pnpm run coverage` must all pass with no regressions against the current baseline.
2. Every in-scope page is visually verified in a running local build via browser automation (Chrome DevTools MCP / Playwright), page by page, checking for console errors and visual correctness against the approved direction — the same method used for the 2026-09-05 production audit that motivated this ADR.
3. `apps/web/app/styles.css` is deleted (not left in place as dead weight) once no page references its classes; a repo-wide grep for its class names must return zero hits in `apps/web/` before the branch is considered done.
4. Only after (1)–(3) pass does the branch go through the normal PR → CI (including SonarCloud/CodeQL/DeepScan) → merge → `cloud-deploy` workflow path already in use for this repository. No new deploy mechanism is introduced by this ADR.

### Risks

- **Regression surface.** A single-shot migration across the entire app and marketing site is the highest-risk rollout shape available; this is accepted product-level risk, mitigated only by the verification gate above, not by staged exposure.
- **Long-lived branch drift.** The migration branch will be open against a `main` that keeps receiving other work (multicad features, billing, etc. are active areas per recent history). The branch must periodically rebase onto `main` rather than merging once at the end cold.
- **Light theme as a first-class mode roughly doubles the visual QA surface** (every page checked in both themes, not one) — accounted for in the verification step above, not hand-waved.

## Follow-up

A separate ADR will cover expanding the GitHub App's requested permission scopes to support deeper in-app configuration (mirroring the level of control other GitHub-connected apps expose), once this migration ships.
