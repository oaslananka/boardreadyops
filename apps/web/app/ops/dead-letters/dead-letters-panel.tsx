"use client";

import { Button } from "../../../components/ui/button.js";
import { DataTable } from "../../../components/ui/data-table.js";
import { Alert, EmptyState, StatusBadge } from "../../../components/ui.js";
import { type DeadLetterListItem, formatFailureReason, formatTimestamp } from "./dead-letter-view-model.js";

export type DeadLettersLoadState = "error" | "idle" | "loading" | "loaded";

export type ReplayRowState =
  | { status: "pending" }
  | { status: "done"; message: string }
  | { status: "failed"; message: string };

export type DeadLettersPanelProps = {
  state: DeadLettersLoadState;
  error?: string;
  items: readonly DeadLetterListItem[];
  hasMore: boolean;
  onLoadMore: () => void;
  onReplay: (item: DeadLetterListItem) => void;
  replayState: Readonly<Record<string, ReplayRowState | undefined>>;
};

function rowKey(item: DeadLetterListItem): string {
  return `${item.itemType}:${item.itemId}`;
}

export function DeadLettersPanel({
  state,
  error,
  items,
  hasMore,
  onLoadMore,
  onReplay,
  replayState,
}: Readonly<DeadLettersPanelProps>) {
  if (state === "idle") {
    return (
      <EmptyState title="Enter an installation and operator token">
        <p>Provide an installation ID and the operator bearer token above, then load dead letters.</p>
      </EmptyState>
    );
  }

  if (state === "loading") {
    return (
      <div className="rounded-md border border-border bg-muted p-4 text-sm text-muted-foreground" aria-live="polite">
        Loading dead letters…
      </div>
    );
  }

  if (state === "error") {
    return (
      <Alert title="Could not load dead letters" tone="danger">
        <p>{error ?? "Unknown error."}</p>
      </Alert>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState title="No dead letters">
        <p>Nothing is stuck. Every job and outbox record for this installation is processing normally.</p>
      </EmptyState>
    );
  }

  return (
    <>
      <DataTable
        caption="Dead-lettered jobs and outbox records"
        columns={[
          {
            id: "item",
            header: "Item",
            rowHeader: true,
            cell: (item) => (
              <>
                <StatusBadge value="dead_letter" label={item.itemType} />
                <div className="mt-1">
                  <code className="font-mono text-meta">{item.itemId}</code>
                </div>
              </>
            ),
          },
          { id: "run", header: "Run", cell: (item) => item.releaseRunId ?? "—" },
          {
            id: "scope",
            header: "Installation / Repository",
            cell: (item) => (
              <>
                <div>{item.installationId}</div>
                {item.repositoryFullName ? (
                  <div className="text-meta text-muted-foreground">{item.repositoryFullName}</div>
                ) : null}
              </>
            ),
          },
          { id: "reason", header: "Failure reason", cell: (item) => formatFailureReason(item) },
          {
            id: "attempts",
            header: "Attempts",
            align: "end",
            cell: (item) => <span className="tabular-nums">{item.attemptCount}</span>,
          },
          { id: "failed-at", header: "Failed at", cell: (item) => formatTimestamp(item.failedAt) },
          {
            id: "action",
            header: "Action",
            cell: (item) => {
              const replay = replayState[rowKey(item)];
              if (!item.replaySafe) return <StatusBadge value="blocked" label="Not replayable" />;
              return (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={replay?.status === "pending"}
                    onClick={() => onReplay(item)}
                  >
                    {replay?.status === "pending" ? "Replaying…" : "Replay"}
                  </Button>
                  {replay && replay.status !== "pending" ? (
                    <div className="mt-1 text-meta text-muted-foreground">{replay.message}</div>
                  ) : null}
                </>
              );
            },
          },
        ]}
        rows={items}
        rowKey={rowKey}
        empty={null}
      />
      {hasMore ? (
        <Button type="button" variant="secondary" className="mt-3" onClick={onLoadMore}>
          Load older dead letters
        </Button>
      ) : null}
    </>
  );
}
