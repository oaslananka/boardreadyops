import Link from "next/link";
import { BrandMarkIcon } from "../components/brand-mark.js";
import "./landing.css";

const installUrl = "https://github.com/apps/boardreadyops/installations/new";

const proofItems = [
  "DRC / ERC and design-rule evidence",
  "BOM and sourcing integrity",
  "Manufacturing package completeness",
  "Versioned findings, artifacts, and checksums",
] as const;

const workflowSteps = [
  {
    number: "01",
    title: "Connect the repository",
    body: "Install the GitHub App and keep source authority, branch protection, and workflow history in GitHub.",
  },
  {
    number: "02",
    title: "Evaluate the exact revision",
    body: "BoardReadyOps normalizes KiCad, BOM, manufacturing, and release evidence for the pull-request revision.",
  },
  {
    number: "03",
    title: "Investigate before release",
    body: "Start with the decision, then open bounded findings, artifacts, execution attempts, and publication evidence.",
  },
] as const;

const capabilities = [
  {
    eyebrow: "Design",
    title: "DRC and ERC evidence",
    body: "Keep electrical and physical rule findings attached to the source revision that produced them.",
  },
  {
    eyebrow: "Supply chain",
    title: "BOM integrity",
    body: "Surface missing MPNs, lifecycle risk, sourcing gaps, and variant consistency before handoff.",
  },
  {
    eyebrow: "Manufacturing",
    title: "Manufacturing readiness",
    body: "Check fabrication and assembly package completeness, drill coverage, markings, and release outputs.",
  },
  {
    eyebrow: "Evidence",
    title: "Checksums and artifacts",
    body: "Trace normalized results to versioned artifacts, checksums, and repository-owned workflow output.",
  },
  {
    eyebrow: "Investigation",
    title: "Bounded data access",
    body: "Search, filter, group, sort, and page through evidence without loading an unbounded tenant history.",
  },
  {
    eyebrow: "Publication",
    title: "GitHub-native decision trail",
    body: "Follow Check Run, pull-request, workflow, and publication state without creating a second source of truth.",
  },
] as const;

