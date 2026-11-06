import { createHash } from "node:crypto";
import { sanitizeAndExtractArchive } from "@boardreadyops/cloud-core/archive-sanitizer";
import { verifyHistoricalUserPartialArchive } from "./data-export-historical-archive.js";

/**
 * SOURCE-ONLY diagnostic, NOT an entitlement or legal/privacy clearance.
 * Never return sampled source text, raw SVG, tenant/login or actor identity.
 * A valid ZIP receipt attests internal integrity, not the right to disclose.
 */
const maxArchiveBytes = 64 * 1024 * 1024;
const digestPattern = /^[0-9a-f]{64}$/u;
const sourceClasses = [
  "repositories",
  "runs",
  "findings",
  "artifacts",
  "reviews",
  "revisions",
  "reviewComments",
  "reviewApprovals",
  "reviewChecklist",
  "findingDecisions",
  "findingAssignments",
  "installationAuditEvents",
  "auditEvents",
] as const;

const textSurfaces = [
  ["findings", "message"],
  ["reviewComments", "content"],
  ["reviewApprovals", "reason"],
  ["reviewApprovals", "invalidationReason"],
  ["reviewChecklist", "title"],
  ["findingDecisions", "reason"],
] as const;

// Explicit, stable NO-GO acceptance criteria. The ZIP cannot attest any of
// these; they require independent lawful provenance and end-to-end evidence.
const acceptanceRequirements = [
  ["partial_source_coverage", "complete_original_user_source_inventory"],
  ["historical_owner_provenance_incomplete", "fresh_numeric_github_user_and_source_provenance"],
  ["third_party_content_disclosure_rights_unverified", "third_party_rights_and_lawful_disclosure_basis"],
  ["private_design_content_disclosure_rights_unverified", "design_ip_rights_and_svg_safety_review"],
  ["excluded_tenant_platform_and_sensitive_sources", "lawful_exclusion_and_platform_data_scope_decision"],
  ["unsealed_cross_store_snapshot", "durably_sealed_consistent_database_and_file_manifest"],
  ["no_authenticated_customer_delivery_entitlement", "authenticated_auditable_expiring_customer_grant"],
  ["no_in_flight_revocation_hold_erasure_acceptance", "stream_revocation_hold_erasure_and_disconnect_e2e"],
] as const;
const persistentBlockers = acceptanceRequirements.map(([code]) => code);

type SourceClass = (typeof sourceClasses)[number];
type TextSurface = (typeof textSurfaces)[number];
type TextSurfaceName = `${TextSurface[0]}.${TextSurface[1]}`;
type SourceTextAcceptance = {
  sourceClass: TextSurface[0];
  field: TextSurface[1];
  nonEmptyRows: number;
  authorProvenanceVerified: false;
  thirdPartyDisclosureRightsVerified: false;
  customerDisclosureAllowed: false;
  requiredEvidence: readonly ["source_author_provenance", "lawful_disclosure_basis", "sensitive_content_review"];
};
type DeliveryAcceptanceCriterion = {
  blockerCode: (typeof acceptanceRequirements)[number][0];
  requiredEvidence: (typeof acceptanceRequirements)[number][1];
  evidenceStatus: "not_verified";
  customerDeliveryAllowed: false;
};
export type HistoricalDisclosureReadiness = {
  kind: "boardreadyops.historical-user-disclosure-readiness";
  formatVersion: 2;
  privateDiagnosticOnly: true;
  releaseDecision: "NO_GO";
  completeCustomerExport: false;
  customerDeliveryReady: false;
  verifiedArchiveSha256: string;
  sourceRowCounts: Record<SourceClass, number>;
  privateTextReviewCounts: Record<TextSurfaceName, number>;
  textRightsAcceptance: readonly SourceTextAcceptance[];
  deliveryAcceptance: readonly DeliveryAcceptanceCriterion[];
  excludedSensitiveSourceCounts: Record<string, number>;
  redactedAuditFieldCounts: Record<string, number>;
  blockers: readonly string[];
};

