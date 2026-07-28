import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  lookupArtifactDownload,
  recordArtifactDownloadStarted,
} from "../../apps/web/app/api/v1/runs/[runId]/artifacts/[artifactId]/download/route.js";
import { createSqlAuditLogStore } from "../../packages/db/src/audit-log-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const artifactId = "44444444-4444-4444-8444-444444444444";
const otherInstallationId = "55555555-5555-4555-8555-555555555555";
const otherRepositoryId = "66666666-6666-4666-8666-666666666666";

type QueryRow = Record<string, unknown>;

function rows(result: unknown): QueryRow[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as QueryRow[]) : [];
}

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

beforeAll(async () => {
  if (!executor) return;
  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, 43001, 'artifact-audit-org', 'Organization'),
            ($2, 43002, 'artifact-audit-other', 'Organization')`,
    [installationId, otherInstallationId],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
     values ($1, $2, 43011, 'artifact-audit-org', 'board', 'main'),
            ($3, $4, 43012, 'artifact-audit-other', 'other-board', 'main')`,
    [repositoryId, installationId, otherRepositoryId, otherInstallationId],
  );
  await database().query(
    `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status)
     values ($1, $2, $3, 'refs/heads/main', 'manual', 'completed')`,
    [runId, repositoryId, "a".repeat(40)],
  );
  await database().query(
    `insert into artifacts (id, run_id, kind, name, storage_path, sha256, bytes, role)
     values ($1, $2, 'release-archive', 'board.zip', 'runs/board.zip', $3, 12, 'primary')`,
    [artifactId, runId, "b".repeat(64)],
  );
});

afterAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where id in ($1, $2)", [installationId, otherInstallationId]);
  await executor.close();
});

describeDatabase("artifact download audit PostgreSQL integration", () => {
  it("derives tenant dimensions and persists a privacy-safe access-start event", async () => {
    const lookup = await lookupArtifactDownload(runId, artifactId, database());
    expect(lookup).toEqual({
      state: "found",
      artifact: {
        id: artifactId,
        runId,
        installationId,
        repositoryId,
        kind: "release-archive",
        name: "board.zip",
        storagePath: "runs/board.zip",
        sha256: "b".repeat(64),
        bytes: 12,
        role: "primary",
      },
    });
    if (lookup.state !== "found") throw new Error("artifact fixture was not found");

    await recordArtifactDownloadStarted(lookup.artifact, database());

    const auditRows = rows(
      await database().query(
        `select installation_id, event_type, actor_type, actor_id, actor_login,
                subject_type, subject_id, repository_id, release_run_id,
                artifact_id, request_id, metadata
           from audit_events
          where artifact_id = $1 and event_type = 'artifact.download.started'`,
        [artifactId],
      ),
    );
    expect(auditRows).toEqual([
      {
        installation_id: installationId,
        event_type: "artifact.download.started",
        actor_type: "signed_url",
        actor_id: null,
        actor_login: null,
        subject_type: "artifact",
        subject_id: artifactId,
        repository_id: repositoryId,
        release_run_id: runId,
        artifact_id: artifactId,
        request_id: null,
        metadata: {
          bytes: 12,
          sha256: "b".repeat(64),
          itemType: "release-archive",
          scope: "primary",
        },
      },
    ]);

    const exported = await createSqlAuditLogStore(database()).listAuditEvents({
      installationId,
      eventType: "artifact.download.started",
    });
    expect(exported).toEqual([
      expect.objectContaining({
        installationId,
        repositoryId,
        releaseRunId: runId,
        artifactId,
        actorType: "signed_url",
        subjectType: "artifact",
        subjectId: artifactId,
        metadata: {
          bytes: 12,
          sha256: "b".repeat(64),
          itemType: "release-archive",
          scope: "primary",
        },
      }),
    ]);
  });

  it("rejects an audit event whose supplied tenant dimensions do not match the artifact chain", async () => {
    const lookup = await lookupArtifactDownload(runId, artifactId, database());
    if (lookup.state !== "found") throw new Error("artifact fixture was not found");

    await expect(
      recordArtifactDownloadStarted(
        { ...lookup.artifact, installationId: otherInstallationId, repositoryId: otherRepositoryId },
        database(),
      ),
    ).rejects.toThrow(/audit release run does not belong to repository|audit artifact does not belong to release run/u);
  });
});
