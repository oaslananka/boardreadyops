import { createHash } from "node:crypto";
import { sanitizeAndExtractArchive } from "@boardreadyops/cloud-core/archive-sanitizer";
import { verifyHistoricalUserMetadataOnlyArchive } from "./data-export-historical-archive.js";

/** Private, count-only metadata risk inventory. Never a customer entitlement. */
const fields = [
  ["repositories", "githubRepositoryId", "github_repository_id"],
  ["repositories", "repositoryId", "repository_uuid"],
  ["runs", "commitSha", "commit_hash"],
  ["runs", "id", "run_uuid"],
  ["findings", "ruleId", "finding_rule_id"],
  ["artifacts", "sha256", "artifact_content_hash"],
  ["artifacts", "byteLength", "artifact_size"],
  ["artifacts", "id", "artifact_uuid"],
  ["revisions", "headCommitSha", "revision_commit_hash"],
  ["revisions", "evidenceDigest", "revision_evidence_hash"],
  ["reviewComments", "findingFingerprint", "comment_fingerprint"],
  ["reviewApprovals", "evidenceDigest", "approval_evidence_hash"],
  ["findingDecisions", "findingFingerprint", "decision_fingerprint"],
  ["findingDecisions", "evidenceDigest", "decision_evidence_hash"],
  ["findingAssignments", "findingFingerprint", "assignment_fingerprint"],
] as const;

export function assessHistoricalUserMetadataExposure(input: { archiveBytes: Buffer; exportId: string }): {
  privateDiagnosticOnly: true;
  completeCustomerExport: false;
  customerDeliveryReady: false;
  releaseDecision: "NO_GO";
  physicalArtifactBytesIncluded: false;
  exposure: Array<{ category: (typeof fields)[number][2] | "visual_digest"; rows: number; rightsVerified: false }>;
  blockers: readonly string[];
} | null {
  if (
    !Buffer.isBuffer(input?.archiveBytes) ||
    input.archiveBytes.length < 1 ||
    input.archiveBytes.length > 1024 * 1024 ||
    typeof input.exportId !== "string"
  )
    return null;
  const digest = createHash("sha256").update(input.archiveBytes).digest("hex");
  if (!verifyHistoricalUserMetadataOnlyArchive(input.archiveBytes, digest, input.exportId)) return null;
  try {
    const files = sanitizeAndExtractArchive(input.archiveBytes, {
      maxCompressedSizeBytes: 1024 * 1024,
      maxTotalExtractedBytes: 1024 * 1024,
      maxSingleFileBytes: 256 * 1024,
      maxFiles: 3,
    }).files;
    const core = files.find((file) => file.path === "metadata/historical-core.json")?.data;
    const visual = files.find((file) => file.path === "metadata/historical-private-visual-evidence.json")?.data;
    if (!core || !visual) return null;
    const data = JSON.parse(core.toString("utf8")) as Record<string, unknown>;
    const images = JSON.parse(visual.toString("utf8")) as { visuals: unknown[] };
    const exposure: Array<{
      category: (typeof fields)[number][2] | "visual_digest";
      rows: number;
      rightsVerified: false;
    }> = fields.map(([source, field, category]) => ({
      category,
      rows: (data[source] as Array<Record<string, unknown>>).filter(
        (row) => row[field] !== null && row[field] !== undefined && row[field] !== "",
      ).length,
      rightsVerified: false as const,
    }));
    exposure.push({ category: "visual_digest", rows: images.visuals.length, rightsVerified: false });
    return {
      privateDiagnosticOnly: true,
      completeCustomerExport: false,
      customerDeliveryReady: false,
      releaseDecision: "NO_GO",
      physicalArtifactBytesIncluded: false,
      exposure,
      blockers: [
        "original_user_provenance_not_attested_by_zip",
        "opaque_id_and_hash_disclosure_rights_unverified",
        "partial_archive_not_customer_export",
        "no_revocable_authenticated_delivery",
      ],
    };
  } catch {
    return null;
  }
}
