import { computeEvidenceDigest } from "@boardreadyops/cloud-core";
import { describe, expect, it } from "vitest";
import { evaluateCloudUploadPolicy } from "../../src/core/cloud-upload-policy.js";
import { createFinding, shouldFail } from "../../src/core/findings.js";
import { createExportProvenanceManifest, verifyExportProvenance } from "../../src/core/provenance.js";
import { clearRulesForTests, type Rule, registerRule } from "../../src/core/rule-registry.js";

describe("Risk-Invariant Verification Matrix", () => {
  it("Invariant 1: Token presence without upload mode produces zero upload consent", () => {
    const policy = evaluateCloudUploadPolicy({ uploadMode: undefined, hasToken: true });
    expect(policy.shouldPublish).toBe(false);
    expect(policy.allowSnapshots).toBe(false);
    expect(policy.allowSource).toBe(false);
  });

  it("Invariant 2: Evidence digest changes when decision-relevant inputs change", () => {
    const baseInput = {
      toolVersion: "1.67.0",
      rulePackDigest: "abc",
      configDigest: "123",
      headCommitSha: "0000000000000000000000000000000000000000",
      findingFingerprints: ["f1"],
    };
    const digest1 = computeEvidenceDigest(baseInput);

    const digest2 = computeEvidenceDigest({ ...baseInput, uploadMode: "snapshots" });
    expect(digest1).not.toEqual(digest2);
  });

  it("Invariant 3: Provenance verification detects source, artifact, and commit tampering", async () => {
    const manifest = await createExportProvenanceManifest({
      root: process.cwd(),
      artifacts: [
        { path: "README.md", sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 10 },
      ],
      git: { sha: "1111111111111111111111111111111111111111" },
    });

    const result = await verifyExportProvenance(process.cwd(), manifest, {
      currentGitSha: "2222222222222222222222222222222222222222",
    });

    expect(result.status).toBe("mismatch");
    expect(result.gitShaMatch).toBe(false);
  });

  it("Invariant 4: Heuristic findings do not block release gate by default", () => {
    clearRulesForTests();
    const heuristicRule: Rule = {
      meta: {
        id: "bom.risk-score",
        title: "Risk Score",
        description: "Heuristic score",
        rationale: "Rationale",
        defaultSeverity: "high",
        appliesTo: ["bom"],
        tags: [],
        category: "sourcing",
        evidenceType: "heuristic",
        fixability: "none",
        vendorDependence: "none",
        configKeys: [],
        kicadVersions: ["9", "10"],
      },
      run: async () => [],
    };
    registerRule(heuristicRule);

    const finding = createFinding({
      ruleId: "bom.risk-score",
      severity: "high",
      message: "High risk score",
      resource: { path: "bom.csv", kind: "bom" },
    });

    expect(shouldFail([finding], "high")).toBe(false);
  });
});
