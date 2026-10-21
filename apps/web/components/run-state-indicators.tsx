import { humanize, StatusBadge } from "./ui.js";

/**
 * Execution state and engineering decision answer different questions.
 * A completed run may fail readiness, while a queued run has no verdict yet.
 */
export function RunStateIndicators({ status, decision }: Readonly<{ status: string; decision: string | undefined }>) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge value={status} label={`Execution: ${humanize(status)}`} />
      {decision ? <StatusBadge value={decision} label={`Decision: ${humanize(decision)}`} /> : null}
    </span>
  );
}
