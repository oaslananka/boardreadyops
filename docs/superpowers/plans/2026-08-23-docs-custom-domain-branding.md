# Documentation Custom Domain and Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `https://docs.boardreadyops.com/` the working HTTPS canonical documentation site while preserving the current MkDocs Material feature set and aligning its visual identity with BoardReadyOps.

**Architecture:** Keep GitHub Pages as the documentation hosting platform and MkDocs Material as the renderer. The code PR changes canonical metadata and theme assets/styles; DNS and GitHub Pages custom-domain settings are applied separately after the code is reviewable, using a DNS-only CNAME so GitHub Pages owns TLS end-to-end. No Cloudflare proxy layer is introduced for docs in this plan.

**Tech Stack:** MkDocs 1.6.1, MkDocs Material 9.7.6, GitHub Pages Actions deployment, Cloudflare DNS API, Vitest, pa11y, repository docs accessibility tooling.

**Spec:** `docs/superpowers/specs/2026-08-23-premium-ui-docs-design.md`

## Global Constraints

- Canonical docs hostname is `https://docs.boardreadyops.com/`.
- DNS default is DNS-only CNAME `docs` -> `oaslananka.github.io`.
- GitHub Pages owns TLS; do not add Cloudflare proxying unless a separate requirement appears.
- Preserve MkDocs Material search, versioning, tabs, navigation, copy, code annotation, and accessibility behavior.
- No tracking/analytics dependency.
- Do not expose Cloudflare, GitHub, or repository secrets in logs, commits, screenshots, or PR text.
- Keep documentation readable as documentation; do not turn it into a marketing landing page.

---

## File structure

- `mkdocs.yml` — canonical `site_url`, Material theme brand configuration, favicon/logo references.
- `docs/stylesheets/accessibility.css` — existing accessibility overrides plus BoardReadyOps visual skin; keep scheme-scoped contrast rules.
- `docs/assets/boardreadyops-mark.svg` — documentation-safe static QFP-chip mark derived from the existing product geometry.
- `tests/unit/docs/custom-domain.test.ts` — canonical hostname/theme config contract.
- `tests/unit/docs/accessibility-css.test.ts` — CSS accessibility and brand-token contract.
- `tests/unit/docs-accessibility.test.ts` — top-level docs navigation and dark-mode contrast regression coverage.

### Task 1: Encode the canonical docs hostname in repository configuration

**Files:**
- Modify: `mkdocs.yml`
- Create: `tests/unit/docs/custom-domain.test.ts`

**Interfaces:**
- Produces: MkDocs canonical URL `https://docs.boardreadyops.com/`.
- Does not create DNS records or mutate GitHub Pages settings yet.

- [ ] **Step 1: Write the failing canonical-domain test**

Create `tests/unit/docs/custom-domain.test.ts`:

```ts
import fs from "node:fs";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

describe("documentation public domain", () => {
  it("uses the BoardReadyOps custom hostname as the canonical MkDocs URL", () => {
    const config = yaml.load(fs.readFileSync("mkdocs.yml", "utf8")) as {
      site_url?: string;
      theme?: { logo?: string; favicon?: string };
    };

    expect(config.site_url).toBe("https://docs.boardreadyops.com/");
    expect(config.theme?.logo).toBe("assets/boardreadyops-mark.svg");
    expect(config.theme?.favicon).toBe("assets/boardreadyops-mark.svg");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
corepack pnpm exec vitest run tests/unit/docs/custom-domain.test.ts
```

Expected: FAIL because `site_url` still points at `https://oaslananka.github.io/boardreadyops/` and logo/favicon are not configured.

- [ ] **Step 3: Change the MkDocs canonical URL and theme asset references**

Update the top of `mkdocs.yml`:

```yaml
site_name: BoardReadyOps
site_url: https://docs.boardreadyops.com/
repo_url: https://github.com/oaslananka/boardreadyops
repo_name: oaslananka/boardreadyops
edit_uri: edit/main/docs/
strict: true
docs_dir: docs

theme:
  name: material
  logo: assets/boardreadyops-mark.svg
  favicon: assets/boardreadyops-mark.svg
```

Keep the existing palette, feature, plugin, extra CSS/JS, and navigation blocks unless a later branding task changes only their colors.

- [ ] **Step 4: Re-run the canonical-domain test**

```bash
corepack pnpm exec vitest run tests/unit/docs/custom-domain.test.ts
```

Expected: PASS after Task 2 creates the asset; until then the config assertions pass even though the static file does not yet exist.

- [ ] **Step 5: Commit Task 1 together with the asset task, not as a broken intermediate branch commit**

Do not commit `mkdocs.yml` until Task 2 adds the referenced SVG and the docs build passes.

### Task 2: Add a BoardReadyOps docs mark and premium Material skin

**Files:**
- Create: `docs/assets/boardreadyops-mark.svg`
- Modify: `docs/stylesheets/accessibility.css`
- Modify: `tests/unit/docs/accessibility-css.test.ts`
- Modify: `tests/unit/docs-accessibility.test.ts`

