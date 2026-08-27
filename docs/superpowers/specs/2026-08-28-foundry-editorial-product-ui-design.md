# Foundry Editorial Product UI — Design Specification

Status: Approved design direction
Date: 2026-08-28
Scope: Entire `apps/web` product experience, shared shell, review workspace, operational pages, settings, and visual alignment of the public landing page

## 1. Product intent

BoardReadyOps must look and behave like a serious hardware release instrument, not a generic SaaS dashboard or an AI-generated component gallery. The interface should communicate engineering judgment, traceability, and calm authority before it communicates decoration.

The approved direction is **Foundry Editorial**: warm industrial materials, strong editorial hierarchy, precise technical typography, restrained motion, and information-dense layouts that remain easy to scan.

The design must feel distinctive without becoming theatrical. It must remain credible beside KiCad, GitHub, fabrication documentation, evidence ledgers, and engineering review artifacts.

## 2. Problems being solved

The existing product UI has real functionality but weak product character:

- Global navigation is an undifferentiated horizontal row of links.
- Most content is presented as similarly weighted bordered rectangles.
- Screen hierarchy depends too heavily on card borders and oversized headings.
- Operational context, primary decision, and secondary evidence compete for attention.
- Review interactions look like forms added to cards rather than a coherent review workspace.
- Light surfaces are visually flat; dark mode does not yet express an equally intentional material system.
- Several responsive layouts collapse mechanically instead of preserving task priority.
- The public landing page has a stronger editorial identity than the product application, making them feel like separate products.

## 3. Goals

1. Establish one unmistakable BoardReadyOps visual language across every web route.
2. Make decision state and next action visible within two seconds on operational screens.
3. Increase usable information density without creating visual noise.
4. Give review, evidence, run, policy, and repository surfaces hardware-specific character.
5. Make keyboard, screen-reader, reduced-motion, and mobile behavior first-class.
6. Preserve current route, API, authorization, and data contracts during this UI phase.
7. Prefer existing React components, semantic HTML, CSS, and inline SVG over new UI dependencies.
8. Leave a maintainable token and primitive layer so later real-data wiring does not require another visual rewrite.

## 4. Non-goals

- No backend, database, billing, storage, or authentication implementation in this phase.
- No replacement of current demo data with live APIs in the visual pass.
- No component-framework migration.
- No glassmorphism, neon control-room styling, purple gradients, oversized pill cards, ornamental charts, or decorative AI imagery.
- No invented testimonials, customer logos, usage metrics, or production claims.
- No dense animation system or motion dependency.
- No redesign of the documentation site in this phase.

## 5. Visual identity

### 5.1 Material language

The interface takes cues from fabrication travelers, engineering notebooks, instrument panels, inspection stamps, copper traces, and high-quality technical publications.

- Backgrounds resemble warm paper and dark oxidized metal rather than pure white or blue-black.
- Dividers behave like drafting rules: thin, deliberate, and used sparingly.
- Surfaces rely on spacing, tone, and alignment before borders or shadows.
- Accent color resembles oxidized copper. Brass is reserved for attention and approval states.
- Status colors remain semantic and never replace written labels or icons.
- Technical data uses monospace only where the content is genuinely machine-like.

### 5.2 Color tokens

Light theme:

- Canvas: `#f1ede3`
- Canvas subdued: `#e9e2d4`
- Surface: `#fbf8f0`
- Surface strong: `#fffdf8`
- Ink: `#1a1915`
- Ink muted: `#686154`
- Ink subtle: `#8b8374`
- Line: `#d8cfbd`
- Line strong: `#a99c83`
- Copper: `#a44730`
- Copper strong: `#7d3323`
- Copper soft: `#f1d8cd`
- Brass: `#9a701e`
- Success: `#286045`
- Warning: `#8a5b10`
- Danger: `#9b3529`
- Information: `#315d70`

Dark theme:

- Canvas: `#13120f`
- Canvas subdued: `#191713`
- Surface: `#1e1b17`
- Surface strong: `#27231d`
- Ink: `#f2ecde`
- Ink muted: `#afa590`
- Ink subtle: `#807766`
- Line: `#3b352b`
- Line strong: `#655b49`
- Copper: `#d16a4d`
- Copper strong: `#e48060`
- Copper soft: `#46261e`
- Brass: `#d2a64a`
- Semantic colors use lighter text and darker surfaces while retaining AA contrast.

