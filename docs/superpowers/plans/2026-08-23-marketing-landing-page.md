# Marketing Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare-bones root page (`apps/web/app/page.tsx`) with a self-contained, on-brand marketing landing page for `boardreadyops.com`, plus a new product mark used for the page itself, the favicon, and the Open Graph share image.

**Architecture:** The landing route stops using the shared `AppShell`/`apps/web/app/styles.css` (used by `/setup` and `/runs/*`) and gets its own scoped stylesheet and markup. A new `BrandMarkIcon`/`BrandMarkLockup` component (QFP-chip mark) is shared by the page nav, the favicon route (`app/icon.tsx`), and the Open Graph image route (`app/opengraph-image.tsx`). Root layout metadata gains Open Graph/Twitter fields.

**Tech Stack:** Next.js 16 App Router, React, plain CSS (no new dependency), `next/og`'s `ImageResponse` for the favicon/OG image (built into Next.js — no new dependency), Vitest (existing project test runner).

**Spec:** `docs/superpowers/specs/2026-08-23-marketing-landing-page-design.md`

## Global Constraints

- The landing route MUST NOT change the visual appearance of `/setup` or `/runs/*` (spec §2.5, §6.2). Their files (`apps/web/app/setup/page.tsx`, `apps/web/app/runs/**`) are not touched by this plan.
- New styles live in a stylesheet scoped to the landing route, not appended to `apps/web/app/styles.css` (spec §6.2).
- No new web font — system font stack only (spec §4.4).
- Primary CTA target: `https://github.com/apps/boardreadyops/installations/new` (GitHub App install URL) everywhere "Install on GitHub" appears.
- Palette tokens are exact, copied from spec §4.2: background `#0a0f0d`, surface `#0f1713`, border `#1e2e26`, accent `#3fe08a`, accent-soft `#9fc9ae`, fg `#f4fff8`, muted `#6e8a78`.
- Copy ships in English (spec §5).

---

### Task 1: Brand mark component

**Files:**
- Create: `apps/web/components/brand-mark.tsx`
- Test: `tests/unit/web/brand-mark.test.ts`

**Interfaces:**
- Produces: `BrandMarkIcon(props: { size?: number; className?: string }): JSX.Element` (default `size` 32), `BrandMarkLockup(props: { size?: number; className?: string }): JSX.Element` (default `size` 24) — both exported from `apps/web/components/brand-mark.tsx`. Later tasks import these by name.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/web/brand-mark.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BrandMarkIcon, BrandMarkLockup } from "../../../apps/web/components/brand-mark.js";

describe("BrandMarkIcon", () => {
  it("renders an SVG sized by the size prop", () => {
    const element = BrandMarkIcon({ size: 48 });
    expect(element.type).toBe("svg");
    expect(element.props.width).toBe(48);
    expect(element.props.height).toBe(48);
    expect(element.props.viewBox).toBe("0 0 104 104");
  });

  it("defaults to size 32 when no size is given", () => {
    const element = BrandMarkIcon({});
    expect(element.props.width).toBe(32);
  });
});

