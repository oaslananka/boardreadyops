import type { ProjectRecord } from "@boardreadyops/db";
import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../../components/app-shell.js";
import { GuidedChecklist } from "../../components/guided-checklist.js";
import { CreateProjectForm, CreateWorkspaceForm } from "../../components/projects/workspace-forms.js";
import { Button } from "../../components/ui/button.js";
import { type DataColumn, DataTable } from "../../components/ui/data-table.js";
import { EmptyState, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { WorkspaceSwitcher } from "../../components/workspace-switcher.js";
import { loadWorkspaceProjects } from "../../lib/project-listing.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";
import { createProjectAction, createWorkspaceAction } from "./actions.js";

export const metadata: Metadata = {
  title: "Projects",
  description: "Multi-CAD hardware projects, revisions, and manufacturing readiness.",
};

// Scoped to the viewer's workspace memberships, so it can never be prerendered.
export const dynamic = "force-dynamic";

export type ProjectsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const cadFormatLabels: Record<string, string> = {
  kicad: "KiCad",
  altium: "Altium",
  easyeda: "EasyEDA",
  fusion360: "Fusion 360",
  ipc2581: "IPC-2581",
  generic_gerber: "Gerber package",
};

function when(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().slice(0, 10);
}

const columns: readonly DataColumn<ProjectRecord>[] = [
  {
    id: "name",
    header: "Project",
    rowHeader: true,
    cell: (project) => (
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-foreground">{project.name}</span>
        {project.description ? (
          <span className="text-meta text-muted-foreground break-words">{project.description}</span>
        ) : null}
      </span>
    ),
  },
  {
    id: "format",
    header: "CAD format",
    cell: (project) => (
      <StatusBadge value="neutral" label={cadFormatLabels[project.defaultCadFormat] ?? project.defaultCadFormat} />
    ),
  },
  {
    id: "repository",
    header: "Repository",
    cell: (project) =>
      project.githubRepoFullName ? (
        <span className="font-mono break-all">{project.githubRepoFullName}</span>
      ) : (
        <span className="text-muted-foreground">Not linked</span>
      ),
  },
  {
    id: "created",
    header: "Created",
    align: "end",
    cell: (project) => (
      <time dateTime={project.createdAt} className="text-muted-foreground tabular-nums">
        {when(project.createdAt)}
      </time>
    ),
  },
];

export default async function ProjectsPage({ searchParams }: Readonly<ProjectsPageProps>) {
  const parameters = await searchParams;
  const viewer = await viewerAuthorization();
  const result = await loadWorkspaceProjects(viewer.session, first(parameters.workspace));

  return (
    <AppShell
      viewerNav={<ViewerNav />}
      breadcrumbs={[{ href: "/dashboard", label: "Dashboard" }, { label: "Projects" }]}
    >
      <main id="main-content" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground">Hardware Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Hardware projects grouped by workspace, across Altium, KiCad, EasyEDA, Fusion 360, and Gerber packages.
            </p>
          </div>
          {result.state === "ok" ? (
            <Button asChild>
              <Link href="/projects/new">Ingest a package</Link>
            </Button>
          ) : null}
        </header>

        {result.state === "ok" ? (
          <>
            {/* Only shown when there is a choice to make. A switcher over one workspace is an
                affordance that does nothing. */}
            <WorkspaceSwitcher workspaces={result.workspaces} selectedId={result.selected.id} basePath="/projects" />

            <Panel
              title={result.selected.name}
              description={`You are ${result.selected.role} of this workspace · ${result.selected.planTier} plan`}
            >
              <DataTable
                caption={`Projects in ${result.selected.name}`}
                columns={columns}
                rows={result.projects}
                rowKey={(project) => project.id}
                empty={
                  <EmptyState title="No projects in this workspace yet">
                    <p>Add one below, then link a repository or ingest a manufacturing package.</p>
                  </EmptyState>
                }
              />
            </Panel>

            {result.selected.role === "viewer" ? null : (
              <Panel title="Add a project" description="A project groups the revisions of one board.">
                <CreateProjectForm workspaceId={result.selected.id} action={createProjectAction} />
              </Panel>
            )}
          </>
        ) : (
          <ProjectsUnavailable state={result.state} />
        )}
      </main>
    </AppShell>
  );
}

function ProjectsUnavailable({ state }: Readonly<{ state: "signed-out" | "not-configured" | "no-workspaces" }>) {
  if (state === "signed-out") {
    return (
      <Panel title="Workspaces">
        <EmptyState title="Sign in to see your projects">
          <p>Projects live in workspaces, and a workspace is scoped to the people in it.</p>
          <Button asChild className="mt-3">
            <a href="/api/auth/github/login">Sign in with GitHub</a>
          </Button>
        </EmptyState>
      </Panel>
    );
  }

  if (state === "not-configured") {
    return (
      <Panel title="Workspaces">
        <EmptyState title="Workspaces are not configured">
          <p>
            This deployment has no control-plane database, so workspaces and projects cannot be stored. Repository
            reviews still work through the GitHub App.
          </p>
          <Button asChild variant="outline" className="mt-3">
            <Link href="/setup">Go to Setup</Link>
          </Button>
        </EmptyState>
      </Panel>
    );
  }

  // Signed in, database present, no membership yet. This is the one state where creating a
  // workspace is the whole of what the page can offer, so it leads rather than sits at the bottom.
  return (
    <>
      <Panel title="Create your first workspace" description="A workspace holds projects, revisions and deliveries.">
        <CreateWorkspaceForm action={createWorkspaceAction} />
      </Panel>
      <Panel title="Or start from a repository">
        <GuidedChecklist
          heading="Already using the GitHub App?"
          steps={[
            {
              id: "setup",
              label: "Link a repository to run readiness checks on pull requests",
              status: "current",
              href: "/setup",
              actionLabel: "Go to Setup",
            },
            { id: "detect", label: "BoardReadyOps detects the CAD format and normalizes it", status: "upcoming" },
            { id: "review", label: "Work the findings each run reports", status: "upcoming" },
          ]}
        />
      </Panel>
    </>
  );
}
