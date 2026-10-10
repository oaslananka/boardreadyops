import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { type DataColumn, DataTable } from "../../../../../components/ui/data-table.js";
import { AppShell, EmptyState, Panel, StatusBadge } from "../../../../../components/ui.js";
import { ViewerNav } from "../../../../../components/viewer-nav.js";
import { githubFindingSourceUrl } from "../../../../../lib/finding-guidance.js";
import { type BoardBomCapture, loadRepositoryBoardHistory } from "../../../../../lib/repository-dashboard.js";
import { viewerAuthorization } from "../../../../../lib/viewer-authorization.js";

type Params = { repositoryId: string; boardId: string };
type PageProps = { params: Promise<Params> };

export const metadata = {
  title: "Board evidence history",
  description: "Read-only source-bound BOM snapshots captured on a single observed board.",
};

function capturedAt(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().replace("T", " ").slice(0, 16) : "Unknown";
}

/** A committed snapshot can be displayed without promising that source and Run IDs match. */
export function boardCaptureColumns(
  repositoryName: string,
  projectPath: string,
): readonly DataColumn<BoardBomCapture>[] {
  return [
    {
      id: "captured",
      header: "Captured",
      rowHeader: true,
      cell: (capture) => <span className="whitespace-nowrap">{capturedAt(capture.capturedAt)}</span>,
    },
    {
      id: "count",
      header: "BOM parts",
      cell: (capture) => <span className="tabular-nums">{capture.componentCount} recorded components</span>,
    },
    {
      id: "run",
      header: "Recorded Run",
      cell: (capture) => (
        <span className="flex flex-col gap-1">
          <Link
            href={`/runs/${encodeURIComponent(capture.runId)}`}
            className="text-primary underline underline-offset-2"
          >
            Inspect Run
          </Link>
          <StatusBadge value={capture.runDecision ?? capture.runStatus} />
        </span>
      ),
    },
    {
      id: "source",
      header: "Captured source revision",
      cell: (capture) => {
        const sourceBoundToRun = capture.snapshotCommitSha === capture.runCommitSha;
        const sourceUrl = sourceBoundToRun
          ? githubFindingSourceUrl(repositoryName, capture.snapshotCommitSha, projectPath)
          : undefined;
        let sourceAction: ReactNode;
        if (!sourceBoundToRun) {
          sourceAction = (
            <span className="text-xs text-muted-foreground">
              Captured source differs from recorded Run commit; inspect the original Run before relying on this
              evidence.
            </span>
          );
        } else if (sourceUrl) {
          sourceAction = (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline underline-offset-2"
            >
              Open project at this commit ↗
            </a>
          );
        } else {
          sourceAction = <span className="text-xs text-muted-foreground">Source path cannot be linked safely</span>;
        }
        return (
          <span className="flex flex-col gap-1">
            <code className="break-all text-xs">{capture.snapshotCommitSha}</code>
            {sourceAction}
          </span>
        );
      },
    },
  ];
}

export default async function BoardHistoryPage({ params }: Readonly<PageProps>) {
  const { repositoryId, boardId } = await params;
  const viewer = await viewerAuthorization();
  const history = await loadRepositoryBoardHistory(repositoryId, boardId, viewer.session);
  // A missing board and a board belonging to another installation are indistinguishable.
  if (!history) return notFound();

  const { repository, board, captures, hasOlderCaptures } = history;
  const repositoryPath = `/repositories/${encodeURIComponent(repository.id)}`;

  return (
    <AppShell
      viewerNav={<ViewerNav />}
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/dashboard", label: "Dashboard" },
        { href: repositoryPath, label: `${repository.owner}/${repository.name}` },
        { label: board.displayName },
      ]}
    >
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <header>
          <h1 className="text-2xl font-bold text-foreground">{board.displayName}</h1>
          <p className="mt-2 break-all text-sm text-muted-foreground">
            KiCad project: <code>{board.projectPath}</code>
          </p>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            Persistent board record: <code>{board.id}</code>
            {board.archived ? " · Archived" : ""}
          </p>
          <Link className="mt-2 inline-block text-sm text-primary underline underline-offset-2" href={repositoryPath}>
            Back to repository boards
          </Link>
        </header>

        <Panel
          title="Captured BOM revision timeline"
          description="Up to 20 most recent BOM captures, ordered by capture time. Each capture belongs to this board record and a persisted repository Run."
        >
          {captures.length ? (
            <DataTable
              caption="Recorded BOM captures for this board"
              columns={boardCaptureColumns(`${repository.owner}/${repository.name}`, board.projectPath)}
              rows={captures}
              rowKey={(capture) => capture.id}
              empty={null}
            />
          ) : (
            <EmptyState title="No BOM snapshots captured for this board">
              <p>
                Board discovery does not imply a successful component capture. Inspect readiness runs for this project.
              </p>
            </EmptyState>
          )}
          {hasOlderCaptures ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Older snapshots exist beyond these 20 captures; this view does not show the full historical inventory.
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            This is recorded BOM history, not a verified component diff, per-board Review approval, current
            manufacturing readiness, or a signed source-bound fabrication export. Runs can cover more than one board.
            Captured order is not necessarily the order of source commits.
          </p>
        </Panel>
      </main>
    </AppShell>
  );
}
