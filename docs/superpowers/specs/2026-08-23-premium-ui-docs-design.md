# BoardReadyOps Premium Engineering Control Room + Docs Delivery Design

Status: Proposed design for user review
Date: 2026-08-23
Scope: `boardreadyops.com` product UI, `/setup`, `/runs/*`, shared web UI states, and `docs.boardreadyops.com`

## 1. Problem statement

BoardReadyOps currently presents two visibly different products:

- `/` uses a custom dark-green marketing treatment in `apps/web/app/landing.css`.
- `/setup`, `/runs/*`, and shared application states use the older blue-heavy token system in `apps/web/app/styles.css` and the `AppShell` component.

The split makes the product feel less mature than its backend and release-evidence capabilities. The current setup experience is functionally clear but visually flat: long text blocks, repeated bordered panels, weak hierarchy, limited product storytelling, and little connection to the QFP-chip brand identity introduced on the landing page.

The documentation problem is separate but user-visible. The MkDocs site builds and is available at `https://oaslananka.github.io/boardreadyops/`, while `docs.boardreadyops.com` has no DNS record and therefore does not resolve. `mkdocs.yml` also declares the GitHub Pages URL as the canonical `site_url`, so the intended public docs hostname is not yet represented in metadata.

## 2. Goals

1. Create one premium, coherent visual system across the public marketing surface and authenticated/public investigation surfaces without changing application contracts.
2. Make `/setup` feel like a guided engineering workflow rather than a long configuration document.
3. Make `/runs/*` feel like an evidence control room: decision first, evidence second, with clear risk/status hierarchy.
4. Keep accessibility, keyboard navigation, reduced-motion behavior, responsive layouts, and high information density first-class.
5. Preserve server rendering and the current Next.js App Router architecture; do not add a large client-side UI framework.
6. Repair `docs.boardreadyops.com` as the canonical docs hostname and visually align MkDocs Material with the product.
7. Avoid fabricated customer logos, metrics, testimonials, or claims. Product proof must come from real BoardReadyOps capabilities and UI states.
8. Preserve all existing API, GitHub App permission, setup, run, and data contracts unless a later task explicitly requires otherwise.

## 3. Non-goals

- No redesign of backend APIs, database schema, GitHub App permission model, queue processing, or runner contracts.
- No new billing/pricing system.
- No fake social proof.
- No WebGL/canvas-heavy hero, video background, or animation dependency.
- No broad component-framework migration.
- No removal or weakening of existing accessibility or security behavior.
- No destructive production migration.

## 4. Chosen visual direction: Premium Engineering Control Room

The approved direction is a restrained engineering-control-room aesthetic rather than a neon/cinematic demo aesthetic.

### 4.1 Brand language

- Near-black graphite background with subtle green-cyan hardware accents.
- BoardReadyOps QFP-chip mark becomes the primary brand mark across marketing and application shells.
- Thin PCB/grid/traces are atmospheric, low-contrast background details rather than dominant decoration.
- Layered surfaces use tonal depth, hairline borders, controlled shadows, and occasional inner highlights instead of large glow effects.
- Monospace is reserved for evidence, IDs, checks, code, and machine-readable values; UI copy remains system sans-serif.
- Accent color communicates interactivity and positive readiness, but semantic success/warning/danger colors remain distinct.

### 4.2 Design tokens

Shared product tokens move into the global web stylesheet so landing and application surfaces consume one vocabulary.

Proposed token families:

- Background: `--bro-bg`, `--bro-bg-elevated`, `--bro-surface`, `--bro-surface-strong`
- Borders: `--bro-border`, `--bro-border-strong`, `--bro-border-accent`
- Text: `--bro-text`, `--bro-text-muted`, `--bro-text-subtle`
- Brand: `--bro-accent`, `--bro-accent-strong`, `--bro-accent-soft`, `--bro-accent-contrast`
- Semantic: success, warning, danger, info with surface/border/text variants
- Geometry: radii, spacing, content widths
- Elevation: restrained shadows and inset highlights
- Motion: standard durations/easings, disabled or minimized under `prefers-reduced-motion`

The current green landing identity is the starting point, but contrast values will be recalculated rather than copied blindly.

## 5. Information architecture and shared shell

