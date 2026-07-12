import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlRunnerArtifactStore } from "../../packages/db/src/runner-artifact-store.js";
import { createSqlRunnerLeaseStore } from "../../packages/db/src/runner-lease-store.js";

const connectionString = process.env.DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 8 }) : undefined;
let githubIdentifier = 980_000_000;

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function nonce(seed: string): string {
  return createHash("sha256").update(seed).digest("base64url");
}

function token(seed: string): string {
  return createHash("sha256").update(`artifact:${seed}`).digest("base64url");
}

function requestTimestamp(value: Date): number {
  return Math.floor(value.valueOf() / 1000);
}

function at(base: Date, seconds: number): Date {
  return new Date(base.valueOf() + seconds * 1000);
}

type TenantFixture = {
  installationId: string;
  repositoryId: string;
  owner: string;
  name: string;
};

async function createTenant(label: string): Promise<TenantFixture> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const owner = `artifact-${label}`.slice(0, 39);
  const name = `board-${label}`.slice(0, 100);
  githubIdentifier += 1;
  const githubInstallationId = githubIdentifier;
  githubIdentifier += 1;
  const githubRepositoryId = githubIdentifier;

  await executor.query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, $3, 'Organization')`,
    [installationId, githubInstallationId, owner],
  );
  await executor.query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
     values ($1, $2, $3, $4, $5, true, 'main')`,
    [repositoryId, installationId, githubRepositoryId, owner, name],
  );
  return { installationId, repositoryId, owner, name };
}

async function createQueuedRun(tenant: TenantFixture, startedAt: Date): Promise<string> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const runId = randomUUID();
  await executor.query(
    `insert into release_runs (
       id, repository_id, commit_sha, ref, pull_request_number, trigger_kind, status, started_at
     ) values ($1, $2, $3, 'refs/pull/73/head', 73, 'pr', 'queued', $4::timestamptz)`,
    [runId, tenant.repositoryId, fingerprint(runId).slice(0, 40), startedAt.toISOString()],
  );
  return runId;
}

async function createManagedIdentity(label: string, createdAt: Date): Promise<string> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const identityId = randomUUID();
  await executor.query(
    `insert into managed_runner_identities (
       id, name, public_key, public_key_fingerprint, capabilities, status,
       created_at, activated_at, last_heartbeat_at
     ) values (
       $1, $2, $3, $4, $5::jsonb, 'active',
       $6::timestamptz, $6::timestamptz, $6::timestamptz
     )`,
    [
      identityId,
      `managed-${label}-${identityId}`,
      "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA2222222222222222222222222222222222222222222=\n-----END PUBLIC KEY-----",
      fingerprint(identityId),
      JSON.stringify(["kicad:10"]),
      createdAt.toISOString(),
    ],
  );
  return identityId;
}

async function createClaimedLease(input: {
  base: Date;
  tenant: TenantFixture;
  runId: string;
  managedIdentityId: string;
  attemptId: string;
  leaseId: string;
  leaseToken: string;
}): Promise<void> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const store = createSqlRunnerLeaseStore(executor, {
    now: () => input.base,
    id: (() => {
      const ids = [input.attemptId, input.leaseId];
      return () => ids.shift() ?? randomUUID();
    })(),
    leaseToken: () => input.leaseToken,
    leaseDurationSeconds: 120,
    maximumLeaseDurationSeconds: 600,
  });
  const claimed = await store.claimJob({
    workerClass: "managed",
    managedRunnerIdentityId: input.managedIdentityId,
    requestTimestamp: requestTimestamp(input.base),
    requestNonce: nonce(`claim-${input.runId}`),
    capabilities: ["kicad:10"],
  });
  if (claimed.status !== "claimed" || claimed.runId !== input.runId) {
    throw new Error(`expected claimed artifact test lease, received ${claimed.status}`);
  }
}

async function cleanupTenant(tenant: TenantFixture, managedIdentityId: string): Promise<void> {
  if (!executor) return;
  await executor.query("delete from installations where id = $1", [tenant.installationId]);
  await executor.query("delete from managed_runner_identities where id = $1", [managedIdentityId]);
}

