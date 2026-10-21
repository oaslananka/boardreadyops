import { createHash, createPublicKey } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { verifyManufacturingDraftReceipt } from "../../../src/runner/draft-attestation.js";
import { resolveLocalArtifactFile } from "./artifact-downloads.js";

// Ephemeral runner claim verification ONLY. No approval, manufacturing artifact
// promotion, guest access or persistent authorization is created by this module.
export type DraftProvenanceResult =
  | { status: "verified-runner-claim"; archiveArtifactId: string; receiptArtifactId: string; archiveSha256: string }
  | { status: "unverified"; reason: "missing" | "ineligible" | "identity" | "signature" | "bytes" | "storage" };

type RecordRow = Record<string, unknown>;
type ArtifactRecord = RecordRow & {
  artifact_id: string;
  cap_kind: string;
  cap_role: string;
  cap_name: string;
  cap_storage_path: string;
  cap_content_type: string;
  cap_declared_bytes: number;
  cap_expected_sha256: string | null;
  registration_allowed_repositories: string[];
  name: string;
  kind: string;
  role: string;
  storage_path: string;
  sha256: string;
  bytes: number;
  content_type: string;
  capability_status: string;
  run_id: string;
  execution_attempt_id: string;
  lease_id: string;
  worker_class: string;
  runner_id: string;
  registration_id: string | null;
  managed_identity_id: string | null;
  registered_key: string;
  registered_status: string;
  registered_algorithm: string;
  disabled_at: Date | null;
  lease_status: string;
  lease_registration_id: string | null;
  lease_managed_identity_id: string | null;
  lease_worker_class: string;
  run_status: string;
  run_decision: string;
  run_attempt_id: string;
  commit_sha: string;
  repository_owner: string;
  repository_name: string;
  repository_private: boolean;
  repository_disabled_at: Date | null;
  attempt_status: string;
  trust_mode: string;
};

const maxArchiveBytes = 64 * 1024 * 1024;
const maxReceiptBytes = 16 * 1024;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

// Query source identity from server-owned registrations, NEVER from the receipt.
const trustedArtifactsQuery = [
  "select artifact.id as artifact_id, artifact.kind, artifact.role, artifact.name,",
  " artifact.storage_path, artifact.sha256, artifact.bytes, artifact.content_type,",
  " capability.kind as cap_kind, capability.role as cap_role, capability.name as cap_name,",
  " capability.storage_path as cap_storage_path, capability.content_type as cap_content_type,",
  " capability.declared_bytes as cap_declared_bytes, capability.expected_sha256 as cap_expected_sha256,",
  " coalesce(reg.allowed_repositories, '{}'::text[]) as registration_allowed_repositories,",
  " capability.status as capability_status, capability.run_id, capability.execution_attempt_id,",
  " capability.lease_id, capability.worker_class,",
  " coalesce(capability.runner_registration_id, capability.managed_runner_identity_id) as runner_id,",
  " capability.runner_registration_id as registration_id,",
  " capability.managed_runner_identity_id as managed_identity_id,",
  " coalesce(reg.public_key, managed.public_key) as registered_key,",
  " coalesce(reg.status, managed.status) as registered_status,",
  " coalesce(reg.signing_algorithm, managed.signing_algorithm) as registered_algorithm,",
  " coalesce(reg.disabled_at, managed.disabled_at) as disabled_at,",
  " lease.status as lease_status,",
  " lease.runner_registration_id as lease_registration_id,",
  " lease.managed_runner_identity_id as lease_managed_identity_id,",
  " lease.worker_class as lease_worker_class,",
  " run.status as run_status, run.decision as run_decision,",
  " run.execution_attempt_id as run_attempt_id, run.commit_sha,",
  " repository.owner as repository_owner, repository.name as repository_name,",
  " repository.private as repository_private, repository.disabled_at as repository_disabled_at,",
  " attempt.status as attempt_status, run.trust_mode",
  " from runner_artifact_upload_capabilities as capability",
  " left join artifacts as artifact on artifact.id = capability.artifact_id",
  "   and artifact.run_id = capability.run_id",
  " join release_runs as run on run.id = capability.run_id",
  " join repositories as repository on repository.id = run.repository_id",
  " join release_run_attempts as attempt",
  "   on attempt.id = capability.execution_attempt_id and attempt.run_id = capability.run_id",
  " join runner_job_leases as lease",
  "   on lease.id = capability.lease_id and lease.run_id = capability.run_id",
  "   and lease.execution_attempt_id = capability.execution_attempt_id",
  " left join runner_registrations as reg",
  "   on reg.id = capability.runner_registration_id",
  "   and reg.installation_id = repository.installation_id",
  " left join managed_runner_identities as managed on managed.id = capability.managed_runner_identity_id",
  " where capability.run_id = $1 and capability.execution_attempt_id = $2",
  " order by capability.artifact_id",
].join("\n");

