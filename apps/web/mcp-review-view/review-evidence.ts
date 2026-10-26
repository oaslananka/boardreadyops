/**
 * Render only evidence for the most recent MCP tool result.
 * Never leave old review counts or provenance visible after an error.
 */
export interface ReviewEvidenceElements {
  status: HTMLElement;
  heading: HTMLElement;
  counts: HTMLElement;
  provenance: HTMLElement;
  detailButton: HTMLButtonElement;
  initialHeading: string | null;
}

interface ReviewToolResult {
  isError?: boolean | undefined;
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string | undefined }> | undefined;
}

export function updateReviewToolResult(elements: ReviewEvidenceElements, result: ReviewToolResult): void {
  const { status, heading, counts, provenance, detailButton, initialHeading } = elements;
  status.textContent = "";
  heading.textContent = initialHeading;
  counts.textContent = "";
  provenance.textContent = "";
  provenance.hidden = true;
  detailButton.textContent = "Show provenance";
  detailButton.hidden = true;

  if (result.isError) {
    status.textContent = "Evidence could not be verified. No release decision was made.";
    return;
  }

  try {
    const text = result.content?.find((item) => item.type === "text");
    const value = result.structuredContent ?? (text?.text ? JSON.parse(text.text) : null);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      status.textContent = "Source evidence unavailable";
      return;
    }

    const evidence = value as Record<string, unknown>;
    if (
      evidence.schemaVersion !== 1 ||
      evidence.scope !== "pcb-footprints-only" ||
      evidence.disclosure !== "counts-and-digests-only"
    ) {
      status.textContent = "No verified PCB footprint summary for this review";
      return;
    }

    const change = evidence.changes;
    if (!change || typeof change !== "object" || Array.isArray(change)) return;
    const changes = change as Record<string, unknown>;
    const values = [changes.added, changes.removed, changes.modified];
    if (!values.every((x) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0)) return;

    heading.textContent = "Source-linked footprint changes";
    counts.textContent = `${values[0]} added · ${values[1]} removed · ${values[2]} modified`;
    status.textContent = "One KiCad PCB file · client-reported Git evidence · risk not evaluated";
    const baseCommit = typeof evidence.baseCommitSha === "string" ? evidence.baseCommitSha : "unavailable";
    const headCommit = typeof evidence.headCommitSha === "string" ? evidence.headCommitSha : "unavailable";
    provenance.textContent = `Base commit: ${baseCommit}\nHead commit: ${headCommit}`;
    detailButton.hidden = false;
  } catch {
    status.textContent = "Evidence unavailable";
  }
}