export default function HomePage() {
  return (
    <div className="landing">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="BoardReadyOps home">
          <BrandMarkIcon size={24} />
          <span className="landing-brand-name">BoardReadyOps</span>
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
        <section className="landing-hero" aria-labelledby="landing-heading">
          <div className="landing-shell landing-hero-layout">
            <div className="landing-hero-copy">
              <p className="landing-kicker">Hardware release intelligence for KiCad</p>
              <h1 id="landing-heading">Release evidence that leads to a decision.</h1>
              <p className="landing-hero-lede">
                Turn every pull request into a traceable manufacturing-readiness decision without moving repository
                authority out of GitHub.
              </p>
              <div className="landing-cta-row">
                <a className="landing-button-primary" href={installUrl}>
                  <span>Install on GitHub</span>
                  <span aria-hidden="true">↗</span>
                </a>
                <Link className="landing-button-secondary" href="/setup">
                  Preview repository setup
                </Link>
              </div>
              <ul className="landing-hero-notes" aria-label="Product boundaries">
                <li>Pull-request native</li>
                <li>Evidence first</li>
                <li>Repository authority preserved</li>
              </ul>
            </div>

            <aside className="landing-evidence-stack" aria-label="Release evidence flow">
              <div className="landing-evidence-header">
                <span className="landing-live-dot" aria-hidden="true" />
                <span>Release evidence</span>
                <code>pull_request</code>
              </div>
              <div className="landing-evidence-decision">
                <div>
                  <span className="landing-evidence-label">Normalized decision</span>
                  <strong>Review readiness</strong>
                </div>
                <span className="landing-state-pill">Evidence linked</span>
              </div>
              <ol className="landing-evidence-rows">
                <li>
                  <span className="landing-evidence-index">01</span>
                  <div>
                    <strong>Source revision</strong>
                    <span className="landing-evidence-description">Commit, ref, Check Run, workflow identity</span>
                  </div>
                  <span className="landing-row-state">Bound</span>
                </li>
                <li>
                  <span className="landing-evidence-index">02</span>
                  <div>
                    <strong>Normalized findings</strong>
                    <span className="landing-evidence-description">Design, BOM, manufacturing, release gates</span>
                  </div>
                  <span className="landing-row-state">Bounded</span>
                </li>
                <li>
                  <span className="landing-evidence-index">03</span>
                  <div>
                    <strong>Release artifacts</strong>
                    <span className="landing-evidence-description">Checksums, provenance, availability, retention</span>
                  </div>
                  <span className="landing-row-state">Traceable</span>
                </li>
              </ol>
              <p className="landing-evidence-footnote">Repository source and workflow output remain authoritative.</p>
            </aside>
          </div>
        </section>

        <section className="landing-proof" aria-labelledby="proof-heading">
          <div className="landing-shell landing-proof-layout">
            <div className="landing-section-heading">
              <p className="landing-section-kicker">Pull request evidence</p>
              <h2 id="proof-heading">Pull request evidence, normalized for a release decision.</h2>
              <p>
                BoardReadyOps turns heterogeneous hardware checks into one investigation surface while keeping the
                underlying GitHub evidence reachable.
              </p>
            </div>
            <ul className="landing-proof-list">
              {proofItems.map((item, index) => (
                <li key={item}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{item}</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-workflow" id="how-it-works" aria-labelledby="workflow-heading">
          <div className="landing-shell">
            <div className="landing-section-heading landing-section-heading-wide">
              <p className="landing-section-kicker">Release workflow</p>
              <h2 id="workflow-heading">From design change to release decision.</h2>
              <p>Keep the engineering path short: connect, evaluate, investigate.</p>
            </div>
            <ol className="landing-workflow-grid">
              {workflowSteps.map((step) => (
                <li key={step.number}>
                  <span className="landing-step-number">{step.number}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-control-room" id="product" aria-labelledby="control-room-heading">
          <div className="landing-shell">
            <div className="landing-section-heading landing-section-heading-wide">
              <p className="landing-section-kicker">Product surface</p>
              <h2 id="control-room-heading">An evidence control room for hardware releases.</h2>
              <p>
                Read the release decision first, then move into only the evidence required to understand or challenge
                it.
              </p>
            </div>

            <div className="landing-control-room-frame">
              <header className="landing-control-room-header">
                <div>
                  <span className="landing-evidence-label">Investigation</span>
                  <strong>repository / release revision</strong>
                </div>
                <ul className="landing-control-room-statuses">
                  <li className="landing-state-pill">Decision first</li>
                  <li className="landing-state-pill landing-state-pill-muted">Evidence bounded</li>
                </ul>
              </header>
              <div className="landing-control-room-grid">
                <article className="landing-control-room-primary">
                  <span className="landing-card-kicker">Decision first</span>
                  <h3>Shortest next action before low-level evidence.</h3>
                  <p>
                    See the stable readiness result, blocking state, and direct path to the evidence that can change the
                    release decision.
                  </p>
                  <div className="landing-control-actions" aria-hidden="true">
                    <span className="landing-control-action">Review blocking findings</span>
                    <span className="landing-control-action">Verify release evidence</span>
                  </div>
                </article>
                <article>
                  <span className="landing-card-kicker">Bounded investigation</span>
                  <h3>Search the evidence, not an unbounded history.</h3>
                  <p>Filter findings and artifacts while server-side pagination keeps tenant data bounded.</p>
                </article>
                <article>
                  <span className="landing-card-kicker">Authoritative sources</span>
                  <h3>Every conclusion stays traceable.</h3>
                  <p>Return to source commits, checks, workflow runs, pull requests, artifacts, and checksums.</p>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-capabilities" aria-labelledby="capabilities-heading">
          <div className="landing-shell">
            <div className="landing-section-heading landing-section-heading-wide">
              <p className="landing-section-kicker">Engineering coverage</p>
              <h2 id="capabilities-heading">Checks that stay tied to the source revision.</h2>
              <p>One visual language across design evidence, manufacturing evidence, and release provenance.</p>
            </div>
            <div className="landing-capability-grid">
              {capabilities.map((capability) => (
                <article key={capability.title}>
                  <span className="landing-card-kicker">{capability.eyebrow}</span>
                  <h3>{capability.title}</h3>
                  <p>{capability.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-trust-boundary" aria-labelledby="trust-heading">
          <div className="landing-shell landing-trust-layout">
            <div className="landing-section-heading">
              <p className="landing-section-kicker">Trust boundary</p>
              <h2 id="trust-heading">Authoritative in GitHub.</h2>
              <p>
                BoardReadyOps is an investigation and normalization layer. Source, branch protections, pull requests,
                checks, and complete workflow logs stay in the repository you already govern.
              </p>
            </div>
            <dl className="landing-trust-grid">
              <div>
                <dt>Source of truth</dt>
                <dd>Repository commit and protected GitHub workflow evidence</dd>
              </div>
              <div>
                <dt>Investigation</dt>
                <dd>Normalized, privacy-bounded findings and artifact metadata</dd>
              </div>
              <div>
                <dt>Decision trail</dt>
                <dd>Check Run, publication state, attempts, checksums, and audit boundary</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="landing-footer-cta" aria-labelledby="landing-cta-heading">
          <div className="landing-shell landing-footer-cta-inner">
            <div>
              <p className="landing-section-kicker">Next release</p>
              <h2 id="landing-cta-heading">Bring release evidence into your next pull request.</h2>
            </div>
            <div className="landing-cta-row">
              <a className="landing-button-primary" href={installUrl}>
                <span>Install on GitHub</span>
                <span aria-hidden="true">↗</span>
              </a>
              <Link className="landing-button-secondary" href="/setup">
                Review setup first
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-site-footer">
        <div className="landing-shell landing-footer-inner">
          <span className="landing-footer-brand">
            <BrandMarkIcon size={20} />
            BoardReadyOps
          </span>
          <p>
            Normalized release evidence for hardware teams. Repository source and full workflow logs remain
            authoritative in GitHub.
          </p>
          <a href="https://docs.boardreadyops.com">Documentation</a>
        </div>
      </footer>
    </div>
  );
}