### 5.1 Shared application shell

`AppShell` remains the application boundary but is visually rebuilt:

- `BrandMarkLockup` replaces the `BR` text square.
- Sticky translucent header with subtle blur and hardware-line border.
- Consistent product navigation and documentation link treatment.
- Footer is simplified and visually aligned with the landing footer.
- Skip link, focus-visible behavior, landmarks, and semantic navigation remain intact.

The shell must not require client JavaScript merely for appearance.

### 5.2 Shared component language

Existing primitives remain the base rather than introducing a parallel component system:

- `Panel` becomes an elevated evidence surface with optional visual hierarchy variants.
- `StatusBadge` retains semantic state mapping while receiving the premium visual treatment.
- `Alert` becomes a compact signal surface with better title/body hierarchy.
- `DefinitionGrid` becomes a metric/evidence grid rather than plain bordered boxes.
- Buttons receive primary, secondary, ghost, and danger visual states using existing anchors/buttons.
- Tables, code blocks, empty states, pagination, loading states, and error states adopt the same tokens.

New abstractions are added only where repeated markup clearly warrants them.

## 6. Landing page redesign

The landing page remains the product front door but gains stronger product proof and visual hierarchy.

### 6.1 Header and hero

- Brand lockup and compact product navigation.
- Stronger headline treatment with a restrained accent gradient or highlight on the decision concept.
- Product positioning remains focused on release evidence and manufacturing readiness.
- Primary CTA: install the GitHub App.
- Secondary CTA: inspect the repository setup experience.
- Trust row uses only factual claims such as KiCad focus, repository-owned workflows, OIDC-bound result validation, and open-source availability where currently supported.

### 6.2 Product proof

Replace the single terminal-like PR card as the only proof with a richer but still static/server-rendered composition:

- Pull request decision card.
- Evidence-chain rail showing check -> finding -> artifact -> decision.
- Small run-summary/score surface using the same components/tokens as the real app.
- No fake customer data; examples remain clearly fictional/demo data.

### 6.3 Workflow section

The three-step flow becomes a visual engineering pipeline with numbered stages, connection lines, and concise evidence outputs.

### 6.4 Capability mosaic

Use asymmetric feature cards for:

- Decision first
- Bounded investigation
- Authoritative sources
- Repository-owned execution
- OIDC-bound evidence
- Release artifact traceability

Content must stay aligned with implemented capabilities.

### 6.5 Final CTA

One strong final conversion section with minimal copy and no duplicated clutter.

## 7. Repository setup experience

`/setup` is the highest-priority application redesign because it currently reads like a long document.

### 7.1 Page framing

- Compact breadcrumb and contextual eyebrow.
- Hero section with headline, short explanation, and a clear read-only/preview status surface.
- Least-privilege information appears as a concise assurance card rather than a full-width generic alert.

### 7.2 Guided step model

The current four major tasks become a visually explicit setup flow:

1. Select policy
2. Review repository files
3. Validate readiness
4. Review permissions

On wide screens, a lightweight sticky step rail or progress index may be used with plain anchors; on mobile it collapses into a horizontal/stacked summary. No client-side state machine is required.

### 7.3 Policy selection

Preset cards should provide immediate comparison:

- Name and short intent
- Release mode
- Blocking threshold
- Selected state with strong but accessible emphasis
- Single clear action

The implementation continues to use query parameters and server rendering.

### 7.4 File review

`boardreadyops.yml` and workflow review become high-quality code/evidence surfaces:

- File header with type/status
- Key policy consequences summarized before code
- Scrollable code with clear line-height and contrast
- Canonical workflow source remains external and authoritative

### 7.5 Permission review

Permissions should read as a security assurance matrix. `Contents: none` and organization/account `None` should be visually understandable as intentionally absent privileges, not merely ordinary rows.

## 8. Run investigation surfaces

All `/runs/*` states should inherit the same design system without changing data loading or URL contracts.

### 8.1 Decision-first header

- Run identity and repository context
- Score/status presented as the strongest visual signal
- Investigation state and freshness secondary
- Clear semantic differentiation among pass/warning/fail/reconciliation states

### 8.2 Navigation

Existing run tabs remain accessible links. The visual treatment becomes a segmented control/rail appropriate for dense operational data while preserving horizontal overflow on narrow screens.

