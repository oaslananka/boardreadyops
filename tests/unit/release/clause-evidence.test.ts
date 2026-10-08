import { describe, expect, it } from "vitest";
import { projectPassportAuditClauses } from "../../../src/release/clause-evidence.js";
import { buildReleasePassport } from "../../../src/release/passport.js";

const base = {
  releaseId: "v2.0.0",
  gitSha: "a".repeat(40),
  gitDirty: false,
  gerbers: [{ path: "front.gtl", sha256: "b".repeat(64), bytes: 100 }],
  drill: [{ path: "holes.drl", sha256: "c".repeat(64), bytes: 15 }],
  bom: { present: true, hash: "d".repeat(64) },
  firmware: { present: false },
  policy: { rulesetHash: "e".repeat(64), failOn: "high", ruleCount: 1, policyStatus: "pass" as const },
  evidenceBundlePath: "evidence",
  evidenceManifestHash: "f".repeat(64),
};

describe("non-normative audit-clause recording projection", () => {
  it("groups only the requested passport fields by supplied clause with honest gaps", () => {
    const projections = projectPassportAuditClauses(buildReleasePassport(base), [
      {
        standard: "ISO 13485",
        clause: "X.1",
        requiredEvidence: ["reviewed_revision", "fabrication_outputs", "policy_evaluation"],
      },
      {
        standard: "AS9100",
        clause: "Y.2",
        requiredEvidence: ["bom_snapshot", "review_approval", "evidence_manifest"],
      },
      { standard: "DO-254", clause: "Z.3", requiredEvidence: ["firmware_snapshot", "risk_waiver"] },
    ]);
    expect(projections.map((p) => p.recordCoverage)).toEqual(["recorded", "partial", "absent"]);
    expect(projections[1]?.recordedEvidence).toEqual(["bom_snapshot", "evidence_manifest"]);
    expect(projections[1]?.missingEvidence).toEqual(["review_approval"]);
    expect(projections[2]?.missingEvidence).toEqual(["firmware_snapshot", "risk_waiver"]);
  });

  it("does not record a dirty revision or unevaluated policy as present", () => {
    const passport = buildReleasePassport({
      ...base,
      gitDirty: true,
      gerbers: [],
      drill: [],
      policy: { ...base.policy, policyStatus: "not-evaluated" },
    });
    const projection = projectPassportAuditClauses(passport, [
      {
        standard: "IATF 16949",
        clause: "A.1",
        requiredEvidence: ["reviewed_revision", "fabrication_outputs", "policy_evaluation"],
      },
    ]);
    expect(projection[0]?.recordCoverage).toBe("absent");
  });

  it("rejects tampered passport contents even if record fields remain present", () => {
    const passport = buildReleasePassport(base);
    passport.release.id = "silently-changed";
    expect(() => projectPassportAuditClauses(passport, [])).toThrow("digest check failed");
  });

  it("rejects ambiguous, invented, unsupported or unbounded clause mappings", () => {
    const passport = buildReleasePassport(base);
    const mapping = { standard: "AS9100" as const, clause: "X.1", requiredEvidence: ["release_decision" as const] };
    expect(() => projectPassportAuditClauses(passport, [mapping, mapping])).toThrow("Duplicate");
    expect(() => projectPassportAuditClauses(passport, [{ ...mapping, requiredEvidence: [] }])).toThrow(
      "empty evidence requirements",
    );
    expect(() => projectPassportAuditClauses(passport, [{ ...mapping, requiredEvidence: ["bogus"] as never }])).toThrow(
      "unsupported",
    );
    expect(() => projectPassportAuditClauses(passport, [{ ...mapping, clause: "../escape" }])).toThrow("invalid");
    expect(() =>
      projectPassportAuditClauses(
        passport,
        Array.from({ length: 201 }, () => mapping),
      ),
    ).toThrow("clause budget");
  });
});
