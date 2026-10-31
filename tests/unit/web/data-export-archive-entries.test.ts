import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ExportArchivePreflightError,
  prepareClaimedArchiveEntries,
} from "../../../apps/web/lib/data-export-archive-entries.js";

type Input = Parameters<typeof prepareClaimedArchiveEntries>[0];
const hash = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const slice = (data: unknown) => {
  const bytes = Buffer.from(
    JSON.stringify(
      data && typeof data === "object" && !Array.isArray(data)
        ? { formatVersion: 1, exportId: "export-1", ...data }
        : data,
    ),
  );
  return { bytes, byteLength: bytes.length, sha256: hash(bytes), contentType: "application/json" as const };
};

function fixture() {
  const bytes = Buffer.from("synthetic-only; never customer data");
  const object = {
    artifactId: "artifact_1",
    runId: "run_1",
    repositoryId: "repo_1",
    storagePath: "private/never-export-this-path",
    sha256: hash(bytes),
    byteLength: bytes.length,
  };
  const metadata = {
    id: object.artifactId,
    runId: object.runId,
    sha256: object.sha256,
    byteLength: object.byteLength,
  };
  const slices = {
    repositories: slice({
      coverage: "selected-installation-repositories-only",
      repositories: [{ repositoryId: "repo_1" }],
    }),
    records: slice({
      kind: "boardreadyops.claimed-run-finding-snapshot",
      runs: [{ id: "run_1", repositoryId: "repo_1" }],
      findings: [],
    }),
    reviewAudit: slice({ kind: "boardreadyops.claimed-review-audit-snapshot", reviews: [], auditEvents: [] }),
    reviewComments: slice({ kind: "boardreadyops.claimed-review-comments-snapshot", comments: [] }),
    reviewWorkflow: slice({ kind: "boardreadyops.claimed-review-workflow-snapshot", approvals: [] }),
    findingCollaboration: slice({ kind: "boardreadyops.claimed-finding-collaboration-snapshot", decisions: [] }),
    artifactMetadata: slice({ kind: "boardreadyops.claimed-artifact-metadata-snapshot", artifacts: [metadata] }),
  } as Input["slices"];
  return { input: { slices, verifiedObjects: [{ object, bytes }] } as Input, bytes, object, metadata };
}

