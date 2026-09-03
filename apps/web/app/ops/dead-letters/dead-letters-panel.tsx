"use client";

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
      <div className="panel surface-inset" aria-live="polite">
        <p>Loading dead letters…</p>
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
      <section className="table-scroll" aria-labelledby="dead-letters-table-caption">
        <table>
          <caption id="dead-letters-table-caption">Dead-lettered jobs and outbox records</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Run</th>
              <th scope="col">Installation / Repository</th>
              <th scope="col">Failure reason</th>
              <th scope="col">Attempts</th>
              <th scope="col">Failed at</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const key = rowKey(item);
              const replay = replayState[key];
              return (
                <tr key={key}>
                  <th scope="row">
                    <StatusBadge value="dead_letter" label={item.itemType} />
                    <div>
                      <code>{item.itemId}</code>
                    </div>
                  </th>
                  <td>{item.releaseRunId ?? "—"}</td>
                  <td>
                    <div>{item.installationId}</div>
                    {item.repositoryFullName ? <div className="cell-note">{item.repositoryFullName}</div> : null}
                  </td>
                  <td>{formatFailureReason(item)}</td>
                  <td>{item.attemptCount}</td>
                  <td>{formatTimestamp(item.failedAt)}</td>
                  <td>
                    {item.replaySafe ? (
                      <>
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          disabled={replay?.status === "pending"}
                          onClick={() => onReplay(item)}
                        >
                          {replay?.status === "pending" ? "Replaying…" : "Replay"}
                        </button>
                        {replay && replay.status !== "pending" ? (
                          <div className="cell-note">{replay.message}</div>
                        ) : null}
                      </>
                    ) : (
                      <StatusBadge value="blocked" label="Not replayable" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {hasMore ? (
        <button type="button" className="button button-secondary" onClick={onLoadMore}>
          Load older dead letters
        </button>
      ) : null}
    </>
  );
}