describe("BrandMarkLockup", () => {
  it("renders the icon at the requested size next to the BoardReadyOps wordmark", () => {
    const element = BrandMarkLockup({ size: 24 });
    const children = element.props.children as [unknown, { props: { children: string } }];
    const [icon, wordmark] = children;
    expect((icon as { type: unknown }).type).toBe(BrandMarkIcon);
    expect((icon as { props: { size: number } }).props.size).toBe(24);
    expect(wordmark.props.children).toBe("BoardReadyOps");
  });

  it("defaults to size 24 when no size is given", () => {
    const element = BrandMarkLockup({});
    const [icon] = element.props.children as [{ props: { size: number } }];
    expect(icon.props.size).toBe(24);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run tests/unit/web/brand-mark.test.ts`
Expected: FAIL — `Cannot find module '../../../apps/web/components/brand-mark.js'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/components/brand-mark.tsx`:

```tsx
export type BrandMarkProps = {
  readonly size?: number;
  readonly className?: string;
};

export function BrandMarkIcon({ size = 32, className }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 104 104"
      role="img"
      aria-label="BoardReadyOps"
      className={className}
    >
      <rect x="4" y="4" width="96" height="96" rx="20" fill="#0f1713" stroke="#1e2e26" />
      <g stroke="#3fe08a" strokeWidth="3" strokeLinecap="round">
        <line x1="36" y1="22" x2="36" y2="30" />
        <line x1="46" y1="22" x2="46" y2="30" />
        <line x1="58" y1="22" x2="58" y2="30" />
        <line x1="68" y1="22" x2="68" y2="30" />
        <line x1="36" y1="74" x2="36" y2="82" />
        <line x1="46" y1="74" x2="46" y2="82" />
        <line x1="58" y1="74" x2="58" y2="82" />
        <line x1="68" y1="74" x2="68" y2="82" />
        <line x1="22" y1="36" x2="30" y2="36" />
        <line x1="22" y1="46" x2="30" y2="46" />
        <line x1="22" y1="58" x2="30" y2="58" />
        <line x1="22" y1="68" x2="30" y2="68" />
        <line x1="74" y1="36" x2="82" y2="36" />
        <line x1="74" y1="46" x2="82" y2="46" />
        <line x1="74" y1="58" x2="82" y2="58" />
        <line x1="74" y1="68" x2="82" y2="68" />
      </g>
      <rect x="30" y="30" width="44" height="44" rx="4" fill="#0c1f16" stroke="#3fe08a" strokeWidth="2.25" />
      <circle cx="36" cy="36" r="2.2" fill="#3fe08a" />
      <path
        d="M40 52 L47 59 L64 42"
        stroke="#f4fff8"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandMarkLockup({ size = 24, className }: BrandMarkProps) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <BrandMarkIcon size={size} />
      <span style={{ fontWeight: 700, fontSize: Math.round(size * 0.62), color: "#f4fff8" }}>BoardReadyOps</span>
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run tests/unit/web/brand-mark.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/brand-mark.tsx tests/unit/web/brand-mark.test.ts
git commit -m "feat(web): add BoardReadyOps QFP-chip brand mark component"
```

---

### Task 2: Landing page structure and stylesheet

**Files:**
- Create: `apps/web/app/landing.css`
- Modify: `apps/web/app/page.tsx` (full rewrite)
- Test: `tests/unit/web/home-page.test.ts`

**Interfaces:**
- Consumes: `BrandMarkIcon` from `apps/web/components/brand-mark.js` (Task 1).
- Produces: default export `HomePage(): JSX.Element` from `apps/web/app/page.tsx` (Next.js page convention — no other task imports it directly, but Task 4's manual verification exercises it via the dev server).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/web/home-page.test.ts`:

```ts
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import HomePage from "../../../apps/web/app/page.js";

function collectText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (isValidElement(node)) {
    return collectText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function collectLinks(node: ReactNode, hrefs: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectLinks(child, hrefs);
    return hrefs;
  }
  if (isValidElement(node)) {
    const props = node.props as { href?: string; children?: ReactNode };
    if (typeof props.href === "string") hrefs.push(props.href);
    collectLinks(props.children, hrefs);
  }
  return hrefs;
}

describe("HomePage", () => {
  it("shows the primary headline", () => {
    const text = collectText(HomePage());
    expect(text).toContain("Release evidence that leads to a decision.");
  });

  it("shows the three feature-grid headings from the existing copy", () => {
    const text = collectText(HomePage());
    expect(text).toContain("Decision first");
    expect(text).toContain("Bounded investigation");
    expect(text).toContain("Authoritative sources");
  });

  it("links every Install on GitHub CTA to the App install URL", () => {
    const links = collectLinks(HomePage());
    const installLinks = links.filter((href) => href === "https://github.com/apps/boardreadyops/installations/new");
    expect(installLinks.length).toBeGreaterThanOrEqual(2);
  });

  it("links the secondary CTA to the setup preview", () => {
    const links = collectLinks(HomePage());
    expect(links).toContain("/setup");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run tests/unit/web/home-page.test.ts`
Expected: FAIL — the current `page.tsx` renders `<AppShell>` with different copy ("Preview repository setup" link, no "Install on GitHub" text), so the headline/CTA assertions fail.

- [ ] **Step 3: Write the stylesheet**

Create `apps/web/app/landing.css`:

```css
.landing {
  background: #0a0f0d;
  color: #e8f5ec;
  font-family: -apple-system, "Segoe UI", Inter, sans-serif;
}

.landing-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 40px;
  border-bottom: 1px solid #1a2620;
}

.landing-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  color: #f4fff8;
  text-decoration: none;
}

.landing-nav-links {
  display: flex;
  align-items: center;
  gap: 28px;
  font-size: 14px;
  color: #9fc9ae;
}

.landing-nav-links a {
  color: inherit;
  text-decoration: none;
}

.landing-nav-links .landing-nav-cta {
  color: #3fe08a;
  border: 1px solid #2a3a30;
  padding: 6px 14px;
  border-radius: 6px;
}

.landing-hero {
  position: relative;
  overflow: hidden;
  text-align: center;
  padding: 72px 40px 64px;
}

.landing-hero::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(60, 220, 140, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(60, 220, 140, 0.07) 1px, transparent 1px);
  background-size: 28px 28px;
}

.landing-hero-inner {
  position: relative;
  max-width: 640px;
  margin: 0 auto;
}

.landing-badge {
  display: inline-block;
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  letter-spacing: 0.08em;
  color: #3fe08a;
  border: 1px solid rgba(63, 224, 138, 0.4);
  padding: 4px 10px;
  border-radius: 4px;
  margin-bottom: 20px;
}

.landing-hero h1 {
  font-size: 40px;
  line-height: 1.15;
  margin: 0 0 16px;
  color: #f4fff8;
}

.landing-hero p {
  font-size: 16px;
  color: #9fc9ae;
  margin: 0 0 28px;
}

.landing-cta-row {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.landing-button-primary,
.landing-button-secondary {
  padding: 12px 22px;
  border-radius: 6px;
  font-size: 14px;
  text-decoration: none;
  display: inline-block;
}

.landing-button-primary {
  background: #3fe08a;
  color: #06130c;
  font-weight: 600;
}

.landing-button-secondary {
  border: 1px solid #2a3a30;
  color: #9fc9ae;
}

.landing-trust-line {
  font-size: 12px;
  color: #6e8a78;
  margin-top: 16px;
}

.landing-pr-preview {
  padding: 0 40px 64px;
}

.landing-pr-preview-panel {
  max-width: 720px;
  margin: 0 auto;
  background: #0f1713;
  border: 1px solid #1e2e26;
  border-radius: 10px;
  overflow: hidden;
}

.landing-pr-preview-chrome {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #1e2e26;
}

.landing-pr-preview-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.landing-pr-preview-path {
  margin-left: 10px;
  font-size: 12px;
  color: #6e8a78;
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
}

.landing-pr-preview-body {
  padding: 20px;
  font-size: 13px;
  line-height: 1.8;
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
}

.landing-pr-preview-pass {
  color: #3fe08a;
}

.landing-pr-preview-detail {
  color: #9fc9ae;
  padding-left: 18px;
}

.landing-pr-preview-link {
  color: #6e8a78;
  padding-left: 18px;
}

.landing-how {
  padding: 0 40px 72px;
  max-width: 900px;
  margin: 0 auto;
}

.landing-how-label {
  text-align: center;
  font-size: 12px;
  letter-spacing: 0.1em;
  color: #6e8a78;
  text-transform: uppercase;
  margin-bottom: 36px;
}

.landing-how-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 28px;
}

.landing-how-step-number {
  color: #3fe08a;
  font-size: 13px;
  margin-bottom: 8px;
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
}

.landing-how-grid h3 {
  font-size: 16px;
  margin: 0 0 8px;
}

.landing-how-grid p {
  font-size: 13px;
  color: #9fc9ae;
  margin: 0;
}

.landing-features {
  padding: 0 40px 72px;
  max-width: 1000px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: #1a2620;
  border: 1px solid #1a2620;
  border-radius: 10px;
  overflow: hidden;
}

.landing-feature-card {
  background: #0d1512;
  padding: 28px;
}

.landing-feature-card h3 {
  font-size: 15px;
  margin: 0 0 8px;
  color: #f4fff8;
}

.landing-feature-card p {
  font-size: 13px;
  color: #9fc9ae;
  margin: 0;
}

.landing-footer-cta {
  padding: 56px 40px;
  text-align: center;
  border-top: 1px solid #1a2620;
}

.landing-footer-cta h2 {
  font-size: 24px;
  margin: 0 0 20px;
  color: #f4fff8;
}

.landing-site-footer {
  padding: 32px 40px;
  text-align: center;
  font-size: 12px;
  color: #6e8a78;
  border-top: 1px solid #1a2620;
}

@media (max-width: 720px) {
  .landing-nav-links span:not(.landing-nav-cta),
  .landing-nav-links a:not(.landing-nav-cta) {
    display: none;
  }

  .landing-hero h1 {
    font-size: 30px;
  }

  .landing-cta-row {
    flex-direction: column;
  }

  .landing-how-grid,
  .landing-features {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Write the page implementation**

Replace the contents of `apps/web/app/page.tsx`:

```tsx
import Link from "next/link";
import { BrandMarkIcon } from "../components/brand-mark.js";
import "./landing.css";

const installUrl = "https://github.com/apps/boardreadyops/installations/new";

export default function HomePage() {
  return (
    <div className="landing">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="landing-nav">
        <Link href="/" className="landing-brand">
          <BrandMarkIcon size={22} />
          BoardReadyOps
        </Link>
        <nav aria-label="Global navigation" className="landing-nav-links">
          <a href="#product">Product</a>
          <a href="#how-it-works">How it works</a>
          <a href="https://docs.boardreadyops.com">Docs</a>
          <a className="landing-nav-cta" href={installUrl}>
            Install on GitHub
          </a>
        </nav>
      </header>

      <main id="main-content">
        <section className="landing-hero">
          <div className="landing-hero-inner">
            <span className="landing-badge">● Early access — built for KiCad</span>
            <h1>Release evidence that leads to a decision.</h1>
            <p>
              Automated DFM/DFA checks on every pull request, a traceable evidence chain, and a single go/no-go
              call — before it ships to manufacturing.
            </p>
            <div className="landing-cta-row">
              <a className="landing-button-primary" href={installUrl}>
                Install on GitHub →
              </a>
              <Link className="landing-button-secondary" href="/setup">
                See an example PR
              </Link>
            </div>
            <p className="landing-trust-line">Free · Unlimited for open-source repositories</p>
          </div>
        </section>

        <section className="landing-pr-preview" aria-label="Example pull request check">
          <div className="landing-pr-preview-panel">
            <div className="landing-pr-preview-chrome">
              <span className="landing-pr-preview-dot" style={{ background: "#ff5f57" }} />
              <span className="landing-pr-preview-dot" style={{ background: "#febc2e" }} />
              <span className="landing-pr-preview-dot" style={{ background: "#28c840" }} />
              <span className="landing-pr-preview-path">github.com/acme/robot-arm-pcb — Pull Request #142</span>
            </div>
            <div className="landing-pr-preview-body">
              <div className="landing-pr-preview-pass">✓ BoardReadyOps — release readiness: PASS</div>
              <div className="landing-pr-preview-detail">
                2 warnings · 0 blocking findings · DRC clean · BOM 100% sourced
              </div>
              <div className="landing-pr-preview-link">Report → dashboard.boardreadyops.com/runs/8f2a…</div>
            </div>
          </div>
        </section>

        <section className="landing-how" id="how-it-works" aria-label="How it works">
          <p className="landing-how-label">How it works</p>
          <div className="landing-how-grid">
            <div>
              <div className="landing-how-step-number">01</div>
              <h3>Install the GitHub App</h3>
              <p>Connect your repo in 30 seconds — zero configuration required.</p>
            </div>
            <div>
              <div className="landing-how-step-number">02</div>
              <h3>Every PR is scanned automatically</h3>
              <p>Your KiCad files are checked for DRC/ERC, BOM integrity, and manufacturing readiness.</p>
            </div>
            <div>
              <div className="landing-how-step-number">03</div>
              <h3>Decide with evidence</h3>
              <p>A clear result on the PR, a fully traceable evidence chain on the dashboard.</p>
            </div>
          </div>
        </section>

        <section className="landing-features" id="product" aria-label="Investigation capabilities">
          <article className="landing-feature-card">
            <h3>Decision first</h3>
            <p>See the stable readiness result and the shortest next action before opening low-level evidence.</p>
          </article>
          <article className="landing-feature-card">
            <h3>Bounded investigation</h3>
            <p>
              Search and page through findings and artifacts without loading unbounded tenant data into the
              browser.
            </p>
          </article>
          <article className="landing-feature-card">
            <h3>Authoritative sources</h3>
            <p>Verify checksums, GitHub publication state, and repository-owned workflow evidence before release.</p>
          </article>
        </section>

        <section className="landing-footer-cta">
          <h2>Try it on your next PR.</h2>
          <a className="landing-button-primary" href={installUrl}>
            Install on GitHub →
          </a>
        </section>
      </main>

      <footer className="landing-site-footer">
        <p>
          BoardReadyOps presents normalized release evidence. Repository source and full workflow logs remain
          authoritative in GitHub.
        </p>
      </footer>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm exec vitest run tests/unit/web/home-page.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/page.tsx apps/web/app/landing.css tests/unit/web/home-page.test.ts
git commit -m "feat(web): rebuild the landing page with the terminal/circuit-board design"
```

---

### Task 3: Favicon, Open Graph image, and metadata

**Files:**
- Create: `apps/web/app/icon.tsx`
- Create: `apps/web/app/opengraph-image.tsx`
- Modify: `apps/web/app/layout.tsx`
- Test: `tests/unit/web/layout-metadata.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks at the type level (the icon/OG routes inline their own SVG rather than importing the React-only `BrandMarkIcon`, since `next/og`'s Satori renderer needs the JSX passed to `ImageResponse` — importing the same component works too, but inlining keeps this task's files self-contained and avoids coupling the renderer to component internals it doesn't need, such as the `className` prop).
- Produces: `metadata` export from `apps/web/app/layout.tsx` gains `openGraph`/`twitter` fields; Next.js file conventions (`icon.tsx`, `opengraph-image.tsx`) auto-populate `metadata.icons`/`metadata.openGraph.images` — do not set those fields by hand in `layout.tsx`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/web/layout-metadata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { metadata } from "../../../apps/web/app/layout.js";

describe("root layout metadata", () => {
  it("keeps the existing page title template", () => {
    expect(metadata.title).toEqual({ default: "BoardReadyOps Cloud", template: "%s · BoardReadyOps" });
  });

  it("sets Open Graph fields for social sharing", () => {
    expect(metadata.openGraph?.title).toBe("BoardReadyOps — Release evidence that leads to a decision.");
    expect(metadata.openGraph?.url).toBe("https://boardreadyops.com");
    expect(metadata.openGraph?.type).toBe("website");
  });

  it("sets a large-image Twitter card", () => {
    expect(metadata.twitter?.card).toBe("summary_large_image");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run tests/unit/web/layout-metadata.test.ts`
Expected: FAIL — `metadata.openGraph` is `undefined`.

- [ ] **Step 3: Update the root layout metadata**

Replace the contents of `apps/web/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: { default: "BoardReadyOps Cloud", template: "%s · BoardReadyOps" },
  description: "Accessible release investigation for KiCad hardware projects.",
  openGraph: {
    title: "BoardReadyOps — Release evidence that leads to a decision.",
    description:
      "Automated DFM/DFA checks on every pull request, a traceable evidence chain, and a single go/no-go call — before it ships to manufacturing.",
    url: "https://boardreadyops.com",
    siteName: "BoardReadyOps",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BoardReadyOps — Release evidence that leads to a decision.",
    description:
      "Automated DFM/DFA checks on every pull request, a traceable evidence chain, and a single go/no-go call — before it ships to manufacturing.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run tests/unit/web/layout-metadata.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Add the favicon route**

Create `apps/web/app/icon.tsx`:

```tsx
import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <svg width="64" height="64" viewBox="0 0 104 104">
          <rect x="4" y="4" width="96" height="96" rx="20" fill="#0f1713" stroke="#1e2e26" />
          <g stroke="#3fe08a" strokeWidth="3" strokeLinecap="round">
            <line x1="36" y1="22" x2="36" y2="30" />
            <line x1="46" y1="22" x2="46" y2="30" />
            <line x1="58" y1="22" x2="58" y2="30" />
            <line x1="68" y1="22" x2="68" y2="30" />
            <line x1="36" y1="74" x2="36" y2="82" />
            <line x1="46" y1="74" x2="46" y2="82" />
            <line x1="58" y1="74" x2="58" y2="82" />
            <line x1="68" y1="74" x2="68" y2="82" />
            <line x1="22" y1="36" x2="30" y2="36" />
            <line x1="22" y1="46" x2="30" y2="46" />
            <line x1="22" y1="58" x2="30" y2="58" />
            <line x1="22" y1="68" x2="30" y2="68" />
            <line x1="74" y1="36" x2="82" y2="36" />
            <line x1="74" y1="46" x2="82" y2="46" />
            <line x1="74" y1="58" x2="82" y2="58" />
            <line x1="74" y1="68" x2="82" y2="68" />
          </g>
          <rect x="30" y="30" width="44" height="44" rx="4" fill="#0c1f16" stroke="#3fe08a" strokeWidth="2.25" />
          <circle cx="36" cy="36" r="2.2" fill="#3fe08a" />
          <path
            d="M40 52 L47 59 L64 42"
            stroke="#f4fff8"
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
```

- [ ] **Step 6: Add the Open Graph image route**

Create `apps/web/app/opengraph-image.tsx`:

```tsx
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0f0d",
          padding: 80,
        }}
      >
        <svg width="88" height="88" viewBox="0 0 104 104" style={{ marginBottom: 36 }}>
          <rect x="4" y="4" width="96" height="96" rx="20" fill="#0f1713" stroke="#1e2e26" />
          <rect x="30" y="30" width="44" height="44" rx="4" fill="#0c1f16" stroke="#3fe08a" strokeWidth="2.25" />
          <circle cx="36" cy="36" r="2.2" fill="#3fe08a" />
          <path
            d="M40 52 L47 59 L64 42"
            stroke="#f4fff8"
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div style={{ fontSize: 56, fontWeight: 700, color: "#f4fff8", textAlign: "center", lineHeight: 1.2 }}>
          Release evidence that leads to a decision.
        </div>
        <div style={{ fontSize: 26, color: "#9fc9ae", marginTop: 24, textAlign: "center" }}>
          BoardReadyOps — release readiness for KiCad hardware
        </div>
      </div>
    ),
    { ...size },
  );
}
```

**Note for the implementer:** `icon.tsx` and `opengraph-image.tsx` cannot be meaningfully unit-tested — they're Next.js file-convention route handlers that render through Satori (`next/og`'s image renderer), which supports only a subset of CSS/SVG. Task 4's manual verification step is where you confirm these actually render correctly; if the nested `<svg>` doesn't render as expected under Satori, fall back to redrawing the same shape with plain `div`/`background`/`border-radius` elements, which Satori supports fully.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/icon.tsx apps/web/app/opengraph-image.tsx apps/web/app/layout.tsx tests/unit/web/layout-metadata.test.ts
git commit -m "feat(web): add favicon, Open Graph image, and social metadata"
```

---

### Task 4: Verification and regression pass

**Files:** none created or modified — this task only runs checks. If any check fails, fix the specific file it points to and re-run.

- [ ] **Step 1: Run the full new-test suite together**

Run: `corepack pnpm exec vitest run tests/unit/web/brand-mark.test.ts tests/unit/web/home-page.test.ts tests/unit/web/layout-metadata.test.ts`
Expected: PASS (11 tests total)

- [ ] **Step 2: Typecheck the web package**

Run: `corepack pnpm run cloud:typecheck`
Expected: exits 0. Fix any type error in the files this plan touched before continuing.

- [ ] **Step 3: Lint**

Run: `corepack pnpm run lint`
Expected: exits 0.

- [ ] **Step 4: Confirm `/setup` and `/runs` are untouched**

Run: `git diff --stat origin/main -- apps/web/app/setup apps/web/app/runs apps/web/app/styles.css apps/web/components/ui.tsx`
Expected: empty output — none of those files appear in the diff. If any do, that's a scope violation of the Global Constraints section; revert the unintended change.

- [ ] **Step 5: Manual visual check**

Run: `corepack pnpm run cloud:dev`, then in a browser open `http://localhost:3000/`:

- Confirm the page matches the approved design (spec §5): dark theme, hero with badge/H1/subhead/two CTAs, PR-preview panel, three-step "how it works", three-card feature grid, footer CTA.
- Resize to a narrow viewport (~375px) and confirm the responsive rules in `landing.css` kick in (nav links collapse to just the CTA, hero heading shrinks, grids stack to one column).
- Tab through the page with the keyboard only; confirm both "Install on GitHub" buttons, the secondary CTA, and all nav links receive a visible focus state and are reachable in a sensible order.
- Open browser dev tools and check computed contrast of `#f4fff8` text and `#9fc9ae` text against the `#0a0f0d`/`#0f1713` backgrounds — both must meet WCAG AA (4.5:1 for body text).
- Visit `http://localhost:3000/setup` and `http://localhost:3000/runs` (or any existing run URL) and confirm they still render in the original light-blue `AppShell` theme, unchanged.
- Confirm the browser tab shows the new chip favicon.

- [ ] **Step 6: Verify the Open Graph image**

With the dev server running, open `http://localhost:3000/opengraph-image` directly in a browser tab and confirm it renders a 1200×630 image with the mark, headline, and subhead — not a broken/blank image. If it fails to render, apply the Task 3 Step 6 fallback (plain `div` shapes instead of nested `<svg>`) and re-check.

- [ ] **Step 7: Final commit if any fixes were needed**

If Steps 2, 3, 5, or 6 required code changes, stage and commit them with a description of what was fixed, e.g.:

```bash
git add -A
git commit -m "fix(web): address landing page verification findings"
```

If no fixes were needed, this task requires no commit — verification-only tasks that pass cleanly don't produce a diff.