describe("claimed archive entry preflight (not a deliverable archive)", () => {
  it("prepares seven metadata entries and exact digest-matched object bytes", () => {
    const { input, bytes, object } = fixture();
    const result = prepareClaimedArchiveEntries(input);
    expect(result.entries).toHaveLength(8);
    expect(result.entries.map((entry) => entry.path)).toEqual([
      "metadata/repositories.json",
      "metadata/runs-findings.json",
      "metadata/reviews-audit.json",
      "metadata/review-comments.json",
      "metadata/review-workflow.json",
      "metadata/finding-collaboration.json",
      "metadata/artifacts.json",
      "objects/artifact_1.bin",
    ]);
    expect(result.entries[7].bytes).toEqual(bytes);
    expect(result.entries[7].sha256).toBe(object.sha256);
    expect(result.totalBytes).toBe(result.entries.reduce((sum, entry) => sum + entry.byteLength, 0));
    expect(result.entries.every((entry) => entry.sha256 === hash(entry.bytes))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(object.storagePath);
    const expected = Buffer.from(bytes);
    input.verifiedObjects[0].bytes.fill(0);
    expect(result.entries[7].bytes).toEqual(expected);
  });

  it("permits a legitimate metadata-only snapshot with no artifacts", () => {
    const { input } = fixture();
    input.slices.artifactMetadata = slice({
      ...JSON.parse(input.slices.artifactMetadata.bytes.toString("utf8")),
      artifacts: [],
    });
    input.verifiedObjects = [];
    const result = prepareClaimedArchiveEntries(input);
    expect(result.entries).toHaveLength(7);
    expect(result.entries.every((entry) => entry.path.startsWith("metadata/"))).toBe(true);
  });

  it("rejects a mixed-export metadata set even when every slice has a valid digest", () => {
    const { input } = fixture();
    for (const key of [
      "repositories",
      "records",
      "reviewAudit",
      "reviewComments",
      "reviewWorkflow",
      "findingCollaboration",
      "artifactMetadata",
    ] as const) {
      const changed = JSON.parse(input.slices[key].bytes.toString("utf8")) as Record<string, unknown>;
      const wrong = slice({ ...changed, exportId: "another-export" });
      expect(() =>
        prepareClaimedArchiveEntries({
          ...input,
          slices: { ...input.slices, [key]: wrong },
        }),
      ).toThrow(ExportArchivePreflightError);
    }
    const missing = slice({ ...JSON.parse(input.slices.reviewAudit.bytes.toString("utf8")), exportId: null });
    expect(() =>
      prepareClaimedArchiveEntries({
        ...input,
        slices: { ...input.slices, reviewAudit: missing },
      }),
    ).toThrow(ExportArchivePreflightError);
  });

  it("rejects a swapped or wrongly versioned metadata slice with a valid digest and exportId", () => {
    const { input } = fixture();
    const swapped = { ...input.slices, reviewComments: input.slices.reviewAudit };
    expect(() => prepareClaimedArchiveEntries({ ...input, slices: swapped })).toThrow(ExportArchivePreflightError);
    const original = JSON.parse(input.slices.reviewWorkflow.bytes.toString("utf8")) as Record<string, unknown>;
    for (const header of [
      { ...original, kind: "boardreadyops.claimed-review-comments-snapshot" },
      { ...original, kind: null },
      { ...original, formatVersion: 2 },
      { ...original, formatVersion: null },
    ]) {
      expect(() =>
        prepareClaimedArchiveEntries({
          ...input,
          slices: { ...input.slices, reviewWorkflow: slice(header) },
        }),
      ).toThrow(ExportArchivePreflightError);
    }
  });

  it("rejects missing, additional and duplicate physical objects", () => {
    const { input } = fixture();
    for (const verifiedObjects of [
      [],
      [...input.verifiedObjects, input.verifiedObjects[0]],
      [
        ...input.verifiedObjects,
        { ...input.verifiedObjects[0], object: { ...input.verifiedObjects[0].object, artifactId: "extra" } },
      ],
    ]) {
      expect(() => prepareClaimedArchiveEntries({ ...input, verifiedObjects })).toThrow(ExportArchivePreflightError);
    }
  });

  it("rejects duplicate artifact metadata that hides an unused verified object", () => {
    const { input, metadata } = fixture();
    const extra = {
      ...input.verifiedObjects[0],
      object: { ...input.verifiedObjects[0].object, artifactId: "artifact_2" },
    };
    const duplicateMetadata = slice({ artifacts: [metadata, metadata] });
    expect(() =>
      prepareClaimedArchiveEntries({
        ...input,
        slices: { ...input.slices, artifactMetadata: duplicateMetadata },
        verifiedObjects: [...input.verifiedObjects, extra],
      }),
    ).toThrow(ExportArchivePreflightError);
  });

  it("fails closed when path, SHA-256, length, run or repository cannot be reconciled", () => {
    const { input } = fixture();
    const original = input.verifiedObjects[0];
    for (const change of [
      { object: { ...original.object, repositoryId: "foreign-repo" } },
      { object: { ...original.object, runId: "foreign-run" } },
      { object: { ...original.object, sha256: "f".repeat(64) } },
      { object: { ...original.object, byteLength: original.object.byteLength + 1 } },
      { bytes: Buffer.alloc(original.bytes.length) },
    ]) {
      expect(() =>
        prepareClaimedArchiveEntries({
          ...input,
          verifiedObjects: [{ ...original, ...change }],
        }),
      ).toThrow(ExportArchivePreflightError);
    }
  });

  it("rejects artifacts attached to out-of-scope runs or repositories", () => {
    const { input } = fixture();
    input.slices.records = slice({
      runs: [{ id: "run_1", repositoryId: "foreign-repo" }],
    }) as Input["slices"]["records"];
    expect(() => prepareClaimedArchiveEntries(input)).toThrow(ExportArchivePreflightError);
  });

  it("does not copy untrusted artifact identifiers into traversal-capable paths", () => {
    const { input } = fixture();
    for (const id of ["../other", "a/b", "a\\b", "", ".".repeat(129)]) {
      input.slices.artifactMetadata = slice({
        artifacts: [{ ...fixture().metadata, id }],
      }) as Input["slices"]["artifactMetadata"];
      expect(() => prepareClaimedArchiveEntries(input)).toThrow(ExportArchivePreflightError);
    }
  });

  it("rejects duplicate and malformed repository or run identifiers", () => {
    const { input } = fixture();
    for (const data of [
      {
        runs: [
          { id: "run_1", repositoryId: "repo_1" },
          { id: "run_1", repositoryId: "repo_1" },
        ],
      },
      { runs: [null] },
      { runs: "invalid" },
    ]) {
      const changed = { ...input.slices, records: slice(data) };
      expect(() => prepareClaimedArchiveEntries({ ...input, slices: changed })).toThrow(ExportArchivePreflightError);
    }
    const changed = { ...input.slices, repositories: slice({ repositories: null }) };
    expect(() => prepareClaimedArchiveEntries({ ...input, slices: changed })).toThrow(ExportArchivePreflightError);
  });

  it("requires authentic JSON metadata and never trusts an untyped payload", () => {
    const { input } = fixture();
    const badContentType = { ...input.slices.reviewAudit, contentType: "text/plain" } as Input["slices"]["reviewAudit"];
    expect(() =>
      prepareClaimedArchiveEntries({ ...input, slices: { ...input.slices, reviewAudit: badContentType } }),
    ).toThrow(ExportArchivePreflightError);
    const badShape = { ...input.slices, artifactMetadata: slice(null) };
    expect(() => prepareClaimedArchiveEntries({ ...input, slices: badShape })).toThrow(ExportArchivePreflightError);
  });

  it("rejects mutated, truncated or overbudget metadata", () => {
    const { input } = fixture();
    const original = input.slices.reviewAudit;
    const mutated = { ...original, bytes: Buffer.from(original.bytes) };
    mutated.bytes[0] ^= 1;
    expect(() => prepareClaimedArchiveEntries({ ...input, slices: { ...input.slices, reviewAudit: mutated } })).toThrow(
      ExportArchivePreflightError,
    );
    const wrongLength = { ...original, byteLength: original.byteLength + 1 };
    expect(() =>
      prepareClaimedArchiveEntries({ ...input, slices: { ...input.slices, reviewAudit: wrongLength } }),
    ).toThrow(ExportArchivePreflightError);
    const huge = slice({ blob: "x".repeat(256 * 1024) });
    expect(() => prepareClaimedArchiveEntries({ ...input, slices: { ...input.slices, reviewAudit: huge } })).toThrow(
      ExportArchivePreflightError,
    );
  });
});
