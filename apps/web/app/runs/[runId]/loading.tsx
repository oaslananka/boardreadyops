import { AppShell, Breadcrumbs, Panel } from "../../../components/ui.js";

export default function LoadingRun() {
  return (
    <AppShell>
      <main className="shell" id="main-content" aria-busy="true">
        <Breadcrumbs items={[{ href: "/", label: "BoardReadyOps" }, { label: "Loading run" }]} />
        <div className="loading-header skeleton" />
        <Panel title="Loading run investigation" description="Fetching normalized run state and bounded evidence.">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </Panel>
      </main>
    </AppShell>
  );
}
