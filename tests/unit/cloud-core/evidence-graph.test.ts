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

  it("rejects duplicate evidence or production identities instead of conflating digests", () => {
    const base = {
      release: {
        id: "run-identity",
        repositoryId: "repo-one",
        repository: "acme/board",
        commitSha: "f".repeat(40),
      },
    };
    expect(() =>
      buildReleaseEvidenceGraph({
        ...base,
        evidence: [
          { id: "artifact-a", kind: "report", name: "old.json", sha256: "1".repeat(64) },
          { id: "artifact-a", kind: "report", name: "replaced.json", sha256: "2".repeat(64) },
        ],
      }),
    ).toThrow("Duplicate evidence graph node identity: evidence:artifact-a");

    expect(() =>
      buildReleaseEvidenceGraph({
        ...base,
        productionBatches: [
          {
            id: "batch-a",
            externalBatchId: "LOT-A",
            manufacturer: "Acme",
            manufacturedOn: "2026-10-01",
            sourceSha256: "3".repeat(64),
          },
          {
            id: "batch-a",
            externalBatchId: "LOT-B",
            manufacturer: "Acme",
            manufacturedOn: "2026-10-02",
            sourceSha256: "4".repeat(64),
          },
        ],
      }),
    ).toThrow("Duplicate evidence graph node identity: production_batch:batch-a");
  });

  it("refuses ambiguous externally supplied graph nodes or an absent root", () => {
    const root = { id: "release:run-1", kind: "release" as const, label: "run-1" };
    const graph = {
      version: 1 as const,
      rootReleaseId: root.id,
      nodes: [root, { ...root, label: "forged run" }],
      edges: [],
      missing: [],
    };
    expect(() => traceReleaseEvidence(graph)).toThrow("Evidence graph contains duplicate node identities.");
    expect(() => traceReleaseEvidence({ ...graph, nodes: [], rootReleaseId: "release:missing" })).toThrow(
      "Evidence graph root release node is missing.",
    );
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

  it("keeps optional policy metadata absent instead of synthesizing defaults", () => {
    const graph = buildReleaseEvidenceGraph({
      release: {
        id: "run-policy",
        repositoryId: "repo-1",
        repository: "acme/gateway",
        commitSha: "1".repeat(40),
      },
      review: {
        id: "review-policy",
        policy: { id: "policy-1", label: "Repository policy" },
        approvals: [],
        waivers: [],
      },
    });

    expect(graph.nodes.find((node) => node.id === "policy:policy-1")).toEqual({
      id: "policy:policy-1",
      kind: "policy",
      label: "Repository policy",
      attributes: {},
    });
  });

  it("uses manufacturing date when a production import timestamp is unavailable", () => {
    const graph = buildReleaseEvidenceGraph({
      release: {
        id: "run-production",
        repositoryId: "repo-1",
        repository: "acme/gateway",
        commitSha: "2".repeat(40),
      },
      evidence: [],
      productionBatches: [
        {
          id: "batch-date",
          externalBatchId: "LOT-DATE",
          manufacturer: "Acme EMS",
          manufacturedOn: "2026-09-18",
          sourceSha256: "3".repeat(64),
        },
      ],
    });

    expect(graph.nodes.find((node) => node.id === "production_batch:batch-date")).toMatchObject({
      occurredAt: "2026-09-18",
      integrity: { sha256: "3".repeat(64) },
    });
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
