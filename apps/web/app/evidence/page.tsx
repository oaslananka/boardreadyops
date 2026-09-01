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
          <pre className="setup-code-preview">boardreadyops release verify --ledger ./evidence-ledger.json</pre>
        </div>
      </main>
    </AppShell>
  );
}
