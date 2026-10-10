import Link from "next/link";
import { notFound } from "next/navigation";
import { GuidedChecklist } from "../../../components/guided-checklist.js";
import { SupplyFindingAcknowledgeButton } from "../../../components/supply-finding-acknowledge-button.js";
import { SupplyFindingSuppressionControl } from "../../../components/supply-finding-suppression-control.js";
import { type DataColumn, DataTable } from "../../../components/ui/data-table.js";
import { AppShell, Definition, DefinitionGrid, EmptyState, Panel, StatusBadge } from "../../../components/ui.js";
import { ViewerNav } from "../../../components/viewer-nav.js";
import { customerStatusLabel } from "../../../lib/customer-nomenclature.js";
import { githubFindingSourceUrl } from "../../../lib/finding-guidance.js";
import { releaseRepositoryDispatchAvailability } from "../../../lib/release-rollout.js";
import { loadRepositoryDetail, type RepositoryDetail } from "../../../lib/repository-dashboard.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";
import {
  acknowledgeSupplyFindingAction,
  clearSupplyFindingSuppressionAction,
  suppressSupplyFindingAction,
} from "./actions.js";

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
type BoardRow = RepositoryDetail["boards"][number];
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

function boardEvidenceColumns(repositoryName: string): readonly DataColumn<BoardRow>[] {
  return [
    {
      id: "board",
      header: "Recorded board",
      rowHeader: true,
      cell: (board) => (
        <span className="flex flex-col gap-1">
          <span className="font-medium">{board.displayName}</span>
          <code className="break-all text-xs text-muted-foreground">{board.projectPath}</code>
          {board.archived ? <StatusBadge value="neutral" label="Archived board record" /> : null}
        </span>
      ),
    },
    {
      id: "bom",
      header: "Latest BOM snapshot",
      cell: (board) =>
        board.latestBom ? (
          <span>
            {board.latestBom.componentCount} recorded components · {when(board.latestBom.capturedAt)}
          </span>
        ) : (
          <span className="text-muted-foreground">No BOM snapshot recorded</span>
        ),
    },
    {
      id: "evidence",
      header: "Recorded source evidence",
      cell: (board) => {
        const snapshot = board.latestBom;
        if (!snapshot) return <span className="text-muted-foreground">Not recorded</span>;
        const sourceUrl = githubFindingSourceUrl(repositoryName, snapshot.commitSha, board.projectPath);
        return (
          <span className="flex flex-col gap-1 text-sm">
            <code className="break-all text-xs">{snapshot.commitSha}</code>
            <Link
              href={`/runs/${encodeURIComponent(snapshot.runId)}`}
              className="text-primary underline underline-offset-2"
            >
              Open snapshot Run
            </Link>
            {sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                Open project at this commit ↗
              </a>
            ) : null}
          </span>
        );
      },
    },
  ];
}

function supplyColumns(repositoryId: string): readonly DataColumn<SupplyRow>[] {
  return [
    {
      id: "part",
      header: "Part",
      rowHeader: true,
      cell: (finding) => (
        <>
          <span className="font-mono">{finding.mpn}</span>
          {finding.manufacturer ? (
            <span className="ml-2 text-muted-foreground">{finding.manufacturer}</span>
          ) : undefined}
        </>
      ),
    },
    { id: "board", header: "Board", cell: (finding) => finding.boardPath },
    { id: "status", header: "Status", cell: (finding) => <StatusBadge value={finding.status} /> },
    { id: "reference", header: "Reference", cell: (finding) => finding.reference ?? "—" },
    {
      id: "source",
      header: "Source",
      cell: (finding) => (finding.source ? customerStatusLabel(finding.source) : "—"),
    },
    {
      id: "detected",
      header: "Detected",
      cell: (finding) => <span className="text-muted-foreground">{when(finding.detectedAt)}</span>,
    },
    {
      id: "acknowledgement",
      header: "Acknowledgement",
      cell: (finding) =>
        finding.acknowledgedAt ? (
          <span className="text-muted-foreground">
            {finding.acknowledgedBy ? `Acknowledged by ${finding.acknowledgedBy}` : "Acknowledged"} ·{" "}
            {when(finding.acknowledgedAt)}
          </span>
        ) : (
          <SupplyFindingAcknowledgeButton
            repositoryId={repositoryId}
            findingId={finding.id}
            action={acknowledgeSupplyFindingAction}
          />
        ),
    },
    {
      id: "alert-policy",
      header: "Alert policy",
      cell: (finding) => (
        <SupplyFindingSuppressionControl
          repositoryId={repositoryId}
          findingId={finding.id}
          suppressedUntil={finding.suppressedUntil}
          suppressedBy={finding.suppressedBy}
          suppressionReason={finding.suppressionReason}
          suppressAction={suppressSupplyFindingAction}
          clearAction={clearSupplyFindingSuppressionAction}
        />
      ),
    },
  ];
}

