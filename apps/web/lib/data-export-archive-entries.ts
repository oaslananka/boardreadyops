import { createHash } from "node:crypto";
import type { ClaimedExportObject } from "@boardreadyops/db/data-export-object-authorization";
import type { prepareClaimedConsistentMetadataSlices } from "../../../packages/db/src/data-export-consistent-snapshot.js";

type ClaimedSlices = NonNullable<Awaited<ReturnType<typeof prepareClaimedConsistentMetadataSlices>>>;

export type VerifiedArchiveObject = {
  readonly object: ClaimedExportObject;
  /** Bytes already verified by the original claim-bound, post-IO authority check. */
  readonly bytes: Buffer;
};

export type PreparedArchiveEntry = {
  readonly path: string;
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly sha256: string;
};

/** This is an in-memory preflight, NOT a ZIP, delivered archive, or export authorization. */
export class ExportArchivePreflightError extends Error {
  constructor() {
    super("Claimed export archive inputs are incomplete, inconsistent or exceed safe limits.");
    this.name = "ExportArchivePreflightError";
  }
}

const maxMetadataBytes = 256 * 1024;
const maxArtifactCount = 100;
const maxTotalBytes = 64 * 1024 * 1024;
const safeEntryId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  [...value].every((char) => {
    const code = char.charCodeAt(0);
    return (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 45 ||
      code === 95
    );
  });
const digest = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function checkedMetadata(value: { bytes: Buffer; byteLength: number; sha256: string; contentType: string }): Buffer {
  if (
    !value ||
    !Buffer.isBuffer(value.bytes) ||
    value.bytes.length === 0 ||
    value.bytes.length > maxMetadataBytes ||
    value.byteLength !== value.bytes.length ||
    value.sha256 !== digest(value.bytes) ||
    value.contentType !== "application/json"
  ) {
    throw new ExportArchivePreflightError();
  }
  return value.bytes;
}

function decoded<T>(bytes: Buffer | undefined): T {
  if (!Buffer.isBuffer(bytes)) throw new ExportArchivePreflightError();
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    throw new ExportArchivePreflightError();
  }
}

/**
 * Validate the one-to-one relationship between seven claim-scoped metadata
 * slices and the *already verified* physical objects. Fail closed on any
 * omitted, additional, tampered or out-of-repository artifact. This does not
 * reauthorize the claim, read storage, build an archive or publish anything.
 */
