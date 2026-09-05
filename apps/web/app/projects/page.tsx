import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../../components/app-shell.js";
import { GuidedChecklist } from "../../components/guided-checklist.js";
import { Breadcrumbs, Panel } from "../../components/ui.js";

export const metadata: Metadata = {
  title: "Projects",
  description: "Multi-CAD hardware projects, revisions, and manufacturing readiness.",
};

export default function ProjectsPage() {
  return (
    <AppShell>
      <main id="main-content" className="flex flex-col gap-5 px-6 py-6">
        <Breadcrumbs items={[{ href: "/dashboard", label: "Dashboard" }, { label: "Projects" }]} />

        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Hardware Projects</h1>
            <p className="text-sm text-muted-foreground">
              Manage hardware projects, revisions, and fabrication handoffs across Altium, KiCad, EasyEDA, Fusion 360,
              and Gerber packages.
            </p>
          </div>
          <Link
            href="/projects/new"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            + New Project
          </Link>
        </header>

        <Panel title="Active Projects">
          <GuidedChecklist
            heading="Start tracking your first hardware revision"
            steps={[
              {
                id: "upload",
                label: "Link a repository or upload a manufacturing package",
                status: "current",
                href: "/projects/new",
                actionLabel: "Create First Project",
              },
              { id: "detect", label: "BoardReadyOps detects the CAD format and normalizes it", status: "upcoming" },
              { id: "review", label: "Run a pre-flight review and track revisions here", status: "upcoming" },
            ]}
          />
        </Panel>
      </main>
    </AppShell>
  );
}
