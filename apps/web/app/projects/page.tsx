import type { ProjectRecord } from "@boardreadyops/db";
import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../../components/app-shell.js";
import { ProjectRowActions, WorkspaceDangerZone } from "../../components/projects/teardown-forms.js";
import { CreateProjectForm, CreateWorkspaceForm } from "../../components/projects/workspace-forms.js";
import { ReviewEmptyVisualPreview } from "../../components/review/review-empty-visual-preview.js";
import { Button } from "../../components/ui/button.js";
import { type DataColumn, DataTable } from "../../components/ui/data-table.js";
import { EmptyState, Pagination, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { WorkspaceSwitcher } from "../../components/workspace-switcher.js";
import { customerPlanLabel, customerStatusLabel } from "../../lib/customer-nomenclature.js";
import { loadWorkspaceProjects, type WorkspaceProjectsImpact } from "../../lib/project-listing.js";
import { canonicalRepositoryName } from "../../lib/review-list-filters.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";
import {
  createProjectAction,
  createWorkspaceAction,
  deleteProjectAction,
  deleteWorkspaceAction,
  renameProjectAction,
  renameWorkspaceAction,
} from "./actions.js";

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

function projectColumns(role: string, impact: WorkspaceProjectsImpact): readonly DataColumn<ProjectRecord>[] {
  return [
    {
      id: "name",
      header: "Project",
      rowHeader: true,
      cell: (project) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{project.name}</span>
          {project.description ? (
            <span className="text-meta text-muted-foreground break-words">{project.description}</span>
          ) : null}
          {role !== "viewer" ? (
            <div className="mt-1 md:hidden">
              <ProjectRowActions
                projectId={project.id}
                projectName={project.name}
                revisions={impact.byProject[project.id]?.revisions ?? 0}
                deliveries={impact.byProject[project.id]?.deliveries ?? 0}
                canRename={true}
                canDelete={role === "owner"}
                renameAction={renameProjectAction}
                deleteAction={deleteProjectAction}
                compact
              />
            </div>
          ) : null}
        </div>
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
      cell: (project) => {
        const repository = project.githubRepoFullName;
        const canonical = repository ? canonicalRepositoryName(repository) : undefined;
        if (!repository) return <span className="text-muted-foreground">Not linked</span>;
        return (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-xs break-all">{repository}</span>
            {canonical ? (
              <Link
                href={`/reviews?repository=${encodeURIComponent(canonical)}`}
                className="w-fit text-sm font-medium text-primary underline underline-offset-2"
              >
                View repository reviews
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">Use GitHub owner/name to link repository reviews.</span>
            )}
          </div>
        );
      },
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
    {
      id: "actions",
      header: "Actions",
      align: "end",
      className: "hidden md:table-cell",
      headerClassName: "hidden md:table-cell",
      cell: (project) => (
        <ProjectRowActions
          projectId={project.id}
          projectName={project.name}
          revisions={impact.byProject[project.id]?.revisions ?? 0}
          deliveries={impact.byProject[project.id]?.deliveries ?? 0}
          canRename={role !== "viewer"}
          canDelete={role === "owner"}
          renameAction={renameProjectAction}
          deleteAction={deleteProjectAction}
        />
      ),
    },
  ];
}

export default async function ProjectsPage({ searchParams }: Readonly<ProjectsPageProps>) {
  const parameters = await searchParams;
  const viewer = await viewerAuthorization();
  const result = await loadWorkspaceProjects(viewer.session, first(parameters.workspace), process.env, parameters.page);

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
              <Link href="/projects/new">Add a project source</Link>
            </Button>
          ) : null}
        </header>

        {result.state === "ok" ? (
          <>
            {/* Only shown when there is a choice to make. A switcher over one workspace is an
                affordance that does nothing. */}
            <WorkspaceSwitcher workspaces={result.workspaces} selectedId={result.selected.id} basePath="/projects" />
            <section
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-4 py-3"
              aria-label="Current CAD workspace"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Selected workspace: <strong>{result.selected.name}</strong>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  CAD projects live here. GitHub App installations expose repository runs and published reviews
                  separately; a repository is not linked to this workspace automatically.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild size="sm">
                  <Link href="/reviews">Open hardware reviews</Link>
                </Button>
                <Link className="text-sm font-medium text-primary underline underline-offset-2" href="/dashboard">
                  View GitHub repositories
                </Link>
              </div>
            </section>

            {result.total === 0 ? (
              <OptionalProjectPreview actionHref="/projects/new" actionLabel="Add your first project source" />
            ) : null}
            <Panel
              title={result.selected.name}
              description={`You are ${customerStatusLabel(result.selected.role)} of this workspace · ${customerPlanLabel(result.selected.planTier)} plan`}
            >
              <DataTable
                caption={`Projects in ${result.selected.name}`}
                columns={projectColumns(result.selected.role, result.impact)}
                rows={result.projects}
                rowKey={(project) => project.id}
                empty={
                  <EmptyState title="No projects in this workspace yet">
                    <p>
                      Create a project, then connect its GitHub repository. Direct hosted ZIP upload is not yet
                      available.
                    </p>
                  </EmptyState>
                }
              />
              <div className="mt-4">
                <Pagination
                  basePath="/projects"
                  page={result.page}
                  totalPages={result.totalPages}
                  pageParameter="page"
                  searchParameters={{ workspace: result.selected.id }}
                />
              </div>
            </Panel>

            {result.selected.role === "viewer" ? null : (
              <Panel title="Add a project" description="A project groups the revisions of one board.">
                <CreateProjectForm workspaceId={result.selected.id} action={createProjectAction} />
              </Panel>
            )}

            {result.selected.role === "owner" || result.selected.role === "admin" ? (
              <Panel
                title="Workspace settings"
                description="Renaming is safe. Deleting is not — it takes every project, revision and delivery link with it."
                tone="section"
              >
                <WorkspaceDangerZone
                  workspaceId={result.selected.id}
                  workspaceName={result.selected.name}
                  projects={result.impact.workspace.projects}
                  revisions={result.impact.workspace.revisions}
                  deliveries={result.impact.workspace.deliveries}
                  canRename={true}
                  canDelete={result.selected.role === "owner"}
                  renameAction={renameWorkspaceAction}
                  deleteAction={deleteWorkspaceAction}
                />
              </Panel>
            ) : null}
          </>
        ) : (
          <ProjectsUnavailable state={result.state} />
        )}
      </main>
    </AppShell>
  );
}

