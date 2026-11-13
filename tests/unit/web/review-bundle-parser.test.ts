import { describe, expect, it } from "vitest";
import { parseReviewBundle, reviewBundleLimitBytes } from "../../../apps/web/components/review/review-bundle-parser.js";

const commit = "a".repeat(40);
const digest = "b".repeat(64);
const repository = "oaslananka-iot/RoyalBlue54L-Feather-Hardware";

function bundle() {
  return {
    format: "boardreadyops-review-bundle-v1",
    repository,
    commitSha: commit,
    uploadMode: "snapshots",
    sourceArtIncluded: true,
    createdAt: "2026-11-13T17:00:00.000Z",
    idempotencyKey: `publish-${commit}-${digest.slice(0, 16)}-${"c".repeat(16)}`,
    payload: {
      repositoryId: repository,
      commitSha: commit,
      ref: "refs/heads/main",
      triggerKind: "manual",
      evidenceDigest: digest,
      title: "Actual RoyalBlue hardware",
      findings: [{ ruleId: "drc.hole_clearance", severity: "error", message: "Real DRC", fingerprint: "f".repeat(64) }],
      artifacts: [],
      snapshots: [
        {
          id: "one",
          name: "kicad_native_F_Cu.svg",
          format: "svg",
          kind: "pcb_layer",
          sheetOrLayer: "F.Cu",
          width: 100,
          height: 100,
          content: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
          sha256: "a".repeat(64),
          anchors: [],
        },
        {
          id: "two",
          name: "kicad_native_schematic.svg",
          format: "svg",
          kind: "schematic",
          sheetOrLayer: "Main",
          width: 100,
          height: 100,
          content: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
          sha256: "b".repeat(64),
          anchors: [],
        },
      ],
    },
  };
}

describe("signed-in browser Review bundle parsing", () => {
  it("previews exactly the selected source/revision, true native artwork and recorded blocker counts", () => {
    const parsed = parseReviewBundle(bundle());
    expect(parsed.repository).toBe(repository);
    expect(parsed.commitSha).toBe(commit);
    expect(parsed.nativePcbViews).toBe(1);
    expect(parsed.nativeSchematicViews).toBe(1);
    expect(parsed.findingCount).toBe(1);
    expect(parsed.blockingCount).toBe(1);
    expect(parsed.includesDesignArtwork).toBe(true);
    expect(parsed.payload.repositoryId).toBe(repository);
    expect(reviewBundleLimitBytes).toBeGreaterThan(20 * 1024 * 1024);
  });

  it("rejects a spoofed repository alias, commit, digest or idempotency identity", () => {
    const invalid = [
      { repository: "other/repo" },
      { commitSha: "e".repeat(40) },
      { idempotencyKey: "arbitrary-duplicate" },
      { payload: { ...bundle().payload, evidenceDigest: "0".repeat(64) } },
    ];
    for (const changed of invalid) expect(() => parseReviewBundle({ ...bundle(), ...changed })).toThrow();
  });

  it("rejects missing native design files when the bundle claims real artwork", () => {
    const source = bundle();
    source.payload.snapshots[0].name = "summary.svg";
    expect(() => parseReviewBundle(source)).toThrow();
  });

  it("does not mistake a malformed tag prefix for a genuine SVG root", () => {
    const source = bundle();
    source.payload.snapshots[0].content = "this is not real art: <svgfake";
    expect(() => parseReviewBundle(source)).toThrow();
  });

  it("rejects a malformed or dangerously oversized snapshot listing before review display", () => {
    const source = bundle();
    source.payload.snapshots = Array.from({ length: 65 }, (_, i) => ({
      ...bundle().payload.snapshots[0],
      id: String(i),
    }));
    expect(() => parseReviewBundle(source)).toThrow();
    expect(() => parseReviewBundle(null)).toThrow();
    expect(() => parseReviewBundle({})).toThrow();
  });
});
