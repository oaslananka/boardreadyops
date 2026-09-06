import Link from "next/link";
import { notFound } from "next/navigation";
import { GuidedChecklist } from "../../../components/guided-checklist.js";
import { type DataColumn, DataTable } from "../../../components/ui/data-table.js";
import { AppShell, Definition, DefinitionGrid, EmptyState, Panel, StatusBadge } from "../../../components/ui.js";
import { ViewerNav } from "../../../components/viewer-nav.js";
import { loadRepositoryDetail, type RepositoryDetail } from "../../../lib/repository-dashboard.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

type PageProps = {
  params: Promise<{ repositoryId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { repositoryId } = await params;
  const viewer = await viewerAuthorization();
  const detail = await loadRepositoryDetail(repositoryId, viewer.session);
  return {
    title: detail ? `${detail.repository.owner}/${detail.repository.name}` : "Repository",
    description: "Recent release readiness runs and open supply findings for one repository.",
  };
}

function when(value: string | undefined): string {
  if (!value) return "unknown";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}

type RunRow = RepositoryDetail["runs"][number];
type SupplyRow = RepositoryDetail["supplyFindings"][number];

const runColumns: readonly DataColumn<RunRow>[] = [
  {
    id: "run",
    header: "Run",
    rowHeader: true,
    cell: (run) => (
      <Link href={`/runs/${run.id}`} className="font-mono text-primary hover:underline">
        {run.commitSha.slice(0, 8) || run.id.slice(0, 8)}
      </Link>
    ),
  },
  { id: "outcome", header: "Outcome", cell: (run) => <StatusBadge value={run.decision ?? run.status} /> },
  {
    id: "ref",
    header: "Ref",
    cell: (run) =>
      run.pullRequestNumber !== undefined ? `#${run.pullRequestNumber}` : run.ref.replace(/^refs\/heads\//u, ""),
  },
  {
    id: "findings",
    header: "Findings",
    align: "end",
    cell: (run) => <span className="tabular-nums">{run.findingCount}</span>,
  },
  {
    id: "started",
    header: "Started",
    cell: (run) => <span className="text-muted-foreground">{when(run.startedAt)}</span>,
  },
];

const supplyColumns: readonly DataColumn<SupplyRow>[] = [
  {
    id: "part",
    header: "Part",
    rowHeader: true,
    cell: (finding) => (
      <>
        <span className="font-mono">{finding.mpn}</span>
        {finding.manufacturer ? <span className="ml-2 text-muted-foreground">{finding.manufacturer}</span> : undefined}
      </>
    ),
  },
  { id: "board", header: "Board", cell: (finding) => finding.boardPath },
  { id: "status", header: "Status", cell: (finding) => <StatusBadge value={finding.status} /> },
  { id: "reference", header: "Reference", cell: (finding) => finding.reference ?? "—" },
  {
    id: "detected",
    header: "Detected",
    cell: (finding) => <span className="text-muted-foreground">{when(finding.detectedAt)}</span>,
  },
];

export default async function RepositoryPage({ params }: PageProps) {
  const { repositoryId } = await params;
  const viewer = await viewerAuthorization();
  const detail = await loadRepositoryDetail(repositoryId, viewer.session);

  // A repository the viewer cannot administer answers the same as one that does not exist, so
  // this page cannot be used to discover which repositories are enrolled.
  //
  // Returned rather than called bare: notFound() never returns, but saying so explicitly keeps
  // the narrowing obvious to a reader, and to any analyser that does not model Next's helpers.
  if (!detail) return notFound();

  const { repository, runs, supplyFindings } = detail;

  return (
    <AppShell
      viewerNav={<ViewerNav />}
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/dashboard", label: "Dashboard" },
        { label: `${repository.owner}/${repository.name}` },
      ]}
    >
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <header>
          <h1 className="text-2xl font-bold text-foreground">
            {repository.owner}/{repository.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Release readiness history and open supply findings for this repository.
          </p>
        </header>

        <Panel title="Current state">
          <DefinitionGrid>
            <Definition label="Visibility">{repository.private ? "Private" : "Public"}</Definition>
            <Definition label="Latest run">
              {repository.latestRunId ? (
                <StatusBadge value={repository.latestRunDecision ?? repository.latestRunStatus} />
              ) : (
                "No runs yet"
              )}
            </Definition>
            <Definition label="Open findings">{repository.latestRunId ? repository.openFindings : "—"}</Definition>
            <Definition label="Boards watched">{repository.watchedBoards}</Definition>
          </DefinitionGrid>
        </Panel>

        <Panel title="Recent runs">
          {runs.length === 0 ? (
            <GuidedChecklist
              heading="Trigger your first run on this repository"
              steps={[
                {
                  id: "connected",
                  label: `Repository ${repository.owner}/${repository.name} connected`,
                  status: "done",
                },
                {
                  id: "pr",
                  label: "Open a pull request touching the hardware project to produce the first run",
                  status: "current",
                },
              ]}
            />
          ) : (
            <DataTable
              caption="Recent runs for this repository"
              columns={runColumns}
              rows={runs}
              rowKey={(run) => run.id}
              empty={null}
            />
          )}
        </Panel>

        <Panel title="Open supply findings">
          {supplyFindings.length === 0 ? (
            <EmptyState title="No open supply findings">
              <p>
                Parts on watched boards are either current or not yet checked. Supply watch needs a component data
                provider credential and a plan that includes it.
              </p>
            </EmptyState>
          ) : (
            <DataTable
              caption="Open supply findings on watched boards"
              columns={supplyColumns}
              rows={supplyFindings}
              rowKey={(finding) => `${finding.boardPath}:${finding.mpn}:${finding.reference ?? ""}`}
              empty={null}
            />
          )}
        </Panel>
      </main>
    </AppShell>
  );
}
