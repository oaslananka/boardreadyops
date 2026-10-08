import type { ReleasePassport } from "./passport.js";
import { verifyPassportDigest } from "./passport.js";

/** Caller-supplied standard/clause IDs; NOT an authoritative normative clause catalogue. */
export type AuditStandard = "ISO 13485" | "IATF 16949" | "AS9100" | "DO-254";
export type PassportEvidenceKind =
  | "reviewed_revision"
  | "policy_evaluation"
  | "release_decision"
  | "review_approval"
  | "risk_waiver"
  | "fabrication_outputs"
  | "bom_snapshot"
  | "firmware_snapshot"
  | "evidence_manifest";

export type AuditClauseMapping = {
  standard: AuditStandard;
  clause: string;
  requiredEvidence: readonly PassportEvidenceKind[];
};

export type AuditClauseProjection = {
  standard: AuditStandard;
  clause: string;
  /** Coverage of fields in a self-reported passport, not compliance or audited sufficiency. */
  recordedEvidence: readonly PassportEvidenceKind[];
  missingEvidence: readonly PassportEvidenceKind[];
  recordCoverage: "recorded" | "partial" | "absent";
};

const standards = new Set<string>(["ISO 13485", "IATF 16949", "AS9100", "DO-254"]);
const evidenceKinds = new Set<string>([
  "reviewed_revision",
  "policy_evaluation",
  "release_decision",
  "review_approval",
  "risk_waiver",
  "fabrication_outputs",
  "bom_snapshot",
  "firmware_snapshot",
  "evidence_manifest",
]);
const sha256 = /^[0-9a-f]{64}$/iu;
const commit = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;

function hasRecordedField(passport: ReleasePassport, kind: PassportEvidenceKind): boolean {
  switch (kind) {
    case "reviewed_revision":
      return passport.release.git?.dirty === false && commit.test(passport.release.git.sha ?? "");
    case "policy_evaluation":
      return (
        sha256.test(passport.policy.rulesetHash) &&
        passport.policy.ruleCount > 0 &&
        (passport.policy.policyStatus === "pass" || passport.policy.policyStatus === "fail")
      );
    case "release_decision":
      return passport.decision.status === "pass" || passport.decision.status === "fail";
    case "review_approval":
      return passport.approvals.some((approval) => approval.status === "approved");
    case "risk_waiver":
      return passport.waivers.length > 0;
    case "fabrication_outputs": {
      const { gerbers, drill } = passport.artifacts.hardware;
      return (
        gerbers.length > 0 &&
        drill.length > 0 &&
        [...gerbers, ...drill].every((artifact) => artifact.bytes > 0 && sha256.test(artifact.sha256))
      );
    }
    case "bom_snapshot":
      return passport.artifacts.bom.present && sha256.test(passport.artifacts.bom.hash ?? "");
    case "firmware_snapshot":
      return passport.artifacts.firmware.present && sha256.test(passport.artifacts.firmware.hash ?? "");
    case "evidence_manifest":
      return sha256.test(passport.evidence.manifestHash ?? "");
  }
}

/**
 * Non-normative record-presence projection for #757. A self-consistent
 * passport digest is NOT third-party authentication, nor proof of compliance.
 */
export function projectPassportAuditClauses(
  passport: ReleasePassport,
  mappings: readonly AuditClauseMapping[],
): readonly AuditClauseProjection[] {
  if (!verifyPassportDigest(passport).ok) throw new Error("Release passport digest check failed.");
  if (mappings.length > 200) throw new Error("Audit mapping exceeds the clause budget.");
  const seen = new Set<string>();

  return mappings.map((mapping) => {
    if (!standards.has(mapping.standard) || !/^[a-z0-9][a-z0-9._/-]{0,79}$/iu.test(mapping.clause)) {
      throw new Error("Audit mapping has invalid standard or clause identity.");
    }
    const key = [mapping.standard, mapping.clause.toUpperCase()].join(":");
    if (seen.has(key)) throw new Error("Duplicate audit clause mapping.");
    seen.add(key);
    const required = new Set(mapping.requiredEvidence);
    if (
      required.size === 0 ||
      required.size !== mapping.requiredEvidence.length ||
      required.size > evidenceKinds.size ||
      [...required].some((kind) => !evidenceKinds.has(kind))
    ) {
      throw new Error("Audit clause has unsupported, duplicated or empty evidence requirements.");
    }

    const recordedEvidence = mapping.requiredEvidence.filter((kind) => hasRecordedField(passport, kind));
    const missingEvidence = mapping.requiredEvidence.filter((kind) => !hasRecordedField(passport, kind));
    return {
      standard: mapping.standard,
      clause: mapping.clause,
      recordedEvidence,
      missingEvidence,
      recordCoverage: missingEvidence.length === 0 ? "recorded" : recordedEvidence.length === 0 ? "absent" : "partial",
    };
  });
}
