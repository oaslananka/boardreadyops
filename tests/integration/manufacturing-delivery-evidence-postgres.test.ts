import { createHash, randomInt, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { verifyDeliveryToken } from "../../apps/web/lib/delivery-auth.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { WorkspaceStore } from "../../packages/db/src/workspace-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const workspaceId = `ws_delivery_evidence_${randomUUID()}`;
const installationId = randomUUID();
const repositoryId = randomUUID();

afterAll(async () => {
  if (!executor) return;
  try {
    await executor.query("delete from workspaces where id = $1", [workspaceId]);
    await executor.query("delete from installations where id = $1", [installationId]);
  } finally {
    await executor.close();
  }
});

describeDatabase("Manufacturing delivery evidence (PostgreSQL)", () => {
  it("only registers a passing run's persisted manufacturing archive and invalidates stale evidence", async () => {
    if (!executor) throw new Error("Disposable PostgreSQL executor is unavailable");
    const store = new WorkspaceStore(executor);
    const installationNumber = randomInt(1_000_000_000, 2_000_000_000);
    const repoNumber = randomInt(1_000_000_000, 2_000_000_000);
    const repoFullName = `evidence-test-${randomUUID().slice(0, 8)}/pcb-board`;
    const commitSha = "a".repeat(40);
    const archiveSha256 = createHash("sha256").update("isolated metadata fixture").digest("hex");

    await executor.query(
      `insert into installations (id, github_installation_id, account_login, account_type)
       values ($1, $2, $3, 'Organization')`,
      [installationId, installationNumber, repoFullName.split("/")[0]],
    );
    await executor.query(
      `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
       values ($1, $2, $3, $4, $5, true, 'main')`,
      [repositoryId, installationId, repoNumber, ...repoFullName.split("/")],
    );

    await store.createWorkspace({
      id: workspaceId,
      name: "Isolated manufacturing evidence fixture",
      slug: `manufacturing-test-${randomUUID().slice(0, 8)}`,
      ownerUserId: "fixture-owner",
    });
    const project = await store.createProject({
      workspaceId,
      name: "Fixture PCB",
      githubRepoFullName: repoFullName,
    });

    const runId = randomUUID();
    await executor.query(
      `insert into release_runs
         (id, repository_id, commit_sha, ref, trigger_kind, status, decision, started_at, completed_at)
       values ($1, $2, $3, 'refs/heads/main', 'push', 'completed', 'pass', now(), now())`,
      [runId, repositoryId, commitSha],
    );
    expect(await store.listValidatedRevisionCandidatesByWorkspace(workspaceId)).toEqual([]);

    const artifactId = randomUUID();
    await executor.query(
      `insert into artifacts (id, run_id, kind, name, storage_path, sha256, bytes, role)
       values ($1, $2, 'archive', 'fixture-gerbers.zip', $3, $4, 512, 'manufacturing')`,
      [artifactId, runId, "fixtures/only-in-disposable-db.zip", archiveSha256],
    );

    expect(await store.listValidatedRevisionCandidatesByWorkspace(`ws_other_${randomUUID()}`)).toEqual([]);
    const candidates = await store.listValidatedRevisionCandidatesByWorkspace(workspaceId);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      projectId: project.id,
      runId,
      artifactId,
      commitSha,
      bundleSha256: archiveSha256,
    });

    expect(
      await store.registerValidatedRevisionFromArtifact({
        workspaceId: `ws_other_${randomUUID()}`,
        projectId: project.id,
        runId,
        artifactId,
        revisionLabel: "Untrusted cross-workspace revision",
      }),
    ).toBeNull();

    const revision = await store.registerValidatedRevisionFromArtifact({
      workspaceId,
      projectId: project.id,
      runId,
      artifactId,
      revisionLabel: "Fixture revision",
    });
    expect(revision).toMatchObject({
      projectId: project.id,
      validationRunId: runId,
      validationArtifactId: artifactId,
      bundleSha256: archiveSha256,
      commitSha,
    });
    expect(await store.listValidatedRevisionCandidatesByWorkspace(workspaceId)).toEqual([]);
    expect(await store.revisionHasValidatedManufacturingEvidence(revision?.id ?? "")).toBe(true);

    // This checks database/token linkage only, not signed file bytes or a public production handoff.
    const { delivery, rawToken } = await store.createDeliveryLink({
      revisionId: revision?.id ?? "",
      expiresAt: new Date(Date.now() + 60_000),
      signedArchiveUrl: "https://example.invalid/isolated-fixture.zip",
    });
    expect((await store.getDeliveryByToken(rawToken))?.id).toBe(delivery.id);
    expect((await verifyDeliveryToken(rawToken, executor)).status).toBe(200);

    await executor.query("update release_runs set decision = 'fail' where id = $1", [runId]);
    expect(await store.revisionHasValidatedManufacturingEvidence(revision?.id ?? "")).toBe(false);
    expect(await store.getDeliveryByToken(rawToken)).toBeNull();
    const stalePageToken = await verifyDeliveryToken(rawToken, executor);
    expect(stalePageToken.status).toBe(404);
    expect(stalePageToken.delivery).toBeUndefined();

    await executor.query("update release_runs set decision = 'pass' where id = $1", [runId]);
    expect((await store.getDeliveryByToken(rawToken))?.id).toBe(delivery.id);

    await executor.query("update artifacts set sha256 = $2 where id = $1", [artifactId, "f".repeat(64)]);
    expect(await store.getDeliveryByToken(rawToken)).toBeNull();
    expect((await verifyDeliveryToken(rawToken, executor)).status).toBe(404);

    await executor.query("update artifacts set sha256 = $2 where id = $1", [artifactId, archiveSha256]);
    await executor.query("update deliveries set expires_at = now() - interval '1 second' where id = $1", [delivery.id]);
    expect(await store.getDeliveryByToken(rawToken)).toBeNull();
    expect((await verifyDeliveryToken(rawToken, executor)).status).toBe(410);
  });
});