Pure white and pure black are avoided for large surfaces. Gradients are not part of the primary visual language; tonal depth comes from adjacent surfaces and restrained shadows.

### 5.3 Typography

Existing self-hosted fonts remain:

- `Newsreader`: display headings, verdict statements, high-level editorial copy.
- `Inter`: navigation, controls, body copy, tables, and forms.
- `JetBrains Mono`: commit hashes, rule IDs, evidence digests, timestamps, paths, commands, and counters where alignment matters.

Rules:

- Page title: fluid `clamp(2rem, 4vw, 4.5rem)` only on marketing; application titles remain `clamp(1.65rem, 2.5vw, 2.75rem)`.
- Body copy: 15–17px with 1.55–1.7 line height.
- Labels: 11–12px, uppercase only for short metadata labels, with moderate tracking.
- Buttons and navigation remain sentence/title case. All-caps is not used for primary actions.
- Numeric metrics use tabular figures.

### 5.4 Geometry and elevation

- Small radius: 4px.
- Standard radius: 8px.
- Large radius: 12px.
- Pills are used only for compact status badges and filters.
- Controls have a minimum 40px height; primary mobile targets have at least 44px.
- Primary shadow is low-opacity and broad; no glow effects.
- Selected or focused surfaces use border contrast plus a copper inset rule, not large shadows.

## 6. Application shell and navigation

### 6.1 Desktop shell

Application routes use a two-part shell:

1. A fixed/collapsible left navigation rail.
2. A compact top context bar above the page workspace.

Expanded rail width is approximately 248px; compact width is approximately 72px. The rail contains:

- Brand mark and product name.
- Primary: My Work, Reviews, Projects.
- Governance: Policies, Evidence, Insights.
- Administration: Setup and Settings.
- Bottom utilities: Documentation, theme control, viewer/account state.

Billing, Security, Data, and Tokens move beneath a single Settings entry. This removes global navigation noise while preserving routes.

The top context bar contains the current repository/review/run context when available, a keyboard-search affordance, and a compact viewer control. It is not a second complete navigation system.

### 6.2 Mobile shell

- Rail becomes an off-canvas navigation drawer.
- Top bar retains brand, page context, and menu control.
- Drawer traps focus while open, closes with Escape, and restores focus to its trigger.
- Product content remains primary; navigation does not consume persistent horizontal space.

### 6.3 Navigation semantics

- Current route uses `aria-current="page"`.
- Groups have accessible names.
- Icons are supplementary; every destination retains a visible label in expanded/mobile states.
- Skip link continues to target `#main-content`.

## 7. Shared page composition

Every application page uses the same vertical rhythm:

1. Compact breadcrumb/context line.
2. Page heading with one-sentence purpose and optional primary action.
3. Optional decision or readiness band.
4. Main workspace.

Content width is route-sensitive:

- Settings and forms: 960–1120px.
- Lists and dashboards: up to 1440px.
- Review/canvas/run workspaces: up to 1680px with edge-aware gutters.

Generic full-width `Panel` stacking is replaced by explicit surface roles:

- `surface`: normal grouped content.
- `surface-raised`: priority or interactive content.
- `surface-inset`: filters, code, evidence, and secondary detail.
- `surface-critical`: blocking decision context.

## 8. Shared component system

Existing primitives remain source-compatible where practical but gain consistent variants.

### 8.1 Buttons

- Primary: copper fill, high-contrast text.
- Secondary: surface fill with strong line.
- Quiet: text/icon action without enclosing card treatment.
- Danger: semantic danger treatment.
- Buttons expose loading, disabled, and focus-visible states.
- Primary and destructive actions are never distinguished by color alone.

### 8.2 Status and signals

- Status badges include a symbol, text, and semantic tone.
- Major verdicts use a `decision-band` with title, explanation, and next action.
- Compact counters use mono numerals but normal UI labels.
- Blocking, warning, and success surfaces differ in iconography and wording as well as color.

### 8.3 Tables and lists

