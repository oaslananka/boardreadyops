/**
 * Pure formatting/URL-building helpers for the dead-letter admin dashboard.
 *
 * Kept free of React and fetch so the branching logic (reason formatting,
 * timestamp display, replay outcome copy, query building) is unit-testable
 * without mounting a component.
 */

export type DeadLetterListItem = {
  itemType: "job" | "outbox";
  itemId: string;
  installationId: string;
  repositoryId?: string;
  repositoryFullName?: string;
  releaseRunId?: string;
  executionAttemptId?: string;
  reasonCode: string;
  errorClass?: string;
  attemptCount: number;
  failedAt: string;
  replaySafe: boolean;
};

export type DeadLetterReplayOutcome = "already_applied" | "not_found" | "not_replayable" | "replayed";

/** `reasonCode (errorClass)` when an error class was captured, else just the reason code. */
export function formatFailureReason(item: Pick<DeadLetterListItem, "errorClass" | "reasonCode">): string {
  return item.errorClass ? `${item.reasonCode} (${item.errorClass})` : item.reasonCode;
}

/** Matches the `YYYY-MM-DD HH:MM` convention already used on the dashboard's run timestamps. */
export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "unknown";
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}

export function replayOutcomeMessage(outcome: DeadLetterReplayOutcome): string {
  switch (outcome) {
    case "replayed":
      return "Replay accepted — item requeued.";
    case "already_applied":
      return "Already replayed previously (idempotent no-op).";
    case "not_found":
      return "Item no longer exists — it may have already resolved.";
    case "not_replayable":
      return "Not safely replayable — needs manual reconciliation.";
    default:
      return "Unknown replay outcome.";
  }
}

export function buildDeadLetterListUrl(options: { installationId: string; limit?: number; before?: string }): string {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.before) params.set("before", options.before);
  const query = params.toString();
  const base = `/api/v1/operator/installations/${encodeURIComponent(options.installationId)}/dead-letters`;
  return query ? `${base}?${query}` : base;
}

export function buildDeadLetterReplayUrl(options: {
  installationId: string;
  itemType: string;
  itemId: string;
}): string {
  return `/api/v1/operator/installations/${encodeURIComponent(options.installationId)}/dead-letters/${encodeURIComponent(options.itemType)}/${encodeURIComponent(options.itemId)}/replay`;
}