### 8.3 Evidence panels

Findings, artifacts, workflow evidence, audit records, and definitions use consistent evidence-card and metric-grid patterns. Machine IDs/checksums remain monospace.

### 8.4 Non-happy states

Loading, not-found, not-configured, error, empty, expired/stale, and reconciliation states receive deliberate premium layouts. Error treatment must remain clear and not hide operational details.

## 9. Interaction and motion

Motion is subtle and optional:

- Hover/focus surface lift of 1-2px or border emphasis.
- Button highlight sweep/gradient shift only if CSS-only and non-distracting.
- Hero/background accents may use slow opacity/position animation.
- No animation is required to understand state.
- `prefers-reduced-motion: reduce` disables non-essential motion.
- Touch targets remain at least 44px where practical.

## 10. Responsive behavior

Primary breakpoints are content-driven rather than device-specific.

- Marketing grids collapse progressively rather than at one hard breakpoint.
- Setup step rail becomes non-sticky/stacked on narrow widths.
- Tables remain horizontally scrollable with preserved headers.
- Run navigation remains horizontally accessible.
- Code surfaces never force viewport overflow.
- Navigation retains a minimal usable mobile state without adding a JS hamburger unless actual content density requires it.

Target manual widths include approximately 375px, 768px, 1024px, and 1440px.

## 11. Accessibility requirements

- WCAG 2.2 AA contrast for normal text and controls.
- Keyboard-only path through navigation, setup presets, code-source links, run tabs, pagination, and CTAs.
- Visible focus that remains visible over all surface variants.
- Semantic headings and landmarks remain ordered.
- Status meaning is never color-only.
- Skip links remain operational.
- Reduced motion respected.
- Axe/pa11y checks must pass with no new violations.
- Existing screen-reader text and table semantics are retained unless improved.

## 12. Documentation delivery repair

### 12.1 Confirmed current state

- `https://oaslananka.github.io/boardreadyops/` serves the built MkDocs site successfully.
- `docs.boardreadyops.com` currently has no Cloudflare DNS record and does not resolve.
- GitHub Pages currently reports no configured custom domain.
- `mkdocs.yml` uses `https://oaslananka.github.io/boardreadyops/` as `site_url`.

### 12.2 Desired state

- Canonical docs URL: `https://docs.boardreadyops.com/`
- Cloudflare DNS: DNS-only CNAME `docs` -> `oaslananka.github.io` by default, so GitHub Pages owns TLS end-to-end without an unnecessary proxy layer.
- GitHub Pages custom domain configured to `docs.boardreadyops.com`.
- HTTPS enforced after GitHub certificate provisioning succeeds.
- `mkdocs.yml` `site_url` changed to the custom domain.
- Product links continue to target `https://docs.boardreadyops.com`.

### 12.3 Safe rollout sequence

1. If GitHub Pages reports domain verification as required, publish the GitHub-provided TXT verification record first and confirm ownership.
2. Add a DNS-only Cloudflare CNAME `docs` -> `oaslananka.github.io` using the existing account credential, without exposing the secret.
3. Configure the GitHub Pages custom domain as `docs.boardreadyops.com`.
4. Wait for Pages/DNS verification and certificate readiness.
5. Enable/verify GitHub Pages HTTPS enforcement.
6. Change `mkdocs.yml` canonical `site_url` in the code PR and deploy docs.
7. Verify public root, asset URLs, search, navigation, canonical metadata, and no redirect loop.

Cloudflare proxying is not part of the initial design. It adds another TLS/cache layer without solving a current requirement and can be evaluated later as a separate optimization.

## 13. Documentation visual alignment

MkDocs Material stays in place. It will receive a lightweight BoardReadyOps skin rather than a theme migration:

- Brand colors and dark palette aligned with product tokens.
- BoardReadyOps mark/favicon where supported.
- Improved header/nav/code-block/surface styling via existing `extra_css` mechanism.
- Typography remains local/system or theme-native; no third-party tracking/font dependency is introduced.
- Existing search, versioning, navigation, copy, and accessibility behavior is preserved.

The docs must remain readable as documentation, not become a marketing page.

## 14. Security and privacy constraints

