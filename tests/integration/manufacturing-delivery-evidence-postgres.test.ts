import { createHash, randomInt, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { verifyDeliveryToken } from "../../apps/web/lib/delivery-auth.js";
import { lookupGuestManufacturingArtifact } from "../../apps/web/lib/guest-manufacturing-download.js";
import {
  authorizedManufacturingRevisionIds,
  authorizeManufacturingShare,
  revokeManufacturingShare,
} from "../../packages/db/src/manufacturing-share-authorization-store.js";
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
      ownerGitHubUserId: 4711,
      ownerGitHubLogin: "fixture-owner",
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

    // Technical readiness alone cannot grant guest access, even when SQL is called directly.
    await expect(
      store.createDeliveryLink({
        revisionId: revision?.id ?? "",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow("Failed to insert delivery");
    expect(
      await authorizeManufacturingShare(executor, revision?.id ?? "", {
        githubUserId: 99999,
        login: "other-user",
      }),
    ).toBe(false);
    expect(
      await authorizeManufacturingShare(executor, revision?.id ?? "", {
        githubUserId: 4711,
        login: "fixture-owner",
      }),
    ).toBe(true);
    expect(
      await authorizeManufacturingShare(executor, revision?.id ?? "", {
        githubUserId: 4711,
        login: "fixture-owner",
      }),
    ).toBe(false);
    expect(await authorizedManufacturingRevisionIds(executor, workspaceId)).toContain(revision?.id);

    // This checks database/token linkage, not source attestation or a signed fabrication approval.
    const { delivery, rawToken } = await store.createDeliveryLink({
      revisionId: revision?.id ?? "",
      expiresAt: new Date(Date.now() + 60_000),
      signedArchiveUrl: "https://example.invalid/isolated-fixture.zip",
    });
    expect((await store.getDeliveryByToken(rawToken))?.id).toBe(delivery.id);
    expect((await verifyDeliveryToken(rawToken, executor)).status).toBe(200);
    expect(await lookupGuestManufacturingArtifact(rawToken, executor)).toMatchObject({
      id: artifactId,
      runId,
      sha256: archiveSha256,
      role: "manufacturing",
      kind: "archive",
    });

    await executor.query("update release_runs set decision = 'fail' where id = $1", [runId]);
    expect(await store.revisionHasValidatedManufacturingEvidence(revision?.id ?? "")).toBe(false);
    expect(await store.getDeliveryByToken(rawToken)).toBeNull();
    expect(await lookupGuestManufacturingArtifact(rawToken, executor)).toBeNull();
    const stalePageToken = await verifyDeliveryToken(rawToken, executor);
    expect(stalePageToken.status).toBe(404);
    expect(stalePageToken.delivery).toBeUndefined();

    await executor.query("update release_runs set decision = 'pass' where id = $1", [runId]);
    expect((await store.getDeliveryByToken(rawToken))?.id).toBe(delivery.id);

    await executor.query("update artifacts set sha256 = $2 where id = $1", [artifactId, "f".repeat(64)]);
    expect(await store.getDeliveryByToken(rawToken)).toBeNull();
    expect((await verifyDeliveryToken(rawToken, executor)).status).toBe(404);
    expect(await lookupGuestManufacturingArtifact(rawToken, executor)).toBeNull();

    await executor.query("update artifacts set sha256 = $2 where id = $1", [artifactId, archiveSha256]);
    await executor.query("update deliveries set signed_archive_url = $2 where id = $1", [
      delivery.id,
      "javascript:alert(1)",
    ]);
    expect(await store.getDeliveryByToken(rawToken)).toBeNull();
    expect((await verifyDeliveryToken(rawToken, executor)).status).toBe(404);

    await executor.query("update deliveries set signed_archive_url = $2 where id = $1", [
      delivery.id,
      "https://example.invalid/isolated-fixture.zip",
    ]);
    // Revocation is effective before expiry, and prevents all existing guest tokens.
    expect((await store.getDeliveryByToken(rawToken))?.id).toBe(delivery.id);
    expect(
      await revokeManufacturingShare(executor, revision?.id ?? "", {
        githubUserId: 4711,
        login: "fixture-owner",
      }),
    ).toBe(true);
    expect(
      await authorizeManufacturingShare(executor, revision?.id ?? "", {
        githubUserId: 4711,
        login: "fixture-owner",
      }),
    ).toBe(false);
    expect(await authorizedManufacturingRevisionIds(executor, workspaceId)).toEqual([]);
    expect(await store.getDeliveryByToken(rawToken)).toBeNull();
    expect((await verifyDeliveryToken(rawToken, executor)).status).toBe(404);
    expect(await lookupGuestManufacturingArtifact(rawToken, executor)).toBeNull();
    await expect(
      store.createDeliveryLink({
        revisionId: revision?.id ?? "",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow("Failed to insert delivery");
    await executor.query("update deliveries set expires_at = now() - interval '1 second' where id = $1", [delivery.id]);
    expect((await verifyDeliveryToken(rawToken, executor)).status).toBe(410);
    const beforeDeletion = (await executor.query(
      "select revoked_by_github_user_id, revoked_by_login, artifact_id from manufacturing_share_authorizations where revision_id = $1",
      [revision?.id],
    )) as { rows: Array<{ revoked_by_github_user_id: string; revoked_by_login: string; artifact_id: string }> };
    expect(beforeDeletion.rows[0]).toMatchObject({
      revoked_by_github_user_id: "4711",
      revoked_by_login: "fixture-owner",
      artifact_id: artifactId,
    });
    // Artifact retirement must not erase the owner authorization/revocation audit.
    await executor.query("delete from artifacts where id = $1", [artifactId]);
    const afterDeletion = (await executor.query(
      "select artifact_id, revoked_at, revoked_by_login from manufacturing_share_authorizations where revision_id = $1",
      [revision?.id],
    )) as { rows: Array<{ artifact_id: string | null; revoked_at: Date | null; revoked_by_login: string }> };
    expect(afterDeletion.rows[0]?.artifact_id).toBeNull();
    expect(afterDeletion.rows[0]?.revoked_at).not.toBeNull();
    expect(afterDeletion.rows[0]?.revoked_by_login).toBe("fixture-owner");
    expect(await lookupGuestManufacturingArtifact(rawToken, executor)).toBeNull();
  });
});
