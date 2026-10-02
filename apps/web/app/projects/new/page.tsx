import type { Metadata } from "next";
import { AppShell } from "../../../components/app-shell.js";
import { ProjectUploadWizard } from "../../../components/project-upload-wizard.js";
import { Panel } from "../../../components/ui.js";

export const metadata: Metadata = {
  title: "Add a Project Source",
  description: "Connect a repository or run BoardReadyOps locally for DFM pre-flight review.",
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
          <h1 className="text-2xl font-bold text-foreground">Add a project source</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect a GitHub repository for automated checks, or run BoardReadyOps locally. Direct hosted zip upload is
            not available yet.
          </p>
        </header>

        <Panel title="Choose an ingestion source">
          <ProjectUploadWizard />
        </Panel>
      </main>
    </AppShell>
  );
}
