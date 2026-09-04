import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangesTab } from "../../../apps/web/components/review/changes-tab.js";
import type { DemoReview } from "../../../apps/web/lib/demo-data.js";

/**
 * A real (Postgres-backed) review has no `changedFiles` diff data yet, but can now have real
 * `headSnapshots` published by `boardreadyops review publish`. These two data sources are
 * independent, so the canvas panel must key off `headSnapshots`, not `changedFiles`.
 */
function persistedReviewFixture(overrides: Partial<DemoReview> = {}): DemoReview {
  return {
    id: "rev_db_real_1",
    repositoryId: "repo-1",
    repositoryName: "acme/board",
    pullRequestNumber: 1,
    title: "Persisted review",
    status: "active",
    decision: "pending",
    currentRevisionId: "rev_v1",
    currentRevisionSequence: 1,
    baseCommitSha: "0".repeat(40),
    headCommitSha: "1".repeat(40),
    evidenceDigest: "a".repeat(64),
    evidenceState: "current",
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    findings: [],
    comments: [],
    checklist: [],
    approvals: [],
    evidenceItems: [],
    changedFiles: undefined,
    bomChanges: undefined,
    headSnapshots: undefined,
    ...overrides,
  };
}

describe("ChangesTab canvas gating", () => {
  it("renders the review canvas from headSnapshots even when changedFiles is unavailable", () => {
    const review = persistedReviewFixture({
      headSnapshots: [
        {
          id: "snap_sch_board",
          name: "schematic_board.svg",
          kind: "schematic",
          format: "svg",
          sheetOrLayer: "board",
          width: 1200,
          height: 800,
          content: '<svg xmlns="http://www.w3.org/2000/svg"><rect id="canvas-probe" /></svg>',
          sha256: "f".repeat(64),
          anchors: [],
        },
      ],
    });

    const html = renderToStaticMarkup(createElement(ChangesTab, { review }));

    expect(html).toContain("canvas-probe");
    expect(html).not.toContain("Canvas diff preview is not available for this persisted review.");
  });

  it("shows an honest empty state when no snapshot has been published for this revision", () => {
    const review = persistedReviewFixture();

    const html = renderToStaticMarkup(createElement(ChangesTab, { review }));

    expect(html).not.toContain("canvas-probe");
    expect(html).toContain("No schematic or PCB snapshot is available for this revision.");
  });
});
