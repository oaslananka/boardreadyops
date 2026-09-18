import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import passportSchema from "../../../schemas/release-passport.schema.json" with { type: "json" };
import { boardReadyVersion } from "../../../src/generated/version.js";
import type { ReleaseEvidenceManifest } from "../../../src/release/evidence.js";
import {
  buildReleasePassport,
  computePassportDigest,
  computeRulesetHash,
  deriveBomState,
  deriveFirmwareState,
  formatPassportText,
  type PassportGenerateOptions,
  type ReleasePassport,
  verifyPassportDigest,
  verifyReleasePassport,
} from "../../../src/release/passport.js";
import { writeFixture } from "../rules/helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultOptions(overrides: Partial<PassportGenerateOptions> = {}): PassportGenerateOptions {
  return {
    releaseId: "v1.0.0",
    gitSha: "a".repeat(64),
    gitDirty: false,
    gitBranch: "main",
    gerbers: [{ path: "artifacts/gerbers/top.gtl", sha256: "b".repeat(64), bytes: 1024 }],
    drill: [{ path: "artifacts/drill/fabrication.drl", sha256: "c".repeat(64), bytes: 512 }],
    bom: { present: true, format: "csv", hash: "d".repeat(64), componentCount: 42 },
    firmware: { present: false },
    policy: {
      rulesetHash: "e".repeat(64),
      failOn: "high",
      ruleCount: 12,
      rules: ["manifest.project-discovery", "drc.kicad"],
      policyStatus: "pass",
    },
    evidenceBundlePath: "bundle",
    evidenceManifestHash: "f".repeat(64),
    ...overrides,
  };
}

