import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlTransactionalGitHubAppLifecycleStore } from "../../packages/db/src/transactional-lifecycle-store.js";

const connectionString = process.env.DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : undefined;
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const numericSuffix = Number.parseInt(suffix.slice(0, 8), 16);
const installationRowId = `producer-installation-${suffix}`;
const repositoryRowId = `producer-repository-${suffix}`;
const githubInstallationId = 7_000_000_000 + numericSuffix;
const githubRepositoryId = 8_000_000_000 + numericSuffix;

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function action(commitSha: string) {
  return {
    type: "release_run.enqueue" as const,
    installation: { id: githubInstallationId },
    repository: {
      id: githubRepositoryId,
      owner: "octo",
      name: `board-${suffix}`,
      fullName: `octo/board-${suffix}`,
      private: false,
      defaultBranch: "main",
    },
    pullRequestNumber: 42,
    ref: "refs/pull/42/head",
    commitSha,
    triggerKind: "pr" as const,
  };
}

function idSequence(values: string[]): () => string {
  return () => values.shift() ?? `unexpected-${randomUUID()}`;
}

async function cleanup(): Promise<void> {
  if (!executor) return;
  await executor.query("delete from installations where id = $1", [installationRowId]);
}

beforeEach(async () => {
  await cleanup();
  await database().query(
    `insert into installations (
       id, github_installation_id, account_login, account_type, created_at, suspended_at
     ) values ($1, $2, 'octo', 'Organization', now(), null)`,
    [installationRowId, githubInstallationId],
  );
  await database().query(
    `insert into repositories (
       id, installation_id, github_repo_id, owner, name, private,
       default_branch, enabled_at, disabled_at
     ) values ($1, $2, $3, 'octo', $4, false, 'main', now(), null)`,
    [repositoryRowId, installationRowId, githubRepositoryId, `board-${suffix}`],
  );
});

afterAll(async () => {
  await cleanup();
  await executor?.close();
});

describeDatabase("transactional release-run outbox producer", () => {
  it("converges concurrent replay to one release run and one Check Run effect", async () => {
    const firstStore = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([`run-first-${suffix}`, `outbox-first-${suffix}`]),
      now: () => new Date("2026-07-22T02:00:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });
    const secondStore = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([`run-replay-${suffix}`, `outbox-replay-${suffix}`]),
      now: () => new Date("2026-07-22T02:01:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });

    const [first, replay] = await Promise.all([
      firstStore.enqueueReleaseRunWithOutbox(action("a".repeat(40))),
      secondStore.enqueueReleaseRunWithOutbox(action("a".repeat(40))),
    ]);

    expect(replay).toEqual(first);
    expect(first.status).toBe("queued");
    expect([`run-first-${suffix}`, `run-replay-${suffix}`]).toContain(first.runId);
    expect([`outbox-first-${suffix}`, `outbox-replay-${suffix}`]).toContain(first.outboxId);

    const state = await database().query(
      `select
         (select count(*)::int from release_runs where repository_id = $1) as run_count,
         (select count(*)::int from control_plane_outbox where release_run_id = $2) as outbox_count,
         (select payload ->> 'runId' from control_plane_outbox where release_run_id = $2) as payload_run_id,
         (select idempotency_key from control_plane_outbox where release_run_id = $2) as outbox_key`,
      [repositoryRowId, first.runId],
    );
    expect((state as { rows: Record<string, unknown>[] }).rows[0]).toEqual({
      run_count: 1,
      outbox_count: 1,
      payload_run_id: first.runId,
      outbox_key: `github.check_run.create:${first.runId}`,
    });
  });

  it("supersedes the previous active run before planning the newer commit", async () => {
    const store = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([`run-old-${suffix}`, `outbox-old-${suffix}`, `run-new-${suffix}`, `outbox-new-${suffix}`]),
      now: () => new Date("2026-07-22T02:10:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });

    const previous = await store.enqueueReleaseRunWithOutbox(action("b".repeat(40)));
    const current = await store.enqueueReleaseRunWithOutbox(action("c".repeat(40)));
    const result = await database().query(
      "select id, status from release_runs where id = any($1::text[]) order by id",
      [[previous.runId, current.runId]],
    );

    expect((result as { rows: Record<string, unknown>[] }).rows).toEqual([
      { id: `run-new-${suffix}`, status: "queued" },
      { id: `run-old-${suffix}`, status: "superseded" },
    ]);
  });
});