function OptionalProjectPreview({ actionHref, actionLabel }: Readonly<{ actionHref: string; actionLabel: string }>) {
  return (
    <details className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Example hardware review">
      <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-foreground hover:bg-muted/35">
        <span>
          Explore a sample PCB and schematic <span className="font-normal text-muted-foreground">· Example only</span>
        </span>
        <span aria-hidden="true" className="text-primary">
          ⌄
        </span>
      </summary>
      <div className="border-t border-border p-3">
        <ReviewEmptyVisualPreview mode="onboarding" actionHref={actionHref} actionLabel={actionLabel} />
      </div>
    </details>
  );
}

function ProjectsUnavailable({ state }: Readonly<{ state: "signed-out" | "not-configured" | "no-workspaces" }>) {
  if (state === "signed-out") {
    return (
      <>
        <ReviewEmptyVisualPreview
          mode="onboarding"
          actionHref="/api/auth/github/login"
          actionLabel="Sign in to start"
        />
        <Panel title="Workspaces">
          <EmptyState title="Sign in to see your projects">
            <p>Projects live in workspaces, and a workspace is scoped to the people in it.</p>
            <Button asChild className="mt-3">
              <a href="/api/auth/github/login">Sign in with GitHub</a>
            </Button>
          </EmptyState>
        </Panel>
      </>
    );
  }

  if (state === "not-configured") {
    return (
      <>
        <ReviewEmptyVisualPreview mode="onboarding" actionLabel="Connect a GitHub repository" />
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
      </>
    );
  }

  // A GitHub App repository is not a CAD workspace membership. The existing
  // GitHub review path is first; optional CAD workspace setup stays second.
  return (
    <>
      <section
        className="rounded-xl border border-border bg-card p-5 shadow-e1 sm:p-6"
        aria-labelledby="github-first-projects-heading"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Start with real hardware work</p>
        <h2
          id="github-first-projects-heading"
          className="mt-2 font-display text-2xl font-semibold tracking-tight text-foreground"
        >
          Continue with GitHub repositories
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          No CAD workspace is required to inspect your existing repository readiness runs or Reviews. GitHub App
          repositories are shown on Dashboard. CAD workspaces have separate memberships and do not automatically import
          those repositories. Your existing runs and findings remain available.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/reviews">Open hardware reviews</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">View repositories</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/runs">Browse readiness runs</Link>
          </Button>
        </div>
      </section>
      <details className="rounded-xl border border-border bg-card" aria-label="Optional CAD workspace setup">
        <summary className="min-h-14 cursor-pointer px-5 py-4 text-sm font-semibold text-foreground hover:bg-muted/35">
          <span className="block">Optional: Create your first workspace</span>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Group CAD projects, revisions and evidence with a team only when you need a shared workspace.
          </span>
        </summary>
        <div className="border-t border-border px-5 py-5">
          <p className="mb-4 text-sm text-muted-foreground">
            Optional: group CAD projects, revisions and manufacturing deliveries in a shared workspace.
          </p>
          <CreateWorkspaceForm action={createWorkspaceAction} />
        </div>
      </details>
      <OptionalProjectPreview actionHref="/dashboard" actionLabel="Explore your GitHub repositories" />
    </>
  );
}