**Interfaces:**
- Consumes: existing `extra_css` and Material scheme hooks.
- Produces: no JavaScript behavior change; existing `docs/javascripts/accessibility.js` remains unchanged unless verification finds a real accessibility regression.

- [ ] **Step 1: Add failing branding assertions to the CSS test**

Extend `tests/unit/docs/accessibility-css.test.ts`:

```ts
it("uses BoardReadyOps documentation brand variables without weakening scheme-scoped nav contrast", async () => {
  const css = await readFile("docs/stylesheets/accessibility.css", "utf8");
  expect(css).toContain("--bro-docs-bg:");
  expect(css).toContain("--bro-docs-surface:");
  expect(css).toContain("--bro-docs-accent:");
  expect(css).toContain(".md-header");
  expect(css).toContain(".md-tabs");
  expect(css).toContain(".md-typeset code");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
});
```

- [ ] **Step 2: Verify RED**

```bash
corepack pnpm exec vitest run tests/unit/docs/accessibility-css.test.ts tests/unit/docs-accessibility.test.ts
```

Expected: FAIL on the new BoardReadyOps docs variables/reduced-motion assertion.

- [ ] **Step 3: Create the static QFP-chip docs SVG**

Create `docs/assets/boardreadyops-mark.svg` as a static, dependency-free version of the existing product mark. Use a 64×64 viewBox, current brand green, pin-1 dot, and checkmark. The file must not contain external fonts, scripts, raster embeds, or metadata with local paths.

Use this structure:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="BoardReadyOps">
  <rect x="15" y="15" width="34" height="34" rx="7" fill="#0f1914" stroke="#5cf5a0" stroke-width="3"/>
  <g stroke="#5cf5a0" stroke-width="3" stroke-linecap="round">
    <path d="M22 8v7M32 8v7M42 8v7M22 49v7M32 49v7M42 49v7"/>
    <path d="M8 22h7M8 32h7M8 42h7M49 22h7M49 32h7M49 42h7"/>
  </g>
  <circle cx="21" cy="21" r="2.5" fill="#5cf5a0"/>
  <path d="m24 33 6 6 12-15" fill="none" stroke="#f4fff8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

- [ ] **Step 4: Refactor docs CSS into an explicit brand layer while preserving existing contrast overrides**

At the top of `docs/stylesheets/accessibility.css`, define:

```css
:root {
  --boardreadyops-link-underline-offset: 0.15em;
  --bro-docs-bg: #070d0a;
  --bro-docs-surface: #0f1914;
  --bro-docs-surface-strong: #14231b;
  --bro-docs-border: #2b4134;
  --bro-docs-text: #f4fff8;
  --bro-docs-muted: #b9cfbf;
  --bro-docs-accent: #5cf5a0;
  --bro-docs-accent-contrast: #06130c;
}
```

Keep the current default-scheme dark-text rules and slate-scheme bright-text rules. Add Material-specific styling such as:

```css
[data-md-color-scheme="slate"] {
  --md-default-bg-color: var(--bro-docs-bg);
  --md-default-fg-color: var(--bro-docs-text);
  --md-primary-fg-color: var(--bro-docs-surface-strong);
  --md-accent-fg-color: var(--bro-docs-accent);
}

.md-header {
  border-bottom: 1px solid var(--bro-docs-border);
  background: color-mix(in srgb, var(--bro-docs-bg) 92%, transparent);
  backdrop-filter: blur(14px);
}

.md-typeset code,
.md-typeset pre > code {
  border-color: var(--bro-docs-border);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation: none !important;
  }
}
```

Do not remove existing explicit nav contrast declarations that current tests protect.

- [ ] **Step 5: Verify CSS and docs accessibility unit tests**

```bash
corepack pnpm exec vitest run tests/unit/docs/custom-domain.test.ts tests/unit/docs/accessibility-css.test.ts tests/unit/docs-accessibility.test.ts
```

Expected: PASS.

- [ ] **Step 6: Build docs strictly**

```bash
corepack pnpm run docs
PATH="$PWD/.dev-tools/venv/bin:$PATH" python -m mkdocs build --strict --site-dir site
```

If the repository toolchain uses a different emitted venv path, use `corepack pnpm run toolchain:doctor` to obtain the prepared Python path rather than installing unpinned dependencies.

Expected: exit 0 and `site/index.html` generated.

- [ ] **Step 7: Commit Tasks 1 and 2 together**

```bash
git add mkdocs.yml docs/assets/boardreadyops-mark.svg docs/stylesheets/accessibility.css tests/unit/docs/custom-domain.test.ts tests/unit/docs/accessibility-css.test.ts tests/unit/docs-accessibility.test.ts
git commit -m "feat(docs): brand the canonical documentation site"
```

### Task 3: Verify the documentation site before public-domain mutation

