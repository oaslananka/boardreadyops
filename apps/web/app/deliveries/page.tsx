import type { Metadata } from "next";
import { AppShell } from "../../components/app-shell.js";
import { Breadcrumbs, EmptyState, Panel } from "../../components/ui.js";

export const metadata: Metadata = {
  title: "Release Deliveries & Fabrication Packages",
  description: "Cryptographically signed manufacturing release deliveries and guest links.",
};

export default function DeliveriesListPage() {
  return (
    <AppShell>
      <main id="main-content" className="page-frame">
        <Breadcrumbs items={[{ href: "/dashboard", label: "Dashboard" }, { label: "Deliveries" }]} />

        <header className="page-intro">
          <h1>Release Deliveries</h1>
          <p>Traceable manufacturing packages, guest sign-off links, and Fabrication Handoff archives.</p>
        </header>

        <Panel title="Active Manufacturing Deliveries">
          <EmptyState title="No active deliveries generated">
            <p>
              Generate a secure guest delivery link directly from any completed review to share verified Gerber and BOM
              packages with manufacturing partners.
            </p>
          </EmptyState>
        </Panel>
      </main>
    </AppShell>
  );
}