- No secret values are committed or printed.
- Existing `.env` files remain local-only.
- Cloudflare changes use the smallest required API operation.
- GitHub Pages changes do not broaden repository permissions.
- External links use current security semantics; no unsafe HTML injection is introduced.
- UI content must not expose internal IDs or tenant data beyond what existing pages already authorize.
- No analytics/tracking is added as part of the redesign.

## 15. Performance constraints

- No new large UI dependency by default.
- Prefer CSS, SVG, and server-rendered React.
- Avoid layout-shifting remote assets.
- Keep landing above-the-fold lightweight.
- Preserve Next.js standalone production build.
- Do not make evidence-heavy run pages load more data merely to improve visuals.

## 16. Testing and verification

### 16.1 Unit/structure tests

Update/add tests for:

- Shared brand shell rendering
- Landing content/CTA/navigation contracts
- Setup preset/query behavior and key semantic landmarks
- Run shell/navigation semantics where current tests permit
- Metadata/canonical docs references
- MkDocs configuration/custom-domain contract where appropriate

### 16.2 Static verification

Run project-standard checks as applicable:

- Unit test suite
- Integration tests affected by web changes
- Lint/Biome
- Typecheck
- Cloud typecheck
- `gc` duplicate-code check
- Web production build
- `verify:dist`
- Docs build in strict mode
- Security/pre-commit hooks

### 16.3 Browser verification

Use the production Next.js build locally where possible and verify:

- `/`
- `/setup`
- representative `/runs/*` states available through fixtures/tests
- 375px and desktop layouts
- keyboard focus/order
- Axe/pa11y
- reduced motion behavior
- favicon/OG metadata remains valid

### 16.4 Production verification

After merge and deployment:

- Exact release SHA/image identity matches the merged commit.
- Web and worker health are green with no restart loop.
- `http://boardreadyops.com` redirects to HTTPS.
- `/`, `/setup`, and representative run routing return expected responses.
- `https://docs.boardreadyops.com/` resolves and serves the custom-domain Pages deployment over HTTPS.
- Docs canonical metadata references `docs.boardreadyops.com`.
- Product Docs links resolve successfully.

## 17. Deployment and rollback

Web redesign deployment uses the repository's existing immutable image/release process. No database migration is expected for visual-only changes. The current production Compose topology must remain normalized; deployment must preflight expected container ownership before replacing services.

Docs deployment uses GitHub Pages. DNS/custom-domain configuration is separated from the application deployment and verified independently.

Rollback:

- Web: previous compatible immutable image/release, with current forward-compatible database schema retained.
- Docs content: revert the PR or redeploy the previous Pages artifact.
- Docs DNS/custom domain: DNS can be removed/reverted independently if Pages custom-domain provisioning fails.

## 18. Production deployment hardening follow-up

During the preceding landing rollout, production exposed a real operational hazard: containers with expected Compose names existed without correct Compose ownership metadata, causing name conflicts and also interfering with rollback.

This redesign must not silently fold an unrelated large deploy refactor into the UI PR. A focused hardening task should add a preflight to the production deployment path that detects conflicting unmanaged/mislabelled container names before any destructive replacement begins and fails with actionable diagnostics. Rollback behavior must be tested against this condition.

If implementation proves that this guard is required for safe deployment of the UI release, it should be delivered as a small prerequisite PR rather than mixed into visual changes.

## 19. Acceptance criteria

The work is complete only when:

1. Landing, setup, run investigation, and shared states visibly share one BoardReadyOps design system.
2. `/setup` presents a guided workflow with materially improved hierarchy and no loss of current behavior.
3. Run surfaces retain all evidence/status functionality with premium, coherent hierarchy.
4. Mobile, keyboard, reduced-motion, and accessibility checks pass.
5. No large UI dependency or unrelated refactor is introduced.
6. Docs retain MkDocs Material functionality while adopting BoardReadyOps branding.
7. `docs.boardreadyops.com` resolves, serves the docs site, and uses HTTPS.
8. `mkdocs.yml` canonical site URL is the custom docs domain.
9. Product documentation links no longer lead to an unresolved hostname.
10. Full relevant CI/security/build verification is green on the final PR.
11. Post-merge application and docs deployments are independently verified before the task is reported complete.
