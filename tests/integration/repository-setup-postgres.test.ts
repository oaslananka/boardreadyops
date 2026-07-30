import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlRepositorySetupStore } from "../../packages/db/src/repository-setup-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = "24000000-0000-4000-8000-000000000001";
const repositoryId = "24000000-0000-4000-8000-000000000002";
const otherInstallationId = "24000000-0000-4000-8000-000000000003";
const otherRepositoryId = "24000000-0000-4000-8000-000000000004";
const revisionOneId = "24000000-0000-4000-8000-000000000011";
const revisionTwoId = "24000000-0000-4000-8000-000000000012";
const probeId = "24000000-0000-4000-8000-000000000013";
const revisionThreeId = "24000000-0000-4000-8000-000000000014";
const expiredProbeId = "24000000-0000-4000-8000-000000000015";
const expiredRevisionId = "24000000-0000-4000-8000-000000000016";
const runId = "setup-run-24";
const outboxId = "setup-outbox-24";
const githubInstallationId = 24_000_001;
const githubRepositoryId = 24_000_002;

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

beforeAll(async () => {
  if (!executor) return;
  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, 'setup-primary', 'Organization'),
            ($3, $4, 'setup-secondary', 'Organization')`,
    [installationId, githubInstallationId, otherInstallationId, githubInstallationId + 1],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch, private)
     values ($1, $2, $3, 'setup-primary', 'board', 'main', true),
            ($4, $5, $6, 'setup-secondary', 'board', 'main', true)`,
    [repositoryId, installationId, githubRepositoryId, otherRepositoryId, otherInstallationId, githubRepositoryId + 1],
  );
});

afterAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where id = any($1::text[])", [
    [installationId, otherInstallationId],
  ]);
  await executor.close();
});

