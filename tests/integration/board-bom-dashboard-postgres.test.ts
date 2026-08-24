import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lookupRunDashboard } from "../../apps/web/lib/run-dashboard.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = "7b000000-0000-4000-8000-000000000001";
const repositoryId = "7b000000-0000-4000-8000-000000000002";
const runId = "7b000000-0000-4000-8000-000000000003";
const mainboardId = "7b000000-0000-4000-8000-000000000004";
const sensorId = "7b000000-0000-4000-8000-000000000005";
const mainSnapshotId = "7b000000-0000-4000-8000-000000000006";
const sensorSnapshotId = "7b000000-0000-4000-8000-000000000007";

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

beforeAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where id = $1", [installationId]);
  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, 47101, 'board-dashboard', 'Organization')`,
    [installationId],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
     values ($1, $2, 47102, 'acme', 'hardware', 'main')`,
    [repositoryId, installationId],
  );
  await database().query(
    `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status, decision)
     values ($1, $2, $3, 'refs/heads/main', 'pr', 'completed', 'pass')`,
    [runId, repositoryId, "c".repeat(40)],
  );
  await database().query(
    `insert into boards (id, repository_id, project_path, display_name)
     values ($1, $3, 'hardware/mainboard/mainboard.kicad_pro', 'mainboard'),
            ($2, $3, 'hardware/sensor/sensor.kicad_pro', 'sensor')`,
    [mainboardId, sensorId, repositoryId],
  );
  await database().query(
    `insert into board_bom_snapshots (id, board_id, run_id, commit_sha, component_count)
     values ($1, $3, $5, $6, 3),
            ($2, $4, $5, $6, 0)`,
    [mainSnapshotId, sensorSnapshotId, mainboardId, sensorId, runId, "c".repeat(40)],
  );
  await database().query(
    `insert into board_bom_components (snapshot_id, reference, mpn, lifecycle_at_capture)
     values ($1, 'U1', 'STM32F103C8T6', 'active'),
            ($1, 'U2', 'OLD-PART-9', 'nrnd'),
            ($1, 'R1', null, null)`,
    [mainSnapshotId],
  );
});

afterAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where id = $1", [installationId]);
  await executor.close();
});

describeDatabase("board BOM dashboard surface", () => {
  it("reports each board captured by the run with its supply signals", async () => {
    const result = await lookupRunDashboard(runId, database(), {});
    expect(result.state).toBe("found");
    if (result.state !== "found") return;

    expect(result.run.boards.map((board) => board.displayName)).toEqual(["mainboard", "sensor"]);

    const mainboard = result.run.boards[0];
    expect(mainboard?.project).toBe("hardware/mainboard/mainboard.kicad_pro");
    expect(mainboard?.componentCount).toBe(3);
    expect(mainboard?.identifiedComponentCount).toBe(2);
    expect(mainboard?.unidentifiedComponentCount).toBe(1);
    expect(mainboard?.riskyLifecycleCount).toBe(1);
  });

  it("reports a board that captured no components without inventing signals", async () => {
    const result = await lookupRunDashboard(runId, database(), {});
    if (result.state !== "found") throw new Error("expected the run to be found");

    const sensor = result.run.boards.find((board) => board.displayName === "sensor");
    expect(sensor?.componentCount).toBe(0);
    expect(sensor?.identifiedComponentCount).toBe(0);
    expect(sensor?.unidentifiedComponentCount).toBe(0);
    expect(sensor?.riskyLifecycleCount).toBe(0);
  });
});
