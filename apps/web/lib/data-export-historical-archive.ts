import { createHash } from "node:crypto";
import { sanitizeAndExtractArchive } from "@boardreadyops/cloud-core/archive-sanitizer";
import {
  checkHistoricalUserArchivePrepublication,
  lookupHistoricalUserExportObject,
  releaseHistoricalUserObjectBatch,
  reserveHistoricalUserObjectBatch,
} from "@boardreadyops/db/data-export-historical-object-authorization";
import { prepareVerifiedHistoricalUserCompositePreflight } from "../../../packages/db/src/data-export-historical-inventory.js";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";
import { createZipBuffer } from "../../../src/util/zip.js";
import type { readVerifiedHistoricalUserLocalObject } from "./data-export-historical-object.js";
import { readVerifiedLocalExportObject } from "./data-export-local-object.js";

const maxSnapshotBytes = 256 * 1024;
const maxArchiveBytes = 64 * 1024 * 1024;
const maxReceiptBytes = 32 * 1024;
const maxObjects = 100;
const metadataPath = "metadata/historical-core.json";
const receiptPath = "metadata/historical-integrity.json";
const visualEvidencePath = "metadata/historical-private-visual-evidence.json";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const objectPath = /^objects\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.bin$/u;
const sha256 = /^[0-9a-f]{64}$/u;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const fixedTime = new Date(1980, 0, 1);

export class HistoricalUserArchivePreflightError extends Error {
  constructor() {
    super("Historical user partial archive cannot be safely prepared or verified.");
    this.name = "HistoricalUserArchivePreflightError";
  }
}

type Artifact = { id: string; runId: string; sha256: string; byteLength: number; retentionExpired: boolean };
type Run = { id: string; repositoryId: string };
type Repository = { repositoryId: string };
type FindingDecision = {
  id: string;
  repositoryId: string;
  reviewId: string;
  findingFingerprint: string;
  disposition: string;
  reason: string;
  evidenceDigest: string;
  expiresAt: string | null;
  ownerIncluded: false;
  actorIncluded: false;
};
type FindingAssignment = {
  id: string;
  repositoryId: string;
  reviewId: string;
  findingFingerprint: string;
  assigneeIncluded: false;
  assignedByIncluded: false;
};
type ExcludedSourceClassCounts = {
  runSnapshots: number;
  apiTokens: number;
  runnerRegistrations: number;
  installationComponentCredentials: number;
  installationComponentObservations: number;
};
const excludedSourceClassNames = [
  "runSnapshots",
  "apiTokens",
  "runnerRegistrations",
  "installationComponentCredentials",
  "installationComponentObservations",
] as const;
type RedactedAuditFieldCounts = {
  installationActorIdentities: number;
  installationSubjectIdentifiers: number;
  installationRequestIdentifiers: number;
  installationPrivateMetadata: number;
  repositoryActorIdentities: number;
  repositorySubjectIdentifiers: number;
  repositoryRequestIdentifiers: number;
  repositoryPrivateMetadata: number;
};
const redactedAuditCountKeys = [
  "installationActorIdentities",
  "installationSubjectIdentifiers",
  "installationRequestIdentifiers",
  "installationPrivateMetadata",
  "repositoryActorIdentities",
  "repositorySubjectIdentifiers",
  "repositoryRequestIdentifiers",
  "repositoryPrivateMetadata",
] as const;
type HistoricalAuditDescriptor = {
  id: string;
  eventType: string;
  actorType: string;
  subjectType: string;
  actorDetailsIncluded: false;
  subjectDetailsIncluded: false;
  requestIdIncluded: false;
  metadataIncluded: false;
};
type HistoricalRepositoryAuditDescriptor = HistoricalAuditDescriptor & {
  repositoryId: string;
  releaseRunId: string | null;
};
const knownActorClasses = new Set(["system", "github_webhook", "internal", "guest", "runner", "redacted"]);
const auditEventLabel = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

type HistoricalSnapshot = {
  kind: string;
  formatVersion: number;
  exportId: string;
  completeCustomerExport: false;
  coverage: string;
  exclusions: string[];
  artifacts: Artifact[];
  runs: Run[];
  repositories: Repository[];
  reviews: Array<{ id: string; repositoryId: string }>;
  findingDecisions: FindingDecision[];
  findingAssignments: FindingAssignment[];
  excludedSourceClassCounts: ExcludedSourceClassCounts;
  redactedAuditFieldCounts: RedactedAuditFieldCounts;
  installationAuditEvents: HistoricalAuditDescriptor[];
  auditEvents: HistoricalRepositoryAuditDescriptor[];
};
export type VerifiedHistoricalArchiveObject = NonNullable<
  Awaited<ReturnType<typeof readVerifiedHistoricalUserLocalObject>>
>;

// An explicit, deny-by-default schema prevents a future source query from
// silently adding actor IDs, credentials, private anchors or other sensitive
// properties to the ZIP. Updating this contract requires a privacy review.
const coreExclusions = [
  "managed-artifact-bytes",
  "review-comment-author-identities",
  "review-approval-actor-identities",
  "review-checklist-completion-actor-identities",
  "finding-decision-owner-and-actor-identities",
  "finding-assignment-assignee-and-assigner-identities",
  "audit-metadata",
  "run-snapshot-private-visual-content",
  "api-token-hashes-prefixes-and-creator-identities",
  "runner-registration-identifiers",
  "installation-credential-envelopes",
  "installation-component-observation-data",
  "unverifiable-tenant-only-policy-and-billing-records",
  "platform-storage",
  "github-actions-source-logs",
  "unverified-collaboration-and-finding-free-text",
  "unverified-repository-review-and-artifact-identifying-metadata",
] as const;