export function assessHistoricalUserPrivateArchiveDisclosure(input: {
  archiveBytes: Buffer;
  exportId: string;
}): HistoricalDisclosureReadiness | null {
  if (
    !input ||
    !Buffer.isBuffer(input.archiveBytes) ||
    input.archiveBytes.byteLength < 1 ||
    input.archiveBytes.byteLength > maxArchiveBytes ||
    typeof input.exportId !== "string"
  )
    return null;
  const archiveSha256 = createHash("sha256").update(input.archiveBytes).digest("hex");
  if (
    !digestPattern.test(archiveSha256) ||
    !verifyHistoricalUserPartialArchive(input.archiveBytes, archiveSha256, input.exportId)
  )
    return null;
  try {
    // The independent verifier already enforces exact core fields, exclusions,
    // receipt, owner relationships, object digests and private visual limits.
    const extracted = sanitizeAndExtractArchive(input.archiveBytes, {
      maxCompressedSizeBytes: maxArchiveBytes,
      maxTotalExtractedBytes: maxArchiveBytes,
      maxSingleFileBytes: maxArchiveBytes,
      maxFiles: 103,
    });
    const coreBytes = extracted.files.find((file) => file.path === "metadata/historical-core.json")?.data;
    if (!coreBytes || coreBytes.byteLength > 256 * 1024) return null;
    const core = JSON.parse(coreBytes.toString("utf8")) as Record<string, unknown>;
    const sourceRowCounts = {} as Record<SourceClass, number>;
    for (const name of sourceClasses) {
      const rows = core[name];
      if (!Array.isArray(rows) || rows.length > 100) return null;
      sourceRowCounts[name] = rows.length;
    }
    const privateTextReviewCounts = {} as Record<TextSurfaceName, number>;
    for (const [name, field] of textSurfaces) {
      const rows = core[name] as Array<Record<string, unknown>>;
      privateTextReviewCounts[`${name}.${field}`] = rows.filter(
        (row) => typeof row[field] === "string" && (row[field] as string).length > 0,
      ).length;
    }
    // These are bounded COUNTS only; the report intentionally omits even
    // potentially sensitive repository names and third-party text snippets.
    const excluded = core.excludedSourceClassCounts as Record<string, number>;
    const redacted = core.redactedAuditFieldCounts as Record<string, number>;
    // ZIP contents have no valid signatures/legal consent/provenance proofs.
    // No automated text inspection or a zero count can approve disclosure.
    const textRightsAcceptance: SourceTextAcceptance[] = textSurfaces.map(([sourceClass, field]) => ({
      sourceClass,
      field,
      nonEmptyRows: privateTextReviewCounts[`${sourceClass}.${field}`],
      authorProvenanceVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      customerDisclosureAllowed: false,
      requiredEvidence: ["source_author_provenance", "lawful_disclosure_basis", "sensitive_content_review"],
    }));
    const deliveryAcceptance: DeliveryAcceptanceCriterion[] = acceptanceRequirements.map(
      ([blockerCode, requiredEvidence]) => ({
        blockerCode,
        requiredEvidence,
        evidenceStatus: "not_verified",
        customerDeliveryAllowed: false,
      }),
    );
    const blockers: string[] = [...persistentBlockers, "source_text_disclosure_disabled_by_policy"];
    // Bounded, verified object bytes may still be in this INTERNAL ZIP.
    // Internal SHA/receipt validity is NOT lawful customer disclosure.
    if (sourceRowCounts.artifacts > 0) {
      blockers.push("unverified_physical_artifact_content_rights");
    }
    if (Object.values(privateTextReviewCounts).some((count) => count > 0)) {
      blockers.push("retained_unstructured_text_requires_manual_rights_review");
    }
    if (Object.values(redacted).some((count) => count > 0)) {
      blockers.push("third_party_audit_fields_redacted_not_disclosed");
    }
    if (Object.values(excluded).some((count) => count > 0)) {
      blockers.push("retained_sensitive_source_records_excluded");
    }
    return {
      kind: "boardreadyops.historical-user-disclosure-readiness",
      formatVersion: 2,
      privateDiagnosticOnly: true,
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryReady: false,
      verifiedArchiveSha256: archiveSha256,
      sourceRowCounts,
      privateTextReviewCounts,
      textRightsAcceptance,
      deliveryAcceptance,
      excludedSensitiveSourceCounts: Object.fromEntries(
        Object.entries(excluded).sort(([a], [b]) => a.localeCompare(b)),
      ),
      redactedAuditFieldCounts: Object.fromEntries(Object.entries(redacted).sort(([a], [b]) => a.localeCompare(b))),
      blockers,
    };
  } catch {
    return null;
  }
}
