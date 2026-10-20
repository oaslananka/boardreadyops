import { createHash, type KeyLike, sign, verify } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { RunnerClaimedJob } from "../../packages/contracts/src/index.js";

// Keep the signer independent of worker.ts so runtime architecture stays acyclic.
type DraftArchiveArtifact = {
  kind: string;
  name: string;
  role: string;
  contentType?: string;
  filePath: string;
  bytes: number;
  sha256: string;
};

const domain = "boardreadyops-runner-draft-receipt-v1\n";
const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const payloadSchema = z
  .object({
    version: z.literal(1),
    purpose: z.literal("manufacturing-draft"),
    runnerId: uuid,
    runId: uuid,
    executionAttemptId: uuid,
    repository: z
      .string()
      .min(3)
      .max(300)
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u),
    sourceCommitSha: z.string().regex(/^[0-9a-f]{40}$/u),
    archiveSha256: sha256,
    archiveBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
  })
  .strict();
const signedSchema = z
  .object({
    payload: payloadSchema,
    algorithm: z.literal("Ed25519"),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/u),
  })
  .strict();

export type SignedManufacturingDraftReceipt = z.infer<typeof signedSchema>;

function signedBytes(payload: z.infer<typeof payloadSchema>): Buffer {
  return Buffer.from(domain + JSON.stringify(payload), "utf8");
}

/**
 * A runner's authenticated CLAIM over the draft bytes and leased source.
 * Verification alone is NOT an engineering approval, independent execution
 * attestation or authorization to fabricate. The verifier must separately
 * resolve the runner key and check current run/attempt/source/artifact state.
 */
export function signManufacturingDraftReceipt(
  payload: z.infer<typeof payloadSchema>,
  privateKey: KeyLike,
): SignedManufacturingDraftReceipt {
  const normalized = payloadSchema.parse(payload);
  return signedSchema.parse({
    payload: normalized,
    algorithm: "Ed25519",
    signature: sign(null, signedBytes(normalized), privateKey).toString("base64url"),
  });
}

export function verifyManufacturingDraftReceipt(value: unknown, publicKey: KeyLike): boolean {
  const parsed = signedSchema.safeParse(value);
  if (!parsed.success) return false;
  const { payload, signature } = parsed.data;
  const decoded = Buffer.from(signature, "base64url");
  if (decoded.length !== 64 || decoded.toString("base64url") !== signature) return false;
  try {
    return verify(null, signedBytes(payload), publicKey, decoded);
  } catch {
    return false;
  }
}

/** Write a detached, non-delivery-eligible receipt beside one verified draft. */
export async function createManufacturingDraftReceiptArtifact(input: {
  workspace: string;
  job: RunnerClaimedJob;
  runnerId: string;
  privateKey: KeyLike;
  archive: DraftArchiveArtifact;
}): Promise<DraftArchiveArtifact> {
  const { archive, job } = input;
  if (job.safeMode.enabled || job.repository.private || job.sourceMode !== "customer_checkout") {
    throw new Error("draft provenance requires an authorized public source checkout");
  }
  if (
    archive.kind !== "archive" ||
    archive.role !== "draft-manufacturing" ||
    archive.contentType !== "application/zip"
  ) {
    throw new Error("draft provenance must reference a draft manufacturing ZIP");
  }
  const workspace = await realpath(path.resolve(input.workspace));
  const archivePath = await realpath(path.resolve(archive.filePath));
  const relative = path.relative(workspace, archivePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative.split(path.sep).includes("..")) {
    throw new Error("draft archive escaped the disposable runner checkout");
  }
  const handle = await open(archivePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let data: Buffer;
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size === 0 || stats.size > 64 * 1024 * 1024) {
      throw new Error("draft archive must be a bounded regular file");
    }
    data = await handle.readFile();
  } finally {
    await handle.close();
  }
  if (data.byteLength !== archive.bytes || createHash("sha256").update(data).digest("hex") !== archive.sha256) {
    throw new Error("draft archive digest changed before runner signing");
  }
  const receipt = signManufacturingDraftReceipt(
    {
      version: 1,
      purpose: "manufacturing-draft",
      runnerId: input.runnerId,
      runId: job.runId,
      executionAttemptId: job.executionAttemptId,
      repository: `${job.repository.owner}/${job.repository.name}`,
      sourceCommitSha: job.repository.commitSha,
      archiveSha256: archive.sha256,
      archiveBytes: archive.bytes,
    },
    input.privateKey,
  );
  const content = Buffer.from(`${JSON.stringify(receipt)}\n`, "utf8");
  const filePath = path.join(path.dirname(archivePath), "manufacturing-draft-receipt.json");
  await writeFile(filePath, content, { flag: "wx", mode: 0o600 });
  return {
    kind: "attestation",
    role: "draft-provenance",
    name: "boardreadyops-manufacturing-draft-receipt.json",
    contentType: "application/json",
    filePath,
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}