const coreRowSchemas = {
  repositories: ["repositoryId", "githubRepositoryId", "owner", "name", "private", "disabled"],
  runs: ["id", "repositoryId", "commitSha", "ref", "status", "decision"],
  findings: ["id", "runId", "ruleId", "severity", "message", "path", "kind"],
  artifacts: [
    "id",
    "runId",
    "kind",
    "name",
    "role",
    "sha256",
    "byteLength",
    "contentType",
    "retentionExpired",
    "contentsVerified",
    "downloadAvailable",
  ],
  reviews: ["id", "repositoryId", "headRunId", "title", "status", "decision"],
  revisions: ["id", "reviewId", "sequence", "headRunId", "baseRunId", "headCommitSha", "evidenceDigest"],
  reviewComments: [
    "id",
    "repositoryId",
    "reviewId",
    "parentId",
    "status",
    "authorType",
    "content",
    "findingFingerprint",
    "evidenceAnchor",
    "contentIncluded",
    "authorIdIncluded",
  ],
  reviewApprovals: [
    "id",
    "repositoryId",
    "reviewId",
    "revisionId",
    "status",
    "evidenceDigest",
    "reason",
    "invalidationReason",
    "isBreakGlass",
    "actorIncluded",
  ],
  reviewChecklist: ["id", "repositoryId", "reviewId", "completed", "title", "titleIncluded", "completedByIncluded"],
  findingDecisions: [
    "id",
    "repositoryId",
    "reviewId",
    "findingFingerprint",
    "disposition",
    "reason",
    "evidenceDigest",
    "expiresAt",
    "ownerIncluded",
    "actorIncluded",
  ],
  findingAssignments: [
    "id",
    "repositoryId",
    "reviewId",
    "findingFingerprint",
    "assigneeIncluded",
    "assignedByIncluded",
  ],
  installationAuditEvents: [
    "id",
    "eventType",
    "actorType",
    "subjectType",
    "actorDetailsIncluded",
    "subjectDetailsIncluded",
    "requestIdIncluded",
    "metadataIncluded",
  ],
  auditEvents: [
    "id",
    "repositoryId",
    "releaseRunId",
    "eventType",
    "actorType",
    "subjectType",
    "actorDetailsIncluded",
    "subjectDetailsIncluded",
    "requestIdIncluded",
    "metadataIncluded",
  ],
} as const;
const exactKeys = (value: unknown, names: readonly string[]): boolean =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));

function checkCorePrivacySchema(value: unknown): boolean {
  const fields = [
    "formatVersion",
    "kind",
    "coverage",
    "completeCustomerExport",
    "exportId",
    "exclusions",
    "excludedSourceClassCounts",
    "redactedAuditFieldCounts",
    ...Object.keys(coreRowSchemas),
  ];
  if (!exactKeys(value, fields)) return false;
  const core = value as Record<string, unknown>;
  if (JSON.stringify(core.exclusions) !== JSON.stringify(coreExclusions)) return false;
  const flagRules: Array<[string, string, boolean]> = [
    ["artifacts", "contentsVerified", false],
    ["artifacts", "downloadAvailable", false],
    ["reviewComments", "contentIncluded", false],
    ["reviewComments", "authorIdIncluded", false],
    ["reviewApprovals", "actorIncluded", false],
    ["reviewChecklist", "titleIncluded", false],
    ["reviewChecklist", "completedByIncluded", false],
    ["findingDecisions", "ownerIncluded", false],
    ["findingDecisions", "actorIncluded", false],
    ["findingAssignments", "assigneeIncluded", false],
    ["findingAssignments", "assignedByIncluded", false],
  ];
  // A future exporter change must not republish these data fields even
  // after an attacker recomputes the ZIP and receipt digests.
  const privateTextRules: Array<[string, string, unknown]> = [
    ["repositories", "owner", ""],
    ["repositories", "name", ""],
    ["runs", "ref", ""],
    ["findings", "message", ""],
    ["findings", "path", null],
    ["artifacts", "name", ""],
    ["reviews", "title", ""],
    ["reviewComments", "evidenceAnchor", null],
    ["reviewComments", "content", ""],
    ["reviewApprovals", "reason", null],
    ["reviewApprovals", "invalidationReason", null],
    ["reviewChecklist", "title", ""],
    ["findingDecisions", "reason", ""],
  ];
  return Object.entries(coreRowSchemas).every(([name, keys]) => {
    const rows = core[name];
    return (
      Array.isArray(rows) &&
      rows.length <= maxObjects &&
      rows.every(
        (row: unknown) =>
          exactKeys(row, keys) &&
          flagRules
            .filter(([className]) => className === name)
            .every(([, flag, expected]) => (row as Record<string, unknown>)[flag] === expected) &&
          privateTextRules
            .filter(([className]) => className === name)
            .every(([, field, expected]) => (row as Record<string, unknown>)[field] === expected),
      )
    );
  });
}

function validateSnapshotEnvelope(snapshot: HistoricalSnapshot): void {
  if (
    !checkCorePrivacySchema(snapshot) ||
    snapshot?.kind !== "boardreadyops.historical-user-consistent-core-preflight" ||
    snapshot.formatVersion !== 1 ||
    snapshot.completeCustomerExport !== false ||
    !uuid.test(snapshot.exportId) ||
    snapshot.coverage !== "retained-suspended-user-installation-core-and-scoped-audit-descriptors-only" ||
    !Array.isArray(snapshot.exclusions) ||
    !snapshot.exclusions.includes("managed-artifact-bytes") ||
    !snapshot.exclusions.includes("finding-decision-owner-and-actor-identities") ||
    !snapshot.exclusions.includes("finding-assignment-assignee-and-assigner-identities") ||
    !snapshot.exclusions.includes("audit-metadata") ||
    !snapshot.exclusions.includes("run-snapshot-private-visual-content") ||
    !snapshot.exclusions.includes("api-token-hashes-prefixes-and-creator-identities") ||
    !snapshot.exclusions.includes("runner-registration-identifiers") ||
    !snapshot.exclusions.includes("installation-credential-envelopes") ||
    !snapshot.exclusions.includes("installation-component-observation-data") ||
    !snapshot.exclusions.includes("unverifiable-tenant-only-policy-and-billing-records") ||
    !Array.isArray(snapshot.reviews) ||
    !Array.isArray(snapshot.installationAuditEvents) ||
    !Array.isArray(snapshot.auditEvents) ||
    snapshot.installationAuditEvents.length > maxObjects ||
    snapshot.auditEvents.length > maxObjects ||
    !Array.isArray(snapshot.findingDecisions) ||
    !Array.isArray(snapshot.findingAssignments) ||
    snapshot.reviews.length > maxObjects ||
    snapshot.findingDecisions.length > maxObjects ||
    snapshot.findingAssignments.length > maxObjects ||
    !Array.isArray(snapshot.repositories) ||
    !Array.isArray(snapshot.runs) ||
    !Array.isArray(snapshot.artifacts) ||
    snapshot.repositories.length > maxObjects ||
    snapshot.runs.length > maxObjects ||
    snapshot.artifacts.length > maxObjects
  )
    throw new HistoricalUserArchivePreflightError();
}