- Sticky headers where the existing structure permits.
- Row density remains compact, with 44px minimum interactive rows.
- Key identity stays left; status and actions align right.
- Mobile presentation uses horizontal scrolling for evidence tables and structured stacked rows for ordinary lists.
- Zebra striping is avoided; grouping comes from rules and spacing.

### 8.4 Forms

- Labels always remain visible; placeholder text is supplementary.
- Help and validation messages occupy stable space where practical.
- Focus state uses a two-layer outline that works on every surface.
- Selects, inputs, and buttons share consistent height and typography.

### 8.5 Empty, loading, and error states

- Empty states explain what is missing and give one relevant next action.
- Skeletons match final layout and obey reduced motion.
- Errors retain operational detail and recovery steps; they are not reduced to decorative illustrations.

## 9. Route-specific experiences

### 9.1 Public landing page

The current editorial landing direction is retained and aligned to the new tokens. Changes are surgical:

- Header and mark match the product shell.
- Product screenshots/cards use the same surface language as the real app.
- Spacing and colors align with Foundry Editorial.
- Existing factual product narrative remains; no fabricated proof is added.

### 9.2 My Work

My Work becomes the daily engineering queue:

- Top band summarizes items requiring action today.
- Assigned findings are the primary column.
- Awaiting decision, requested changes, and mentions become smaller queue sections.
- Each row shows repository, review, severity, age, assignee, and next action without opening the item.
- Empty states distinguish “nothing assigned” from “no accessible repositories.”

### 9.3 Reviews list

- Title area includes review counts and compact filter summary.
- Filters live in a restrained inset toolbar, not a large card.
- Review rows use a consistent grid: repository/PR, review title, revision, change summary, blockers, decision, and age.
- Blocking count is visually primary only when non-zero.
- Entire row remains keyboard-accessible without nested conflicting links.

### 9.4 Review workspace

The review detail route is the flagship product surface.

- Sticky review command header shows repository, PR, revision, base/head, decision, evidence state, and primary approval actions.
- Decision and evidence freshness stay visible while switching sections.
- Section navigation becomes a compact workspace rail/tab bar with clear selected state.
- Overview opens with decision readiness, then blockers, checklist, approvals, and changed surfaces.
- Changes prioritizes the visual canvas and BOM delta; controls live in a compact instrument toolbar.
- Findings uses a two-pane desktop layout where useful: scan list and focused finding detail. Narrow screens use a single column.
- Discussion reads as an engineering thread with anchors and status, not a generic social feed.
- Checklist and approvals distinguish requirements, completed work, invalidated approvals, and final sign-off.
- Evidence presents digest, provenance, verification command, and artifact inventory as one coherent chain.

### 9.5 Projects, repositories, and runs

- Project dashboard prioritizes repository readiness and current release risk.
- Run pages retain existing investigation navigation but share the same shell and decision band.
- Timelines, artifacts, findings, and audit history use consistent evidence rows.
- Setup becomes a guided sequence with a progress index and explicit completion states.

### 9.6 Policies and insights

- Policies use a structured registry layout with scope, inheritance, enforcement mode, and impact.
- Policy editing remains readable at desktop and mobile widths.
- Insights avoids decorative charts. Every visualization must answer an operational question and include a textual/table fallback.

### 9.7 Settings

Settings gets its own secondary navigation containing Billing, Security, Data, Tokens, and component intelligence.

- Settings pages share a constrained reading width.
- Destructive or external-provider actions are clearly separated.
- Decorative descriptive pages still receive complete states but are not presented as functional when no backing interaction exists.

## 10. Interaction model

- Hover states emphasize border, underline, or 1px translation; no floating-card theatrics.
- Standard transition duration: 120–180ms.
- Large workspace state changes may use 200–240ms opacity/position transitions.
- `prefers-reduced-motion: reduce` removes translations and non-essential transitions.
- Keyboard shortcuts remain visible near the workflow they affect.
- A future command palette is visually accommodated, but no speculative command system is implemented in this phase unless existing search behavior can support it without fake actions.

## 11. Responsive rules

Verification widths: 375px, 768px, 1024px, 1440px, and 1920px.

