import type { RunListingEntry } from "./run-listing.js";

type ReviewActionInput = Pick<RunListingEntry, "id" | "status" | "decision">;

export type RunReviewAction = {
  label: string;
  description: string;
  href: string;
};

const activeStates = new Set(["queued", "dispatching", "dispatched", "running", "reporting"]);

/** A recorded check is not a review decision, signed package, or fabrication authorization. */
export function nextRunReviewAction(run: ReviewActionInput): RunReviewAction {
  const href = `/runs/${encodeURIComponent(run.id)}`;
  if (activeStates.has(run.status)) {
    return {
      href,
      label: "Track this check",
      description: "This check is still in progress. Follow its recorded status before acting on any findings.",
    };
  }
  if (run.status !== "completed") {
    return {
      href,
      label: "Inspect incomplete check",
      description: "No completed result is recorded. Inspect the failure or cancellation before another attempt.",
    };
  }
  if (run.decision === "fail") {
    return {
      href: `${href}/findings`,
      label: "Investigate findings",
      description: "This recorded readiness check failed. Inspect its findings and source before trying again.",
    };
  }
  if (run.decision === "pass") {
    return {
      href: `${href}/artifacts`,
      label: "Verify recorded evidence",
      description:
        "Readiness passed, but that is not fabrication approval. Check the available evidence and its source.",
    };
  }
  return {
    href,
    label: "Review recorded result",
    description: "The readiness result is not a verified pass. Investigate before considering any handoff.",
  };
}
