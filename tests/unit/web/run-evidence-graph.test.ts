import { describe, expect, it } from "vitest";
import { buildRunEvidenceGraph, type RunEvidenceGraphInput } from "../../../apps/web/lib/run-evidence-graph.js";

function runInput(overrides: Partial<RunEvidenceGraphInput> = {}): RunEvidenceGraphInput {
  return {
    id: "run-1",
    repositoryId: "repo-1",
    repository: "acme/gateway",
    commitSha: "a".repeat(40),
    ref: "refs/tags/v2.4.0",
    decision: "pass",
    completedAt: "2026-09-12T10:00:00.000Z",
    reviewId: "review-1",
    setupPreset: "production",
    setupPresetVersion: 3,
    setupRevision: 7,
    artifacts: [
      {
        id: "artifact-1",
        kind: "report",
        name: "review.json",
        sha256: "b".repeat(64),
        bytes: 1200,
        role: "evidence",
        contentType: "application/json",
        executionAttemptId: "attempt-1",
        uploadedAt: "2026-09-12T10:00:01.000Z",
        downloadUrl: undefined,
        availability: "available",
        retention: "no-automatic-expiry",
        retentionUntil: undefined,
      },
    ],
    productionBatches: [
      {
        id: "batch-1",
        externalBatchId: "LOT-42",
        manufacturer: "Acme EMS",
        manufacturedOn: "2026-09-18",
        quantity: 500,
        firstPassYieldBps: 9825,
        reworkCount: 4,
        scrapCount: 1,
        notes: undefined,
        correctiveAction: undefined,
        sourceKind: "csv",
        sourceName: "lot-42.csv",
        sourceSha256: "c".repeat(64),
        importedAt: "2026-09-20T08:00:00.000Z",
        defects: [],
      },
    ],
    ...overrides,
  };
}

describe("run evidence graph adapter", () => {
  it("connects dashboard-visible release context and leaves unloaded governance explicit", () => {
    const { graph, trace } = buildRunEvidenceGraph(runInput());

    expect(graph.rootReleaseId).toBe("release:run-1");
    expect(trace.backward.map((node) => node.kind)).toEqual(["source", "evidence", "review", "policy"]);
    expect(trace.forward).toEqual([
      expect.objectContaining({
        kind: "production_batch",
        label: "Acme EMS · LOT-42",
        integrity: { sha256: "c".repeat(64) },
      }),
    ]);
    expect(trace.missing).toEqual([
      expect.objectContaining({
        from: "review:review-1",
        relationship: "approved_by",
        expectedKind: "approval",
      }),
      expect.objectContaining({
        from: "review:review-1",
        relationship: "waived_by",
        expectedKind: "waiver",
      }),
    ]);

    const policy = graph.nodes.find((node) => node.kind === "policy");
    expect(policy).toMatchObject({
      label: "production · v3 · revision 7",
      attributes: { source: "repository setup", version: 3 },
    });
  });

  it("reports absent review, evidence, and production links instead of inferring them", () => {
    const { trace } = buildRunEvidenceGraph(
      runInput({
        reviewId: undefined,
        setupPreset: undefined,
        setupPresetVersion: undefined,
        setupRevision: undefined,
        artifacts: [],
        productionBatches: [],
      }),
    );

    expect(trace.backward.map((node) => node.kind)).toEqual(["source"]);
    expect(trace.forward).toEqual([]);
    expect(trace.missing.map((entry) => entry.relationship)).toEqual(["supported_by", "reviewed_in", "produced"]);
  });
});
