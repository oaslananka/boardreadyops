import type { Metadata } from "next";
import { AppShell } from "../../components/app-shell.js";
import { Breadcrumbs, EmptyState, Panel } from "../../components/ui.js";

export const metadata: Metadata = {
  title: "Component Sourcing & Parts Lifecycle",
  description: "Aggregated BOM component risk, distributor inventory, and lifecycle statuses.",
};

export default function PartsPage() {
  return (
    <AppShell>
      <main id="main-content" className="page-frame">
        <Breadcrumbs items={[{ href: "/dashboard", label: "Dashboard" }, { label: "Parts" }]} />

        <header className="page-intro">
          <h1>Component Intelligence & Parts</h1>
          <p>
            BOM risk aggregation, lead-time warnings, end-of-life alerts, and multi-source distributor availability.
          </p>
        </header>

        <Panel title="Aggregated BOM Components">
          <EmptyState title="No active BOM parts registered">
            <p>Components will automatically appear as you ingest manufacturing packages and BOM files.</p>
          </EmptyState>
        </Panel>
      </main>
    </AppShell>
  );
}
