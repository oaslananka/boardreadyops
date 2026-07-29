import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlArtifactDeletionStore } from "../../packages/db/src/artifact-deletion-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : undefined;
let githubIdentifier = 995_000_000;

function requireExecutor() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

async function fixture(label: string) {
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const runId = randomUUID();
  githubIdentifier += 1;
  await requireExecutor().query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, $3, 'Organization')`,
    [installationId, githubIdentifier, `artifact-delete-${label}`],
  );
  githubIdentifier += 1;
  await requireExecutor().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
     values ($1, $2, $3, $4, $5, true, 'main')`,
    [repositoryId, installationId, githubIdentifier, `owner-${label}`, `repo-${label}`],
  );
  await requireExecutor().query(
    `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status, started_at)
     values ($1, $2, $3, 'refs/heads/main', 'push', 'completed', now())`,
    [runId, repositoryId, createHash("sha256").update(runId).digest("hex").slice(0, 40)],
  );
  return { installationId, repositoryId, runId };
}

async function insertJob(input: Awaited<ReturnType<typeof fixture>>, artifactId: string): Promise<string> {
  const deletionJobId = randomUUID();
  await requireExecutor().query(
    `insert into artifact_deletion_jobs (
       id, artifact_id, installation_id, repository_id, release_run_id,
       storage_driver, storage_path, deletion_reason, artifact_kind,
       artifact_role, artifact_sha256, artifact_bytes, available_at, created_at
     ) values ($1, $2, $3, $4, $5, 'local', $6, 'result_replaced', 'report', 'primary', $7, 42, now(), now())`,
    [
      deletionJobId,
      artifactId,
      input.installationId,
      input.repositoryId,
      input.runId,
      `${input.runId}/${artifactId}.bin`,
      createHash("sha256").update(artifactId).digest("hex"),
    ],
  );
  return deletionJobId;
}

afterAll(async () => {
  await executor?.close();
});

describeDatabase("artifact deletion PostgreSQL store", () => {
  it("claims and completes an idempotent missing-object deletion with audit proof", async () => {
    const tenant = await fixture(`complete-${randomUUID().slice(0, 8)}`);
    const artifactId = randomUUID();
    const deletionJobId = await insertJob(tenant, artifactId);
    const at = new Date(Date.now() + 1_000);
    const store = createSqlArtifactDeletionStore(requireExecutor(), { now: () => at, leaseSeconds: 60 });

    const claimed = await store.claimDeletions({ workerId: "artifact-worker-1", limit: 1 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ deletionJobId, artifactId, storageDriver: "local", attemptCount: 1 });
    await expect(
      store.completeDeletion({ deletionJobId, workerId: "artifact-worker-1", outcome: "missing" }),
    ).resolves.toBe("completed");

    expect(
      rows(
        await requireExecutor().query("select status, deletion_outcome from artifact_deletion_jobs where id = $1", [
          deletionJobId,
        ]),
      ),
    ).toEqual([{ status: "completed", deletion_outcome: "missing" }]);
    expect(
      rows(
        await requireExecutor().query(
          `select event_type, subject_id, repository_id, release_run_id, metadata
           from audit_events where event_type = 'artifact.object.deleted' and subject_id = $1`,
          [artifactId],
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        event_type: "artifact.object.deleted",
        subject_id: artifactId,
        repository_id: tenant.repositoryId,
        release_run_id: tenant.runId,
        metadata: expect.objectContaining({ outcome: "missing", reason: "result_replaced", storageDriver: "local" }),
      }),
    ]);
  });

  it("dead-letters an exhausted expired lease with audit proof before claiming new work", async () => {
    const tenant = await fixture(`expired-${randomUUID().slice(0, 8)}`);
    const artifactId = randomUUID();
    const deletionJobId = await insertJob(tenant, artifactId);
    const firstAt = new Date(Date.now() + 1_000);
    const firstStore = createSqlArtifactDeletionStore(requireExecutor(), { now: () => firstAt, leaseSeconds: 1 });

    await firstStore.claimDeletions({ workerId: "artifact-worker-expired", limit: 1 });
    await requireExecutor().query("update artifact_deletion_jobs set max_attempts = 1 where id = $1", [deletionJobId]);

    const recoveredAt = new Date(firstAt.valueOf() + 2_000);
    const recoveringStore = createSqlArtifactDeletionStore(requireExecutor(), { now: () => recoveredAt });
    await expect(recoveringStore.claimDeletions({ workerId: "artifact-worker-recovery", limit: 1 })).resolves.toEqual(
      [],
    );

    expect(
      rows(
        await requireExecutor().query(
          "select status, last_error_class, completed_at is not null as completed from artifact_deletion_jobs where id = $1",
          [deletionJobId],
        ),
      ),
    ).toEqual([{ status: "dead_letter", last_error_class: "lease_expired", completed: true }]);
    expect(
      rows(
        await requireExecutor().query(
          `select event_type, subject_id, metadata
           from audit_events where event_type = 'artifact.object.deletion_failed' and subject_id = $1`,
          [artifactId],
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        event_type: "artifact.object.deletion_failed",
        subject_id: artifactId,
        metadata: expect.objectContaining({ errorClass: "lease_expired", attemptCount: 1 }),
      }),
    ]);
  });

  it("retries transient failures and dead-letters permanent failures with audit proof", async () => {
    const tenant = await fixture(`failure-${randomUUID().slice(0, 8)}`);
    const artifactId = randomUUID();
    const deletionJobId = await insertJob(tenant, artifactId);
    let at = new Date(Date.now() + 1_000);
    const store = createSqlArtifactDeletionStore(requireExecutor(), { now: () => at, retryBaseSeconds: 1 });

    await store.claimDeletions({ workerId: "artifact-worker-2", limit: 1 });
    await expect(
      store.failDeletion({
        deletionJobId,
        workerId: "artifact-worker-2",
        attemptCount: 1,
        retryable: true,
        errorClass: "EIO",
        errorMessage: "temporary filesystem failure",
      }),
    ).resolves.toBe("retry");

    at = new Date(at.valueOf() + 2_000);
    const retried = await store.claimDeletions({ workerId: "artifact-worker-2", limit: 1 });
    expect(retried[0]).toMatchObject({ deletionJobId, attemptCount: 2 });
    await expect(
      store.failDeletion({
        deletionJobId,
        workerId: "artifact-worker-2",
        attemptCount: 2,
        retryable: false,
        errorClass: "unsafe_path",
        errorMessage: "unsafe artifact path",
      }),
    ).resolves.toBe("dead_letter");

    expect(
      rows(
        await requireExecutor().query("select status, last_error_class from artifact_deletion_jobs where id = $1", [
          deletionJobId,
        ]),
      ),
    ).toEqual([{ status: "dead_letter", last_error_class: "unsafe_path" }]);
    expect(
      rows(
        await requireExecutor().query(
          `select event_type, subject_id, metadata
           from audit_events where event_type = 'artifact.object.deletion_failed' and subject_id = $1`,
          [artifactId],
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        event_type: "artifact.object.deletion_failed",
        subject_id: artifactId,
        metadata: expect.objectContaining({ errorClass: "unsafe_path", attemptCount: 2 }),
      }),
    ]);
  });
});
