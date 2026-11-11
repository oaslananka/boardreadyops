/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { remoteFootprintFacts } from "../../../apps/web/lib/remote-mcp-foundation.js";
import { updateReviewToolResult } from "../../../apps/web/mcp-review-view/review-evidence.js";

beforeEach(() => {
  document.body.innerHTML = `
    <h1 id="heading">BoardReadyOps · PCB Review</h1>
    <p id="status">Waiting</p>
    <p id="counts"></p>
    <button id="detail-button" hidden>Show provenance</button>
    <pre id="provenance" hidden></pre>`;
});

function element(id: string): HTMLElement {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing ${id}`);
  return result;
}

describe("MCP Apps Review evidence lifecycle", () => {
  it("clears earlier source evidence before failed, invalid, and absent tool results", async () => {
    const heading = element("heading");
    const counts = element("counts");
    const status = element("status");
    const provenance = element("provenance");
    const detail = document.getElementById("detail-button") as HTMLButtonElement;
    const elements = { heading, counts, status, provenance, detailButton: detail, initialHeading: heading.textContent };
    const handle = (result: Parameters<typeof updateReviewToolResult>[1]) => updateReviewToolResult(elements, result);

    const valid = {
      schemaVersion: 1,
      scope: "pcb-footprints-only",
      disclosure: "counts-and-digests-only",
      provenance: "local-git-commits",
      baseCommitSha: "1".repeat(40),
      headCommitSha: "2".repeat(40),
      baseBlobSha: "3".repeat(40),
      headBlobSha: "4".repeat(40),
      baseSourceSha256: "5".repeat(64),
      headSourceSha256: "6".repeat(64),
      changes: {
        added: 2,
        removed: 1,
        modified: 3,
        byField: { reference: 3, libraryId: 0, layer: 0, positionMm: 0, rotationDeg: 0 },
      },
      riskAssessment: "not-evaluated",
    };
    const show = () => {
      handle({ structuredContent: valid });
      expect(counts.textContent).toContain("2 added");
      expect(provenance.textContent).toContain("Base commit");
      expect(detail.hidden).toBe(false);
    };
    const cleared = () => {
      expect(heading.textContent).toBe("BoardReadyOps · PCB Review");
      expect(counts.textContent).toBe("");
      expect(provenance.textContent).toBe("");
      expect(provenance.hidden).toBe(true);
      expect(detail.hidden).toBe(true);
      expect(detail.textContent).toBe("Show provenance");
    };

    show();
    provenance.hidden = false;
    detail.textContent = "Hide provenance";
    expect(provenance.hidden).toBe(false);
    handle({ isError: true });
    cleared();
    expect(status.textContent).toContain("could not be verified");

    show();
    handle({ structuredContent: { ...valid, scope: "unknown" } });
    cleared();
    expect(status.textContent).toContain("unavailable");

    for (const invalidChanges of [
      null,
      [1, 2, 3],
      { added: -1, removed: 0, modified: 0 },
      { added: Number.NaN, removed: 0, modified: 0 },
      { added: 1, removed: 0.5, modified: 0 },
    ]) {
      show();
      handle({ structuredContent: { ...valid, changes: invalidChanges } });
      cleared();
      expect(status.textContent).toBe("Source evidence unavailable");
    }

    show();
    handle({ structuredContent: remoteFootprintFacts(valid) });
    expect(counts.textContent).toContain("2 added");
    expect(status.textContent).toContain("client-reported");
    expect(provenance.textContent).toContain("Base commit");

    for (const invalidResult of [
      remoteFootprintFacts(null),
      { availability: "client-reported", summary: null },
      { availability: "verified", summary: valid },
      { ...valid, headCommitSha: "not-a-real-git-id" },
      { ...valid, baseCommitSha: undefined },
      { ...valid, headSourceSha256: "not-a-digest" },
      { ...valid, provenance: "untrusted-example" },
      { ...valid, changes: { ...valid.changes, added: 10_001 } },
      { ...valid, changes: { ...valid.changes, byField: { ...valid.changes.byField, reference: 4 } } },
    ]) {
      show();
      handle({ structuredContent: invalidResult });
      cleared();
      expect(status.textContent).toContain("unavailable");
    }

    show();
    handle({ content: [{ type: "text", text: "invalid JSON" }] });
    cleared();
    expect(status.textContent).toBe("Evidence unavailable");
  });
});
