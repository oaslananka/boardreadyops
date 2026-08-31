import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BrandMarkIcon } from "../components/brand-mark.js";
import { installUrl, LandingHeroActions, LandingNavActions } from "../components/landing-actions.js";
import { PublicStructuredData } from "../components/public-structured-data.js";
import "./landing.css";

export const metadata: Metadata = {
  title: { absolute: "BoardReadyOps — Catch board mistakes before the fab does." },
  description: "Checks whether a KiCad board is ready to fabricate, on every pull request.",
  alternates: {
    canonical: "/",
    types: {
      "text/markdown": "/index.md",
    },
  },
};

const proofItems = [
  "Layout and schematic rule checks",
  "Parts you can actually buy",
  "A complete manufacturing package",
  "Every result tied to a file and a checksum",
] as const;

const workflowSteps = [
  {
    number: "01",
    title: "Connect the repository",
    body: "Install the GitHub App. Your source, branch protection and workflow history stay where they are.",
  },
  {
    number: "02",
    title: "Check the exact commit",
    body: "KiCad, BOM and manufacturing checks run against the commit in the pull request, not a moving branch.",
  },
  {
    number: "03",
    title: "Decide before you order",
    body: "Start with the verdict, then open the findings, files and execution history behind it.",
  },
] as const;

const glossaryTerms = [
  {
    term: "DRC",
    definition:
      "Design Rule Check. KiCad checks board geometry such as clearances, widths, keepouts, and connectivity against the rules defined by the project. BoardReadyOps keeps the resulting evidence tied to the exact commit being reviewed instead of treating a local DRC run as timeless proof.",
  },
  {
    term: "ERC",
    definition:
      "Electrical Rules Check. ERC catches schematic-level problems such as incompatible pin types, missing drivers, and unconnected signals. It complements DRC: a board can be geometrically clean while the schematic still contains an electrical contradiction that should block release.",
  },
  {
    term: "BOM",
    definition:
      "Bill of materials. BoardReadyOps evaluates the part list that belongs to the release, including manufacturer part numbers, lifecycle signals, variant consistency, approved alternates, and evidence that the selected parts match the design being handed off.",
  },
  {
    term: "Manufacturing package",
    definition:
      "The fabrication and assembly evidence required by the chosen handoff: Gerbers, drill data, BOM, position or CPL files, drawings, notes, stackup information, and other configured outputs. BoardReadyOps validates completeness and freshness; it does not pretend to be the tool that generated those files.",
  },
  {
    term: "Release evidence",
    definition:
      "Versioned facts used to justify a hardware release decision: check results, manifests, hashes, reports, workflow runs, and manufacturing outputs. Evidence is useful only when a reviewer can trace it back to the exact source revision and see whether it is still current.",
  },
  {
    term: "Check Run",
    definition:
      "GitHub's native status-and-detail record for a commit. BoardReadyOps publishes a concise readiness conclusion there, then links deeper findings and artifacts so an engineer can start with the decision without losing the audit trail behind it.",
  },
  {
    term: "Exact-commit evaluation",
    definition:
      "The rule that every release decision must identify the immutable Git commit it evaluated. A moving branch name is not enough: if the branch changes after a check begins, the evidence remains attached to the original revision rather than silently describing different source.",
  },
  {
    term: "CPL / position file",
    definition:
      "The component placement list used by an assembler to place parts on the PCB. Coordinates, rotation, side, reference designators, and package identity need to agree with the released board and BOM; stale placement data can make an otherwise clean design impossible to assemble correctly.",
  },
  {
    term: "Waiver",
    definition:
      "An explicit, reviewable decision to accept a known finding under defined conditions. BoardReadyOps treats waivers as evidence with scope and history, not as a way to erase a warning from the record. The underlying finding remains understandable to future reviewers.",
  },
  {
    term: "Source of truth",
    definition:
      "The protected repository commit and its GitHub workflow evidence. BoardReadyOps presents and normalizes that evidence, but the repository, pull request, Check Run, workflow history, and versioned files remain authoritative for what was reviewed and released.",
  },
] as const;

