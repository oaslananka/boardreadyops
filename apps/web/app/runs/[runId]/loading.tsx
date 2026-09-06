import { AppShell, Panel } from "../../../components/ui.js";

export default function LoadingRun() {
  return (
    <AppShell breadcrumbs={[{ href: "/", label: "Home" }, { label: "Loading run" }]}>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-8" id="main-content" aria-busy="true">
        <section className="run-state-surface flex flex-col gap-4">
          <div className="h-24 animate-pulse rounded-md bg-muted" />
          <Panel title="Loading this run" description="Fetching the results.">
            <div className="h-4 animate-pulse rounded-sm bg-muted" />
            <div className="mt-2 h-4 w-2/3 animate-pulse rounded-sm bg-muted" />
          </Panel>
        </section>
      </main>
    </AppShell>
  );
}
