import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSqlEntitlementStore } from "../../packages/db/src/entitlement-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = "7d000000-0000-4000-8000-000000000001";
const repositoryId = "7d000000-0000-4000-8000-000000000002";
const boardIds = [
  "7d000000-0000-4000-8000-00000000000a",
  "7d000000-0000-4000-8000-00000000000b",
  "7d000000-0000-4000-8000-00000000000c",
];

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
    `insert into installations (id, github_installation_id, account_login, account_type, plan_tier)
     values ($1, 47301, 'entitlements', 'Organization', 'team')`,
    [installationId],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
     values ($1, $2, 47302, 'acme', 'hardware', 'main')`,
    [repositoryId, installationId],
  );
  // Distinct first_seen_at so the downgrade ordering is deterministic.
  for (const [index, boardId] of boardIds.entries()) {
    await database().query(
      `insert into boards (id, repository_id, project_path, display_name, first_seen_at)
       values ($1, $2, $3, $4, $5::timestamptz)`,
      [
        boardId,
        repositoryId,
        `hardware/board-${index}/board-${index}.kicad_pro`,
        `board-${index}`,
        new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      ],
    );
    await database().query("insert into board_supply_watch (board_id) values ($1)", [boardId]);
  }
});

afterAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where id = $1", [installationId]);
  await executor.close();
});

describeDatabase("entitlement store", () => {
  it("reports the installation's plan and how many boards it watches", async () => {
    const store = createSqlEntitlementStore(database());
    const entitlement = await store.forRepository(repositoryId);

    expect(entitlement?.tier).toBe("team");
    expect(entitlement?.watchedBoards).toBe(3);
  });

  it("suspends the newest boards when the plan cannot cover them all", async () => {
    const store = createSqlEntitlementStore(database());
    const result = await store.applyWatchAllowance(installationId, "free");

    expect(result).toEqual({ watched: 1, suspended: 2 });

    const enabled = rows(
      await database().query(
        `select boards.display_name
         from board_supply_watch as watch
         join boards on boards.id = watch.board_id
         where boards.repository_id = $1 and watch.enabled`,
        [repositoryId],
      ),
    );
    // The oldest board keeps its watch, so a downgrade does not stop watching the board the
    // team has relied on longest.
    expect(enabled.map((row) => row.display_name)).toEqual(["board-0"]);
  });

  it("keeps suspended boards and their evidence rather than deleting them", async () => {
    const boards = rows(await database().query("select id from boards where repository_id = $1", [repositoryId]));
    expect(boards).toHaveLength(3);
  });

  it("re-enables every board when the plan is raised again", async () => {
    const store = createSqlEntitlementStore(database());
    const result = await store.applyWatchAllowance(installationId, "team");

    expect(result).toEqual({ watched: 3, suspended: 0 });

    const entitlement = await store.forRepository(repositoryId);
    expect(entitlement?.watchedBoards).toBe(3);
  });

  it("degrades an unrecognised stored tier to the least privileged one", async () => {
    await database().query("update installations set plan_tier = $2 where id = $1", [
      installationId,
      "enterprise-unreleased",
    ]);

    const store = createSqlEntitlementStore(database());
    const entitlement = await store.forRepository(repositoryId);

    expect(entitlement?.tier).toBe("free");

    await database().query("update installations set plan_tier = 'team' where id = $1", [installationId]);
  });
});