function validArtifact(value: RecordRow): value is ArtifactRecord {
  return (
    typeof value.artifact_id === "string" &&
    uuidPattern.test(value.artifact_id) &&
    typeof value.storage_path === "string" &&
    typeof value.sha256 === "string" &&
    sha256Pattern.test(value.sha256) &&
    typeof value.bytes === "number" &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    typeof value.kind === "string" &&
    typeof value.role === "string" &&
    typeof value.name === "string" &&
    typeof value.cap_kind === "string" &&
    typeof value.cap_role === "string" &&
    typeof value.cap_name === "string" &&
    typeof value.cap_storage_path === "string" &&
    typeof value.cap_content_type === "string" &&
    typeof value.cap_declared_bytes === "number" &&
    (value.cap_expected_sha256 === null || typeof value.cap_expected_sha256 === "string") &&
    Array.isArray(value.registration_allowed_repositories) &&
    value.registration_allowed_repositories.every((repo: unknown) => typeof repo === "string") &&
    typeof value.content_type === "string" &&
    typeof value.runner_id === "string" &&
    typeof value.registered_key === "string" &&
    typeof value.repository_owner === "string" &&
    typeof value.repository_name === "string" &&
    typeof value.commit_sha === "string" &&
    /^[0-9a-f]{40}$/u.test(value.commit_sha)
  );
}

function sameTrustedLease(record: ArtifactRecord, runId: string, attemptId: string): boolean {
  if (
    record.capability_status !== "uploaded" ||
    record.cap_kind !== record.kind ||
    record.cap_role !== record.role ||
    record.cap_name !== record.name ||
    record.cap_storage_path !== record.storage_path ||
    record.cap_content_type !== record.content_type ||
    record.cap_declared_bytes !== record.bytes ||
    record.cap_expected_sha256 !== record.sha256 ||
    record.run_id !== runId ||
    record.execution_attempt_id !== attemptId ||
    record.run_attempt_id !== attemptId ||
    record.run_status !== "completed" ||
    record.run_decision !== "pass" ||
    record.attempt_status !== "completed" ||
    record.lease_status !== "completed" ||
    record.registered_status !== "active" ||
    record.registered_algorithm !== "ed25519" ||
    record.disabled_at !== null ||
    record.repository_private ||
    record.repository_disabled_at !== null ||
    record.trust_mode !== "standard" ||
    record.lease_worker_class !== record.worker_class ||
    !uuidPattern.test(record.runner_id)
  )
    return false;
  const currentRepository = (record.repository_owner + "/" + record.repository_name).toLowerCase();
  return record.worker_class === "self_hosted"
    ? (record.registration_allowed_repositories.length === 0 ||
        record.registration_allowed_repositories.some((allowed) => allowed.toLowerCase() === currentRepository)) &&
        record.registration_id === record.runner_id &&
        record.managed_identity_id === null &&
        record.lease_registration_id === record.runner_id &&
        record.lease_managed_identity_id === null
    : record.worker_class === "managed" &&
        record.managed_identity_id === record.runner_id &&
        record.registration_id === null &&
        record.lease_managed_identity_id === record.runner_id &&
        record.lease_registration_id === null;
}

