import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { handleRunnerArtifactUploadRequest } from "../../apps/web/lib/runner-artifact-routes.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlRetentionMaintenanceStore } from "../../packages/db/src/retention-maintenance-store.js";
import { createSqlRunnerArtifactStore } from "../../packages/db/src/runner-artifact-store.js";
import { createSqlRunnerLeaseStore } from "../../packages/db/src/runner-lease-store.js";
import { WorkspaceStore } from "../../packages/db/src/workspace-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";
import { detectKicadCli } from "../../src/kicad/cli.js";
import { createKicadCliRunner, runGenerate } from "../../src/release/generate.js";
import { createVerifiedManufacturingZip } from "../../src/release/manufacturing-archive.js";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 8 }) : undefined;
let githubIdentifier = 980_000_000;

function requireExecutor() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

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

async function realManufacturingZip(): Promise<Uint8Array> {
  const cli = await detectKicadCli();
  if (!cli.path || !cli.found) throw new Error("KiCad 10 CLI is required for this real-archive test");
  const root = await mkdtemp(path.join(os.tmpdir(), "bro-draft-sql-zip-"));
  try {
    await cp(path.resolve("tests/fixtures/projects/safe-basic"), root, { recursive: true });
    await writeFile(path.join(root, ".gitignore"), "build/\n");
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync(
      "git",
      ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"],
      { cwd: root },
    );
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const result = await runGenerate(
      { schemaVersion: 1, steps: [{ kind: "gerbers" }, { kind: "drill" }] },
      {
        outputDir: path.join(root, "build", "outputs"),
        boardFile: path.join(root, "safe-basic.kicad_pcb"),
        gitRoot: root,
        reviewedSourceSha: sha,
        kicadVersion: cli.version,
        runner: createKicadCliRunner(cli.path),
      },
    );
    expect(result.failures).toBe(0);
    const archive = await createVerifiedManufacturingZip({
      root,
      generated: result,
      sourceCommitSha: sha,
      destination: path.join(root, "build", "manufacturing-draft.zip"),
    });
    expect(archive.files).toBeGreaterThan(0);
    return await readFile(archive.path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function persistRealDraftArtifact(
  fixture: Awaited<ReturnType<typeof setup>>,
  storageRoot: string,
): Promise<string> {
  const data = await realManufacturingZip();
  const digest = createHash("sha256").update(data).digest("hex");
  const artifactId = randomUUID();
  const uploadToken = token(`draft-upload-${artifactId}`);
  const issued = await createSqlRunnerArtifactStore(requireExecutor(), {
    now: () => at(fixture.base, 10),
    id: () => artifactId,
    uploadToken: () => uploadToken,
  }).issueCapabilities({
    workerClass: "managed",
    managedRunnerIdentityId: fixture.managedIdentityId,
    requestTimestamp: requestTimestamp(at(fixture.base, 10)),
    requestNonce: nonce(`issue-draft-${artifactId}`),
    runId: fixture.runId,
    executionAttemptId: fixture.attemptId,
    leaseId: fixture.leaseId,
    leaseToken: fixture.leaseToken,
    artifacts: [
      {
        kind: "archive",
        name: "boardreadyops-manufacturing-draft.zip",
        role: "draft-manufacturing",
        contentType: "application/zip",
        bytes: data.byteLength,
        sha256: digest,
      },
    ],
  });
  expect(issued.status).toBe("accepted");
  const upload = await handleRunnerArtifactUploadRequest(
    new Request(`https://boardreadyops.test/upload?cap=${uploadToken}`, {
      method: "PUT",
      body: new Blob([new Uint8Array(data)]),
    }),
    artifactId,
    {
      environment: { ARTIFACT_STORAGE_DRIVER: "local", ARTIFACT_STORAGE_ROOT: storageRoot },
      now: () => at(fixture.base, 20),
      queryExecutor: requireExecutor,
      createArtifactStore: (database) =>
        createSqlRunnerArtifactStore(database, {
          now: () => at(fixture.base, 20),
        }),
    },
  );
  expect(upload.status).toBe(201);
  const stored = rows(
    await requireExecutor().query(
      "select run_id, kind, role, content_type, sha256, bytes, storage_path from artifacts where id = $1",
      [artifactId],
    ),
  )[0];
  expect(stored).toMatchObject({
    run_id: fixture.runId,
    kind: "archive",
    role: "draft-manufacturing",
    content_type: "application/zip",
    sha256: digest,
    bytes: data.byteLength,
  });
  expect(
    createHash("sha256")
      .update(await readFile(path.join(storageRoot, String(stored?.storage_path))))
      .digest("hex"),
  ).toBe(digest);
  return artifactId;
}

describeDatabase("runner artifact capability PostgreSQL store", () => {
  it("issues digest-only capabilities and completes an artifact exactly once", async () => {
    const fixture = await setup("artifact-test-complete");
    const artifactId = randomUUID();
    const uploadToken = token("complete");
    const sha256 = fingerprint("artifact-content");
    const issueAt = at(fixture.base, 10);
    const issueStore = createSqlRunnerArtifactStore(requireExecutor(), {
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
        artifacts: [
          { kind: "report", name: "report.json", role: "machine", bytes: 42, sha256, contentType: "application/json" },
        ],
      };
      const issued = await issueStore.issueCapabilities(input);
      expect(issued).toEqual({
        status: "accepted",
        uploads: [
          {
            artifactId,
            storagePath: `${fixture.runId}/${fixture.attemptId}/${artifactId}.bin`,
            uploadToken,
            expiresAt: at(fixture.base, 120).toISOString(),
            maximumBytes: 42,
          },
        ],
      });
      await expect(issueStore.issueCapabilities(input)).resolves.toEqual({ status: "replayed" });

      const pending = rows(
        await requireExecutor().query(
          `select status, upload_token_digest, storage_path, content_type
           from runner_artifact_upload_capabilities
           where artifact_id = $1`,
          [artifactId],
        ),
      )[0];
      expect(pending).toMatchObject({
        status: "pending",
        storage_path: `${fixture.runId}/${fixture.attemptId}/${artifactId}.bin`,
        content_type: "application/json",
      });
      expect(pending?.upload_token_digest).toBe(fingerprint(uploadToken));
      expect(pending?.upload_token_digest).not.toBe(uploadToken);

      const beginStore = createSqlRunnerArtifactStore(requireExecutor(), { now: () => at(fixture.base, 20) });
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

      const completeStore = createSqlRunnerArtifactStore(requireExecutor(), { now: () => at(fixture.base, 30) });
      await expect(completeStore.completeUpload({ artifactId, uploadToken, sha256, bytes: 42 })).resolves.toEqual({
        status: "accepted",
      });
      await expect(completeStore.completeUpload({ artifactId, uploadToken, sha256, bytes: 42 })).resolves.toEqual({
        status: "replayed",
      });

      const artifactRows = rows(
        await requireExecutor().query(
          `select id, run_id, execution_attempt_id, kind, name, role, bytes, sha256, storage_path, content_type, retention_until
           from artifacts where id = $1`,
          [artifactId],
        ),
      );
      expect(artifactRows).toEqual([
        {
          id: artifactId,
          run_id: fixture.runId,
          execution_attempt_id: fixture.attemptId,
          kind: "report",
          name: "report.json",
          role: "machine",
          bytes: 42,
          sha256,
          storage_path: `${fixture.runId}/${fixture.attemptId}/${artifactId}.bin`,
          content_type: "application/json",
          retention_until: null,
        },
      ]);
    } finally {
      await cleanupTenant(fixture.tenant, fixture.managedIdentityId);
    }
  });

  it.each(["committed", "rolled-back"] as const)(
    "retains artifact bytes when PostgreSQL finalization acknowledgement is lost (%s)",
    async (outcome) => {
      const fixture = await setup(`artifact-test-lost-ack-${randomUUID().slice(0, 8)}`);
      const artifactId = randomUUID();
      const uploadToken = token(`lost-ack-${artifactId}`);
      const sha256 = fingerprint("hello");
      const storageRoot = await mkdtemp(path.join(os.tmpdir(), "bro-upload-lost-ack-"));
      try {
        const issued = await createSqlRunnerArtifactStore(requireExecutor(), {
          now: () => at(fixture.base, 10),
          id: () => artifactId,
          uploadToken: () => uploadToken,
          capabilityTtlSeconds: 300,
        }).issueCapabilities({
          workerClass: "managed",
          managedRunnerIdentityId: fixture.managedIdentityId,
          requestTimestamp: requestTimestamp(at(fixture.base, 10)),
          requestNonce: nonce(`lost-ack-${artifactId}`),
          runId: fixture.runId,
          executionAttemptId: fixture.attemptId,
          leaseId: fixture.leaseId,
          leaseToken: fixture.leaseToken,
          artifacts: [
            { kind: "report", name: "report.json", role: "machine", bytes: 5, sha256, contentType: "application/json" },
          ],
        });
        expect(issued.status).toBe("accepted");
        let acknowledgementLost = false;
        const response = await handleRunnerArtifactUploadRequest(
          new Request(`https://boardreadyops.test/upload?cap=${uploadToken}`, {
            method: "PUT",
            body: "hello",
          }),
          artifactId,
          {
            environment: { ARTIFACT_STORAGE_DRIVER: "local", ARTIFACT_STORAGE_ROOT: storageRoot },
            now: () => at(fixture.base, 20),
            queryExecutor: requireExecutor,
            createArtifactStore: (database) =>
              createSqlRunnerArtifactStore(
                {
                  ...database,
                  query: async (sql, params = []) => {
                    if (sql.includes("boardreadyops_complete_artifact_upload") && outcome === "rolled-back") {
                      acknowledgementLost = true;
                      throw new Error("simulated transport failure before SQL execution");
                    }
                    const result = await database.query(sql, params);
                    if (sql.includes("boardreadyops_complete_artifact_upload")) {
                      acknowledgementLost = true;
                      throw new Error("simulated lost response after successful COMMIT");
                    }
                    return result;
                  },
                },
                { now: () => at(fixture.base, 20) },
              ),
          },
        );
        expect(response.status).toBe(503);
        expect(acknowledgementLost).toBe(true);
        const persisted = rows(
          await requireExecutor().query("select id, storage_path, sha256 from artifacts where id = $1", [artifactId]),
        );
        const capability = rows(
          await requireExecutor().query(
            "select status, storage_path from runner_artifact_upload_capabilities where artifact_id=$1",
            [artifactId],
          ),
        )[0];
        expect(capability?.status).toBe(outcome === "committed" ? "uploaded" : "uploading");
        const finalFile = path.join(storageRoot, String(capability?.storage_path));
        await expect(readFile(finalFile, "utf8")).resolves.toBe("hello");
        if (outcome === "rolled-back") {
          // The failed SQL left no durable artifact row. Preserving bytes avoids
          // an irreversible guess; the orphan needs operator reconciliation.
          expect(persisted).toEqual([]);
        } else {
          expect(persisted).toEqual([expect.objectContaining({ id: artifactId, sha256 })]);
          // A retry with an already-consumed capability is a non-mutating
          // conflict, not permission to overwrite the committed artifact.
          const retry = await handleRunnerArtifactUploadRequest(
            new Request(`https://boardreadyops.test/upload?cap=${uploadToken}`, {
              method: "PUT",
              body: "hello",
            }),
            artifactId,
            {
              environment: { ARTIFACT_STORAGE_DRIVER: "local", ARTIFACT_STORAGE_ROOT: storageRoot },
              now: () => at(fixture.base, 25),
              queryExecutor: requireExecutor,
              createArtifactStore: (database) =>
                createSqlRunnerArtifactStore(database, { now: () => at(fixture.base, 25) }),
            },
          );
          expect(retry.status).toBe(409);
          expect(
            rows(
              await requireExecutor().query(
                "select status from runner_artifact_upload_capabilities where artifact_id=$1",
                [artifactId],
              ),
            ),
          ).toEqual([{ status: "uploaded" }]);
          await expect(readFile(finalFile, "utf8")).resolves.toBe("hello");
        }
      } finally {
        await cleanupTenant(fixture.tenant, fixture.managedIdentityId);
        await rm(storageRoot, { recursive: true, force: true });
      }
    },
  );

  it("persists a real KiCad draft through HTTP and PostgreSQL without enabling fabrication delivery", async (context) => {
    const cli = await detectKicadCli();
    if (!cli.found || !/^10[.]0[.]/u.test(cli.version ?? "")) {
      if (process.env.CI) throw new Error("KiCad 10 CLI required in CI");
      context.skip();
    }
    const fixture = await setup("artifact-test-real-draft");
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "bro-draft-upload-store-"));
    const workspaceId = `ws_draft_${randomUUID()}`;
    try {
      const artifactId = await persistRealDraftArtifact(fixture, storageRoot);
      // A passing release run and matching repository still cannot promote an unsigned draft.
      await requireExecutor().query("update repositories set private = false where id = $1", [
        fixture.tenant.repositoryId,
      ]);
      await requireExecutor().query(
        "update release_runs set status = 'completed', decision = 'pass', completed_at = $2::timestamptz where id = $1",
        [fixture.runId, at(fixture.base, 40).toISOString()],
      );
      const store = new WorkspaceStore(requireExecutor());
      await store.createWorkspace({
        id: workspaceId,
        name: "Draft must not become production",
        slug: `draft-fixture-${randomUUID().slice(0, 8)}`,
        ownerUserId: "fixture-owner",
      });
      const project = await store.createProject({
        workspaceId,
        name: "Draft board",
        githubRepoFullName: `${fixture.tenant.owner}/${fixture.tenant.name}`,
      });
      expect(await store.listValidatedRevisionCandidatesByWorkspace(workspaceId)).toEqual([]);
      expect(
        await store.registerValidatedRevisionFromArtifact({
          workspaceId,
          projectId: project.id,
          runId: fixture.runId,
          artifactId,
          revisionLabel: "Cannot approve draft",
        }),
      ).toBeNull();
    } finally {
      await requireExecutor().query("delete from workspaces where id = $1", [workspaceId]);
      await cleanupTenant(fixture.tenant, fixture.managedIdentityId);
      await rm(storageRoot, { recursive: true, force: true });
    }
  }, 180_000);

  it("expires a pending capability in bounded retention maintenance", async () => {
    const fixture = await setup("artifact-test-maintenance-expiry");
    const artifactId = randomUUID();
    const uploadToken = token("maintenance-expiry");
    const issueAt = at(fixture.base, 10);
    const store = createSqlRunnerArtifactStore(requireExecutor(), {
      now: () => issueAt,
      id: () => artifactId,
      uploadToken: () => uploadToken,
      capabilityTtlSeconds: 30,
    });

    try {
      const issued = await store.issueCapabilities({
        workerClass: "managed",
        managedRunnerIdentityId: fixture.managedIdentityId,
        requestTimestamp: requestTimestamp(issueAt),
        requestNonce: nonce("artifact-maintenance-expiry-issue"),
        runId: fixture.runId,
        executionAttemptId: fixture.attemptId,
        leaseId: fixture.leaseId,
        leaseToken: fixture.leaseToken,
        artifacts: [{ kind: "report", name: "report.json", role: "machine", bytes: 42 }],
      });
      expect(issued.status).toBe("accepted");

      const expiredAt = at(fixture.base, 41);
      await expect(
        createSqlRetentionMaintenanceStore(requireExecutor(), {
          now: () => expiredAt,
        }).expireArtifactUploadCapabilities(),
      ).resolves.toBe(1);
      await expect(
        createSqlRunnerArtifactStore(requireExecutor(), { now: () => expiredAt }).beginUpload({
          artifactId,
          uploadToken,
        }),
      ).resolves.toEqual({ status: "expired" });

      const state = rows(
        await requireExecutor().query(
          "select status, failed_at, failure_reason from runner_artifact_upload_capabilities where artifact_id = $1",
          [artifactId],
        ),
      )[0];
      expect(state).toMatchObject({
        status: "expired",
        failure_reason: "Artifact upload capability expired before use.",
      });
      expect(state?.failed_at).not.toBeNull();
    } finally {
      await cleanupTenant(fixture.tenant, fixture.managedIdentityId);
    }
  });

  it("fails closed on metadata mismatch and never creates an artifact row", async () => {
    const fixture = await setup("artifact-test-mismatch");
    const artifactId = randomUUID();
    const uploadToken = token("mismatch");
    const issueAt = at(fixture.base, 10);
    const store = createSqlRunnerArtifactStore(requireExecutor(), {
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
      await createSqlRunnerArtifactStore(requireExecutor(), { now: () => at(fixture.base, 20) }).beginUpload({
        artifactId,
        uploadToken,
      });
      await expect(
        createSqlRunnerArtifactStore(requireExecutor(), { now: () => at(fixture.base, 30) }).completeUpload({
          artifactId,
          uploadToken,
          sha256: fingerprint("wrong-size"),
          bytes: 99,
        }),
      ).resolves.toEqual({ status: "rejected" });

      const state = rows(
        await requireExecutor().query(
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
    const store = createSqlRunnerArtifactStore(requireExecutor(), {
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
        artifacts: [{ kind: "archive", name: "gerbers.zip", role: "draft-manufacturing", bytes: 512 }],
      });
      expect(issued.status).toBe("accepted");

      const replacementAttemptId = randomUUID();
      await requireExecutor().query(
        `insert into release_run_attempts (
           id, run_id, attempt_number, status, created_at, started_at, heartbeat_at
         ) values ($1, $2, 2, 'in_progress', $3::timestamptz, $3::timestamptz, $3::timestamptz)`,
        [replacementAttemptId, fixture.runId, at(fixture.base, 20).toISOString()],
      );
      await requireExecutor().query(
        `update release_runs
         set execution_attempt_id = $1, execution_attempt_started_at = $2::timestamptz, status = 'running'
         where id = $3`,
        [replacementAttemptId, at(fixture.base, 20).toISOString(), fixture.runId],
      );

      await expect(
        createSqlRunnerArtifactStore(requireExecutor(), { now: () => at(fixture.base, 30) }).beginUpload({
          artifactId,
          uploadToken,
        }),
      ).resolves.toEqual({ status: "stale" });
      const state = rows(
        await requireExecutor().query(
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
