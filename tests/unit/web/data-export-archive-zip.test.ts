import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ExportArchivePreflightError } from "../../../apps/web/lib/data-export-archive-entries.js";
import { prepareClaimedArchiveZip } from "../../../apps/web/lib/data-export-archive-zip.js";
import { sanitizeAndExtractArchive } from "../../../packages/cloud-core/src/archive-sanitizer.js";

type ZipInput = Parameters<typeof prepareClaimedArchiveZip>[0];
const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
const slice = (value: unknown) => {
  const bytes = Buffer.from(
    JSON.stringify(
      value && typeof value === "object" && !Array.isArray(value)
        ? { formatVersion: 1, exportId: "export-1", ...value }
        : value,
    ),
  );
  return { bytes, byteLength: bytes.length, sha256: sha256(bytes), contentType: "application/json" as const };
};
function fixture() {
  const bytes = Buffer.from("synthetic export bytes; not customer data");
  const artifact = {
    artifactId: "artifact_1",
    runId: "run_1",
    repositoryId: "repo_1",
    storagePath: "private/never-include-this-path",
    sha256: sha256(bytes),
    byteLength: bytes.length,
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
    reviewAudit: slice({
      kind: "boardreadyops.claimed-review-audit-snapshot",
      reviews: [],
      revisions: [],
      auditEvents: [],
    }),
    reviewComments: slice({ kind: "boardreadyops.claimed-review-comments-snapshot", comments: [] }),
    reviewWorkflow: slice({
      kind: "boardreadyops.claimed-review-workflow-snapshot",
      approvals: [],
      checklistItems: [],
    }),
    findingCollaboration: slice({
      kind: "boardreadyops.claimed-finding-collaboration-snapshot",
      decisions: [],
      assignments: [],
    }),
    artifactMetadata: slice({
      kind: "boardreadyops.claimed-artifact-metadata-snapshot",
      artifacts: [
        { id: artifact.artifactId, runId: artifact.runId, sha256: artifact.sha256, byteLength: bytes.length },
      ],
    }),
  } as ZipInput["slices"];
  return { input: { slices, verifiedObjects: [{ object: artifact, bytes }] } as ZipInput, bytes, artifact };
}

describe("bounded, internal claim-scoped ZIP packaging", () => {
  it("creates deterministic, independently extractable bytes with seven metadata entries and the exact object", () => {
    const { input, bytes, artifact } = fixture();
    const first = prepareClaimedArchiveZip(input);
    const second = prepareClaimedArchiveZip(input);
    expect(first).toEqual(second);
    expect(first.sha256).toBe(sha256(first.bytes));
    expect(first.byteLength).toBe(first.bytes.length);
    expect(first.files).toBe(8);
    const result = sanitizeAndExtractArchive(first.bytes);
    expect(result.fileCount).toBe(8);
    const files = new Map(result.files.map(({ path, data }) => [path, data]));
    expect(files.get("objects/artifact_1.bin")).toEqual(bytes);
    expect(JSON.parse(files.get("metadata/repositories.json")?.toString("utf8") ?? "{}")).toEqual({
      formatVersion: 1,
      exportId: "export-1",
      coverage: "selected-installation-repositories-only",
      repositories: [{ repositoryId: "repo_1" }],
    });
    expect([...files.keys()].filter((name) => name.startsWith("metadata/"))).toHaveLength(7);
    expect([...files.keys()].every((path) => !path.includes("..") && !path.includes("\\"))).toBe(true);
    expect(JSON.stringify([...files.keys()])).not.toContain(artifact.storagePath);
  });

  it("can assemble a metadata-only ZIP without inventing artifact content", () => {
    const { input } = fixture();
    input.slices.artifactMetadata = slice({
      ...JSON.parse(input.slices.artifactMetadata.bytes.toString("utf8")),
      artifacts: [],
    });
    input.verifiedObjects = [];
    const prepared = prepareClaimedArchiveZip(input);
    expect(prepared.files).toBe(7);
    const extracted = sanitizeAndExtractArchive(prepared.bytes);
    expect(extracted.files.every(({ path }) => path.startsWith("metadata/"))).toBe(true);
  });

  it("rejects modified artifact bytes and out-of-scope run references before producing ZIP", () => {
    const { input } = fixture();
    input.verifiedObjects[0].bytes[0] ^= 1;
    expect(() => prepareClaimedArchiveZip(input)).toThrow(ExportArchivePreflightError);
    const next = fixture();
    next.input.slices.records = slice({ runs: [{ id: "run_1", repositoryId: "other-repo" }] });
    expect(() => prepareClaimedArchiveZip(next.input)).toThrow(ExportArchivePreflightError);
  });

  it("does not treat missing/extra objects or tampered metadata as a publishable ZIP", () => {
    const { input } = fixture();
    expect(() => prepareClaimedArchiveZip({ ...input, verifiedObjects: [] })).toThrow(ExportArchivePreflightError);
    const bad = { ...input.slices, reviewAudit: { ...input.slices.reviewAudit, sha256: "f".repeat(64) } };
    expect(() => prepareClaimedArchiveZip({ ...input, slices: bad })).toThrow(ExportArchivePreflightError);
  });
});