async function checkedBytes(storageRoot: string, record: ArtifactRecord, limit: number): Promise<Buffer | undefined> {
  if (record.bytes > limit) return undefined;
  const resolution = await resolveLocalArtifactFile(storageRoot, record.storage_path);
  if (resolution.state !== "resolved") return undefined;
  const handle = await open(resolution.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== record.bytes) return undefined;
    const buffer = await handle.readFile();
    const after = await handle.stat();
    if (
      buffer.length !== record.bytes ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      createHash("sha256").update(buffer).digest("hex") !== record.sha256
    )
      return undefined;
    return buffer;
  } finally {
    await handle.close();
  }
}

export async function verifyStoredManufacturingDraftClaim(input: {
  executor: SqlQueryExecutor;
  runId: string;
  executionAttemptId: string;
  storageRoot: string;
  storageDriver: string;
}): Promise<DraftProvenanceResult> {
  const fail = (reason: Extract<DraftProvenanceResult, { status: "unverified" }>["reason"]) =>
    ({ status: "unverified", reason }) as const;
  if (
    !uuidPattern.test(input.runId) ||
    !uuidPattern.test(input.executionAttemptId) ||
    input.storageDriver !== "local" ||
    !input.storageRoot
  )
    return fail("storage");
  try {
    const result = await input.executor.query(trustedArtifactsQuery, [input.runId, input.executionAttemptId]);
    const records = (result as { rows: RecordRow[] }).rows;
    if (!records?.length) return fail("missing");
    if (!records.every(validArtifact)) return fail("ineligible");
    const drafts = records.filter((row) => row.kind === "archive" && row.role === "draft-manufacturing");
    const receipts = records.filter((row) => row.kind === "attestation" && row.role === "draft-provenance");
    if (drafts.length !== 1 || receipts.length !== 1) return fail("ineligible");
    const archive = drafts[0];
    const receipt = receipts[0];
    if (!archive || !receipt) return fail("ineligible");
    if (
      !sameTrustedLease(archive, input.runId, input.executionAttemptId) ||
      !sameTrustedLease(receipt, input.runId, input.executionAttemptId) ||
      archive.lease_id !== receipt.lease_id ||
      archive.runner_id !== receipt.runner_id ||
      archive.worker_class !== receipt.worker_class ||
      archive.content_type !== "application/zip" ||
      receipt.content_type !== "application/json" ||
      archive.bytes > maxArchiveBytes ||
      receipt.bytes > maxReceiptBytes
    )
      return fail("ineligible");
    const publicKey = createPublicKey(archive.registered_key);
    if (publicKey.asymmetricKeyType !== "ed25519" || archive.registered_key !== receipt.registered_key) {
      return fail("identity");
    }
    const receiptBytes = await checkedBytes(input.storageRoot, receipt, maxReceiptBytes);
    if (!receiptBytes) return fail("bytes");
    let parsed: unknown;
    try {
      parsed = JSON.parse(receiptBytes.toString("utf8")) as unknown;
    } catch {
      return fail("signature");
    }
    if (!verifyManufacturingDraftReceipt(parsed, publicKey)) return fail("signature");
    const candidate = parsed as { payload: Record<string, unknown> };
    if (
      candidate.payload.runnerId !== archive.runner_id ||
      candidate.payload.runId !== input.runId ||
      candidate.payload.executionAttemptId !== input.executionAttemptId ||
      candidate.payload.repository !== `${archive.repository_owner}/${archive.repository_name}` ||
      candidate.payload.sourceCommitSha !== archive.commit_sha ||
      candidate.payload.archiveSha256 !== archive.sha256 ||
      candidate.payload.archiveBytes !== archive.bytes
    )
      return fail("identity");
    const archiveBytes = await checkedBytes(input.storageRoot, archive, maxArchiveBytes);
    if (archiveBytes?.subarray(0, 4).toString("hex") !== "504b0304") return fail("bytes");
    return {
      status: "verified-runner-claim",
      archiveArtifactId: archive.artifact_id,
      receiptArtifactId: receipt.artifact_id,
      archiveSha256: archive.sha256,
    };
  } catch {
    // Includes unavailable DB, unsafe/missing path and malformed registered key.
    return fail("storage");
  }
}