describeDatabase("repository setup PostgreSQL integration", () => {
  it("keeps setup revisions append-only, tenant-scoped and idempotent", async () => {
    const ids = [revisionOneId, revisionOneId, revisionOneId, revisionTwoId];
    const store = createSqlRepositorySetupStore(database(), {
      id: () => ids.shift() ?? "24000000-0000-4000-8000-000000000099",
      now: () => new Date("2026-07-30T06:00:00.000Z"),
    });
    const base = {
      installationId,
      repositoryId,
      preset: "production" as const,
      presetVersion: 1,
      source: "operator" as const,
      actorId: "operator.primary",
      requestId: "setup-request-1",
      workflowStatus: "unknown" as const,
      configStatus: "unknown" as const,
    };

    await expect(store.applyRevision(base)).resolves.toEqual({
      outcome: "applied",
      revisionId: revisionOneId,
      revision: 1,
    });
    await expect(store.applyRevision(base)).resolves.toEqual({
      outcome: "replayed",
      revisionId: revisionOneId,
      revision: 1,
    });
    await expect(store.applyRevision({ ...base, preset: "prototype" })).resolves.toEqual({
      outcome: "conflict",
      revisionId: revisionOneId,
      revision: 1,
    });
    await expect(store.applyRevision({ ...base, preset: "prototype", requestId: "setup-request-2" })).resolves.toEqual({
      outcome: "applied",
      revisionId: revisionTwoId,
      revision: 2,
    });

    await expect(
      database().query("update repository_setup_revisions set preset = 'production' where id = $1", [revisionTwoId]),
    ).rejects.toThrow(/append-only/iu);
    await expect(
      database().query(
        `insert into repository_setup_revisions (
           id, installation_id, repository_id, revision, preset, preset_version,
           source, actor_id, request_id, workflow_status, config_status
         ) values ($1, $2, $3, 99, 'prototype', 1, 'operator', 'operator.primary', 'cross-tenant', 'unknown', 'unknown')`,
        ["24000000-0000-4000-8000-000000000088", otherInstallationId, repositoryId],
      ),
    ).rejects.toThrow(/does not belong to installation/iu);

    const history = await store.listRevisions({ installationId, repositoryId });
    expect(history.map((revision) => [revision.revision, revision.preset])).toEqual([
      [2, "prototype"],
      [1, "production"],
    ]);
  });

  it("validates a bounded probe, snapshots provenance onto runs, and emits safe audit metadata", async () => {
    const ids = [probeId, revisionThreeId];
    const store = createSqlRepositorySetupStore(database(), {
      id: () => ids.shift() ?? "24000000-0000-4000-8000-000000000099",
      now: () => new Date("2026-07-30T06:05:00.000Z"),
    });

    await expect(
      store.createProbe({
        installationId,
        repositoryId,
        requestedBy: "operator.primary",
        requestId: "probe-request-1",
        expiresAt: new Date("2026-07-30T06:20:00.000Z"),
      }),
    ).resolves.toEqual({ outcome: "created", probeId, setupRevisionId: revisionTwoId });
    await expect(store.markProbeDispatched({ probeId, workflowRunId: "240000099" })).resolves.toBe("applied");
    await expect(
      store.completeProbe({
        probeId,
        workflowContractVersion: 1,
        configStatus: "ready",
        configVersion: 1,
        observedSha: "a".repeat(40),
        diagnostics: ["validation detail stays outside exported metadata"],
      }),
    ).resolves.toEqual({ outcome: "completed", revisionId: revisionThreeId, revision: 3 });

    await expect(store.getProbe(probeId)).resolves.toMatchObject({ status: "completed" });
    await expect(
      store.completeProbe({
        probeId,
        workflowContractVersion: 1,
        configStatus: "ready",
        configVersion: 1,
        observedSha: "a".repeat(40),
        diagnostics: ["validation detail stays outside exported metadata"],
      }),
    ).resolves.toEqual({ outcome: "replayed", revisionId: revisionThreeId, revision: 3 });

    await database().query(
      `select * from boardreadyops_enqueue_release_run_with_outbox(
         $1, 24, $2, 'refs/pull/24/head', 'pr', $3, $4::timestamptz,
         $5, $6, $7, $8::jsonb
       )`,
      [
        githubRepositoryId,
        "b".repeat(40),
        githubInstallationId,
        "2026-07-30T06:10:00.000Z",
        runId,
        "release:setup-run-24",
        outboxId,
        JSON.stringify({ repository: { id: githubRepositoryId }, pullRequestNumber: 24 }),
      ],
    );

    const runRows = rows(
      await database().query(
        `select release_runs.repository_setup_revision_id,
                setup.preset,
                setup.revision,
                setup.workflow_status,
                setup.config_status
           from release_runs
           join repository_setup_revisions as setup
             on setup.id = release_runs.repository_setup_revision_id
          where release_runs.id = $1`,
        [runId],
      ),
    );
    expect(runRows).toEqual([
      {
        repository_setup_revision_id: revisionThreeId,
        preset: "prototype",
        revision: 3,
        workflow_status: "ready",
        config_status: "ready",
      },
    ]);

    const auditRows = rows(
      await database().query(
        `select event_type, metadata
           from audit_events
          where installation_id = $1
            and event_type like 'github_app.repository.setup%'
          order by created_at, event_type`,
        [installationId],
      ),
    );
    expect(auditRows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        "github_app.repository.setup_changed",
        "github_app.repository.setup_probe_requested",
        "github_app.repository.setup_validated",
      ]),
    );
    const validated = auditRows.find((row) => row.event_type === "github_app.repository.setup_validated");
    expect(validated?.metadata).toMatchObject({
      preset: "prototype",
      presetVersion: 1,
      setupRevision: 3,
      workflowStatus: "ready",
      workflowContractVersion: 1,
      configStatus: "ready",
      configVersion: 1,
    });
    expect(JSON.stringify(auditRows)).not.toContain("validation detail");

    const expiringStore = createSqlRepositorySetupStore(database(), {
      id: () => expiredProbeId,
      now: () => new Date("2026-07-30T06:15:00.000Z"),
    });
    await expect(
      expiringStore.createProbe({
        installationId,
        repositoryId,
        requestedBy: "operator.primary",
        requestId: "probe-request-expired",
        expiresAt: new Date("2026-07-30T06:16:00.000Z"),
      }),
    ).resolves.toEqual({ outcome: "created", probeId: expiredProbeId, setupRevisionId: revisionThreeId });

    const expiredStore = createSqlRepositorySetupStore(database(), {
      id: () => expiredRevisionId,
      now: () => new Date("2026-07-30T06:20:00.000Z"),
    });
    const expiredInput = {
      probeId: expiredProbeId,
      workflowContractVersion: 1,
      configStatus: "ready" as const,
      configVersion: 1,
      observedSha: "c".repeat(40),
      diagnostics: [],
    };
    await expect(expiredStore.completeProbe(expiredInput)).resolves.toEqual({ outcome: "expired" });
    await expect(expiredStore.completeProbe(expiredInput)).resolves.toEqual({ outcome: "expired" });
  });
});
