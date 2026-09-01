import { AppShell, Breadcrumbs } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";

export const metadata = {
  title: "Releases & Evidence",
  description: "Signed evidence packs bound to review decisions, approvals and artifact digests.",
};

export default function EvidencePage() {
  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="page-frame operational-page" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Evidence" }]} />
        <header className="page-intro">
          <h1>Releases & Evidence</h1>
          <p>Signed evidence packs bound to review decisions, approvals and artifact digests.</p>
        </header>

        <div className="panel surface-raised">
          <p>
            Evidence packs are deterministic, offline-verifiable, and include base/head SHAs, tool versions, digests and
            decision history.
          </p>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable overflow-x region needs tabIndex so keyboard users can scroll it (WCAG 2.1.1, axe scrollable-region-focusable). */}
          <pre className="setup-code-preview" tabIndex={0}>
            boardreadyops release verify --ledger ./evidence-ledger.json
          </pre>
        </div>
      </main>
    </AppShell>
  );
}
