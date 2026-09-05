import type { Metadata } from "next";
import { AppShell } from "../../components/app-shell.js";
import { GuidedChecklist } from "../../components/guided-checklist.js";
import { Breadcrumbs, Panel } from "../../components/ui.js";

export const metadata: Metadata = {
  title: "Release Deliveries & Fabrication Packages",
  description: "Cryptographically signed manufacturing release deliveries and guest links.",
};

export default function DeliveriesListPage() {
  return (
    <AppShell>
      <main id="main-content" className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <Breadcrumbs items={[{ href: "/dashboard", label: "Dashboard" }, { label: "Deliveries" }]} />

        <header>
          <h1 className="text-2xl font-bold text-foreground">Release Deliveries</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Traceable manufacturing packages, guest sign-off links, and Fabrication Handoff archives.
          </p>
        </header>

        <Panel title="Active Manufacturing Deliveries">
          <GuidedChecklist
            heading="Generate your first manufacturing delivery"
            steps={[
              {
                id: "review",
                label: "Complete a hardware review and get it approved",
                status: "current",
                href: "/reviews",
                actionLabel: "Go to Reviews",
              },
              {
                id: "deliver",
                label: "Generate a secure guest delivery link to share verified packages with a manufacturing partner",
                status: "upcoming",
              },
            ]}
          />
        </Panel>
      </main>
    </AppShell>
  );
}
