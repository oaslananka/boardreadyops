import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { ProtectedReleaseIntentStore } from "../../packages/db/src/protected-release-intent-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 5 }) : undefined;
const installationId = randomUUID();
const repositoryId = randomUUID();
const secondInstallationId = randomUUID();
const secondRepositoryId = randomUUID();
const numericSuffix = Number.parseInt(randomUUID().slice(0, 8), 16);
const githubInstallationId = 7_700_000_000 + numericSuffix;
const githubRepositoryId = 8_800_000_000 + numericSuffix;
const ownerId = 9_900_000_000 + numericSuffix;
const otherGithubInstallationId = githubInstallationId + 1;
const otherGithubRepositoryId = githubRepositoryId + 1;

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function database() {
  if (!executor) throw new Error("Disposable PostgreSQL database required");
  return executor;
}

function evidence(requestId = randomUUID()) {
  return {
    version: 2 as const,
    kind: "protected-branch" as const,
    installationId: githubInstallationId,
    repositoryId,
    githubRepositoryId,
    githubOwnerId: ownerId,
    actorGithubUserId: 123456,
    actorLogin: "maintainer",
    ref: "refs/heads/main",
    sha: "a".repeat(40),
    requestId,
    digest: "b".repeat(64),
  };
}

const context = {
  internalInstallationId: installationId,
  githubInstallationId,
  observedAt: new Date(),
};