function validateSnapshotCounters(snapshot: HistoricalSnapshot): void {
  const excluded = snapshot.excludedSourceClassCounts;
  if (
    !excluded ||
    typeof excluded !== "object" ||
    Array.isArray(excluded) ||
    !exactKeys(excluded, excludedSourceClassNames) ||
    excludedSourceClassNames.some(
      (key) => !Number.isSafeInteger(excluded[key]) || excluded[key] < 0 || excluded[key] > maxObjects,
    )
  )
    throw new HistoricalUserArchivePreflightError();
  const redacted = snapshot.redactedAuditFieldCounts;
  if (
    !redacted ||
    typeof redacted !== "object" ||
    Array.isArray(redacted) ||
    !exactKeys(redacted, redactedAuditCountKeys) ||
    redactedAuditCountKeys.some(
      (key) =>
        !Number.isSafeInteger(redacted[key]) ||
        redacted[key] < 0 ||
        redacted[key] >
          (key.startsWith("installation") ? snapshot.installationAuditEvents.length : snapshot.auditEvents.length),
    )
  )
    throw new HistoricalUserArchivePreflightError();
}

function validateSnapshotOwnership(snapshot: HistoricalSnapshot): {
  runs: Map<string, string>;
  reviews: Map<string, string>;
} {
  const allowedEventKeys = [
    "id",
    "eventType",
    "actorType",
    "subjectType",
    "actorDetailsIncluded",
    "subjectDetailsIncluded",
    "requestIdIncluded",
    "metadataIncluded",
  ];
  const allowedRepositoryEventKeys = [...allowedEventKeys, "repositoryId", "releaseRunId"];
  const validAudit = (audit: HistoricalAuditDescriptor, keys: string[]): boolean =>
    audit &&
    typeof audit === "object" &&
    !Array.isArray(audit) &&
    exactKeys(audit, keys) &&
    uuid.test(audit.id) &&
    typeof audit.eventType === "string" &&
    audit.eventType.length <= 160 &&
    auditEventLabel.test(audit.eventType) &&
    knownActorClasses.has(audit.actorType) &&
    typeof audit.subjectType === "string" &&
    audit.subjectType.length <= 64 &&
    auditEventLabel.test(audit.subjectType) &&
    audit.actorDetailsIncluded === false &&
    audit.subjectDetailsIncluded === false &&
    audit.requestIdIncluded === false &&
    audit.metadataIncluded === false;
  if (
    snapshot.installationAuditEvents.some((audit) => !validAudit(audit, allowedEventKeys)) ||
    snapshot.auditEvents.some((audit) => !validAudit(audit, allowedRepositoryEventKeys)) ||
    new Set(snapshot.installationAuditEvents.map((audit) => audit.id)).size !==
      snapshot.installationAuditEvents.length ||
    new Set(snapshot.auditEvents.map((audit) => audit.id)).size !== snapshot.auditEvents.length
  )
    throw new HistoricalUserArchivePreflightError();

  const repositories = new Set<string>();
  for (const repository of snapshot.repositories) {
    if (!uuid.test(repository?.repositoryId) || repositories.has(repository.repositoryId)) {
      throw new HistoricalUserArchivePreflightError();
    }
    repositories.add(repository.repositoryId);
  }
  const runs = new Map<string, string>();
  for (const run of snapshot.runs) {
    if (!uuid.test(run?.id) || !repositories.has(run?.repositoryId) || runs.has(run.id)) {
      throw new HistoricalUserArchivePreflightError();
    }
    runs.set(run.id, run.repositoryId);
  }
  for (const audit of snapshot.auditEvents) {
    if (
      !repositories.has(audit.repositoryId) ||
      (audit.releaseRunId !== null && runs.get(audit.releaseRunId) !== audit.repositoryId)
    )
      throw new HistoricalUserArchivePreflightError();
  }
  const reviews = new Map<string, string>();
  for (const review of snapshot.reviews) {
    if (!uuid.test(review?.id) || !repositories.has(review?.repositoryId) || reviews.has(review.id)) {
      throw new HistoricalUserArchivePreflightError();
    }
    reviews.set(review.id, review.repositoryId);
  }
  return { runs, reviews };
}

function validateSnapshotRows(
  snapshot: HistoricalSnapshot,
  runs: Map<string, string>,
  reviews: Map<string, string>,
): void {
  const validFingerprint = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 2048;
  const validRowId = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value;
  const decisions = new Set<string>();
  for (const decision of snapshot.findingDecisions) {
    if (
      !validRowId(decision?.id) ||
      decisions.has(decision.id) ||
      reviews.get(decision.reviewId) !== decision.repositoryId ||
      !validFingerprint(decision.findingFingerprint) ||
      !["accepted_risk", "false_positive", "mitigated", "fix_required", "deferred"].includes(decision.disposition) ||
      typeof decision.reason !== "string" ||
      Buffer.byteLength(decision.reason, "utf8") > 4096 ||
      !sha256.test(decision.evidenceDigest) ||
      (decision.expiresAt !== null &&
        (typeof decision.expiresAt !== "string" || !Number.isFinite(Date.parse(decision.expiresAt)))) ||
      decision.ownerIncluded !== false ||
      decision.actorIncluded !== false ||
      Object.hasOwn(decision, "owner") ||
      Object.hasOwn(decision, "actorId")
    )
      throw new HistoricalUserArchivePreflightError();
    decisions.add(decision.id);
  }
  const assignments = new Set<string>();
  for (const assignment of snapshot.findingAssignments) {
    if (
      !validRowId(assignment?.id) ||
      assignments.has(assignment.id) ||
      reviews.get(assignment.reviewId) !== assignment.repositoryId ||
      !validFingerprint(assignment.findingFingerprint) ||
      assignment.assigneeIncluded !== false ||
      assignment.assignedByIncluded !== false ||
      Object.hasOwn(assignment, "assignee") ||
      Object.hasOwn(assignment, "assignedBy")
    )
      throw new HistoricalUserArchivePreflightError();
    assignments.add(assignment.id);
  }
  const artifactIds = new Set<string>();
  for (const artifact of snapshot.artifacts) {
    if (
      !uuid.test(artifact?.id) ||
      !runs.has(artifact.runId) ||
      !sha256.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.byteLength) ||
      artifact.byteLength < 0 ||
      artifact.byteLength > maxArchiveBytes ||
      typeof artifact.retentionExpired !== "boolean" ||
      artifact.retentionExpired ||
      artifactIds.has(artifact.id)
    )
      throw new HistoricalUserArchivePreflightError();
    artifactIds.add(artifact.id);
  }
}