export default async function RepositoryPage({ params }: Readonly<PageProps>) {
  const { repositoryId } = await params;
  const viewer = await viewerAuthorization();
  const detail = await loadRepositoryDetail(repositoryId, viewer.session);

  // A repository the viewer cannot administer answers the same as one that does not exist, so
  // this page cannot be used to discover which repositories are enrolled.
  //
  // Returned rather than called bare: notFound() never returns, but saying so explicitly keeps
  // the narrowing obvious to a reader, and to any analyser that does not model Next's helpers.
  if (!detail) return notFound();

  const { repository, runs, boards, supplyFindings } = detail;
  const dispatch = releaseRepositoryDispatchAvailability(`${repository.owner}/${repository.name}`);

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
            <Definition label="Supply-tracked boards">{repository.watchedBoards}</Definition>
          </DefinitionGrid>
          <p className="mt-3 text-sm text-muted-foreground">
            Supply-tracked boards are registered for component monitoring. This number does not count successful
            readiness runs; view the recent runs below to inspect release checks.
          </p>
          {/*
            "How do I stop watching this repository?" had no answer anywhere in the product. It
            is GitHub's to answer — the App's repository access is what connects it, and
            `repositories.disabled_at` is set from the `installation_repositories` webhook rather
            than by anything here — but saying nothing left people hunting for a button that
            should not exist.
          */}
          <p className="mt-4 border-t border-border pt-3 text-meta text-muted-foreground">
            To stop watching this repository, remove it from the BoardReadyOps App's repository access on GitHub;{" "}
            <a
              href={`https://github.com/settings/installations/${repository.githubInstallationId}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2"
            >
              manage the installation
            </a>
            . Runs and evidence already recorded stay here.
          </p>
        </Panel>

        <Panel
          title="Recorded boards and BOM history"
          description="Up to 50 observed board records, distinguished by their project paths. This is source-run BOM history, not a board-level Review approval or signed manufacturing export."
        >
          {boards.length === 0 ? (
            <EmptyState title="No board records captured">
              <p>
                Readiness runs can exist without imported per-board BOM snapshots. This does not prove that the
                repository has no hardware boards; inspect run findings for the actual project sources.
              </p>
            </EmptyState>
          ) : (
            <DataTable
              caption="Latest recorded BOM snapshot for each observed board"
              columns={boardEvidenceColumns(`${repository.owner}/${repository.name}`)}
              rows={boards}
              rowKey={(board) => board.id}
              empty={null}
            />
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            These records are not automatically linked to Review decisions. A newer revision or signed source-bound
            package requires its own evidence; an older BOM snapshot is not current manufacturing authorization.
          </p>
        </Panel>

        <Panel title="Recent runs">
          {runs.length === 0 ? (
            dispatch.enabled ? (
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
              <EmptyState title="Readiness runs are not enabled yet">
                <p>{dispatch.reason}</p>
              </EmptyState>
            )
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
              columns={supplyColumns(repository.id)}
              rows={supplyFindings}
              rowKey={(finding) => finding.id}
              empty={null}
            />
          )}
        </Panel>
      </main>
    </AppShell>
  );
}
