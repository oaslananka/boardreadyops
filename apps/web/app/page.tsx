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
              Automated DFM/DFA checks on every pull request, a traceable evidence chain, and a single go/no-go call —
              before it ships to manufacturing.
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
              Search and page through findings and artifacts without loading unbounded tenant data into the browser.
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
