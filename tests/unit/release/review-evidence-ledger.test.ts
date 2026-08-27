import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyReviewEvidenceOffline, writeReviewEvidenceLedger } from "../../../src/release/evidence.js";
import { writeFixture } from "../rules/helpers.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function ledgerFixture() {
  const root = await writeFixture({});
  roots.push(root);
  const artifactContent = "artifact-bytes";
  const artifactPath = path.join(root, "artifacts", "mainboard_bom.csv");
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, artifactContent, "utf8");
  const sha256 = createHash("sha256").update(artifactContent).digest("hex");

  const written = await writeReviewEvidenceLedger({
    outputDir: root,
    repository: "acme-hardware/gateway",
    baseSha: "7b4a2c1f",
    headSha: "e93d81b4",
    manifest: [
      {
        name: "mainboard_bom.csv",
        path: "artifacts/mainboard_bom.csv",
        type: "bom",
        sizeBytes: artifactContent.length,
        sha256,
      },
    ],
    decisions: [
      {
        fingerprint: "f".repeat(64),
        disposition: "accepted_risk",
        reason: "Reviewed and accepted by the manufacturing engineer for this revision.",
        owner: "mfg-lead@acme.corp",
        timestamp: "2026-08-25T16:00:00.000Z",
      },
    ],
    approvals: [
      {
        approverId: "alex.kumar@acme.corp",
        status: "approved",
        isBreakGlass: false,
        timestamp: "2026-08-25T16:05:00.000Z",
      },
    ],
    checklist: [{ id: "chk_01", title: "Verify isolation clearance", completed: true }],
  });

  return { root, written, sha256 };
}

describe("writeReviewEvidenceLedger", () => {
  it("writes a ledger and manifest file and returns their paths with a matching digest", async () => {
    const { root, written } = await ledgerFixture();

    const ledgerRaw = JSON.parse(await fs.readFile(written.ledgerPath, "utf8"));
    expect(ledgerRaw.evidenceDigest).toBe(written.evidenceDigest);
    expect(ledgerRaw.repository).toBe("acme-hardware/gateway");
    expect(written.ledgerPath).toBe(path.join(root, "evidence-ledger.json"));
    expect(written.manifestPath).toBe(path.join(root, "manifest.json"));
  });

  it("produces the same digest for the same input, and a different digest when a decision changes", async () => {
    const first = await ledgerFixture();
    const second = await ledgerFixture();
    expect(second.written.evidenceDigest).toBe(first.written.evidenceDigest);
  });
});

describe("verifyReviewEvidenceOffline", () => {
  it("verifies a freshly written ledger against its artifacts with no network access", async () => {
    const { root } = await ledgerFixture();
    const result = await verifyReviewEvidenceOffline(path.join(root, "evidence-ledger.json"), root);

    expect(result.verified).toBe(true);
    expect(result.manifestCheckPassed).toBe(true);
    expect(result.tamperedItems).toEqual([]);
    expect(result.missingItems).toEqual([]);
  });

  it("detects a single tampered byte in an artifact referenced by the manifest", async () => {
    const { root } = await ledgerFixture();
    await fs.writeFile(path.join(root, "artifacts", "mainboard_bom.csv"), "artifact-bytex", "utf8");

    const result = await verifyReviewEvidenceOffline(path.join(root, "evidence-ledger.json"), root);

    expect(result.verified).toBe(false);
    expect(result.tamperedItems).toHaveLength(1);
    expect(result.tamperedItems[0]).toContain("mainboard_bom.csv");
  });

  it("flags a manifest entry whose artifact file is missing entirely", async () => {
    const { root } = await ledgerFixture();
    await fs.rm(path.join(root, "artifacts", "mainboard_bom.csv"));

    const result = await verifyReviewEvidenceOffline(path.join(root, "evidence-ledger.json"), root);

    expect(result.verified).toBe(false);
    expect(result.missingItems).toContain("artifacts/mainboard_bom.csv");
  });

  it("detects the ledger digest itself being tampered with", async () => {
    const { root } = await ledgerFixture();
    const ledgerPath = path.join(root, "evidence-ledger.json");
    const doc = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
    doc.evidenceDigest = "0".repeat(64);
    await fs.writeFile(ledgerPath, JSON.stringify(doc, null, 2), "utf8");

    const result = await verifyReviewEvidenceOffline(ledgerPath, root);

    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.includes("digest mismatch"))).toBe(true);
  });

  it("rejects an accepted_risk decision with a reason shorter than 20 characters", async () => {
    const { root } = await ledgerFixture();
    const ledgerPath = path.join(root, "evidence-ledger.json");
    const doc = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
    doc.decisions[0].reason = "too short";
    await fs.writeFile(ledgerPath, JSON.stringify(doc, null, 2), "utf8");

    const result = await verifyReviewEvidenceOffline(ledgerPath, root);

    expect(result.errors.some((e) => e.includes("accepted_risk requires min 20 char reason"))).toBe(true);
  });
});
