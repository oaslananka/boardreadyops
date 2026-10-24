import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  groupReviewFindings,
  ReviewDesignWorkspace,
  visibleReviewFindings,
} from "../../../apps/web/components/review/review-design-workspace.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

const base = DEMO_REVIEWS[0];
if (!base) throw new Error("Review fixture missing");

const u1 = {
  ...base.findings[0],
  fingerprint: "fp-source-bound",
  component: "U1",
  ruleId: "drc.clearance",
  message: "Insufficient clearance on U1",
  severity: "error" as const,
  disposition: "open" as const,
};
const r2 = {
  ...base.findings[0],
  fingerprint: "fp-unmapped",
  component: "U2",
  ruleId: "erc.pin_mismatch",
  message: "Pin mismatch on U2",
  severity: "warning" as const,
  disposition: "open" as const,
};

const review = {
  ...base,
  findings: [u1, r2],
  headSnapshots: [
    {
      id: "snap-pcb",
      name: "summary.svg",
      kind: "pcb_layer" as const,
      format: "svg" as const,
      sheetOrLayer: "F.Cu",
      width: 1000,
      height: 800,
      content: '<svg xmlns="http://www.w3.org/2000/svg"><rect id="source-bound-test"/></svg>',
      sha256: "e".repeat(64),
      anchors: [
        {
          id: "u1",
          kind: "finding" as const,
          targetRef: "U1",
          x: 0.5,
          y: 0.5,
          metadata: { fingerprint: "fp-source-bound", severity: "error", ruleId: "drc.clearance" },
        },
      ],
    },
  ],
};

describe("Zaptrace-inspired BoardReadyOps review workspace", () => {
  it("renders a real published SVG, a triage list, and a selected inspector together", () => {
    const html = renderToStaticMarkup(createElement(ReviewDesignWorkspace, { review }));
    expect(html).toContain('aria-label="Hardware design inspection workspace"');
    expect(html).toContain('aria-label="Selected finding inspector"');
    expect(html).toContain("source-bound-test");
    expect(html).toContain("2 recorded");
    expect(html).toContain("1 open critical/error");
    expect(html).toContain("Snapshot marker available");
    expect(html).not.toContain("No snapshot marker");
    expect(html).toContain("Insufficient clearance on U1");
    expect(html).not.toContain("Pin mismatch on U2");
    expect(html).toContain("Blockers (1)");
    expect(html).toContain("All (2)");
    expect(html).toContain("1 of 2 findings shown");
    expect(html).toContain("Search findings by rule, component or message");
    expect(html).toContain("not exact native KiCad");
    expect(html).toContain("not verified");
    expect(html).toContain("xl:grid-cols-[minmax(275px,1.05fr)_minmax(0,1.9fr)_minmax(235px,0.95fr)]");
    expect(html).toContain("line-clamp-2");
    expect(html).toContain("h-[19rem]");
    expect(html).toContain("px-3 py-2 sm:gap-3 sm:p-4");
    expect(html).toContain("hidden text-xs font-semibold uppercase tracking-wide text-primary sm:block");
    // Engineering detail remains fully present in the inspector even when the list preview is clamped.
    expect(html).toContain('class="mt-1 break-words">Insufficient clearance on U1');
  });

  it("filters actual blocker records by severity, disposition and query without losing other findings", () => {
    expect(visibleReviewFindings(review.findings, "blocking", "").map((x) => x.fingerprint)).toEqual([
      "fp-source-bound",
    ]);
    expect(visibleReviewFindings(review.findings, "all", "")).toHaveLength(2);
    expect(visibleReviewFindings(review.findings, "all", "u2").map((x) => x.fingerprint)).toEqual(["fp-unmapped"]);
    expect(visibleReviewFindings(review.findings, "blocking", "PIN mismatch")).toEqual([]);
    expect(visibleReviewFindings([{ ...u1, disposition: "waived" }], "blocking", "")).toEqual([]);
  });

  it("groups repeated rule findings without losing their individual fingerprints or evidence", () => {
    const repeated = [
      ...Array.from({ length: 9 }, (_, index) => ({
        ...u1,
        fingerprint: `fp-${index}`,
        component: `U${index}`,
        message: `Insufficient clearance on U${index}`,
      })),
      r2,
    ];
    const groups = groupReviewFindings(repeated);
    expect(groups.map((group) => [group.ruleId, group.findings.length])).toEqual([
      ["drc.clearance", 9],
      ["erc.pin_mismatch", 1],
    ]);
    expect(groups.flatMap((group) => group.findings.map((finding) => finding.fingerprint))).toEqual(
      repeated.map((finding) => finding.fingerprint),
    );
    const html = renderToStaticMarkup(
      createElement(ReviewDesignWorkspace, { review: { ...review, findings: repeated } }),
    );
    expect(html).toContain("Show 7 more drc.clearance findings");
    expect(html).toContain("Insufficient clearance on U1");
    expect(html).toContain("U8");
  });

  it("does not invent a PCB image or a passing verdict when no snapshots or findings exist", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewDesignWorkspace, { review: { ...review, findings: [], headSnapshots: undefined } }),
    );
    expect(html).toContain("No schematic or PCB snapshot is available for this revision.");
    expect(html).toContain("No findings are recorded for this Review.");
    expect(html).toContain("does not independently verify manufacturing readiness");
    expect(html).toContain("min-h-[17rem]");
    expect(html).toContain("md:min-h-[25rem]");
    expect(html).not.toContain("source-bound-test");
  });
});
