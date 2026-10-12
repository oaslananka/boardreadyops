import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { releaseAuditClausesCommand } from "../../../src/cli/commands/release.js";
import { exportPassportAuditClausesJson, projectPassportAuditClauses } from "../../../src/release/clause-evidence.js";
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

  it("exports stable clause-grouped JSON with self-reported provenance and explicit record gaps", () => {
    const passport = buildReleasePassport(base);
    const maps = [
      { standard: "DO-254" as const, clause: "Z.3", requiredEvidence: ["firmware_snapshot" as const] },
      {
        standard: "ISO 13485" as const,
        clause: "X.1",
        requiredEvidence: ["reviewed_revision" as const, "review_approval" as const],
      },
    ];
    const first = exportPassportAuditClausesJson(passport, maps);
    expect(exportPassportAuditClausesJson(passport, [...maps].reverse())).toBe(first);
    const parsed = JSON.parse(first) as {
      release: { id: string; sourceCommitClaim?: string; passportDigest: string };
      provenance: string;
      disclaimer: string;
      clauses: { standard: string; recordCoverage: string; missingEvidence: string[] }[];
    };
    expect(first.endsWith("\n")).toBe(true);
    expect(parsed.release).toEqual({
      id: "v2.0.0",
      sourceCommitClaim: "a".repeat(40),
      passportDigest: passport.verification.passportDigest,
    });
    expect(parsed.provenance).toBe("self-reported-passport");
    expect(parsed.disclaimer).toContain("not independently authenticated");
    expect(parsed.clauses.map((x) => x.standard)).toEqual(["DO-254", "ISO 13485"]);
    expect(parsed.clauses.map((x) => x.recordCoverage)).toEqual(["absent", "partial"]);
    expect(parsed.clauses[1]?.missingEvidence).toEqual(["review_approval"]);
    const dirty = buildReleasePassport({ ...base, gitDirty: true });
    expect(JSON.parse(exportPassportAuditClausesJson(dirty, maps)).release).not.toHaveProperty("sourceCommitClaim");
    passport.release.id = "tampered";
    expect(() => exportPassportAuditClausesJson(passport, maps)).toThrow("digest check failed");
  });

  it("exposes an offline stdout-only export and fails closed on unreadable or unsupported mapping input", async () => {
    const dir = mkdtempSync(join(tmpdir(), "boardreadyops-clause-export-"));
    try {
      const passportFile = join(dir, "passport.json");
      const mappingFile = join(dir, "clauses.json");
      writeFileSync(passportFile, JSON.stringify(buildReleasePassport(base)));
      writeFileSync(
        mappingFile,
        JSON.stringify([{ standard: "AS9100", clause: "X.1", requiredEvidence: ["release_decision", "risk_waiver"] }]),
      );
      let stdout = "";
      let stderr = "";
      const out = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          stdout += chunk.toString("utf8");
          callback();
        },
      });
      const err = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          stderr += chunk.toString("utf8");
          callback();
        },
      });
      const streams = { stdout: out, stderr: err };
      expect(await releaseAuditClausesCommand(passportFile, { mappings: mappingFile }, streams)).toBe(0);
      expect(JSON.parse(stdout).clauses[0]).toMatchObject({
        standard: "AS9100",
        recordCoverage: "partial",
        missingEvidence: ["risk_waiver"],
      });
      expect(stderr).toBe("");
      writeFileSync(
        mappingFile,
        JSON.stringify([{ standard: "DO-254", clause: "../bad", requiredEvidence: ["firmware_snapshot"] }]),
      );
      expect(await releaseAuditClausesCommand(passportFile, { mappings: mappingFile }, streams)).toBe(2);
      expect(stderr).toContain("Audit clause export failed");
      writeFileSync(mappingFile, JSON.stringify([null]));
      expect(await releaseAuditClausesCommand(passportFile, { mappings: mappingFile }, streams)).toBe(2);
      writeFileSync(mappingFile, " ".repeat(1024 * 1024 + 1));
      expect(await releaseAuditClausesCommand(passportFile, { mappings: mappingFile }, streams)).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
