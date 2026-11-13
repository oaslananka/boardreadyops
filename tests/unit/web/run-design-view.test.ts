import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunDesignView, trustedReviewServerOrigin } from "../../../apps/web/components/run-design-view.js";

const visual = {
  id: "svg1",
  name: "kicad_native_F_Cu.svg",
  kind: "pcb_layer" as const,
  format: "svg" as const,
  sheetOrLayer: "F.Cu",
  width: 100,
  height: 100,
  content: '<svg viewBox="0 0 100 100"><path id="pcb-copper" /></svg>',
  sha256: "a".repeat(64),
  anchors: [],
};

describe("run design visual inspection", () => {
  it("renders genuinely published KiCad artwork with no fabricated markers or readiness claim", () => {
    const html = renderToStaticMarkup(
      createElement(RunDesignView, {
        runId: "run-1",
        snapshots: [visual],
        reviewId: "review-1",
      }),
    );
    expect(html).toContain('aria-label="Run design inspection"');
    expect(html).toContain("PCB &amp; schematic inspection");
    expect(html).toContain("1 KiCad-native");
    expect(html).toContain("Real run artwork · not fabrication approval.");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("min-[360px]:grid");
    expect(html).toContain("pcb-copper");
    expect(html).toContain("Finding coordinates are not inferred");
    expect(html).toContain("/runs/run-1/findings");
    expect(html).toContain("/reviews/review-1");
  });
  it("puts source artwork ahead of the secondary inventory on a visual-first investigation", () => {
    const html = renderToStaticMarkup(
      createElement(RunDesignView, {
        runId: "run-1",
        snapshots: [visual],
        baseSnapshots: [{ ...visual, id: "base", sha256: "b".repeat(64) }],
      }),
    );
    expect(html).toContain('aria-label="Published artwork inventory"');
    expect(html.indexOf('aria-label="Run design investigation workspace"')).toBeLessThan(
      html.indexOf('aria-label="Published artwork inventory"'),
    );
    expect(html).toContain("1 KiCad-native");
    expect(html).toContain("1 base views");
  });

  it("shows real recorded findings alongside the source artwork in the Run view", () => {
    const html = renderToStaticMarkup(
      createElement(RunDesignView, {
        runId: "run-1",
        snapshots: [visual],
        findings: [
          {
            id: "f1",
            ruleId: "bom.missing-mpn",
            severity: "high",
            message: "C1 has no manufacturer part number.",
            path: "board.kicad_sch",
            kind: undefined,
            waivedAt: undefined,
          },
        ],
        totalFindings: 14,
        repository: "example/hardware",
        commitSha: "a".repeat(40),
      }),
    );
    expect(html).toContain("Recorded findings");
    expect(html).toContain("Finding inspector");
    expect(html).toContain("1 of 14");
    expect(html).toContain("C1 has no manufacturer part number.");
    expect(html).toContain("Supply a verifiable manufacturer part number");
  });

  it("lets reviewers navigate every page of recorded findings alongside the source artwork", () => {
    const html = renderToStaticMarkup(
      createElement(RunDesignView, {
        runId: "run-1",
        snapshots: [visual],
        findings: [
          {
            id: "finding-on-third-page",
            fingerprint: "fp-third",
            ruleId: "design.board-outline",
            severity: "high",
            message: "Third-page outline finding.",
            path: "board.kicad_pcb",
          },
        ],
        totalFindings: 63,
        findingsPage: { page: 3, totalPages: 4 },
      }),
    );
    expect(html).toContain("Third-page outline finding.");
    expect(html).toContain("1 of 63");
    expect(html).toContain("Page");
    expect(html).toContain('href="/runs/run-1/design?findingsPage=2"');
    expect(html).toContain('href="/runs/run-1/design?findingsPage=4"');
  });

  it("does not show pagination for a single findings page", () => {
    const html = renderToStaticMarkup(
      createElement(RunDesignView, {
        runId: "run-1",
        snapshots: [visual],
        findingsPage: { page: 1, totalPages: 1 },
      }),
    );
    expect(html).not.toContain('aria-label="Pagination"');
  });

  it("exposes a real recorded base only as a visual comparison, never an engineering verdict", () => {
    const html = renderToStaticMarkup(
      createElement(RunDesignView, {
        runId: "run-1",
        snapshots: [visual],
        baseSnapshots: [{ ...visual, id: "base", sha256: "b".repeat(64) }],
      }),
    );
    expect(html).toContain("1 base views");
    expect(html).toContain(
      "Base/head comparison is a visual overlay only where both revisions publish matching layer artwork",
    );
    expect(html).toContain("not a dimensional or electrical verification");
    expect(html).toContain('title="Overlay with opacity slider"');
    const overlay = html.match(/<button[^>]+title="Overlay with opacity slider"[^>]*>/u)?.[0] ?? "";
    expect(overlay).not.toContain("disabled");
  });

  it("does not compare mismatched design layers or pretend they are the same board view", () => {
    const html = renderToStaticMarkup(
      createElement(RunDesignView, {
        runId: "run-1",
        snapshots: [visual],
        baseSnapshots: [{ ...visual, id: "base", sheetOrLayer: "B.Cu", sha256: "b".repeat(64) }],
      }),
    );
    const overlay = html.match(/<button[^>]+title="Overlay with opacity slider"[^>]*>/u)?.[0] ?? "";
    expect(overlay).toContain("disabled");
    expect(html).toContain("1 base views");
    expect(html).toContain("F.Cu");
    expect(html).toContain("B.Cu");
  });

  it("shows recorded base-only KiCad artwork without claiming that the head run published it", () => {
    const html = renderToStaticMarkup(
      createElement(RunDesignView, {
        runId: "run-1",
        snapshots: [],
        baseSnapshots: [{ ...visual, id: "recorded-base", sha256: "b".repeat(64) }],
        findings: [
          {
            id: "head-finding",
            ruleId: "design.board-outline",
            severity: "high",
            message: "Current run has an open PCB outline",
            path: "board.kicad_pcb",
          },
        ],
        totalFindings: 1,
        repository: "example/hardware",
        commitSha: "a".repeat(40),
      }),
    );
    expect(html).toContain("0 published views");
    expect(html).toContain("1 base views");
    expect(html).toContain("1 base KiCad-native");
    expect(html).toContain("Only the recorded base revision has design artwork");
    expect(html).toContain('role="status"');
    expect(html).toContain("No head-revision PCB or schematic snapshot was published");
    expect(html).toContain("This does not show the board at the current run commit");
    expect(html).toContain("No head artwork is available for visual comparison");
    expect(html).toContain('href="/reviews#publish-review"');
    expect(html).toContain("pcb-copper");
    expect(html).toContain("Current run has an open PCB outline");
    expect(html).not.toContain("No PCB or schematic preview published for this run");
    const baseMode = html.match(/<button[^>]+title="Base revision only"[^>]*>/u)?.[0] ?? "";
    const headMode = html.match(/<button[^>]+title="Head revision only"[^>]*>/u)?.[0] ?? "";
    const overlayMode = html.match(/<button[^>]+title="Overlay with opacity slider"[^>]*>/u)?.[0] ?? "";
    expect(baseMode).toContain('aria-pressed="true"');
    expect(headMode).toContain("disabled");
    expect(overlayMode).toContain("disabled");
  });

  it("uses only the configured service origin, not the vendor host, for native artwork upload guidance", () => {
    const custom = "https://reviews.customer.example";
    const html = renderToStaticMarkup(
      createElement(RunDesignView, {
        runId: "private",
        snapshots: [],
        serverOrigin: custom,
      }),
    );
    expect(html).toContain("boardreadyops review publish . --native-visuals --server https://reviews.customer.example");
    expect(html).not.toContain("https://boardreadyops.com");
    expect(html).toContain("Verify this is the intended server");

    expect(trustedReviewServerOrigin("https://boardreadyops.com/")).toBe("https://boardreadyops.com");
    expect(trustedReviewServerOrigin("https://reviews.example;echo%20bad")).toBeUndefined();
    expect(trustedReviewServerOrigin("https://reviews.example/path")).toBeUndefined();
    expect(trustedReviewServerOrigin("http://reviews.example")).toBeUndefined();
  });

  it("identifies the exact recorded source commit before offering opt-in native publishing", () => {
    const sha = "a".repeat(40);
    const html = renderToStaticMarkup(
      createElement(RunDesignView, { runId: "run-commit", snapshots: [], commitSha: sha }),
    );
    expect(html).toContain(sha);
    expect(html).toContain("git rev-parse HEAD");
    expect(html).toContain("--project path/to/board.kicad_pro");
    expect(html).toContain("separate source-bound run and Review");
  });

  it("does not misrepresent a run with no published design IP", () => {
    const html = renderToStaticMarkup(createElement(RunDesignView, { runId: "run-1", snapshots: [] }));
    expect(html).toContain("No PCB or schematic preview published for this run");
    expect(html).toContain("--native-visuals");
    expect(html).toContain('href="/reviews#publish-review"');
    expect(html).toContain("Publish source-derived PCB and schematic views");
    expect(html).toContain(
      "boardreadyops review publish . --native-visuals --server https://YOUR-BOARDREADYOPS-SERVER",
    );
    expect(html).toContain("does not attach images to this earlier run");
    expect(html).toContain("BOARDREADYOPS_TOKEN");
    expect(html).not.toContain("Investigate 0 recorded findings");
    expect(html).toContain("0 KiCad-native");
    expect(html).not.toContain("pcb-copper");
  });
});
