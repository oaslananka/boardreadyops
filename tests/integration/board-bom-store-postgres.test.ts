import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSqlBoardBomStore } from "../../packages/db/src/board-bom-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = "40000000-0000-4000-8000-000000000001";
const repositoryId = "40000000-0000-4000-8000-000000000002";
const runOneId = "40000000-0000-4000-8000-000000000003";
const runTwoId = "40000000-0000-4000-8000-000000000004";
const githubInstallationId = 40_000_001;
const githubRepositoryId = 40_000_002;
const commitOne = `a${"1".repeat(39)}`;
const commitTwo = `b${"2".repeat(39)}`;

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
  await database().query("delete from installations where id = $1", [installationId]);
  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, 'board-bom', 'Organization')`,
    [installationId, githubInstallationId],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
     values ($1, $2, $3, 'acme', 'hardware', 'main')`,
    [repositoryId, installationId, githubRepositoryId],
  );
  await database().query(
    `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status)
     values ($1, $2, $4, 'refs/heads/main', 'pr', 'completed'),
            ($3, $2, $5, 'refs/heads/main', 'pr', 'completed')`,
    [runOneId, repositoryId, runTwoId, commitOne, commitTwo],
  );
});

afterAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where id = $1", [installationId]);
  await executor.close();
});

describeDatabase("board BOM store", () => {
  it("discovers a board and writes its first snapshot", async () => {
    const store = createSqlBoardBomStore(database());
    const result = await store.recordSnapshots({
      runId: runOneId,
      repositoryId,
      commitSha: commitOne,
      boms: [
        {
          project: "hardware/mainboard/mainboard.kicad_pro",
          components: [
            { reference: "U1", mpn: "STM32F103C8T6", manufacturer: "ST", quantity: 1, dnp: false },
            { reference: "R1", value: "10k", quantity: 4 },
          ],
        },
      ],
    });

    expect(result).toEqual({ boardsTouched: 1, snapshotsWritten: 1, componentsWritten: 2 });

    const boards = rows(
      await database().query("select project_path, display_name from boards where repository_id = $1", [repositoryId]),
    );
    expect(boards).toHaveLength(1);
    expect(boards[0]?.project_path).toBe("hardware/mainboard/mainboard.kicad_pro");
    expect(boards[0]?.display_name).toBe("mainboard");
  });

  it("keeps the earlier snapshot when the same board reports a later run", async () => {
    const store = createSqlBoardBomStore(database());
    await store.recordSnapshots({
      runId: runTwoId,
      repositoryId,
      commitSha: commitTwo,
      boms: [
        {
          project: "hardware/mainboard/mainboard.kicad_pro",
          components: [{ reference: "U1", mpn: "STM32G071CBT6", manufacturer: "ST", quantity: 1 }],
        },
      ],
    });

    const snapshots = rows(
      await database().query(
        `select snapshot.component_count
         from board_bom_snapshots as snapshot
         join boards on boards.id = snapshot.board_id
         where boards.repository_id = $1
         order by snapshot.captured_at asc, snapshot.id asc`,
        [repositoryId],
      ),
    );
    expect(snapshots).toHaveLength(2);
  });

  it("is idempotent when the same run is replayed", async () => {
    const store = createSqlBoardBomStore(database());
    const replay = await store.recordSnapshots({
      runId: runOneId,
      repositoryId,
      commitSha: commitOne,
      boms: [
        {
          project: "hardware/mainboard/mainboard.kicad_pro",
          components: [
            { reference: "U1", mpn: "STM32F103C8T6", manufacturer: "ST", quantity: 1, dnp: false },
            { reference: "R1", value: "10k", quantity: 4 },
          ],
        },
      ],
    });

    expect(replay.snapshotsWritten).toBe(0);

    const components = rows(
      await database().query(
        `select count(*)::int as total
         from board_bom_components as component
         join board_bom_snapshots as snapshot on snapshot.id = component.snapshot_id
         where snapshot.run_id = $1`,
        [runOneId],
      ),
    );
    expect(components[0]?.total).toBe(2);
  });

  it("collapses a duplicated project path instead of failing the command", async () => {
    const store = createSqlBoardBomStore(database());
    const result = await store.recordSnapshots({
      runId: runTwoId,
      repositoryId,
      commitSha: commitTwo,
      boms: [
        { project: "hardware/sensor/sensor.kicad_pro", components: [{ reference: "U1" }] },
        { project: "hardware/sensor/sensor.kicad_pro", components: [{ reference: "U1" }, { reference: "U2" }] },
      ],
    });

    expect(result.boardsTouched).toBe(1);
    expect(result.snapshotsWritten).toBe(1);
    expect(result.componentsWritten).toBe(2);
  });

  it("enrols a newly discovered board in supply watch", async () => {
    // Without this the watch never becomes due for any board created after the watch
    // migration ran, so the feature would silently never evaluate anything.
    const watch = rows(
      await database().query(
        `select watch.board_id, watch.enabled
         from board_supply_watch as watch
         join boards on boards.id = watch.board_id
         where boards.repository_id = $1 and boards.project_path = $2`,
        [repositoryId, "hardware/mainboard/mainboard.kicad_pro"],
      ),
    );

    expect(watch).toHaveLength(1);
    expect(watch[0]?.enabled).toBe(true);
  });

  it("refuses a board whose run belongs to another repository", async () => {
    const store = createSqlBoardBomStore(database());
    await expect(
      store.recordSnapshots({
        runId: runOneId,
        repositoryId: "40000000-0000-4000-8000-0000000000ff",
        commitSha: commitOne,
        boms: [{ project: "other.kicad_pro", components: [{ reference: "U1" }] }],
      }),
    ).rejects.toThrow(/repository/u);
  });
});
