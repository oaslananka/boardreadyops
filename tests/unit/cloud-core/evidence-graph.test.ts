import { describe, expect, it } from "vitest";
import { buildReleaseEvidenceGraph, traceReleaseEvidence } from "../../../packages/cloud-core/src/evidence-graph.js";

describe("release evidence graph", () => {
  it("links a release backward to source/evidence/governance and forward to production outcomes", () => {
    const graph = buildReleaseEvidenceGraph({
      release: {
        id: "run-42",
        repositoryId: "repo-1",
        repository: "acme/gateway",
        commitSha: "a".repeat(40),
        ref: "refs/tags/v2.4.0",
        decision: "pass",
        completedAt: "2026-09-12T10:00:00.000Z",
      },
      evidence: [
        {
          id: "artifact-1",
          kind: "report",
          name: "review.json",
          sha256: "b".repeat(64),
          uploadedAt: "2026-09-12T10:00:01.000Z",
        },
      ],
      review: {
        id: "review-7",
        evidenceDigest: "c".repeat(64),
        policy: {
          id: "release-production-v3",
          label: "Production release policy v3",
          source: "repository",
          version: 3,
        },
        approvals: [
          {
            id: "approval-1",
            approverId: "hardware-lead",
            status: "approved",
            occurredAt: "2026-09-12T09:58:00.000Z",
            evidenceDigest: "c".repeat(64),
          },
        ],
        waivers: [
          {
            id: "waiver-1",
            owner: "rf-team",
            disposition: "accepted_risk",
            occurredAt: "2026-09-12T09:57:00.000Z",
            evidenceDigest: "c".repeat(64),
          },
        ],
      },
      productionBatches: [
        {
          id: "batch-1",
          externalBatchId: "LOT-2026-09-A",
          manufacturer: "Acme EMS",
          manufacturedOn: "2026-09-18",
          sourceSha256: "d".repeat(64),
          importedAt: "2026-09-20T08:00:00.000Z",
        },
      ],
    });

    const trace = traceReleaseEvidence(graph);

    expect(graph.version).toBe(1);
    expect(graph.rootReleaseId).toBe("release:run-42");
    expect(trace.backward.map((node) => node.kind)).toEqual([
      "source",
      "evidence",
      "review",
      "policy",
      "approval",
      "waiver",
    ]);
    expect(trace.forward).toEqual([
      expect.objectContaining({
        id: "production_batch:batch-1",
        kind: "production_batch",
        integrity: { sha256: "d".repeat(64) },
      }),
    ]);
    expect(trace.missing).toEqual([]);
  });

  it("keeps absent optional relationships explicit instead of inventing evidence", () => {
    const graph = buildReleaseEvidenceGraph({
      release: {
        id: "run-no-context",
        repositoryId: "repo-1",
        repository: "acme/gateway",
        commitSha: "e".repeat(40),
      },
    });

    const trace = traceReleaseEvidence(graph);

    expect(trace.backward.map((node) => node.kind)).toEqual(["source"]);
    expect(trace.forward).toEqual([]);
    expect(trace.missing).toEqual([
      {
        from: "release:run-no-context",
        relationship: "supported_by",
        expectedKind: "evidence",
        reason: "No release evidence artifacts are linked to this run.",
      },
      {
        from: "release:run-no-context",
        relationship: "reviewed_in",
        expectedKind: "review",
        reason: "No linked review context is available for this release.",
      },
      {
        from: "release:run-no-context",
        relationship: "produced",
        expectedKind: "production_batch",
        reason: "No production outcomes are linked to this release yet.",
      },
    ]);
  });

  it("distinguishes an explicitly empty approval/waiver history from context that was never loaded", () => {
    const graph = buildReleaseEvidenceGraph({
      release: {
        id: "run-reviewed",
        repositoryId: "repo-1",
        repository: "acme/gateway",
        commitSha: "f".repeat(40),
      },
      review: {
        id: "review-9",
        approvals: [],
        waivers: [],
      },
    });

    expect(graph.missing).toEqual([
      {
        from: "release:run-reviewed",
        relationship: "supported_by",
        expectedKind: "evidence",
        reason: "No release evidence artifacts are linked to this run.",
      },
      {
        from: "review:review-9",
        relationship: "governed_by",
        expectedKind: "policy",
        reason: "The run dashboard has no persisted policy context for this review.",
      },
      {
        from: "release:run-reviewed",
        relationship: "produced",
        expectedKind: "production_batch",
        reason: "No production outcomes are linked to this release yet.",
      },
    ]);
  });
});
