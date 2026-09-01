import { AppShell, Breadcrumbs, Panel } from "../../../components/ui.js";

export default function LoadingRun() {
  return (
    <AppShell>
      <main className="shell" id="main-content" aria-busy="true">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Loading run" }]} />
        <section className="run-state-surface">
          <div className="loading-header skeleton" />
          <Panel title="Loading this run" description="Fetching the results.">
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
          </Panel>
        </section>
      </main>
    </AppShell>
  );
}
