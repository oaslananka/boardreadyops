import type { Metadata } from "next";
import { AppShell } from "../../../components/app-shell.js";
import { ProjectUploadWizard } from "../../../components/project-upload-wizard.js";
import { Panel } from "../../../components/ui.js";
import { ViewerNav } from "../../../components/viewer-nav.js";
import { loadViewerRepositoryResult } from "../../../lib/repository-dashboard.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

export const metadata: Metadata = {
  title: "Add a Project Source",
  description: "Connect a repository or run BoardReadyOps locally for DFM pre-flight review.",
};

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const viewer = await viewerAuthorization();
  const { state, groups } = await loadViewerRepositoryResult(viewer.session);
  // Only pass currently verified, viewer-scoped repositories to the client.
  // Setup re-checks the user's installation and GitHub repository grants before
  // any write. Never trust a repository id from an arbitrary query parameter.
  const repositories =
    state === "access-unavailable"
      ? []
      : groups.flatMap((group) =>
          group.repositories.map((repository) => ({
            id: repository.id,
            fullName: `${repository.owner}/${repository.name}`,
            hasSetupRevision: repository.setupRevision !== undefined,
          })),
        );
  return (
    <AppShell
      viewerNav={<ViewerNav />}
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
          <ProjectUploadWizard
            signedIn={Boolean(viewer.session)}
            accessUnavailable={state === "access-unavailable"}
            repositories={repositories}
          />
        </Panel>
      </main>
    </AppShell>
  );
}