- At 1180px and below, the rail may default to compact mode.
- At 820px and below, navigation becomes a drawer and multi-column workspaces stack.
- Review header actions remain reachable without covering title or status.
- Tab bars and run navigation support horizontal scrolling with visible edge affordance.
- Technical tables and code never force body-level horizontal overflow.
- Canvas controls wrap into logical groups without reducing touch target size.
- Dense metadata may collapse behind a labelled disclosure, but decision and blocker state never does.

## 12. Accessibility requirements

- WCAG 2.2 AA contrast for text, controls, focus indicators, and non-text UI boundaries.
- Logical heading structure and named landmarks on every route.
- Visible focus on all interactive elements.
- Keyboard operation for navigation drawer, tabs, dialogs, filters, review actions, and canvas controls.
- Dialog focus containment and focus restoration.
- Status is never color-only.
- Minimum target sizing is preserved.
- Screen-reader text is concise and avoids repeating visible labels.
- Reduced motion and forced-colors behavior are explicitly tested.
- The actual product routes, not only documentation pages, receive axe checks.

## 13. Performance and implementation constraints

- No new component library.
- No icon package unless existing assets cannot cover a necessary semantic symbol; prefer a small shared inline SVG set.
- Server Components remain the default. Client Components are limited to navigation state and genuinely interactive workspaces.
- Avoid serial data waterfalls and avoid increasing serialized demo/API payloads solely for presentation.
- Long finding lists use `content-visibility` in the visual phase and retain a clear upgrade path to true windowing in the subsequent performance phase.
- Theme initialization must not cause a visible flash.
- Existing Next.js standalone build remains supported.

## 14. Testing strategy

Implementation follows TDD for structural and behavioral changes.

Required automated checks:

- Shared shell renders grouped navigation and current-route semantics.
- Mobile navigation opens, closes with Escape, traps/restores focus, and exposes an accessible name.
- Settings secondary navigation contains every current settings route.
- Review workspace retains six sections and approval/change-request actions.
- Keyboard triage behavior remains intact.
- Product route axe tests cover My Work, Reviews, representative review detail, dashboard, and settings.
- Existing reduced-motion and focus-visible assertions remain green.
- No body-level horizontal overflow at target mobile width in Playwright.
- Existing route and content contract tests remain green.

Visual/browser verification:

- Light and dark screenshots for landing, Reviews, review detail, My Work, dashboard, and one settings route.
- Desktop and 375px mobile review flows.
- Keyboard-only navigation from skip link through primary review action.
- No Next.js error overlay or console errors.

Repository gates:

- Biome/lint
- TypeScript and cloud typecheck
- Focused unit tests during development
- Full unit suite
- Playwright E2E
- Cloud production build and standalone verification
- Product accessibility suite
- Coverage thresholds

## 15. Delivery sequence

1. Lock regression tests around shell, semantics, and critical screen structure.
2. Replace global tokens and establish shared surface/button/status primitives.
3. Build the application rail, top context bar, mobile drawer, and settings navigation.
4. Redesign My Work and Reviews list.
5. Redesign the review command header, tabs, overview, findings, changes, discussion, checklist, and evidence.
6. Align dashboard, repository, run investigation, setup, policies, evidence, insights, and settings.
7. Harmonize the landing page without undoing its stronger editorial composition.
8. Add product-route accessibility and responsive E2E coverage.
9. Run React quality review, full verification, and browser screenshots in both themes.

## 16. Acceptance criteria

The UI phase is complete only when:

1. Product routes no longer use the existing horizontal global link wall.
2. Landing and application visibly belong to one Foundry Editorial system.
3. Review decision, blockers, evidence freshness, and primary actions are immediately legible.
4. My Work and Reviews can be scanned without opening every item.
5. Every current product route inherits intentional light, dark, mobile, empty, loading, and error styling.
6. Existing functionality and route contracts remain intact.
7. Product-route WCAG/axe checks pass without new violations.
8. Target desktop and mobile screenshots show no clipping, overlap, body overflow, or generic card-grid regression.
9. Lint, typecheck, unit, E2E, cloud build, standalone verification, and coverage gates pass from a clean tree.
10. No new large UI dependency, fake product capability, or unrelated backend refactor is introduced.

