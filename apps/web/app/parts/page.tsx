import type { Metadata } from "next";
import { AppShell } from "../../components/app-shell.js";
import { GuidedChecklist } from "../../components/guided-checklist.js";
import { Breadcrumbs, Panel } from "../../components/ui.js";

export const metadata: Metadata = {
  title: "Component Intelligence & Parts",
  description: "Aggregated BOM component risk, distributor inventory, and lifecycle statuses.",
};

export default function PartsPage() {
  return (
    <AppShell>
      <main id="main-content" className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <Breadcrumbs items={[{ href: "/dashboard", label: "Dashboard" }, { label: "Parts" }]} />

        <header>
          <h1 className="text-2xl font-bold text-foreground">Component Intelligence & Parts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            BOM risk aggregation, lead-time warnings, end-of-life alerts, and multi-source distributor availability.
          </p>
        </header>

        <Panel title="Aggregated BOM Components">
          <GuidedChecklist
            heading="Populate your component intelligence"
            steps={[
              {
                id: "setup",
                label: "Link a repository with a hardware project",
                status: "current",
                href: "/setup",
                actionLabel: "Go to Setup",
              },
              {
                id: "ingest",
                label: "Ingest a manufacturing package or BOM file to populate parts automatically",
                status: "upcoming",
              },
            ]}
          />
        </Panel>
      </main>
    </AppShell>
  );
}