**Files:**
- No source changes unless verification exposes a real defect.

**Interfaces:**
- Verification-only task before DNS/GitHub Pages mutation.

- [ ] **Step 1: Run all documentation-focused tests**

```bash
corepack pnpm exec vitest run tests/unit/docs tests/unit/docs-accessibility.test.ts tests/unit/docs-repository-setup.test.ts tests/unit/docs-golden-demo-repositories.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository docs build and accessibility checks**

```bash
corepack pnpm run docs
corepack pnpm run test:a11y
```

Expected: docs generation/build and pa11y checks exit 0.

- [ ] **Step 3: Inspect generated canonical metadata**

After the strict MkDocs build, verify generated HTML references `https://docs.boardreadyops.com/` rather than the old GitHub Pages project URL:

```bash
grep -R "https://docs.boardreadyops.com/" site/index.html | head
grep -R "oaslananka.github.io/boardreadyops" site/index.html && exit 1 || true
```

Expected: custom-domain canonical URL is present and the old canonical URL is absent from the generated homepage metadata.

- [ ] **Step 4: Review source diff**

```bash
git diff --check origin/main...HEAD
git diff origin/main...HEAD -- mkdocs.yml docs/stylesheets docs/assets tests/unit/docs tests/unit/docs-accessibility.test.ts
```

Reject generated `site/` files from the commit.

### Task 4: PR, DNS, GitHub Pages custom domain, and HTTPS rollout

**Files:**
- Repository code from Tasks 1–2 only; DNS/Pages are external configuration mutations.

**Interfaces:**
- Cloudflare zone for `boardreadyops.com`.
- GitHub Pages repository `oaslananka/boardreadyops`.

- [ ] **Step 1: Open the docs/UI feature PR only after source verification is green**

The PR must report that `https://oaslananka.github.io/boardreadyops/` currently works while `docs.boardreadyops.com` has no DNS record, and that external-domain mutation will occur only after review.

- [ ] **Step 2: Require clean CI/security/docs checks**

At minimum require docs-build, accessibility, lint, typecheck, unit, security gate, SonarCloud, CodeQL, Semgrep, Gitleaks, and dependency review to succeed on the final head.

- [ ] **Step 3: Merge the code change before making the custom hostname canonical in production**

After merge, verify the exact merge SHA’s docs workflow succeeded and GitHub Pages still serves the generated site at the existing project URL.

- [ ] **Step 4: Read the current Cloudflare DNS and GitHub Pages state**

Before mutation, verify:

```text
docs.boardreadyops.com DNS record count = 0
GitHub Pages current URL = https://oaslananka.github.io/boardreadyops/
GitHub Pages current cname = null
```

If state differs, stop and re-plan rather than overwriting unrelated DNS.

- [ ] **Step 5: Create a DNS-only CNAME through Cloudflare API**

Use the existing local Cloudflare credential without printing it. Create exactly:

```text
type: CNAME
name: docs
target: oaslananka.github.io
proxied: false
TTL: auto
```

Immediately read the record back and verify the target and `proxied=false` state.

- [ ] **Step 6: Configure the GitHub Pages custom domain**

Use the GitHub Pages API/update capability to set:

```text
cname = docs.boardreadyops.com
```

Read Pages state back and verify the custom domain is attached. If GitHub reports domain verification is required, use the exact TXT record GitHub supplies; do not invent a verification value.

- [ ] **Step 7: Wait for DNS and GitHub Pages certificate readiness**

Poll boundedly, not continuously. Verify public DNS resolves and HTTPS becomes available. Do not enable Cloudflare proxying to hide an unprovisioned GitHub certificate.

- [ ] **Step 8: Enable GitHub Pages HTTPS enforcement only after the certificate is ready**

Set `https_enforced=true` through the Pages API/capability and read it back.

- [ ] **Step 9: Verify public behavior from outside the browser session**

Require:

```text
https://docs.boardreadyops.com/ -> 200
http://docs.boardreadyops.com/ -> redirects to HTTPS
canonical metadata -> https://docs.boardreadyops.com/
search UI loads
primary navigation works
version selector does not break
static CSS/JS/SVG assets -> 200
```

Also verify `https://boardreadyops.com/` and `/setup` documentation links resolve to the custom hostname.

- [ ] **Step 10: Run a final docs accessibility spot-check on the public hostname**

Use pa11y or Axe against the docs homepage, quickstart, and one deep reference page. Expected: no new WCAG A/AA violation introduced by the custom skin.

- [ ] **Step 11: Record rollback state**

Rollback is non-destructive:

```text
1. Disable Pages custom-domain/HTTPS enforcement if GitHub requires it.
2. Remove only the `docs` CNAME created by this rollout.
3. Restore `mkdocs.yml` site_url in a code revert if the custom domain is intentionally abandoned.
4. GitHub Pages project URL remains the hosting fallback.
```

Do not delete unrelated DNS records.