async function setup(label: string) {
  const base = new Date(Date.now() + 60_000);
  const tenant = await createTenant(label);
  const runId = await createQueuedRun(tenant, base);
  const managedIdentityId = await createManagedIdentity(label, base);
  const attemptId = randomUUID();
  const leaseId = randomUUID();
  const leaseToken = token(`lease-${label}`);
  await createClaimedLease({ base, tenant, runId, managedIdentityId, attemptId, leaseId, leaseToken });
  return { base, tenant, runId, managedIdentityId, attemptId, leaseId, leaseToken };
}

afterAll(async () => {
  if (!executor) return;
  await executor.query("delete from installations where account_login like 'artifact-artifact-test-%'");
  await executor.query("delete from managed_runner_identities where name like 'managed-artifact-test-%'");
});

describeDatabase("runner artifact capability PostgreSQL store", () => {
  it("issues digest-only capabilities and completes an artifact exactly once", async () => {
    const fixture = await setup("artifact-test-complete");
    const artifactId = randomUUID();
    const uploadToken = token("complete");
    const sha256 = fingerprint("artifact-content");
    const issueAt = at(fixture.base, 10);
    const issueStore = createSqlRunnerArtifactStore(executor!, {
      now: () => issueAt,
      id: () => artifactId,
      uploadToken: () => uploadToken,
      capabilityTtlSeconds: 300,
    });

    try {
      const input = {
        workerClass: "managed" as const,
        managedRunnerIdentityId: fixture.managedIdentityId,
        requestTimestamp: requestTimestamp(issueAt),
        requestNonce: nonce("artifact-complete-issue"),
        runId: fixture.runId,
        executionAttemptId: fixture.attemptId,
        leaseId: fixture.leaseId,
        leaseToken: fixture.leaseToken,
        artifacts: [{ kind: "report", name: "report.json", role: "machine", bytes: 42, sha256 }],
      };
      const issued = await issueStore.issueCapabilities(input);
      expect(issued).toEqual({
        status: "accepted",
        uploads: [
          {
            artifactId,
            uploadToken,
            expiresAt: at(fixture.base, 120).toISOString(),
            maximumBytes: 42,
          },
        ],
      });
      await expect(issueStore.issueCapabilities(input)).resolves.toEqual({ status: "replayed" });

      const pending = rows(
        await executor!.query(
          `select status, upload_token_digest, storage_path
           from runner_artifact_upload_capabilities
           where artifact_id = $1`,
          [artifactId],
        ),
      )[0];
      expect(pending).toMatchObject({
        status: "pending",
        storage_path: `${fixture.runId}/${fixture.attemptId}/${artifactId}.bin`,
      });
      expect(pending?.upload_token_digest).toBe(fingerprint(uploadToken));
      expect(pending?.upload_token_digest).not.toBe(uploadToken);

      const beginStore = createSqlRunnerArtifactStore(executor!, { now: () => at(fixture.base, 20) });
      const begun = await beginStore.beginUpload({ artifactId, uploadToken });
      expect(begun).toEqual({
        status: "accepted",
        artifactId,
        runId: fixture.runId,
        executionAttemptId: fixture.attemptId,
        leaseId: fixture.leaseId,
        storagePath: `${fixture.runId}/${fixture.attemptId}/${artifactId}.bin`,
        declaredBytes: 42,
        expectedSha256: sha256,
      });
      await expect(beginStore.beginUpload({ artifactId, uploadToken })).resolves.toEqual({ status: "replayed" });

      const completeStore = createSqlRunnerArtifactStore(executor!, { now: () => at(fixture.base, 30) });
      await expect(completeStore.completeUpload({ artifactId, uploadToken, sha256, bytes: 42 })).resolves.toEqual({
        status: "accepted",
      });
      await expect(completeStore.completeUpload({ artifactId, uploadToken, sha256, bytes: 42 })).resolves.toEqual({
        status: "replayed",
      });

      const artifactRows = rows(
        await executor!.query(
          `select id, run_id, kind, name, role, bytes, sha256, storage_path
           from artifacts where id = $1`,
          [artifactId],
        ),
      );
      expect(artifactRows).toEqual([
        {
          id: artifactId,
          run_id: fixture.runId,
          kind: "report",
          name: "report.json",
          role: "machine",
          bytes: 42,
          sha256,
          storage_path: `${fixture.runId}/${fixture.attemptId}/${artifactId}.bin`,
        },
      ]);
    } finally {
      await cleanupTenant(fixture.tenant, fixture.managedIdentityId);
    }
  });

  it("fails closed on metadata mismatch and never creates an artifact row", async () => {
    const fixture = await setup("artifact-test-mismatch");
    const artifactId = randomUUID();
    const uploadToken = token("mismatch");
    const issueAt = at(fixture.base, 10);
    const store = createSqlRunnerArtifactStore(executor!, {
      now: () => issueAt,
      id: () => artifactId,
      uploadToken: () => uploadToken,
    });

    try {
      const issued = await store.issueCapabilities({
        workerClass: "managed",
        managedRunnerIdentityId: fixture.managedIdentityId,
        requestTimestamp: requestTimestamp(issueAt),
        requestNonce: nonce("artifact-mismatch-issue"),
        runId: fixture.runId,
        executionAttemptId: fixture.attemptId,
        leaseId: fixture.leaseId,
        leaseToken: fixture.leaseToken,
        artifacts: [{ kind: "bom", name: "bom.csv", role: "manufacturing", bytes: 100 }],
      });
      expect(issued.status).toBe("accepted");
      await createSqlRunnerArtifactStore(executor!, { now: () => at(fixture.base, 20) }).beginUpload({
        artifactId,
        uploadToken,
      });
      await expect(
        createSqlRunnerArtifactStore(executor!, { now: () => at(fixture.base, 30) }).completeUpload({
          artifactId,
          uploadToken,
          sha256: fingerprint("wrong-size"),
          bytes: 99,
        }),
      ).resolves.toEqual({ status: "rejected" });

      const state = rows(
        await executor!.query(
          `select status, failure_reason,
             (select count(*)::int from artifacts where id = $1) as artifact_count
           from runner_artifact_upload_capabilities where artifact_id = $1`,
          [artifactId],
        ),
      )[0];
      expect(state).toMatchObject({ status: "failed", artifact_count: 0 });
    } finally {
      await cleanupTenant(fixture.tenant, fixture.managedIdentityId);
    }
  });

  it("revokes a pending capability when the logical run moves to a new attempt", async () => {
    const fixture = await setup("artifact-test-stale");
    const artifactId = randomUUID();
    const uploadToken = token("stale");
    const issueAt = at(fixture.base, 10);
    const store = createSqlRunnerArtifactStore(executor!, {
      now: () => issueAt,
      id: () => artifactId,
      uploadToken: () => uploadToken,
    });

    try {
      const issued = await store.issueCapabilities({
        workerClass: "managed",
        managedRunnerIdentityId: fixture.managedIdentityId,
        requestTimestamp: requestTimestamp(issueAt),
        requestNonce: nonce("artifact-stale-issue"),
        runId: fixture.runId,
        executionAttemptId: fixture.attemptId,
        leaseId: fixture.leaseId,
        leaseToken: fixture.leaseToken,
        artifacts: [{ kind: "archive", name: "gerbers.zip", role: "manufacturing", bytes: 512 }],
      });
      expect(issued.status).toBe("accepted");

      const replacementAttemptId = randomUUID();
      await executor!.query(
        `insert into release_run_attempts (
           id, run_id, attempt_number, status, created_at, started_at, heartbeat_at
         ) values ($1, $2, 2, 'in_progress', $3::timestamptz, $3::timestamptz, $3::timestamptz)`,
        [replacementAttemptId, fixture.runId, at(fixture.base, 20).toISOString()],
      );
      await executor!.query(
        `update release_runs
         set execution_attempt_id = $1, execution_attempt_started_at = $2::timestamptz, status = 'running'
         where id = $3`,
        [replacementAttemptId, at(fixture.base, 20).toISOString(), fixture.runId],
      );

      await expect(
        createSqlRunnerArtifactStore(executor!, { now: () => at(fixture.base, 30) }).beginUpload({
          artifactId,
          uploadToken,
        }),
      ).resolves.toEqual({ status: "stale" });
      const state = rows(
        await executor!.query(
          `select status, failure_reason from runner_artifact_upload_capabilities where artifact_id = $1`,
          [artifactId],
        ),
      )[0];
      expect(state).toMatchObject({ status: "revoked" });
    } finally {
      await cleanupTenant(fixture.tenant, fixture.managedIdentityId);
    }
  });
});