function parseSnapshot(input: { bytes: Buffer; sha256: string; byteLength: number }): HistoricalSnapshot {
  if (
    !Buffer.isBuffer(input?.bytes) ||
    input.bytes.length === 0 ||
    input.bytes.length > maxSnapshotBytes ||
    input.byteLength !== input.bytes.length ||
    !sha256.test(input.sha256) ||
    digest(input.bytes) !== input.sha256
  )
    throw new HistoricalUserArchivePreflightError();
  let snapshot: HistoricalSnapshot;
  try {
    snapshot = JSON.parse(input.bytes.toString("utf8")) as HistoricalSnapshot;
  } catch {
    throw new HistoricalUserArchivePreflightError();
  }
  validateSnapshotEnvelope(snapshot);
  validateSnapshotCounters(snapshot);
  const { runs, reviews } = validateSnapshotOwnership(snapshot);
  validateSnapshotRows(snapshot, runs, reviews);
  return snapshot;
}

type HistoricalVisualEvidenceBytes = {
  bytes: Buffer;
  sha256: string;
  byteLength: number;
  visualCount: number;
};

// A private manifest of SHA-verifiable visual evidence, never actual SVG.
function checkedVisualEvidence(snapshot: HistoricalSnapshot, evidence: HistoricalVisualEvidenceBytes): Buffer {
  if (
    !evidence ||
    !Buffer.isBuffer(evidence.bytes) ||
    evidence.bytes.length < 1 ||
    evidence.bytes.length > maxSnapshotBytes ||
    evidence.byteLength !== evidence.bytes.length ||
    !sha256.test(evidence.sha256) ||
    digest(evidence.bytes) !== evidence.sha256 ||
    !Number.isSafeInteger(evidence.visualCount) ||
    evidence.visualCount !== snapshot.excludedSourceClassCounts.runSnapshots
  )
    throw new HistoricalUserArchivePreflightError();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(evidence.bytes.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new HistoricalUserArchivePreflightError();
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !exactKeys(parsed, [
      "kind",
      "formatVersion",
      "exportId",
      "completeCustomerExport",
      "contentIncluded",
      "exclusions",
      "visuals",
    ]) ||
    parsed.kind !== "boardreadyops.historical-user-private-visual-evidence-preflight" ||
    parsed.formatVersion !== 1 ||
    parsed.exportId !== snapshot.exportId ||
    parsed.completeCustomerExport !== false ||
    parsed.contentIncluded !== false ||
    JSON.stringify(parsed.exclusions) !==
      JSON.stringify([
        "visual-svg-content",
        "visual-anchors-and-rendering-metadata",
        "non-svg-visual-formats-unverified",
        "actor-and-audit-identities",
      ]) ||
    !Array.isArray(parsed.visuals) ||
    parsed.visuals.length !== evidence.visualCount
  )
    throw new HistoricalUserArchivePreflightError();

  const repositories = new Set(snapshot.repositories.map((r) => r.repositoryId));
  const runs = new Map(snapshot.runs.map((r) => [r.id, r.repositoryId]));
  const ids = new Set<string>();
  let previousId = "";
  let totalBytes = 0;
  for (const item of parsed.visuals) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HistoricalUserArchivePreflightError();
    }
    const visual = item as Record<string, unknown>;
    if (
      !exactKeys(visual, ["id", "runId", "repositoryId", "kind", "format", "sha256", "byteLength"]) ||
      typeof visual.id !== "string" ||
      !uuid.test(visual.id) ||
      ids.has(visual.id) ||
      visual.id <= previousId ||
      typeof visual.runId !== "string" ||
      !uuid.test(visual.runId) ||
      !repositories.has(visual.repositoryId as string) ||
      runs.get(visual.runId) !== visual.repositoryId ||
      !["schematic", "pcb_layer", "3d_render"].includes(String(visual.kind)) ||
      visual.format !== "svg" ||
      typeof visual.sha256 !== "string" ||
      !sha256.test(visual.sha256) ||
      !Number.isSafeInteger(visual.byteLength) ||
      (visual.byteLength as number) < 1 ||
      (visual.byteLength as number) > 262144
    )
      throw new HistoricalUserArchivePreflightError();
    ids.add(visual.id);
    previousId = visual.id;
    totalBytes += visual.byteLength as number;
    if (totalBytes > 4 * 1024 * 1024) throw new HistoricalUserArchivePreflightError();
  }
  return Buffer.from(evidence.bytes);
}

