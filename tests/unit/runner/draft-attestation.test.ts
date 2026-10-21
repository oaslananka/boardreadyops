import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunnerClaimedJob } from "../../../packages/contracts/src/index.js";
import {
  createManufacturingDraftReceiptArtifact,
  signManufacturingDraftReceipt,
  verifyManufacturingDraftReceipt,
} from "../../../src/runner/draft-attestation.js";

const rootPaths: string[] = [];
const keys = generateKeyPairSync("ed25519");
const other = generateKeyPairSync("ed25519");
const payload = {
  version: 1 as const,
  purpose: "manufacturing-draft" as const,
  runnerId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  executionAttemptId: "33333333-3333-4333-8333-333333333333",
  repository: "oaslananka/boardreadyops",
  sourceCommitSha: "a".repeat(40),
  archiveSha256: "b".repeat(64),
  archiveBytes: 2048,
};

afterEach(async () => {
  await Promise.all(rootPaths.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("manufacturing draft runner claim receipt (never fabrication approval)", () => {
  it("authenticates the signed run/attempt/repository/commit/ZIP digest using Ed25519", () => {
    const receipt = signManufacturingDraftReceipt(payload, keys.privateKey);
    expect(receipt.algorithm).toBe("Ed25519");
    expect(verifyManufacturingDraftReceipt(receipt, keys.publicKey)).toBe(true);
    expect(verifyManufacturingDraftReceipt(receipt, other.publicKey)).toBe(false);
    for (const modified of [
      { ...payload, runnerId: other.publicKey.asymmetricKeyType },
      { ...payload, runId: "44444444-4444-4444-8444-444444444444" },
      { ...payload, executionAttemptId: "55555555-5555-4555-8555-555555555555" },
      { ...payload, repository: "attacker/boardreadyops" },
      { ...payload, sourceCommitSha: "c".repeat(40) },
      { ...payload, archiveSha256: "d".repeat(64) },
      { ...payload, archiveBytes: 2049 },
    ]) {
      expect(verifyManufacturingDraftReceipt({ ...receipt, payload: modified }, keys.publicKey)).toBe(false);
    }
    expect(verifyManufacturingDraftReceipt({ ...receipt, signature: "e".repeat(86) }, keys.publicKey)).toBe(false);
    expect(verifyManufacturingDraftReceipt({ ...receipt, unknownAuthority: true }, keys.publicKey)).toBe(false);
    expect(verifyManufacturingDraftReceipt({ ...receipt, algorithm: "HS256" }, keys.publicKey)).toBe(false);
  });

  it("refuses an invalid source commit or archive digest before signing", () => {
    expect(() => signManufacturingDraftReceipt({ ...payload, sourceCommitSha: "main" }, keys.privateKey)).toThrow();
    expect(() => signManufacturingDraftReceipt({ ...payload, archiveSha256: "not-hex" }, keys.privateKey)).toThrow();
  });

  it("signs actual draft bytes in the checkout, refuses mutated bytes and stays non-delivery-eligible", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "bro-draft-receipt-"));
    rootPaths.push(workspace);
    const sourceFile = path.join(workspace, "draft.zip");
    const bytes = Buffer.from("PK\x03\x04 verified draft ZIP");
    await writeFile(sourceFile, bytes);
    const archive = {
      kind: "archive",
      role: "draft-manufacturing",
      name: "draft.zip",
      contentType: "application/zip",
      filePath: sourceFile,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const job = {
      safeMode: { enabled: false, reasons: [] },
      repository: { owner: "oaslananka", name: "boardreadyops", commitSha: payload.sourceCommitSha, private: false },
      sourceMode: "customer_checkout",
      runId: payload.runId,
      executionAttemptId: payload.executionAttemptId,
    } as unknown as RunnerClaimedJob;

    const result = await createManufacturingDraftReceiptArtifact({
      workspace,
      job,
      runnerId: payload.runnerId,
      privateKey: keys.privateKey,
      archive,
    });
    expect(result).toMatchObject({ kind: "attestation", role: "draft-provenance", contentType: "application/json" });
    const receipt = JSON.parse(await readFile(result.filePath, "utf8"));
    expect(verifyManufacturingDraftReceipt(receipt, keys.publicKey)).toBe(true);
    expect(receipt.payload.archiveSha256).toBe(archive.sha256);
    await expect(
      createManufacturingDraftReceiptArtifact({
        workspace,
        job,
        runnerId: payload.runnerId,
        privateKey: keys.privateKey,
        archive,
      }),
    ).rejects.toThrow(); // no silent replacement of a signed receipt

    const modified = { ...archive, sha256: "f".repeat(64) };
    await expect(
      createManufacturingDraftReceiptArtifact({
        workspace,
        job,
        runnerId: payload.runnerId,
        privateKey: keys.privateKey,
        archive: modified,
      }),
    ).rejects.toThrow(/digest changed/);
    await expect(
      createManufacturingDraftReceiptArtifact({
        workspace,
        job: { ...job, safeMode: { enabled: true, reasons: ["private-repository"] } },
        runnerId: payload.runnerId,
        privateKey: keys.privateKey,
        archive,
      }),
    ).rejects.toThrow(/authorized public/);
    await expect(
      createManufacturingDraftReceiptArtifact({
        workspace,
        job: { ...job, repository: { ...job.repository, private: true } },
        runnerId: payload.runnerId,
        privateKey: keys.privateKey,
        archive,
      }),
    ).rejects.toThrow(/authorized public/);
  });

  it("does not follow a symlinked draft into a different directory", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "bro-draft-receipt-src-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "bro-draft-receipt-dst-"));
    rootPaths.push(workspace, outside);
    const secretFile = path.join(outside, "draft.zip");
    const bytes = Buffer.from("PK\x03\x04 external file");
    await writeFile(secretFile, bytes);
    const link = path.join(workspace, "draft.zip");
    await symlink(secretFile, link);
    const job = {
      safeMode: { enabled: false, reasons: [] },
      repository: { owner: "oaslananka", name: "boardreadyops", commitSha: payload.sourceCommitSha, private: false },
      sourceMode: "customer_checkout",
      runId: payload.runId,
      executionAttemptId: payload.executionAttemptId,
    } as unknown as RunnerClaimedJob;
    await expect(
      createManufacturingDraftReceiptArtifact({
        workspace,
        job,
        runnerId: payload.runnerId,
        privateKey: keys.privateKey,
        archive: {
          kind: "archive",
          name: "draft.zip",
          role: "draft-manufacturing",
          contentType: "application/zip",
          filePath: link,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      }),
    ).rejects.toThrow(/escaped/);
  });
});
