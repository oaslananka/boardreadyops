import { pcbFootprintSummarySchema } from "@boardreadyops/contracts/pcb-footprint-summary";

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

    const payload = value as Record<string, unknown>;
    // Both the repository-scoped MCP Apps tool and the OAuth remote MCP tool
    // use this resource. The latter wraps an authorized summary in an
    // explicit client-reported/unavailable availability state.
    const candidate =
      payload.availability === "client-reported" ? payload.summary : "availability" in payload ? null : payload;
    const parsed = pcbFootprintSummarySchema.safeParse(candidate);
    if (!parsed.success) {
      status.textContent = "Source evidence unavailable";
      return;
    }

    const evidence = parsed.data;
    heading.textContent = "Source-linked footprint changes";
    const { added, removed, modified } = evidence.changes;
    counts.textContent = `${added} added · ${removed} removed · ${modified} modified`;
    status.textContent = "One KiCad PCB file · client-reported Git evidence · risk not evaluated";
    provenance.textContent = `Base commit: ${evidence.baseCommitSha}\nHead commit: ${evidence.headCommitSha}`;
    detailButton.hidden = false;
  } catch {
    status.textContent = "Evidence unavailable";
  }
}
