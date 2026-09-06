import type { Metadata } from "next";
import { AppShell } from "../../../components/app-shell.js";
import { ProjectUploadWizard } from "../../../components/project-upload-wizard.js";
import { Panel } from "../../../components/ui.js";

export const metadata: Metadata = {
  title: "New Project & Package Upload",
  description: "Upload a Multi-CAD manufacturing package or connect a repository for DFM pre-flight review.",
};

export default function NewProjectPage() {
  return (
    <AppShell
      breadcrumbs={[
        { href: "/dashboard", label: "Dashboard" },
        { href: "/projects", label: "Projects" },
        { label: "New Project" },
      ]}
    >
      <main id="main-content" className="flex flex-col gap-5 px-6 py-6">
        <header>
          <h1 className="text-2xl font-bold text-foreground">New Project</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Directly ingest Gerber/drill zip packages, connect your repository, or run local CLI audits.
          </p>
        </header>

        <Panel title="Manufacturing Package Ingestion">
          <ProjectUploadWizard />
        </Panel>
      </main>
    </AppShell>
  );
}
