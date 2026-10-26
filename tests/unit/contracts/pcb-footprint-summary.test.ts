import { describe, expect, it } from "vitest";
import { pcbFootprintSummarySchema } from "../../../packages/contracts/src/pcb-footprint-summary.js";

const example = {
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
    byField: { reference: 1, libraryId: 2, layer: 0, positionMm: 3, rotationDeg: 1 },
  },
  riskAssessment: "not-evaluated",
} as const;

describe("v1 non-source-disclosing PCB footprint evidence summary", () => {
  it("accepts bounded, deterministic, source-digest-backed fact counts", () => {
    expect(pcbFootprintSummarySchema.parse(example)).toEqual(example);
    const json = JSON.stringify(example);
    expect(json).not.toContain("sourceUuid");
    expect(json).not.toContain("coordinates");
    expect(json).not.toContain('libraryId":"R_');
  });

  it.each([
    { extra: "private PCB source", ...example },
    { ...example, schemaVersion: 2 },
    { ...example, scope: "all-pcb-geometry" },
    { ...example, disclosure: "source-text" },
    { ...example, riskAssessment: "pass" },
    { ...example, baseSourceSha256: "bad" },
    { ...example, headCommitSha: "bad" },
    { ...example, changes: { ...example.changes, added: -1 } },
    { ...example, changes: { ...example.changes, removed: 2.2 } },
    { ...example, changes: { ...example.changes, modified: 10_001 } },
    { ...example, changes: { ...example.changes, byField: { ...example.changes.byField, positionMm: 4 } } },
    {
      ...example,
      changes: {
        ...example.changes,
        byField: { ...example.changes.byField, reference: 0, libraryId: 0, positionMm: 0, rotationDeg: 0 },
      },
    },
    { ...example, changes: { ...example.changes, byField: { ...example.changes.byField, sourceUuid: "secret" } } },
  ])("rejects invalid, unverified, contradictory or source-leaking data %#", (value) => {
    expect(pcbFootprintSummarySchema.safeParse(value).success).toBe(false);
  });

  it("accepts same-source empty factual changes without interpreting them as readiness", () => {
    const clean = {
      ...example,
      changes: {
        added: 0,
        removed: 0,
        modified: 0,
        byField: { reference: 0, libraryId: 0, layer: 0, positionMm: 0, rotationDeg: 0 },
      },
    };
    expect(pcbFootprintSummarySchema.safeParse(clean).success).toBe(true);
    expect(clean.riskAssessment).toBe("not-evaluated");
  });
});
