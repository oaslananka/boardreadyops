"use client";

import { Button } from "../../../components/ui/button.js";
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
      <section className="overflow-x-auto" aria-labelledby="dead-letters-table-caption">
        <table className="w-full text-left text-sm">
          <caption id="dead-letters-table-caption" className="sr-only">
            Dead-lettered jobs and outbox records
          </caption>
          <thead>
            <tr className="border-b border-border text-xs uppercase text-muted-foreground">
              <th scope="col" className="py-2 pr-3">
                Item
              </th>
              <th scope="col" className="py-2 pr-3">
                Run
              </th>
              <th scope="col" className="py-2 pr-3">
                Installation / Repository
              </th>
              <th scope="col" className="py-2 pr-3">
                Failure reason
              </th>
              <th scope="col" className="py-2 pr-3">
                Attempts
              </th>
              <th scope="col" className="py-2 pr-3">
                Failed at
              </th>
              <th scope="col" className="py-2 pr-3">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const key = rowKey(item);
              const replay = replayState[key];
              return (
                <tr key={key} className="border-b border-border last:border-b-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <StatusBadge value="dead_letter" label={item.itemType} />
                    <div className="mt-1">
                      <code className="text-xs">{item.itemId}</code>
                    </div>
                  </th>
                  <td className="py-2 pr-3">{item.releaseRunId ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <div>{item.installationId}</div>
                    {item.repositoryFullName ? (
                      <div className="text-xs text-muted-foreground">{item.repositoryFullName}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">{formatFailureReason(item)}</td>
                  <td className="py-2 pr-3">{item.attemptCount}</td>
                  <td className="py-2 pr-3">{formatTimestamp(item.failedAt)}</td>
                  <td className="py-2 pr-3">
                    {item.replaySafe ? (
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
                          <div className="mt-1 text-xs text-muted-foreground">{replay.message}</div>
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
        <Button type="button" variant="secondary" className="mt-3" onClick={onLoadMore}>
          Load older dead letters
        </Button>
      ) : null}
    </>
  );
}
