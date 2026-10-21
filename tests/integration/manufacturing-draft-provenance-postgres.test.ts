import { createHash, generateKeyPairSync, randomInt, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { verifyStoredManufacturingDraftClaim } from "../../apps/web/lib/manufacturing-draft-provenance.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";
import { signManufacturingDraftReceipt } from "../../src/runner/draft-attestation.js";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const installation = randomUUID();
const repository = randomUUID();
const run = randomUUID();
const attempt = randomUUID();
const lease = randomUUID();
const runner = randomUUID();
const zipArtifact = randomUUID();
const receiptArtifact = randomUUID();
const rootPaths: string[] = [];
const digest = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

afterAll(async () => {
  await Promise.all(rootPaths.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  if (executor) {
    try {
      await executor.query("delete from runner_artifact_upload_capabilities where run_id = $1", [run]);
      await executor.query("delete from runner_job_leases where run_id = $1", [run]);
      await executor.query("delete from installations where id = $1", [installation]);
      await executor.query("delete from runner_registrations where id = $1", [runner]);
    } finally {
      await executor.close();
    }
  }
});

async function prepareDraftFixture(db: NonNullable<typeof executor>) {
  const key = generateKeyPairSync("ed25519");
  const publicKey = key.publicKey.export({ type: "spki", format: "pem" }).toString();
  const folder = await mkdtemp(path.join(os.tmpdir(), "bro-draft-real-pg-"));
  rootPaths.push(folder);
  const zip = Buffer.from(
    "UEsDBBQAAAAIAKRtVV0z7c5VJwAAACUAAAAWAAAAZmFicmljYXRpb24vUkVBRE1FLnR4dHMJcnQLUfD384lU0FXw8w9RcHN0CvJ0dgzx9PdTcAwICPIPc/QBAFBLAQIUAxQAAAAIAKRtVV0z7c5VJwAAACUAAAAWAAAAAAAAAAAAAACAAQAAAABmYWJyaWNhdGlvbi9SRUFETUUudHh0UEsFBgAAAAABAAEARAAAAFsAAAAAAA==",
    "base64",
  );
  const receipt = Buffer.from(
    JSON.stringify(
      signManufacturingDraftReceipt(
        {
          version: 1,
          purpose: "manufacturing-draft",
          runnerId: runner,
          runId: run,
          executionAttemptId: attempt,
          repository: "verify-fixture/pcb",
          sourceCommitSha: "a".repeat(40),
          archiveSha256: digest(zip),
          archiveBytes: zip.length,
        },
        key.privateKey,
      ),
    ),
  );
  await writeFile(path.join(folder, "archive.zip"), zip);
  await writeFile(path.join(folder, "receipt.json"), receipt);

  await db.query(
    "insert into installations (id, github_installation_id, account_login, account_type) values ($1, $2, 'verify-fixture', 'Organization')",
    [installation, randomInt(1000000000, 2000000000)],
  );
  await db.query(
    "insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch) values ($1, $2, $3, 'verify-fixture', 'pcb', false, 'main')",
    [repository, installation, randomInt(1000000000, 2000000000)],
  );
  await db.query(
    "insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status, decision, started_at, completed_at) values ($1, $2, $3, 'refs/heads/main', 'push', 'completed', 'pass', now(), now())",
    [run, repository, "a".repeat(40)],
  );
  await db.query(
    "insert into release_run_attempts (id, run_id, attempt_number, status, started_at, completed_at) values ($1, $2, 1, 'completed', now(), now())",
    [attempt, run],
  );
  await db.query(
    "update release_runs set execution_attempt_id = $1, execution_attempt_started_at = now() where id = $2",
    [attempt, run],
  );
  await db.query(
    "insert into runner_registrations (id, installation_id, name, public_key, public_key_fingerprint, status, activated_at, last_heartbeat_at) values ($1, $2, $3, $4, $5, 'active', now(), now())",
    [runner, installation, "draft-verifier", publicKey, digest(Buffer.from(publicKey))],
  );
  await db.query(
    "insert into runner_job_leases (id, run_id, execution_attempt_id, worker_class, runner_registration_id, lease_token_digest, status, claimed_at, heartbeat_at, expires_at, maximum_expires_at, closed_at, expected_run_status, expected_run_version, expected_attempt_status, expected_attempt_version) values ($1, $2, $3, 'self_hosted', $4, $5, 'completed', now() - interval '5 minutes', now(), now() + interval '5 minutes', now() + interval '15 minutes', now(), 'completed', 0, 'completed', 0)",
    [lease, run, attempt, runner, "a".repeat(64)],
  );

  await insertDraftArtifactRows(db, zip, receipt);
  return { executor: db, runId: run, executionAttemptId: attempt, storageRoot: folder, storageDriver: "local" };
}

async function insertDraftArtifactRows(db: NonNullable<typeof executor>, zip: Buffer, receipt: Buffer) {
  for (const item of [
    {
      id: zipArtifact,
      kind: "archive",
      role: "draft-manufacturing",
      name: "draft.zip",
      file: "archive.zip",
      bytes: zip,
    },
    {
      id: receiptArtifact,
      kind: "attestation",
      role: "draft-provenance",
      name: "draft-receipt.json",
      file: "receipt.json",
      bytes: receipt,
    },
  ]) {
    const contentType = item.kind === "archive" ? "application/zip" : "application/json";
    await db.query(
      "insert into artifacts (id, run_id, kind, name, storage_path, sha256, bytes, role, content_type) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [item.id, run, item.kind, item.name, item.file, digest(item.bytes), item.bytes.length, item.role, contentType],
    );
    await db.query(
      "insert into runner_artifact_upload_capabilities (artifact_id, run_id, execution_attempt_id, lease_id, worker_class, runner_registration_id, kind, name, role, declared_bytes, expected_sha256, storage_path, upload_token_digest, status, issued_at, expires_at, upload_started_at, uploaded_at, content_type) values ($1, $2, $3, $4, 'self_hosted', $5, $6, $7, $8, $9, $10, $11, $12, 'uploaded', now() - interval '2 minutes', now() + interval '5 minutes', now() - interval '1 minutes', now(), $13)",
      [
        item.id,
        run,
        attempt,
        lease,
        runner,
        item.kind,
        item.name,
        item.role,
        item.bytes.length,
        digest(item.bytes),
        item.file,
        "b".repeat(64),
        contentType,
      ],
    );
  }
}

describeDatabase("real PostgreSQL runner draft provenance verification", () => {
  it("verifies server-owned identity and persisted capability against actual local archive bytes", async () => {
    if (!executor) throw new Error("isolated PostgreSQL is required");
    const input = await prepareDraftFixture(executor);
    expect(await verifyStoredManufacturingDraftClaim(input)).toMatchObject({
      status: "verified-runner-claim",
      archiveArtifactId: zipArtifact,
      receiptArtifactId: receiptArtifact,
    });
    await executor.query(
      "update runner_registrations set allowed_repositories=ARRAY['other-owner/pcb']::text[] where id=$1",
      [runner],
    );
    expect((await verifyStoredManufacturingDraftClaim(input)).status).toBe("unverified");
    await executor.query("update runner_registrations set allowed_repositories='{}'::text[] where id=$1", [runner]);
    await executor.query(
      "update runner_job_leases set status='revoked', closed_at=now(), close_reason='fixture test' where id=$1",
      [lease],
    );
    expect((await verifyStoredManufacturingDraftClaim(input)).status).toBe("unverified");
    await executor.query("update runner_job_leases set status='completed' where id=$1", [lease]);
    await executor.query("update runner_registrations set status='disabled', disabled_at=now() where id=$1", [runner]);
    expect((await verifyStoredManufacturingDraftClaim(input)).status).toBe("unverified");
    await executor.query("update runner_registrations set status='active', disabled_at=null where id=$1", [runner]);
    await executor.query("update release_runs set commit_sha=$1 where id=$2", ["b".repeat(40), run]);
    expect((await verifyStoredManufacturingDraftClaim(input)).status).toBe("unverified");
    await executor.query("update release_runs set commit_sha=$1 where id=$2", ["a".repeat(40), run]);
    await writeFile(path.join(input.storageRoot, "archive.zip"), Buffer.from("modified payload"));
    expect((await verifyStoredManufacturingDraftClaim(input)).status).toBe("unverified");
  });
});