const releaseGuides = [
  {
    title: "Why an exact commit matters",
    body: "Hardware reviews are often longer than software checks. A BOM can be refreshed, a footprint moved, or a fabrication output regenerated while somebody is still looking at the pull request. BoardReadyOps records the commit and workflow context that produced a result so a later change cannot inherit an earlier green decision by accident. When a new commit appears, it deserves new evidence. That keeps the question simple: the verdict on screen describes this revision, not a nearby version of the board.",
  },
  {
    title: "Evidence stays close to the engineering workflow",
    body: "The useful place for a release decision is where engineers already review change: the pull request and its GitHub checks. The Check Run carries the short conclusion; findings explain what needs attention; artifacts and hashes show which generated outputs were evaluated; workflow logs preserve execution context. BoardReadyOps is deliberately not a replacement repository. It creates a navigable decision trail over evidence that remains owned by the project.",
  },
  {
    title: "Manufacturing readiness is broader than DRC and ERC",
    body: "A clean schematic and layout are necessary, but they do not prove that a contract manufacturer received a usable package. The release also needs the expected Gerbers and drill files, a BOM that matches the selected variant, component placement data, useful fabrication notes, and any project-specific vendor requirements. BoardReadyOps brings those checks into one release-readiness view so missing handoff evidence is visible before an order is placed.",
  },
  {
    title: "Repository control remains explicit",
    body: "The production GitHub App is intentionally narrow. Repository-owned configuration and workflow files go through the same protected pull-request process as the board itself. BoardReadyOps can report a decision and dispatch the repository-owned evaluation workflow, but it does not quietly rewrite design files or bypass branch protection. That boundary makes a green result easier to trust because the automation cannot change the source in order to make its own check pass.",
  },
] as const;

const releaseFaq = [
  {
    question: "Does BoardReadyOps generate the manufacturing files?",
    answer:
      "No. KiCad, KiBot, kicad-cli, or the fabrication pipeline your team already trusts should generate Gerbers, drill files, BOM exports, position files, drawings, and related outputs. BoardReadyOps checks whether the expected release evidence exists, belongs to the revision under review, and satisfies the release policy. Keeping generation and verification separate avoids turning a readiness gate into another opaque build system.",
  },
  {
    question: "When should a release check run again?",
    answer:
      "Whenever the source revision or evidence that supports the decision changes. A footprint edit, BOM substitution, regenerated fabrication archive, policy change, or new commit can change the release conclusion. The exact-commit model makes that boundary visible: an older green Check Run remains a record of what it evaluated, but it is not silently promoted to evidence for a different revision.",
  },
  {
    question: "How should a reviewer interpret a waiver?",
    answer:
      "A waiver is a documented engineering decision, not a deleted finding. Reviewers should be able to see what was waived, why the exception was accepted, which scope it applies to, and whether the underlying condition still exists. That makes temporary manufacturing exceptions and known design tradeoffs auditable without teaching the automation to ignore the problem forever.",
  },
  {
    question: "What makes a manufacturing handoff reviewable later?",
    answer:
      "The handoff needs more than a folder of outputs. It needs a traceable source revision, a manifest or equivalent inventory, hashes for important files, the policy that was evaluated, and a workflow record showing how the evidence was produced and checked. BoardReadyOps organizes those facts around the release decision so another engineer can reconstruct why the board was considered ready without relying on somebody's local workstation state.",
  },
] as const;

const releaseEvidenceChecklist = [
  {
    title: "Source revision",
    body: "Record the immutable Git commit that the decision describes. A branch name can move after review starts; the release evidence must not.",
  },
  {
    title: "Design checks",
    body: "Keep DRC and ERC results associated with the evaluated project so schematic and layout findings can be traced to the same revision as the handoff.",
  },
  {
    title: "Manufacturing outputs",
    body: "Verify that expected Gerbers, drill data, BOM, CPL or position files, drawings, and configured vendor deliverables are present and current rather than leftovers from an older build.",
  },
  {
    title: "Evidence identity",
    body: "Use manifests, hashes, or equivalent identifiers for important artifacts. A reviewer should be able to tell which exact output was checked without trusting a filename alone.",
  },
  {
    title: "Policy and exceptions",
    body: "Preserve the release policy, blocking threshold, suppressions, and waivers that shaped the verdict. Exceptions should remain visible engineering decisions with scope and rationale.",
  },
  {
    title: "Workflow record",
    body: "Keep the GitHub workflow and Check Run that produced the result. Together they show when the evaluation ran, which revision it evaluated, and where a reviewer can inspect the authoritative execution evidence.",
  },
] as const;

const capabilities = [
  {
    eyebrow: "Design",
    title: "Layout and schematic",
    body: "Every rule violation stays attached to the commit that introduced it.",
  },
  {
    eyebrow: "Supply chain",
    title: "Bill of materials",
    body: "Missing part numbers, parts going end of life, and gaps between variants — before handoff.",
  },
  {
    eyebrow: "Manufacturing",
    title: "Manufacturing readiness",
    body: "Gerbers, drill files, markings and assembly outputs, checked for completeness.",
  },
  {
    eyebrow: "Traceability",
    title: "Nothing unaccounted for",
    body: "Every result traces back to a versioned file, its checksum, and the workflow run that produced it.",
  },
  {
    eyebrow: "Speed",
    title: "Fast on a long history",
    body: "Search, filter and sort without waiting for your whole history to load.",
  },
  {
    eyebrow: "Publication",
    title: "It all lives in GitHub",
    body: "Check Runs, pull requests and workflow logs stay in GitHub. No second place to look.",
  },
] as const;