export function prepareClaimedArchiveEntries(input: {
  slices: ClaimedSlices;
  verifiedObjects: readonly VerifiedArchiveObject[];
}): { entries: readonly PreparedArchiveEntry[]; totalBytes: number } {
  if (!input?.slices || !Array.isArray(input.verifiedObjects)) {
    throw new ExportArchivePreflightError();
  }
  const metadata = [
    ["metadata/repositories.json", input.slices.repositories],
    ["metadata/runs-findings.json", input.slices.records],
    ["metadata/reviews-audit.json", input.slices.reviewAudit],
    ["metadata/review-comments.json", input.slices.reviewComments],
    ["metadata/review-workflow.json", input.slices.reviewWorkflow],
    ["metadata/finding-collaboration.json", input.slices.findingCollaboration],
    ["metadata/artifacts.json", input.slices.artifactMetadata],
  ] as const;

  const entryBytes: Array<{ path: string; bytes: Buffer }> = metadata.map(([path, content]) => ({
    path,
    bytes: checkedMetadata(content),
  }));
  // A valid hash or exportId does not establish the meaning of each blob.
  // Bind every slot to the versioned schema emitted by its snapshot builder,
  // so valid but mislabelled review/audit evidence cannot be silently swapped.
  const expectedKinds = [
    null, // Repository inventory has a coverage label instead of a kind.
    "boardreadyops.claimed-run-finding-snapshot",
    "boardreadyops.claimed-review-audit-snapshot",
    "boardreadyops.claimed-review-comments-snapshot",
    "boardreadyops.claimed-review-workflow-snapshot",
    "boardreadyops.claimed-finding-collaboration-snapshot",
    "boardreadyops.claimed-artifact-metadata-snapshot",
  ] as const;
  const headers = entryBytes.map((entry) =>
    decoded<{ formatVersion?: unknown; kind?: unknown; coverage?: unknown }>(entry.bytes),
  );
  if (
    headers.some(
      (header, index) =>
        header?.formatVersion !== 1 ||
        (index === 0
          ? header.coverage !== "selected-installation-repositories-only"
          : header.kind !== expectedKinds[index]),
    )
  ) {
    throw new ExportArchivePreflightError();
  }
  // The seven slices carry an exportId independently. A valid digest alone
  // must never permit content from two different export reservations to be
  // spliced into one archive, even when repository/run IDs happen to match.
  const claimedExportIds = entryBytes.map((entry) => decoded<{ exportId?: unknown }>(entry.bytes)?.exportId);
  const exportId = claimedExportIds[0];
  if (
    typeof exportId !== "string" ||
    exportId.length === 0 ||
    exportId.length > 256 ||
    exportId.trim() !== exportId ||
    claimedExportIds.some((id) => id !== exportId)
  ) {
    throw new ExportArchivePreflightError();
  }
  const inventory = decoded<{ repositories: Array<{ repositoryId: string }> }>(entryBytes[0]?.bytes);
  const records = decoded<{
    runs: Array<{ id: string; repositoryId: string }>;
    findings: Array<{ id: string; runId: string }>;
  }>(entryBytes[1]?.bytes);
  const artifacts = decoded<{
    artifacts: Array<{ id: string; runId: string; sha256: string; byteLength: number }>;
  }>(entryBytes[6]?.bytes);
  if (
    !Array.isArray(inventory?.repositories) ||
    !Array.isArray(records?.runs) ||
    !Array.isArray(records?.findings) ||
    !Array.isArray(artifacts?.artifacts) ||
    records.runs.length > 100 ||
    records.findings.length > 100 ||
    artifacts.artifacts.length > maxArtifactCount ||
    input.verifiedObjects.length !== artifacts.artifacts.length
  ) {
    throw new ExportArchivePreflightError();
  }

  if (
    inventory.repositories.some((item) => !item || !safeEntryId(item.repositoryId)) ||
    records.runs.some((item) => !item || !safeEntryId(item.id) || !safeEntryId(item.repositoryId))
  ) {
    throw new ExportArchivePreflightError();
  }
  const permittedRepositories = new Set(inventory.repositories.map((item) => item.repositoryId));
  const runs = new Map(records.runs.map((item) => [item.id, item.repositoryId]));
  if (
    runs.size !== records.runs.length ||
    permittedRepositories.size !== inventory.repositories.length ||
    records.runs.some((run) => !permittedRepositories.has(run.repositoryId))
  ) {
    throw new ExportArchivePreflightError();
  }
  const findingIds = new Set<string>();
  for (const finding of records.findings) {
    if (
      !safeEntryId(finding?.id) ||
      !safeEntryId(finding.runId) ||
      !runs.has(finding.runId) ||
      findingIds.has(finding.id)
    ) {
      throw new ExportArchivePreflightError();
    }
    findingIds.add(finding.id);
  }
  const verified = new Map<string, VerifiedArchiveObject>();
  for (const candidate of input.verifiedObjects) {
    if (!candidate || !safeEntryId(candidate.object?.artifactId) || verified.has(candidate.object.artifactId)) {
      throw new ExportArchivePreflightError();
    }
    verified.set(candidate.object.artifactId, candidate);
  }

  const includedArtifactIds = new Set<string>();
  for (const artifact of artifacts.artifacts) {
    if (!safeEntryId(artifact?.id) || !safeEntryId(artifact.runId) || includedArtifactIds.has(artifact.id)) {
      throw new ExportArchivePreflightError();
    }
    includedArtifactIds.add(artifact.id);
    const candidate = verified.get(artifact.id);
    const repository = runs.get(artifact.runId);
    if (
      !candidate ||
      !repository ||
      !permittedRepositories.has(repository) ||
      candidate.object.runId !== artifact.runId ||
      candidate.object.repositoryId !== repository ||
      candidate.object.sha256 !== artifact.sha256 ||
      candidate.object.byteLength !== artifact.byteLength ||
      !Buffer.isBuffer(candidate.bytes) ||
      candidate.bytes.length !== artifact.byteLength ||
      digest(candidate.bytes) !== artifact.sha256
    ) {
      throw new ExportArchivePreflightError();
    }
    entryBytes.push({ path: `objects/${artifact.id}.bin`, bytes: candidate.bytes });
  }

  let totalBytes = 0;
  for (const entry of entryBytes) {
    totalBytes += entry.bytes.length;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxTotalBytes) {
      throw new ExportArchivePreflightError();
    }
  }
  // Isolate the staged bytes from mutations of the caller's buffers.
  const entries = entryBytes.map(({ path, bytes }) => {
    const owned = Buffer.from(bytes);
    return { path, bytes: owned, byteLength: owned.length, sha256: digest(owned) };
  });
  return { entries, totalBytes };
}