function checkedObjectEntries(
  snapshot: HistoricalSnapshot,
  objects: readonly VerifiedHistoricalArchiveObject[],
): Array<{ name: string; data: Buffer; store: boolean }> {
  if (!Array.isArray(objects) || objects.length !== snapshot.artifacts.length || objects.length > maxObjects) {
    throw new HistoricalUserArchivePreflightError();
  }
  const byId = new Map<string, VerifiedHistoricalArchiveObject>();
  for (const object of objects) {
    if (!object || !uuid.test(object.artifactId) || byId.has(object.artifactId)) {
      throw new HistoricalUserArchivePreflightError();
    }
    byId.set(object.artifactId, object);
  }
  const runRepositories = new Map(snapshot.runs.map((run) => [run.id, run.repositoryId]));
  return snapshot.artifacts.map((artifact) => {
    const object = byId.get(artifact.id);
    if (
      !object ||
      object.exportId !== snapshot.exportId ||
      object.runId !== artifact.runId ||
      object.repositoryId !== runRepositories.get(artifact.runId) ||
      object.sha256 !== artifact.sha256 ||
      !Buffer.isBuffer(object.bytes) ||
      object.bytes.length !== artifact.byteLength ||
      digest(object.bytes) !== artifact.sha256
    )
      throw new HistoricalUserArchivePreflightError();
    return { name: `objects/${artifact.id}.bin`, data: Buffer.from(object.bytes), store: true };
  });
}

/**
 * INTERNAL partial snapshot + independently verified artifact byte preflight.
 * No publication/final authority: every object's prior verification and the
 * snapshot were obtained at different points in time, not one atomic claim.
 * NO public route, ZIP persistence, signed link or customer delivery.
 */
export function prepareHistoricalUserPartialArchive(input: {
  snapshot: { bytes: Buffer; sha256: string; byteLength: number };
  verifiedObjects: readonly VerifiedHistoricalArchiveObject[];
  visualEvidence: HistoricalVisualEvidenceBytes;
  /** Original numeric USER scoped committed mutation revision fingerprint. */
  mutationEpochSha256: string;
}): { bytes: Buffer; sha256: string; byteLength: number; files: number } {
  const snapshot = parseSnapshot(input?.snapshot);
  if (typeof input?.mutationEpochSha256 !== "string" || !sha256.test(input.mutationEpochSha256))
    throw new HistoricalUserArchivePreflightError();
  const objects = checkedObjectEntries(snapshot, input.verifiedObjects);
  const visualBytes = checkedVisualEvidence(snapshot, input.visualEvidence);
  const entries = [
    { name: metadataPath, data: Buffer.from(input.snapshot.bytes), store: false },
    { name: visualEvidencePath, data: visualBytes, store: false },
    ...objects,
  ].sort((a, b) => a.name.localeCompare(b.name));
  let totalBytes = 0;
  for (const entry of entries) {
    totalBytes += entry.data.length;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxArchiveBytes - 128 * 1024) {
      throw new HistoricalUserArchivePreflightError();
    }
  }
  const receipt = Buffer.from(
    JSON.stringify({
      kind: "boardreadyops.historical-user-partial-integrity-receipt",
      formatVersion: 3,
      exportId: snapshot.exportId,
      scope: "partial-preflight-not-customer-export",
      completeCustomerExport: false,
      // The core JSON omits physical bytes; the ZIP includes independently
      // verified eligible artifacts. Keep these semantics distinct.
      metadataSnapshotExclusions: snapshot.exclusions,
      verifiedPhysicalArtifactCount: objects.length,
      verifiedPrivateVisualDigestCount: input.visualEvidence.visualCount,
      privateVisualContentsIncluded: false,
      originalUserMutationEpochSha256: input.mutationEpochSha256,
      archiveExclusions: [
        "review-actor-identities-and-audit-metadata",
        "finding-decision-and-assignment-actor-identities",
        "platform-storage",
        "github-repository-source",
        "github-actions-logs-and-artifacts",
      ],
      entries: entries.map(({ name, data }) => ({
        path: name,
        byteLength: data.length,
        sha256: digest(data),
      })),
    }),
    "utf8",
  );
  if (!receipt.length || receipt.length > maxReceiptBytes) {
    throw new HistoricalUserArchivePreflightError();
  }
  entries.push({ name: receiptPath, data: receipt, store: false });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const bytes = createZipBuffer(entries, fixedTime);
  if (!bytes.length || bytes.length > maxArchiveBytes) throw new HistoricalUserArchivePreflightError();
  return { bytes, sha256: digest(bytes), byteLength: bytes.length, files: entries.length };
}