export default function HomePage() {
  return (
    <div className="landing">
      <PublicStructuredData />
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
          <a href="#glossary">Glossary</a>
          <a href="https://docs.boardreadyops.com/security/assurance-case/">Trust</a>
          <a href="https://docs.boardreadyops.com">Docs</a>
          {/* Suspended so reading the session never delays the landing navigation. */}
          <Suspense fallback={null}>
            <LandingNavActions />
          </Suspense>
        </nav>
      </header>

      <main id="main-content">
        <section className="landing-hero" aria-labelledby="landing-heading">
          <div className="landing-shell landing-hero-layout">
            <div className="landing-hero-copy">
              <p className="landing-kicker">Hardware release intelligence for KiCad</p>
              <h1 id="landing-heading">Catch board mistakes before the fab does.</h1>
              <p className="landing-hero-lede">
                BoardReadyOps runs KiCad&apos;s checks on every pull request and tells you in one line whether the board
                is ready to fabricate. Your repository stays exactly where it is.
              </p>
              <div className="landing-cta-row">
                <Suspense
                  fallback={
                    <a className="landing-button-primary" href={installUrl}>
                      <span>Install on GitHub</span>
                      <span aria-hidden="true">↗</span>
                    </a>
                  }
                >
                  <LandingHeroActions />
                </Suspense>
              </div>
              <ul className="landing-hero-notes" aria-label="What BoardReadyOps does">
                <li>Runs on every pull request</li>
                <li>Shows its working</li>
                <li>Your repository stays in charge</li>
              </ul>
            </div>

            <aside className="landing-evidence-stack" aria-label="What a run looks like">
              <div className="landing-evidence-header">
                <span className="landing-live-dot" aria-hidden="true" />
                <span>Release readiness</span>
                <code>pull_request</code>
              </div>
              <div className="landing-evidence-decision">
                <div>
                  <span className="landing-evidence-label">The verdict</span>
                  <strong>Ready to fabricate</strong>
                </div>
                <span className="landing-state-pill">Every check passed</span>
              </div>
              <ol className="landing-evidence-rows">
                <li>
                  <span className="landing-evidence-index">01</span>
                  <div>
                    <strong>The commit it checked</strong>
                    <span className="landing-evidence-description">Exact revision, branch, and Check Run</span>
                  </div>
                  <span className="landing-row-state">Pinned</span>
                </li>
                <li>
                  <span className="landing-evidence-index">02</span>
                  <div>
                    <strong>What it found</strong>
                    <span className="landing-evidence-description">
                      Layout, schematic, BOM, and manufacturing checks
                    </span>
                  </div>
                  <span className="landing-row-state">Explained</span>
                </li>
                <li>
                  <span className="landing-evidence-index">03</span>
                  <div>
                    <strong>The files it produced</strong>
                    <span className="landing-evidence-description">Reports and outputs, each with a checksum</span>
                  </div>
                  <span className="landing-row-state">Downloadable</span>
                </li>
              </ol>
              <p className="landing-evidence-footnote">
                Your repository and its workflow logs stay the source of truth.
              </p>
            </aside>
          </div>
        </section>

        <section className="landing-proof landing-product-proof" aria-labelledby="proof-heading">
          <div className="landing-shell landing-proof-layout">
            <div className="landing-section-heading">
              <p className="landing-section-kicker">Pull request evidence</p>
              <h2 id="proof-heading">Every pull request, reviewed like a design review.</h2>
              <p>
                DRC, ERC, BOM and manufacturing checks arrive as one answer instead of several logs, and every part of
                it links back to the GitHub run it came from.
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
              <p className="landing-section-kicker">What you see</p>
              <h2 id="control-room-heading">The answer first. The reasons underneath.</h2>
              <p>
                Open a run and the verdict is the first thing on the page. Everything below it is there to explain that
                verdict, or to let you argue with it.
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
                  <li className="landing-state-pill landing-state-pill-muted">Loads fast</li>
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
                  <span className="landing-card-kicker">Finding things</span>
                  <h3>Search what matters, not everything you have ever run.</h3>
                  <p>Filter findings and files without pulling your whole history down the wire.</p>
                </article>
                <article>
                  <span className="landing-card-kicker">Back to the source</span>
                  <h3>Every answer links back to where it came from.</h3>
                  <p>One click to the commit, the Check Run, the workflow run, the pull request, or the file itself.</p>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-capabilities" aria-labelledby="capabilities-heading">
          <div className="landing-shell">
            <div className="landing-section-heading landing-section-heading-wide">
              <p className="landing-section-kicker">Engineering coverage</p>
              <h2 id="capabilities-heading">Every check stays tied to the commit it ran on.</h2>
              <p>Layout, supply chain and manufacturing all reported the same way, so nothing needs translating.</p>
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
              <h2 id="trust-heading">Your repository stays the source of truth.</h2>
              <p>
                BoardReadyOps reads and reports; it does not take custody of anything. Your source, branch protections,
                pull requests, checks and full workflow logs stay in the repository you already run.
              </p>
            </div>
            <dl className="landing-trust-grid">
              <div>
                <dt>Source of truth</dt>
                <dd>Repository commit and protected GitHub workflow evidence</dd>
              </div>
              <div>
                <dt>Investigation</dt>
                <dd>Findings and file details only — never your board design itself</dd>
              </div>
              <div>
                <dt>Decision trail</dt>
                <dd>Check Run, publication state, attempts, checksums, and audit boundary</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="landing-release-guide" aria-labelledby="release-guide-heading">
          <div className="landing-shell">
            <div className="landing-section-heading landing-section-heading-wide">
              <p className="landing-section-kicker">How to read a release decision</p>
              <h2 id="release-guide-heading">Evidence is useful when another engineer can reproduce the reasoning.</h2>
              <p>
                BoardReadyOps is built around a small set of release principles that make hardware evidence easier to
                review now and easier to audit later.
              </p>
            </div>
            <div className="landing-guide-grid">
              {releaseGuides.map((guide) => (
                <article key={guide.title}>
                  <h3>{guide.title}</h3>
                  <p>{guide.body}</p>
                </article>
              ))}
            </div>
            <section className="landing-evidence-checklist" aria-labelledby="evidence-checklist-heading">
              <h3 id="evidence-checklist-heading">A reviewable release-evidence checklist</h3>
              <p>
                A green verdict should be explainable without access to the original engineer's workstation. These are
                the evidence categories a reviewer should expect to trace.
              </p>
              <ol>
                {releaseEvidenceChecklist.map((entry) => (
                  <li key={entry.title}>
                    <strong>{entry.title}</strong>
                    <span>{entry.body}</span>
                  </li>
                ))}
              </ol>
            </section>

            <div className="landing-faq-heading">
              <h3>Release-readiness questions</h3>
              <p>Practical boundaries that keep the verdict understandable instead of turning it into a black box.</p>
            </div>
            <div className="landing-faq-grid">
              {releaseFaq.map((entry) => (
                <article key={entry.question}>
                  <h3>{entry.question}</h3>
                  <p>{entry.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-glossary" id="glossary" aria-labelledby="glossary-heading">
          <div className="landing-shell">
            <div className="landing-section-heading landing-section-heading-wide">
              <p className="landing-section-kicker">Glossary</p>
              <h2 id="glossary-heading">The hardware-release terms behind the verdict.</h2>
              <p>
                These definitions describe the evidence BoardReadyOps reports. For implementation details, continue to
                the canonical documentation; for the public machine-readable service contract, see OpenAPI.
              </p>
            </div>
            <dl className="landing-glossary-grid">
              {glossaryTerms.map((entry) => (
                <div key={entry.term}>
                  <dt>{entry.term}</dt>
                  <dd>{entry.definition}</dd>
                </div>
              ))}
            </dl>
            <nav className="landing-technical-links" aria-label="Technical discovery references">
              <a href="https://docs.boardreadyops.com">Read the documentation</a>
              <a href="/openapi.json">OpenAPI</a>
              <a href="/llms.txt">LLM discovery</a>
              <a href="/sitemap.md">Markdown sitemap</a>
            </nav>
          </div>
        </section>

        <section className="landing-footer-cta" aria-labelledby="landing-cta-heading">
          <div className="landing-shell landing-footer-cta-inner">
            <div>
              <p className="landing-section-kicker">Next release</p>
              <h2 id="landing-cta-heading">Check your next board before you order it.</h2>
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
            Release readiness checks for hardware teams. Your repository and its full workflow logs stay the source of
            truth.
          </p>
          <a href="https://docs.boardreadyops.com">Documentation</a>
        </div>
      </footer>
    </div>
  );
}
