import { AppShell } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";

export const metadata = {
  title: "Releases & Evidence",
  description: "Signed evidence packs bound to review decisions, approvals and artifact digests.",
};

export default function EvidencePage() {
  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/", label: "Home" }, { label: "Evidence" }]}>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Releases & Evidence</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed evidence packs bound to review decisions, approvals and artifact digests.
          </p>
        </header>

        <div className="rounded-md border border-border bg-card p-4 shadow-e2">
          <p className="text-sm text-foreground">
            Evidence packs are deterministic, offline-verifiable, and include base/head SHAs, tool versions, digests and
            decision history.
          </p>
          {/* A scrollable block needs keyboard access, or its overflow is unreachable without a pointer. */}
          <pre
            className="mt-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: axe requires a scrollable region to be keyboard-reachable
            tabIndex={0}
          >
            boardreadyops release verify --ledger ./evidence-ledger.json
          </pre>
        </div>
      </main>
    </AppShell>
  );
}
