import type { Metadata } from "next";
import { AppShell } from "../../../components/app-shell.js";
import { ProjectUploadWizard } from "../../../components/project-upload-wizard.js";
import { Breadcrumbs, Panel } from "../../../components/ui.js";

export const metadata: Metadata = {
  title: "New Project & Package Upload",
  description: "Upload a Multi-CAD manufacturing package or connect a repository for DFM pre-flight review.",
};

export default function NewProjectPage() {
  return (
    <AppShell>
      <main id="main-content" className="page-shell">
        <Breadcrumbs
          items={[
            { href: "/dashboard", label: "Dashboard" },
            { href: "/projects", label: "Projects" },
            { label: "New Project" },
          ]}
        />
        <Panel
          title="New Project & Manufacturing Package Ingestion"
          description="Directly ingest Gerber/drill zip packages, connect your repository, or run local CLI audits."
        >
          <ProjectUploadWizard />
        </Panel>
      </main>
    </AppShell>
  );
}
