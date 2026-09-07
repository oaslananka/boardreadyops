import Link from "next/link";
import { CopyButton } from "../../components/copy-button.js";
import { GuidedChecklist } from "../../components/guided-checklist.js";
import { Button } from "../../components/ui/button.js";
import { CursorPagination, type DataColumn, DataTable } from "../../components/ui/data-table.js";
import { AppShell, EmptyState, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import {
  decodeRunListingCursor,
  loadViewerRuns,
  normalizedRunListingLimit,
  type RunListingEntry,
} from "../../lib/run-listing.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";

export const metadata = {
  title: "Runs",
  description: "Every readiness run across the repositories your installations can see, newest first.",
};

// The listing is per-viewer and cursor-paginated, so it can never be prerendered.
export const dynamic = "force-dynamic";

export type RunsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function when(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}

const columns: readonly DataColumn<RunListingEntry>[] = [
  {
    id: "status",
    header: "Outcome",
    cell: (run) => <StatusBadge value={run.decision ?? run.status} />,
  },
  {
    id: "repository",
    header: "Repository",
    rowHeader: true,
    cell: (run) => (
      <Link href={`/repositories/${run.repositoryId}`} className="text-primary hover:underline">
        {run.repository}
      </Link>
    ),
  },
  {
    id: "ref",
    header: "Ref",
    cell: (run) =>
      run.pullRequestNumber === undefined ? (
        <span className="font-mono text-meta">{run.ref.replace(/^refs\/heads\//u, "") || "—"}</span>
      ) : (
        <span>PR #{run.pullRequestNumber}</span>
      ),
  },
  {
    id: "commit",
    header: "Commit",
    cell: (run) =>
      run.commitSha ? (
        <span className="flex items-center gap-1.5">
          <Link href={`/runs/${run.id}`} className="font-mono text-primary hover:underline">
            {run.commitSha.slice(0, 7)}
          </Link>
          <CopyButton value={run.commitSha} label="Copy commit SHA" />
        </span>
      ) : (
        <Link href={`/runs/${run.id}`} className="font-mono text-primary hover:underline">
          {run.id.slice(0, 7)}
        </Link>
      ),
  },
  {
    id: "started",
    header: "Started",
    align: "end",
    // <time> is masked in the visual baselines, so a new run does not churn a screenshot.
    cell: (run) => (
      <time dateTime={run.startedAt} className="text-muted-foreground tabular-nums">
        {when(run.startedAt)}
      </time>
    ),
  },
];

export default async function RunsPage({ searchParams }: Readonly<RunsPageProps>) {
  const parameters = await searchParams;
  const viewer = await viewerAuthorization();
  const cursor = decodeRunListingCursor(first(parameters.cursor) ?? null);
  const limit = normalizedRunListingLimit(Number(first(parameters.limit)) || undefined);
  const listing = await loadViewerRuns(viewer.session, { ...(cursor ? { cursor } : {}), limit });

  const runs = listing.state === "ok" ? listing.runs : [];
  const next = listing.state === "ok" ? listing.next : undefined;

  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/dashboard", label: "Dashboard" }, { label: "Runs" }]}>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Runs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every readiness run across the repositories your installations can see, newest first.
          </p>
        </header>

        <Panel title="Recent runs" description={`Showing up to ${limit} runs per page.`}>
          <DataTable
            caption="Readiness runs across every visible repository"
            columns={columns}
            rows={runs}
            rowKey={(run) => run.id}
            empty={
              viewer.session ? (
                <GuidedChecklist
                  heading="No runs recorded yet"
                  steps={[
                    {
                      id: "setup",
                      label: "Link a repository with a hardware project",
                      status: "current",
                      href: "/setup",
                      actionLabel: "Go to Setup",
                    },
                    {
                      id: "open-pr",
                      label: "Open a pull request so the readiness workflow runs",
                      status: "upcoming",
                    },
                    { id: "review", label: "Work the findings the run reports", status: "upcoming" },
                  ]}
                />
              ) : (
                <EmptyState title="Sign in to see your runs">
                  <p>Runs are scoped to the repositories your GitHub App installations can access.</p>
                  <Button asChild className="mt-3">
                    <a href="/api/auth/github/login">Sign in with GitHub</a>
                  </Button>
                </EmptyState>
              )
            }
          />
        </Panel>

        <CursorPagination
          basePath="/runs"
          searchParameters={{ limit: first(parameters.limit) }}
          {...(next ? { nextCursor: next } : {})}
          {...(cursor ? { previousCursor: undefined } : {})}
          label="Run pagination"
        />
      </main>
    </AppShell>
  );
}
