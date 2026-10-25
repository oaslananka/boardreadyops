import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangesTab } from "../../../apps/web/components/review/changes-tab.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";
import type { PcbFootprintSummary } from "../../../packages/contracts/src/pcb-footprint-summary.js";

const summary: PcbFootprintSummary = {
  schemaVersion: 1,
  scope: "pcb-footprints-only",
  provenance: "local-git-commits",
  disclosure: "counts-and-digests-only",
  baseCommitSha: "a".repeat(40),
  headCommitSha: "b".repeat(40),
  baseBlobSha: "c".repeat(40),
  headBlobSha: "d".repeat(40),
  baseSourceSha256: "e".repeat(64),
  headSourceSha256: "f".repeat(64),
  changes: {
    added: 2,
    removed: 1,
    modified: 3,
    byField: { reference: 1, libraryId: 0, layer: 0, positionMm: 3, rotationDeg: 0 },
  },
  riskAssessment: "not-evaluated",
};

describe("disclosure-minimal Review PCB footprint summary panel", () => {
  it("shows source-linked counts with explicit client-reported, non-verdict provenance", () => {
    const review = DEMO_REVIEWS[0];
    if (!review) throw new Error("missing review fixture");
    const html = renderToStaticMarkup(
      createElement(ChangesTab, { review: { ...review, pcbFootprintSummary: summary } }),
    );
    expect(html).toContain('aria-label="Client-reported PCB footprint changes"');
    expect(html).toContain("Source-linked · client reported");
    expect(html).toContain("not independently examined the source design");
    expect(html).toContain("Risk, DRC and manufacturing");
    expect(html).toContain("Show source-digest provenance");
    expect(html).toContain(`Base Git: ${summary.baseCommitSha}`);
    expect(html).toContain(`Head source SHA-256: ${summary.headSourceSha256}`);
    for (const name of ["Added", "Removed", "Modified"]) expect(html).toContain(name);
    expect(html).not.toContain("sourceUuid");
    expect(html).not.toContain("R_0603");
  });

  it("does not invent footprint evidence when no summary exists", () => {
    const review = DEMO_REVIEWS[0];
    if (!review) throw new Error("missing review fixture");
    const html = renderToStaticMarkup(createElement(ChangesTab, { review }));
    expect(html).not.toContain("Client-reported PCB footprint changes");
    expect(html).not.toContain("Source-linked · client reported");
  });
});