describeDatabase("protected-release verified owner evidence v2 in PostgreSQL", () => {
  beforeAll(async () => {
    const db = database();
    await db.query(
      "insert into installations (id, github_installation_id, account_login, account_type) values ($1, $2, 'owner-a', 'Organization'), ($3, $4, 'owner-b', 'Organization')",
      [installationId, githubInstallationId, secondInstallationId, otherGithubInstallationId],
    );
    await db.query(
      "insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch) values ($1, $2, $3, 'owner-a', 'board', false, 'main'), ($4, $5, $6, 'owner-b', 'board', true, 'main')",
      [
        repositoryId,
        installationId,
        githubRepositoryId,
        secondRepositoryId,
        secondInstallationId,
        otherGithubRepositoryId,
      ],
    );
  });

  afterAll(async () => {
    if (!executor) return;
    await executor.query("delete from installations where id = any($1::text[])", [
      [installationId, secondInstallationId],
    ]);
    await executor.close();
  });

  it("persists v2 owner identity and exact replay without mutating immutable evidence", async () => {
    const db = database();
    const record = evidence();
    const store = new ProtectedReleaseIntentStore(db);
    const first = await store.record(record, context);
    expect(first.inserted).toBe(true);
    const repeated = await store.record(record, context);
    expect(repeated).toEqual({ id: first.id, inserted: false });

    const snapshot = await db.query(
      "select evidence_version, github_owner_id, evidence_digest, installation_id, repository_id from protected_release_intent_candidates where id = $1",
      [first.id],
    );
    expect(rows(snapshot)).toEqual([
      expect.objectContaining({
        evidence_version: 2,
        github_owner_id: String(ownerId),
        evidence_digest: record.digest,
        installation_id: installationId,
        repository_id: repositoryId,
      }),
    ]);
    await expect(
      db.query("update protected_release_intent_candidates set github_owner_id = $2 where id = $1", [
        first.id,
        ownerId + 1,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("rejects a different owner ID or digest for the same request without mutation", async () => {
    const store = new ProtectedReleaseIntentStore(database());
    const request = evidence();
    await store.record(request, context);
    await expect(store.record({ ...request, githubOwnerId: ownerId + 1 }, context)).rejects.toMatchObject({
      code: "23505",
    });
    await expect(store.record({ ...request, digest: "c".repeat(64) }, context)).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("records concurrent identical requests exactly once", async () => {
    const store = new ProtectedReleaseIntentStore(database());
    const request = evidence();
    const replies = await Promise.all([store.record(request, context), store.record(request, context)]);
    expect(replies.map((item) => item.id)).toEqual([replies[0]?.id, replies[0]?.id]);
    expect(replies.map((item) => item.inserted).sort()).toEqual([false, true]);
  });

  it("rejects cross-installation identities and private repository evidence", async () => {
    const store = new ProtectedReleaseIntentStore(database());
    await expect(
      store.record(evidence(), { ...context, internalInstallationId: secondInstallationId }),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      store.record(
        {
          ...evidence(),
          repositoryId: secondRepositoryId,
          githubRepositoryId: otherGithubRepositoryId,
          installationId: otherGithubInstallationId,
        },
        {
          ...context,
          internalInstallationId: secondInstallationId,
          githubInstallationId: otherGithubInstallationId,
        },
      ),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("does not allow a historical v1 request to be silently upgraded", async () => {
    const db = database();
    const request = evidence();
    const old = await db.query(
      "select candidate_id, inserted from boardreadyops_record_protected_release_intent_candidate($1,$2,$3::bigint,$4::bigint,$5::bigint,$6,$7,$8,$9,$10,$11::timestamptz)",
      [
        installationId,
        repositoryId,
        githubInstallationId,
        githubRepositoryId,
        request.actorGithubUserId,
        request.actorLogin,
        request.ref,
        request.sha,
        request.requestId,
        request.digest,
        context.observedAt.toISOString(),
      ],
    );
    expect(rows(old)[0]?.inserted).toBe(true);
    await expect(new ProtectedReleaseIntentStore(db).record(request, context)).rejects.toMatchObject({
      code: "23505",
    });
    const snapshot = await db.query(
      "select evidence_version, github_owner_id from protected_release_intent_candidates where id = $1",
      [rows(old)[0]?.candidate_id],
    );
    expect(rows(snapshot)).toEqual([{ evidence_version: 1, github_owner_id: null }]);
    const oldSeal = await db.query(
      "select * from boardreadyops_seal_protected_release_identity($1,$2,$3,$4::bigint,$5::bigint,$6::bigint,$7,$8,$9::timestamptz)",
      [
        rows(old)[0]?.candidate_id,
        installationId,
        repositoryId,
        githubInstallationId,
        githubRepositoryId,
        request.actorGithubUserId,
        randomUUID(),
        randomUUID(),
        new Date().toISOString(),
      ],
    );
    const sealed = await db.query(
      "select snapshot_version, github_owner_id, dispatch_allowed from protected_release_execution_seals where id = $1",
      [rows(oldSeal)[0]?.seal_id],
    );
    expect(rows(sealed)).toEqual([{ snapshot_version: 1, github_owner_id: null, dispatch_allowed: false }]);
  });

  it("rejects downgrading a v2 owner-bound candidate into a legacy v1 seal", async () => {
    const db = database();
    const candidate = await new ProtectedReleaseIntentStore(db).record(evidence(), context);
    await expect(
      db.query(
        "select * from boardreadyops_seal_protected_release_identity($1,$2,$3,$4::bigint,$5::bigint,$6::bigint,$7,$8,$9::timestamptz)",
        [
          candidate.id,
          installationId,
          repositoryId,
          githubInstallationId,
          githubRepositoryId,
          123456,
          randomUUID(),
          randomUUID(),
          new Date().toISOString(),
        ],
      ),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("does not create a release run, outbox effect or seal when recording owner evidence", async () => {
    const db = database();
    const record = await new ProtectedReleaseIntentStore(db).record(evidence(), context);
    const result = await db.query(
      "select (select count(*)::int from release_runs where repository_id = $1) as runs, (select count(*)::int from protected_release_execution_seals where candidate_id = $2) as seals, (select count(*)::int from control_plane_outbox where release_run_id in (select id from release_runs where repository_id = $1)) as effects",
      [repositoryId, record.id],
    );
    expect(rows(result)).toEqual([{ runs: 0, seals: 0, effects: 0 }]);
  });
});