function makeMinimalPassport(overrides: Partial<PassportGenerateOptions> = {}): ReleasePassport {
  return buildReleasePassport(defaultOptions(overrides));
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("release passport schema", () => {
  it("validates a minimal passport against the JSON schema", () => {
    const passport = makeMinimalPassport();
    const ajv = new Ajv2020({ allErrors: true });
    const validate = ajv.compile(passportSchema);
    expect(validate(passport), JSON.stringify(validate.errors)).toBe(true);
  });

  it("validates a passport with all optional fields populated", () => {
    const passport = makeMinimalPassport({
      approvals: [{ approverId: "human-1", status: "approved", timestamp: "2026-09-01T00:00:00Z" }],
      waivers: [
        {
          fingerprint: "a".repeat(64),
          disposition: "accepted_risk",
          reason: "Low risk cosmetic issue on non-critical board edge.",
          owner: "lead-eng",
          expiresAt: "2027-01-01T00:00:00Z",
        },
      ],
      evidenceLedgerPath: "evidence/evidence-ledger.json",
      evidenceLedgerDigest: "1".repeat(64),
      kicadVersion: "10.0.0",
    });
    const ajv = new Ajv2020({ allErrors: true });
    const validate = ajv.compile(passportSchema);
    expect(validate(passport), JSON.stringify(validate.errors)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Build + digest
// ---------------------------------------------------------------------------

describe("buildReleasePassport", () => {
  it("sets schemaVersion 1 and type 'release-passport'", () => {
    const passport = makeMinimalPassport();
    expect(passport.schemaVersion).toBe(1);
    expect(passport.type).toBe("release-passport");
  });

  it("records tool name and version", () => {
    const passport = makeMinimalPassport();
    expect(passport.tool).toEqual({ name: "boardreadyops", version: boardReadyVersion });
  });

  it("records release identity and git provenance", () => {
    const passport = makeMinimalPassport({ releaseId: "v2.3.0", gitSha: "abc123", gitBranch: "release/v2" });
    expect(passport.release.id).toBe("v2.3.0");
    expect(passport.release.git?.sha).toBe("abc123");
    expect(passport.release.git?.branch).toBe("release/v2");
    expect(passport.release.git?.dirty).toBe(false);
  });

  it("omits git block when no git info is provided", () => {
    const passport = makeMinimalPassport({ gitSha: undefined, gitBranch: undefined });
    expect(passport.release.git).toBeUndefined();
  });

  it("sorts gerber and drill artifacts by path", () => {
    const passport = makeMinimalPassport({
      gerbers: [
        { path: "z.gtl", sha256: "a".repeat(64), bytes: 1 },
        { path: "a.gbs", sha256: "b".repeat(64), bytes: 2 },
      ],
      drill: [{ path: "m.drl", sha256: "c".repeat(64), bytes: 3 }],
    });
    expect(passport.artifacts.hardware.gerbers.map((g) => g.path)).toEqual(["a.gbs", "z.gtl"]);
    expect(passport.artifacts.hardware.drill.map((d) => d.path)).toEqual(["m.drl"]);
  });

  it("sorts approvals by timestamp", () => {
    const passport = makeMinimalPassport({
      approvals: [
        { approverId: "b", status: "approved", timestamp: "2026-09-02T00:00:00Z" },
        { approverId: "a", status: "approved", timestamp: "2026-09-01T00:00:00Z" },
      ],
    });
    expect(passport.approvals[0]?.approverId).toBe("a");
    expect(passport.approvals[1]?.approverId).toBe("b");
  });

  it("sorts waivers by fingerprint", () => {
    const passport = makeMinimalPassport({
      waivers: [
        { fingerprint: "z".repeat(64), disposition: "accepted_risk", reason: "r2", owner: "o2" },
        { fingerprint: "a".repeat(64), disposition: "mitigated", reason: "r1", owner: "o1" },
      ],
    });
    expect(passport.waivers[0]?.fingerprint).toBe("a".repeat(64));
    expect(passport.waivers[1]?.fingerprint).toBe("z".repeat(64));
  });

  it("embeds the correct passport digest", () => {
    const passport = makeMinimalPassport();
    const { verification, ...body } = passport;
    const expected = computePassportDigest(body);
    expect(verification.passportDigest).toBe(expected);
  });

  it("produces different digests for different release IDs", () => {
    const a = makeMinimalPassport({ releaseId: "v1.0.0" });
    const b = makeMinimalPassport({ releaseId: "v2.0.0" });
    expect(a.verification.passportDigest).not.toBe(b.verification.passportDigest);
  });

  it("omits optional evidence fields when not provided", () => {
    const passport = makeMinimalPassport({
      evidenceManifestHash: undefined,
      evidenceLedgerPath: undefined,
      evidenceLedgerDigest: undefined,
    });
    expect(passport.evidence.manifestHash).toBeUndefined();
    expect(passport.evidence.ledgerPath).toBeUndefined();
    expect(passport.evidence.ledgerDigest).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computePassportDigest
// ---------------------------------------------------------------------------

describe("computePassportDigest", () => {
  it("returns a 64-char hex string", () => {
    const digest = computePassportDigest({ schemaVersion: 1, type: "release-passport", test: "value" } as never);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const a = computePassportDigest({ x: 1, y: "hello" } as never);
    const b = computePassportDigest({ x: 1, y: "hello" } as never);
    expect(a).toBe(b);
  });

  it("changes when fields differ", () => {
    const a = computePassportDigest({ x: 1 } as never);
    const b = computePassportDigest({ x: 2 } as never);
    expect(a).not.toBe(b);
  });

  it("uses canonical JSON (sorted keys)", () => {
    // Both produce the same canonical form
    const a = computePassportDigest({ b: 1, a: 2 } as never);
    const b = computePassportDigest({ a: 2, b: 1 } as never);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

describe("verifyPassportDigest", () => {
  it("passes for a correctly constructed passport", () => {
    const passport = makeMinimalPassport();
    const result = verifyPassportDigest(passport);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when the digest has been tampered", () => {
    const passport = makeMinimalPassport();
    passport.verification.passportDigest = "0".repeat(64);
    const result = verifyPassportDigest(passport);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("digest mismatch");
    expect(result.errorCodes).toContain("DIGEST_MISMATCH");
  });

  it("fails when schemaVersion is wrong", () => {
    const passport = makeMinimalPassport();
    (passport as { schemaVersion: number }).schemaVersion = 2;
    const result = verifyPassportDigest(passport);
    expect(result.ok).toBe(false);
    expect(result.errorCodes).toContain("SCHEMA_MISMATCH");
  });

  it("fails when type is wrong", () => {
    const passport = makeMinimalPassport();
    (passport as { type: string }).type = "wrong";
    const result = verifyPassportDigest(passport);
    expect(result.ok).toBe(false);
    expect(result.errorCodes).toContain("SCHEMA_MISMATCH");
  });
});

describe("verifyReleasePassport", () => {
  it("verifies the digest without evidence manifest when flag is off", async () => {
    const passport = makeMinimalPassport();
    const result = await verifyReleasePassport(passport, "/some/dir");
    expect(result.ok).toBe(true);
  });

  it("verifies evidence manifest hash when flag is on and hash matches", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "boardreadyops.yml": "version: 1\nfail-on: never\n",
    });
    const manifestContent = '{"test": true}';
    const manifestHash = createHash("sha256").update(manifestContent).digest("hex");
    await fs.mkdir(path.join(root, "bundle"), { recursive: true });
    await fs.writeFile(path.join(root, "bundle", "manifest.json"), manifestContent, "utf8");

    const passport = makeMinimalPassport({ evidenceManifestHash: manifestHash });
    const result = await verifyReleasePassport(passport, root, { verifyEvidenceManifest: true });
    expect(result.ok).toBe(true);
  });

  it("detects evidence manifest hash mismatch", async () => {
    const root = await writeFixture({});
    await fs.mkdir(path.join(root, "bundle"), { recursive: true });
    await fs.writeFile(path.join(root, "bundle", "manifest.json"), "tampered", "utf8");

    const passport = makeMinimalPassport({ evidenceManifestHash: "0".repeat(64) });
    const result = await verifyReleasePassport(passport, root, { verifyEvidenceManifest: true });
    expect(result.ok).toBe(false);
    expect(result.errorCodes).toContain("MANIFEST_HASH_MISMATCH");
  });

  it("reports error when evidence manifest file is missing", async () => {
    const root = await writeFixture({});
    const passport = makeMinimalPassport({ evidenceManifestHash: "a".repeat(64) });
    const result = await verifyReleasePassport(passport, root, { verifyEvidenceManifest: true });
    expect(result.ok).toBe(false);
    expect(result.errorCodes).toContain("MANIFEST_HASH_MISMATCH");
    expect(result.errors[0]).toContain("unreadable");
  });
});

// ---------------------------------------------------------------------------
// Domain state helpers
// ---------------------------------------------------------------------------

describe("deriveBomState", () => {
  it("returns absent when no BOM artifacts exist", () => {
    const manifest = {
      artifacts: [{ path: "report.json", kind: "report", sha256: "a".repeat(64), bytes: 100 }],
    } as unknown as ReleaseEvidenceManifest;
    const state = deriveBomState(manifest);
    expect(state).toEqual({ present: false, format: null, hash: null, componentCount: null });
  });

  it("returns present with the first BOM artifact hash", () => {
    const manifest = {
      artifacts: [
        { path: "bom.csv", kind: "bom", sha256: "b".repeat(64), bytes: 200 },
        { path: "report.json", kind: "report", sha256: "c".repeat(64), bytes: 100 },
      ],
    } as unknown as ReleaseEvidenceManifest;
    const state = deriveBomState(manifest);
    expect(state.present).toBe(true);
    expect(state.hash).toBe("b".repeat(64));
    expect(state.format).toBe("csv");
  });
});

describe("deriveFirmwareState", () => {
  it("returns absent when no firmware hash is provided", () => {
    const state = deriveFirmwareState();
    expect(state).toEqual({ present: false, hash: null, componentCount: null });
  });

  it("returns present with hash and component count", () => {
    const state = deriveFirmwareState("a".repeat(64), 5);
    expect(state.present).toBe(true);
    expect(state.hash).toBe("a".repeat(64));
    expect(state.componentCount).toBe(5);
  });
});

describe("computeRulesetHash", () => {
  it("returns a 64-char hex string", () => {
    const hash = computeRulesetHash({ failOn: "high", rules: ["drc.kicad"] });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic", () => {
    const a = computeRulesetHash({ x: 1 });
    const b = computeRulesetHash({ x: 1 });
    expect(a).toBe(b);
  });

  it("sorts keys canonically", () => {
    const a = computeRulesetHash({ b: 2, a: 1 });
    const b = computeRulesetHash({ a: 1, b: 2 });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("formatPassportText", () => {
  it("renders all major sections of a complete passport", () => {
    const passport = makeMinimalPassport({
      releaseId: "v2.1.0",
      approvals: [{ approverId: "reviewer-1", status: "approved", timestamp: "2026-09-15T12:00:00Z" }],
      waivers: [
        {
          fingerprint: "a".repeat(64),
          disposition: "accepted_risk",
          reason: "Cosmetic silkscreen misalignment on non-critical edge.",
          owner: "lead-eng",
          expiresAt: "2027-01-01T00:00:00Z",
        },
      ],
    });
    const text = formatPassportText(passport);
    expect(text).toContain("Release Passport");
    expect(text).toContain("Release ID:      v2.1.0");
    expect(text).toContain("Source commit:");
    expect(text).toContain("Decision:        PASS");
    expect(text).toContain("Policy:          pass");
    expect(text).toContain("Gerber files:    1");
    expect(text).toContain("Drill files:     1");
    expect(text).toContain("BOM:             present (csv)");
    expect(text).toContain("Firmware:        not declared");
    expect(text).toContain("Approvals:       1");
    expect(text).toContain("Active waivers:  1");
    expect(text).toContain("Evidence bundle: bundle");
    expect(text).toContain("Passport digest:");
    expect(text).toContain("Active waivers:");
    expect(text).toContain("Cosmetic silkscreen");
  });

  it("renders decision reasons when present", () => {
    const passport = makeMinimalPassport();
    passport.decision = { status: "fail", reasons: ["validation failed", "missing gerbers"] };
    const text = formatPassportText(passport);
    expect(text).toContain("Decision:        FAIL");
    expect(text).toContain("Decision reasons:");
    expect(text).toContain("- validation failed");
    expect(text).toContain("- missing gerbers");
  });
});

// ---------------------------------------------------------------------------
// Integration: full generate → verify round-trip
// ---------------------------------------------------------------------------

describe("full round-trip", () => {
  it("generates a passport that passes self-verification", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "boardreadyops.yml": "version: 1\nfail-on: never\n",
    });
    await fs.mkdir(path.join(root, "bundle"), { recursive: true });
    const evidenceManifest = '{"schemaVersion":2,"tool":{"name":"boardreadyops","version":"test"}}';
    await fs.writeFile(path.join(root, "bundle", "manifest.json"), evidenceManifest, "utf8");
    const evidenceManifestHash = createHash("sha256").update(evidenceManifest).digest("hex");

    const passport = buildReleasePassport({
      releaseId: "v3.0.0",
      gitSha: "deadbeef".repeat(8),
      gitDirty: false,
      gitBranch: "release/3.0",
      gerbers: [
        { path: "artifacts/gerbers/top.gtl", sha256: "1".repeat(64), bytes: 2048 },
        { path: "artifacts/gerbers/bottom.gbs", sha256: "2".repeat(64), bytes: 1024 },
      ],
      drill: [{ path: "artifacts/drill/holes.drl", sha256: "3".repeat(64), bytes: 512 }],
      bom: { present: true, format: "csv", hash: "4".repeat(64), componentCount: 30 },
      firmware: { present: false },
      policy: {
        rulesetHash: computeRulesetHash({ failOn: "high" }),
        failOn: "high",
        ruleCount: 8,
        rules: ["drc.kicad", "erc.kicad"],
        policyStatus: "pass",
      },
      kicadVersion: "10.0.0",
      evidenceBundlePath: "bundle",
      evidenceManifestHash,
      approvals: [{ approverId: "auto-gate", status: "approved", timestamp: "2026-09-18T00:00:00Z" }],
      waivers: [],
    });

    // Self-verify
    const selfCheck = verifyPassportDigest(passport);
    expect(selfCheck.ok).toBe(true);

    // With evidence verification
    const fullCheck = await verifyReleasePassport(passport, root, { verifyEvidenceManifest: true });
    expect(fullCheck.ok).toBe(true);

    // Tamper detection: modify release ID
    passport.release.id = "v3.0.1";
    const tamperedCheck = verifyPassportDigest(passport);
    expect(tamperedCheck.ok).toBe(false);
    expect(tamperedCheck.errorCodes).toContain("DIGEST_MISMATCH");
  });

  it("explicitly represents absent firmware and BOM as absent, not omitted", () => {
    const passport = makeMinimalPassport({
      bom: { present: false },
      firmware: { present: false },
    });
    expect(passport.artifacts.bom.present).toBe(false);
    expect(passport.artifacts.bom.hash).toBeUndefined();
    expect(passport.artifacts.firmware.present).toBe(false);
    expect(passport.artifacts.firmware.hash).toBeUndefined();

    // Validate the schema still passes with explicit nulls
    const ajv = new Ajv2020({ allErrors: true });
    const validate = ajv.compile(passportSchema);
    expect(validate(passport), JSON.stringify(validate.errors)).toBe(true);
  });
});
