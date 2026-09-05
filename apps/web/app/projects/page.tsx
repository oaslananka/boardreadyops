import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../../components/app-shell.js";
import { Breadcrumbs, EmptyState, Panel } from "../../components/ui.js";

export const metadata: Metadata = {
  title: "Projects",
  description: "Multi-CAD hardware projects, revisions, and manufacturing readiness.",
};

export default function ProjectsPage() {
  return (
    <AppShell>
      <main id="main-content" className="page-frame">
        <Breadcrumbs items={[{ href: "/dashboard", label: "Dashboard" }, { label: "Projects" }]} />

        <header className="page-intro">
          <div className="flex-between">
            <div>
              <h1>Hardware Projects</h1>
              <p>
                Manage hardware projects, revisions, and fabrication handoffs across Altium, KiCad, and Gerber packages.
              </p>
            </div>
            <div>
              <Link href="/projects/new" className="button button-primary">
                + New Project
              </Link>
            </div>
          </div>
        </header>

        <Panel title="Active Projects">
          <EmptyState
            title="No projects configured yet"
            action={
              <Link href="/projects/new" className="button button-primary">
                Create First Project
              </Link>
            }
          >
            <p>Upload a Multi-CAD zip package or link a repository to start tracking hardware revisions.</p>
          </EmptyState>
        </Panel>
      </main>
    </AppShell>
  );
}
