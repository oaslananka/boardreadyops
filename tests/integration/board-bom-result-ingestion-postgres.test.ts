import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleResultRequest, type ResultRouteDependencies } from "../../apps/web/app/api/v1/runs/result/route.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 1 }) : undefined;

const installationId = "41111111-1111-4111-8111-111111111111";
const repositoryId = "42222222-2222-4222-8222-222222222222";
const bomRunId = "43333333-3333-4333-8333-333333333333";
const bomAttemptId = "44444444-4444-4444-8444-444444444444";
const plainRunId = "45555555-5555-4555-8555-555555555555";
const plainAttemptId = "46666666-6666-4666-8666-666666666666";
const bomCommitSha = "0123456789abcdef0123456789abcdef0123abcd";
const plainCommitSha = "89abcdef0123456789abcdef0123456789ab1234";
const completedAt = "2026-08-24T12:00:00.000Z";
const startedAt = "2026-08-24T11:59:58.750Z";

type QueryRow = Record<string, unknown>;

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function rows(result: unknown): QueryRow[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as QueryRow[]) : [];
}

function dependenciesFor(runId: string, attemptId: string): ResultRouteDependencies {
  return {
    queryExecutor: () => executor,
    checkRunClient: () => undefined,
    detailsUrl: (id) => `https://boardreadyops.test/runs/${id}`,
    now: () => new Date(completedAt),
    verifyOidcToken: async (_token, expectedRunId, expectedAttemptId) =>
      expectedRunId === runId && expectedAttemptId === attemptId,
  };
}

function resultRequest(runId: string, attemptId: string, body: Record<string, unknown>): Request {
  const url = new URL("https://boardreadyops.test/api/v1/runs/result");
  url.searchParams.set("run_id", runId);
  url.searchParams.set("attempt_id", attemptId);
  return new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer header.payload.signature", "content-type": "application/json" },
    body: JSON.stringify({
      version: 1,
      executionAttemptId: attemptId,
      status: "completed",
      decision: "pass",
      findings: [],
      artifacts: [],
      metrics: {},
      reportLinks: [],
      ...body,
    }),
  });
}

async function seedRun(runId: string, attemptId: string, commitSha: string): Promise<void> {
  await database().query(
    `insert into release_runs (
       id, repository_id, commit_sha, ref, trigger_kind, status,
       execution_attempt_id, execution_attempt_started_at, started_at
     ) values ($1, $2, $3, 'refs/heads/main', 'pr', 'running', $4, $5::timestamptz, $5::timestamptz)`,
    [runId, repositoryId, commitSha, attemptId, startedAt],
  );
  await database().query(
    `insert into release_run_attempts (
       id, run_id, attempt_number, status, created_at, dispatch_requested_at, dispatched_at, started_at
     ) values ($1, $2, 1, 'in_progress', $3::timestamptz, $3::timestamptz, $3::timestamptz, $3::timestamptz)`,
    [attemptId, runId, startedAt],
  );
}

beforeAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where id = $1", [installationId]);
  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, 4123456, 'bom-org', 'Organization')`,
    [installationId],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
     values ($1, $2, 4678900, 'bom-org', 'hardware-board', 'main')`,
    [repositoryId, installationId],
  );
  await seedRun(bomRunId, bomAttemptId, bomCommitSha);
  await seedRun(plainRunId, plainAttemptId, plainCommitSha);
});

afterAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where id = $1", [installationId]);
  await executor.close();
});

describeDatabase("board BOM result ingestion", () => {
  it("persists a board BOM snapshot when the terminal result carries one", async () => {
    const response = await handleResultRequest(
      resultRequest(bomRunId, bomAttemptId, {
        boms: [
          {
            project: "hardware/mainboard/mainboard.kicad_pro",
            components: [{ reference: "U1", mpn: "STM32F103C8T6", quantity: 1 }],
          },
        ],
      }),
      dependenciesFor(bomRunId, bomAttemptId),
    );

    expect(response.status).toBe(202);

    const snapshots = rows(
      await database().query(
        `select boards.project_path, boards.display_name, snapshot.component_count, snapshot.commit_sha
         from board_bom_snapshots as snapshot
         join boards on boards.id = snapshot.board_id
         where snapshot.run_id = $1`,
        [bomRunId],
      ),
    );

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.project_path).toBe("hardware/mainboard/mainboard.kicad_pro");
    expect(snapshots[0]?.display_name).toBe("mainboard");
    expect(snapshots[0]?.component_count).toBe(1);
    expect(snapshots[0]?.commit_sha).toBe(bomCommitSha);
  });

  it("attributes the board to the run's own repository", async () => {
    const boards = rows(
      await database().query("select repository_id from boards where repository_id = $1", [repositoryId]),
    );
    expect(boards).toHaveLength(1);
  });

  it("accepts a terminal result with no BOM and writes no board rows", async () => {
    const response = await handleResultRequest(
      resultRequest(plainRunId, plainAttemptId, {}),
      dependenciesFor(plainRunId, plainAttemptId),
    );

    expect(response.status).toBe(202);

    const snapshots = rows(
      await database().query("select id from board_bom_snapshots where run_id = $1", [plainRunId]),
    );
    expect(snapshots).toHaveLength(0);
  });
});