/** Independent integrity check; a digest supplied only inside the ZIP is untrusted. */
export function verifyHistoricalUserPartialArchive(
  archive: Buffer,
  trustedZipSha256: string,
  expectedExportId: string,
): boolean {
  if (
    !Buffer.isBuffer(archive) ||
    archive.length === 0 ||
    archive.length > maxArchiveBytes ||
    !sha256.test(trustedZipSha256) ||
    digest(archive) !== trustedZipSha256 ||
    !uuid.test(expectedExportId)
  )
    return false;
  try {
    const extracted = sanitizeAndExtractArchive(archive, {
      maxCompressedSizeBytes: maxArchiveBytes,
      maxTotalExtractedBytes: maxArchiveBytes,
      maxSingleFileBytes: maxArchiveBytes,
      maxFiles: maxObjects + 3,
    });
    const files = new Map<string, Buffer>();
    for (const file of extracted.files) {
      if (files.has(file.path)) return false;
      files.set(file.path, file.data);
    }
    if (files.size < 3 || files.size > maxObjects + 3) return false;
    const metadata = files.get(metadataPath);
    const receiptBytes = files.get(receiptPath);
    const visualBytes = files.get(visualEvidencePath);
    if (!metadata || !visualBytes || !receiptBytes || receiptBytes.length > maxReceiptBytes) return false;
    const snapshot = parseSnapshot({ bytes: metadata, sha256: digest(metadata), byteLength: metadata.length });
    checkedVisualEvidence(snapshot, {
      bytes: visualBytes,
      byteLength: visualBytes.length,
      sha256: digest(visualBytes),
      visualCount: snapshot.excludedSourceClassCounts.runSnapshots,
    });
    const receipt = JSON.parse(Buffer.from(receiptBytes).toString("utf8")) as Record<string, unknown>;
    const receiptFields = [
      "kind",
      "formatVersion",
      "exportId",
      "scope",
      "completeCustomerExport",
      "metadataSnapshotExclusions",
      "verifiedPhysicalArtifactCount",
      "verifiedPrivateVisualDigestCount",
      "privateVisualContentsIncluded",
      "originalUserMutationEpochSha256",
      "archiveExclusions",
      "entries",
    ];
    if (
      !exactKeys(receipt, receiptFields) ||
      receipt?.kind !== "boardreadyops.historical-user-partial-integrity-receipt" ||
      receipt.formatVersion !== 3 ||
      typeof receipt.originalUserMutationEpochSha256 !== "string" ||
      !sha256.test(receipt.originalUserMutationEpochSha256) ||
      receipt.scope !== "partial-preflight-not-customer-export" ||
      receipt.completeCustomerExport !== false ||
      receipt.exportId !== expectedExportId ||
      snapshot.exportId !== expectedExportId ||
      JSON.stringify(receipt.metadataSnapshotExclusions) !== JSON.stringify(snapshot.exclusions) ||
      receipt.verifiedPhysicalArtifactCount !== snapshot.artifacts.length ||
      receipt.verifiedPrivateVisualDigestCount !== snapshot.excludedSourceClassCounts.runSnapshots ||
      receipt.privateVisualContentsIncluded !== false ||
      JSON.stringify(receipt.archiveExclusions) !==
        JSON.stringify([
          "review-actor-identities-and-audit-metadata",
          "finding-decision-and-assignment-actor-identities",
          "platform-storage",
          "github-repository-source",
          "github-actions-logs-and-artifacts",
        ]) ||
      !Array.isArray(receipt.entries) ||
      receipt.entries.length !== files.size - 1
    )
      return false;
    const paths = [...files.keys()].filter((path) => path !== receiptPath).sort((a, b) => a.localeCompare(b));
    if (paths.some((path) => path !== metadataPath && path !== visualEvidencePath && !objectPath.test(path)))
      return false;
    const artifactMap = new Map(snapshot.artifacts.map((artifact) => [artifact.id, artifact]));
    if (paths.length !== artifactMap.size + 2) return false;
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      if (!path) return false;
      const bytes = files.get(path);
      const entry = receipt.entries[i] as Record<string, unknown> | undefined;
      if (
        !bytes ||
        !entry ||
        !exactKeys(entry, ["path", "byteLength", "sha256"]) ||
        entry.path !== path ||
        entry.byteLength !== bytes.length ||
        entry.sha256 !== digest(bytes)
      )
        return false;
      if (path !== metadataPath && path !== visualEvidencePath) {
        const match = objectPath.exec(path);
        if (!match?.[1]) return false;
        const artifact = artifactMap.get(match[1]);
        if (!artifact || artifact.byteLength !== bytes.length || artifact.sha256 !== digest(bytes)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * SEPARATE, SOURCE-ONLY metadata archive contract. This is deliberately NOT
 * ZIP v3: it can never contain an objects/ entry, raw SVG or file bytes.
 * Receipt verification is internal consistency, NOT external ownership or
 * legal authority, and never grants an HTTP/customer capability.
 */
const metadataOnlyReceiptPath = "metadata/historical-metadata-only-integrity.json";
const metadataOnlyScope = "private-metadata-only-not-customer-export";
const metadataOnlyExclusions = [
  "all-physical-artifact-file-bytes",
  "all-private-visual-svg-file-bytes",
  "customer-download-and-disclosure-authorization",
] as const;
const maxMetadataOnlyZipBytes = maxSnapshotBytes * 2 + maxReceiptBytes + 8192;
type HistoricalMetadataOnlyInput = {
  snapshot: { bytes: Buffer; sha256: string; byteLength: number };
  visualEvidence: HistoricalVisualEvidenceBytes;
  mutationEpochSha256: string;
};

/** No verifiedObjects or storageRoot parameter exists by design. */
export function prepareHistoricalUserMetadataOnlyArchive(input: HistoricalMetadataOnlyInput): {
  bytes: Buffer;
  sha256: string;
  byteLength: number;
  files: 3;
} {
  const snapshot = parseSnapshot(input?.snapshot);
  if (typeof input?.mutationEpochSha256 !== "string" || !sha256.test(input.mutationEpochSha256))
    throw new HistoricalUserArchivePreflightError();
  const visualBytes = checkedVisualEvidence(snapshot, input.visualEvidence);
  const entries = [
    { name: metadataPath, data: Buffer.from(input.snapshot.bytes) },
    { name: visualEvidencePath, data: visualBytes },
  ].sort((a, b) => a.name.localeCompare(b.name));
  const receipt = Buffer.from(
    JSON.stringify({
      kind: "boardreadyops.historical-user-metadata-only-integrity-receipt",
      formatVersion: 1,
      exportId: snapshot.exportId,
      scope: metadataOnlyScope,
      completeCustomerExport: false,
      customerDeliveryReady: false,
      physicalArtifactContentsIncluded: false,
      artifactDescriptorCount: snapshot.artifacts.length,
      privateVisualContentsIncluded: false,
      privateVisualDescriptorCount: input.visualEvidence.visualCount,
      originalUserMutationEpochSha256: input.mutationEpochSha256,
      exclusions: metadataOnlyExclusions,
      entries: entries.map(({ name, data }) => ({
        path: name,
        byteLength: data.length,
        sha256: digest(data),
      })),
    }),
  );
  if (!receipt.length || receipt.length > maxReceiptBytes) throw new HistoricalUserArchivePreflightError();
  const zip = createZipBuffer([...entries, { name: metadataOnlyReceiptPath, data: receipt }], fixedTime);
  if (!zip.length || zip.length > maxMetadataOnlyZipBytes) throw new HistoricalUserArchivePreflightError();
  return { bytes: zip, sha256: digest(zip), byteLength: zip.length, files: 3 };
}

/**
 * Verifies the exact three-file private metadata-only contract, not ZIP v3.
 * Never accepts an objects/ entry, even with a fully recomputed ZIP digest.
 */
export function verifyHistoricalUserMetadataOnlyArchive(
  archive: Buffer,
  trustedZipSha256: string,
  expectedExportId: string,
): boolean {
  if (
    !Buffer.isBuffer(archive) ||
    archive.length === 0 ||
    archive.length > maxMetadataOnlyZipBytes ||
    typeof trustedZipSha256 !== "string" ||
    !sha256.test(trustedZipSha256) ||
    digest(archive) !== trustedZipSha256 ||
    !uuid.test(expectedExportId)
  )
    return false;
  try {
    const extracted = sanitizeAndExtractArchive(archive, {
      maxCompressedSizeBytes: maxMetadataOnlyZipBytes,
      maxTotalExtractedBytes: maxMetadataOnlyZipBytes,
      maxSingleFileBytes: maxSnapshotBytes,
      maxFiles: 3,
    });
    if (extracted.files.length !== 3) return false;
    const files = new Map(extracted.files.map((entry) => [entry.path, entry.data]));
    if (
      files.size !== 3 ||
      [...files.keys()].some(
        (path) => path !== metadataPath && path !== visualEvidencePath && path !== metadataOnlyReceiptPath,
      )
    )
      return false;
    const coreBytes = files.get(metadataPath);
    const visualBytes = files.get(visualEvidencePath);
    const receiptBytes = files.get(metadataOnlyReceiptPath);
    if (!coreBytes || !visualBytes || !receiptBytes || receiptBytes.length > maxReceiptBytes) return false;
    const snapshot = parseSnapshot({ bytes: coreBytes, sha256: digest(coreBytes), byteLength: coreBytes.length });
    checkedVisualEvidence(snapshot, {
      bytes: visualBytes,
      sha256: digest(visualBytes),
      byteLength: visualBytes.length,
      visualCount: snapshot.excludedSourceClassCounts.runSnapshots,
    });
    const receipt = JSON.parse(Buffer.from(receiptBytes).toString("utf8")) as Record<string, unknown>;
    const receiptFields = [
      "kind",
      "formatVersion",
      "exportId",
      "scope",
      "completeCustomerExport",
      "customerDeliveryReady",
      "physicalArtifactContentsIncluded",
      "artifactDescriptorCount",
      "privateVisualContentsIncluded",
      "privateVisualDescriptorCount",
      "originalUserMutationEpochSha256",
      "exclusions",
      "entries",
    ];
    if (
      !exactKeys(receipt, receiptFields) ||
      receipt.kind !== "boardreadyops.historical-user-metadata-only-integrity-receipt" ||
      receipt.formatVersion !== 1 ||
      receipt.exportId !== expectedExportId ||
      snapshot.exportId !== expectedExportId ||
      receipt.scope !== metadataOnlyScope ||
      receipt.completeCustomerExport !== false ||
      receipt.customerDeliveryReady !== false ||
      receipt.physicalArtifactContentsIncluded !== false ||
      receipt.artifactDescriptorCount !== snapshot.artifacts.length ||
      receipt.privateVisualContentsIncluded !== false ||
      receipt.privateVisualDescriptorCount !== snapshot.excludedSourceClassCounts.runSnapshots ||
      typeof receipt.originalUserMutationEpochSha256 !== "string" ||
      !sha256.test(receipt.originalUserMutationEpochSha256) ||
      JSON.stringify(receipt.exclusions) !== JSON.stringify(metadataOnlyExclusions) ||
      !Array.isArray(receipt.entries) ||
      receipt.entries.length !== 2
    )
      return false;
    const paths = [metadataPath, visualEvidencePath].sort((a, b) => a.localeCompare(b));
    const receiptEntries = receipt.entries as Array<Record<string, unknown>>;
    return paths.every((path, index) => {
      const content = files.get(path);
      const row = receiptEntries[index];
      return (
        content !== undefined &&
        row !== undefined &&
        exactKeys(row, ["path", "byteLength", "sha256"]) &&
        row.path === path &&
        row.byteLength === content.length &&
        row.sha256 === digest(content)
      );
    });
  } catch {
    return false;
  }
}

/**
 * Trusted DB-only diagnostic entrypoint: never reads physical storage.
 * Two same-owner composite checks catch drift between source reads; a final
 * short, existing DB prepublication gate checks original USER, every artifact
 * locator, retention, active legal holds, erasure, and epoch before success.
 * These short transactions are NOT a durable seal or customer authorization.
 */
export async function prepareVerifiedHistoricalUserMetadataOnlyArchive(input: {
  db: PgQueryExecutor;
  authority: { exportId: string; verifiedGitHubUserId: number };
}): Promise<ReturnType<typeof prepareHistoricalUserMetadataOnlyArchive> | null> {
  if (
    !input?.db?.withTransaction ||
    !input?.authority ||
    !Number.isSafeInteger(input.authority.verifiedGitHubUserId) ||
    input.authority.verifiedGitHubUserId <= 0
  )
    return null;
  const first = await prepareVerifiedHistoricalUserCompositePreflight(input.db, input.authority);
  if (!first) return null;
  const second = await prepareVerifiedHistoricalUserCompositePreflight(input.db, input.authority);
  if (
    !second ||
    second.core.sha256 !== first.core.sha256 ||
    second.core.byteLength !== first.core.byteLength ||
    !second.core.bytes.equals(first.core.bytes) ||
    second.visual.sha256 !== first.visual.sha256 ||
    second.visual.byteLength !== first.visual.byteLength ||
    !second.visual.bytes.equals(first.visual.bytes) ||
    second.mutationEpochSha256 !== first.mutationEpochSha256
  )
    return null;
  // A ZIP without physical bytes still refers to managed artifact rows:
  // compare EVERY current original-USER artifact locator against the core.
  // We never read storage files or create copy reservations here.
  const snapshot = parseSnapshot(second.core);
  const runRepositories = new Map(snapshot.runs.map((run) => [run.id, run.repositoryId]));
  const objects = [];
  for (const artifact of snapshot.artifacts) {
    if (artifact.retentionExpired) return null;
    const object = await lookupHistoricalUserExportObject(input.db, input.authority, artifact.id);
    if (
      !object ||
      object.artifactId !== artifact.id ||
      object.runId !== artifact.runId ||
      object.repositoryId !== runRepositories.get(artifact.runId) ||
      object.sha256 !== artifact.sha256 ||
      object.byteLength !== artifact.byteLength
    )
      return null;
    objects.push(object);
  }
  const archive = prepareHistoricalUserMetadataOnlyArchive({
    snapshot: second.core,
    visualEvidence: second.visual,
    mutationEpochSha256: second.mutationEpochSha256,
  });
  if (!verifyHistoricalUserMetadataOnlyArchive(archive.bytes, archive.sha256, input.authority.exportId)) return null;
  // Even the metadata-only private ZIP must fail closed if an intervening
  // hold/erasure, imminent retention, changed manifest or scoped ABA makes
  // the previously verified owner snapshot stale. No customer entitlement.
  const gate = await checkHistoricalUserArchivePrepublication({
    db: input.db,
    authority: input.authority,
    objects,
    expectedCore: { sha256: first.core.sha256, byteLength: first.core.byteLength },
    expectedVisual: {
      sha256: first.visual.sha256,
      byteLength: first.visual.byteLength,
      visualCount: first.visual.visualCount,
    },
    expectedMutationEpochSha256: first.mutationEpochSha256,
  });
  return gate === "eligible" ? archive : null;
}

/**
 * Original-USER, source-only orchestration of one bounded metadata snapshot
 * and EVERY managed physical object. The independently verified OAuth numeric
 * identity is supplied only by trusted server code, never by a client body.
 * All durable physical path copy reservations are committed together and
 * held until the in-memory ZIP settles; a final identical metadata snapshot
 * detects mutations across sequential IO. This does NOT atomically pin
 * legal holds, export permissions, retention or customer publication rights.
 */
export async function prepareVerifiedHistoricalUserPartialArchive(input: {
  db: PgQueryExecutor;
  authority: { exportId: string; verifiedGitHubUserId: number };
  storageRoot: string;
  storageDriver: string;
}): Promise<ReturnType<typeof prepareHistoricalUserPartialArchive> | null> {
  if (input?.storageDriver !== "local") return null;
  const originalPair = await prepareVerifiedHistoricalUserCompositePreflight(input.db, input.authority);
  if (!originalPair) return null;
  const { core: initial, visual: initialVisual, mutationEpochSha256: originalEpoch } = originalPair;
  const parsed = parseSnapshot(initial);
  checkedVisualEvidence(parsed, initialVisual);
  const expected = new Map(parsed.runs.map((run) => [run.id, run.repositoryId]));
  const objects = [];
  let byteBudget = initial.byteLength;
  for (const artifact of parsed.artifacts) {
    const object = await lookupHistoricalUserExportObject(input.db, input.authority, artifact.id);
    if (
      !object ||
      object.artifactId !== artifact.id ||
      object.runId !== artifact.runId ||
      object.repositoryId !== expected.get(artifact.runId) ||
      object.sha256 !== artifact.sha256 ||
      object.byteLength !== artifact.byteLength
    )
      throw new HistoricalUserArchivePreflightError();
    byteBudget += object.byteLength;
    if (!Number.isSafeInteger(byteBudget) || byteBudget > maxArchiveBytes - 128 * 1024) {
      throw new HistoricalUserArchivePreflightError();
    }
    objects.push(object);
  }

  // All-or-nothing reservation admission occurs before even the first file
  // read. Every artifact's physical path stays fenced through ZIP assembly.
  const admitted = await reserveHistoricalUserObjectBatch(input.db, input.authority, objects);
  if (!admitted) throw new HistoricalUserArchivePreflightError();
  try {
    const verifiedObjects: VerifiedHistoricalArchiveObject[] = [];
    for (const { object } of admitted) {
      const before = await lookupHistoricalUserExportObject(input.db, input.authority, object.artifactId);
      if (!before || JSON.stringify(before) !== JSON.stringify(object)) {
        throw new HistoricalUserArchivePreflightError();
      }
      const bytes = await readVerifiedLocalExportObject({
        storageRoot: input.storageRoot,
        storageDriver: input.storageDriver,
        object,
      });
      if (!bytes) throw new HistoricalUserArchivePreflightError();
      const after = await lookupHistoricalUserExportObject(input.db, input.authority, object.artifactId);
      if (!after || JSON.stringify(after) !== JSON.stringify(object)) {
        throw new HistoricalUserArchivePreflightError();
      }
      verifiedObjects.push({
        bytes,
        artifactId: object.artifactId,
        exportId: input.authority.exportId,
        repositoryId: object.repositoryId,
        runId: object.runId,
        sha256: object.sha256,
      });
    }
    const finalPair = await prepareVerifiedHistoricalUserCompositePreflight(input.db, input.authority);
    if (!finalPair) throw new HistoricalUserArchivePreflightError();
    const { core: final, visual: finalVisual } = finalPair;
    if (
      final.byteLength !== initial.byteLength ||
      final.sha256 !== initial.sha256 ||
      !final.bytes.equals(initial.bytes) ||
      finalVisual.sha256 !== initialVisual.sha256 ||
      finalVisual.byteLength !== initialVisual.byteLength ||
      finalVisual.visualCount !== initialVisual.visualCount ||
      !finalVisual.bytes.equals(initialVisual.bytes) ||
      finalPair.mutationEpochSha256 !== originalEpoch
    )
      throw new HistoricalUserArchivePreflightError();
    const archive = prepareHistoricalUserPartialArchive({
      snapshot: final,
      verifiedObjects,
      visualEvidence: finalVisual,
      mutationEpochSha256: originalEpoch,
    });
    // One short transaction rechecks every retained original-USER artifact,
    // request status, pending physical deletion, retention and legal hold.
    // No durable publication right survives this transaction.
    const gate = await checkHistoricalUserArchivePrepublication({
      db: input.db,
      authority: input.authority,
      objects,
      expectedCore: { sha256: initial.sha256, byteLength: initial.byteLength },
      expectedVisual: {
        sha256: initialVisual.sha256,
        byteLength: initialVisual.byteLength,
        visualCount: initialVisual.visualCount,
      },
      expectedMutationEpochSha256: originalEpoch,
    });
    if (gate !== "eligible") throw new HistoricalUserArchivePreflightError();
    return archive;
  } finally {
    // This must settle only AFTER all filesystem reads, the snapshot recheck,
    // and in-memory ZIP production. Uncertain settlement fails closed.
    await releaseHistoricalUserObjectBatch(input.db, input.authority, admitted);
  }
}
