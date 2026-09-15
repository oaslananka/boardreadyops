import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSqlAffectedBoardsStore } from "../../packages/db/src/affected-boards-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

/**
 * Runs the affected-boards query against a real Postgres.
 *
 * The unit tests hand `resolveAffectedBoards` a mocked executor, which proves the code reads rows
 * correctly and proves nothing at all about the SQL. This query joins five tables, unnests two
 * arrays, groups, ranks and compares timestamps, and under #755 its output is what gets reported
 * to a regulator. Shipping it having never executed it would be the "built but unverified" pattern
 * with the stakes turned up.
 */

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = "7c000000-0000-4000-8000-000000000001";
const otherInstallationId = "7c000000-0000-4000-8000-000000000011";
const repositoryId = "7c000000-0000-4000-8000-000000000002";
const otherRepositoryId = "7c000000-0000-4000-8000-000000000012";
const runId = "7c000000-0000-4000-8000-000000000003";
const otherRunId = "7c000000-0000-4000-8000-000000000013";
const currentBoardId = "7c000000-0000-4000-8000-000000000004";
const supersededBoardId = "7c000000-0000-4000-8000-000000000005";
const archivedBoardId = "7c000000-0000-4000-8000-000000000006";
const otherTenantBoardId = "7c000000-0000-4000-8000-000000000016";

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

async function seedTenant(id: string, repository: string, run: string, githubId: number, login: string) {
  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, $3, 'Organization')`,
    [id, githubId, login],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
     values ($1, $2, $3, 'acme', $4, 'main')`,
    [repository, id, githubId + 1, login],
  );
  await database().query(
    `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status, decision)
     values ($1, $2, $3, 'refs/heads/main', 'pr', 'completed', 'pass')`,
    [run, repository, "d".repeat(40)],
  );
}

beforeAll(async () => {
  if (!executor) return;
  for (const id of [installationId, otherInstallationId]) {
    await database().query("delete from installations where id = $1", [id]);
  }

  await seedTenant(installationId, repositoryId, runId, 47201, "affected");
  await seedTenant(otherInstallationId, otherRepositoryId, otherRunId, 47301, "othertenant");

  await database().query(
    `insert into boards (id, repository_id, project_path, display_name, archived_at)
     values ($1, $4, 'hardware/current/current.kicad_pro', 'current', null),
            ($2, $4, 'hardware/superseded/superseded.kicad_pro', 'superseded', null),
            ($3, $4, 'hardware/archived/archived.kicad_pro', 'archived', now())`,
    [currentBoardId, supersededBoardId, archivedBoardId, repositoryId],
  );
  await database().query(
    `insert into boards (id, repository_id, project_path, display_name)
     values ($1, $2, 'hardware/other/other.kicad_pro', 'other')`,
    [otherTenantBoardId, otherRepositoryId],
  );

  // `current` carries the part in its newest snapshot. `superseded` carried it in an older one and
  // designed it out. Both have to come back, told apart.
  await database().query(
    `insert into board_bom_snapshots (id, board_id, run_id, commit_sha, component_count, captured_at)
     values ('7c000000-0000-4000-8000-000000000101', $1, $4, $5, 2, now() - interval '30 days'),
            ('7c000000-0000-4000-8000-000000000102', $1, $4, $5, 2, now() - interval '1 day'),
            ('7c000000-0000-4000-8000-000000000103', $2, $4, $5, 2, now() - interval '60 days'),
            ('7c000000-0000-4000-8000-000000000104', $2, $4, $5, 1, now() - interval '2 days'),
            ('7c000000-0000-4000-8000-000000000105', $3, $4, $5, 1, now() - interval '5 days')`,
    [currentBoardId, supersededBoardId, archivedBoardId, runId, "d".repeat(40)],
  );
  await database().query(
    `insert into board_bom_snapshots (id, board_id, run_id, commit_sha, component_count)
     values ('7c000000-0000-4000-8000-000000000106', $1, $2, $3, 1)`,
    [otherTenantBoardId, otherRunId, "d".repeat(40)],
  );

  await database().query(
    `insert into board_bom_components (snapshot_id, reference, mpn, manufacturer, dnp)
     values ('7c000000-0000-4000-8000-000000000101', 'U7', 'TPS62840DLCR', 'Texas Instruments', false),
            ('7c000000-0000-4000-8000-000000000102', 'U7', 'TPS62840DLCR', 'Texas Instruments', false),
            ('7c000000-0000-4000-8000-000000000102', 'U9', 'TPS62840DLCR', 'Texas Instruments', false),
            ('7c000000-0000-4000-8000-000000000102', 'C1', 'GRM188R71H104KA93D', 'Murata', false),
            ('7c000000-0000-4000-8000-000000000103', 'U3', 'TPS62840DLCR', 'Texas Instruments', false),
            ('7c000000-0000-4000-8000-000000000104', 'U3', 'REPLACEMENT-1', 'Texas Instruments', false),
            ('7c000000-0000-4000-8000-000000000105', 'U1', 'TPS62840DLCR', 'Texas Instruments', false),
            ('7c000000-0000-4000-8000-000000000106', 'U1', 'TPS62840DLCR', 'Texas Instruments', false)`,
  );
});

afterAll(async () => {
  if (!executor) return;
  for (const id of [installationId, otherInstallationId]) {
    await database().query("delete from installations where id = $1", [id]);
  }
  await executor.close();
});

describeDatabase("resolveAffectedBoards against Postgres", () => {
  it("finds the boards carrying a part and says which still build it", async () => {
    const store = createSqlAffectedBoardsStore(database());
    const result = await store.resolveAffectedBoards(installationId, [{ mpn: "TPS62840DLCR" }]);

    expect(result.truncated).toBe(false);
    const byName = new Map(result.boards.map((board) => [board.displayName, board]));
    expect([...byName.keys()].sort()).toEqual(["current", "superseded"]);

    const current = byName.get("current");
    expect(current?.inCurrentRevision).toBe(true);
    // Both references on the newest snapshot, aggregated and ordered.
    expect(current?.references).toEqual(["U7", "U9"]);
    expect(current?.repositoryFullName).toBe("acme/affected");

    const superseded = byName.get("superseded");
    // The part is only in an older snapshot: relevant to a device in the field, not to a reorder.
    expect(superseded?.inCurrentRevision).toBe(false);
    expect(superseded?.references).toEqual(["U3"]);
  });

  it("puts the boards still building the part first", async () => {
    const store = createSqlAffectedBoardsStore(database());
    const result = await store.resolveAffectedBoards(installationId, [{ mpn: "TPS62840DLCR" }]);

    expect(result.boards[0]?.inCurrentRevision).toBe(true);
  });

  it("matches on manufacturer when one is given, and ignores it when not", async () => {
    const store = createSqlAffectedBoardsStore(database());

    const matched = await store.resolveAffectedBoards(installationId, [
      { mpn: "TPS62840DLCR", manufacturer: "Texas Instruments" },
    ]);
    expect(matched.boards.length).toBeGreaterThan(0);

    const wrongManufacturer = await store.resolveAffectedBoards(installationId, [
      { mpn: "TPS62840DLCR", manufacturer: "Not The Maker" },
    ]);
    expect(wrongManufacturer.boards).toEqual([]);
  });

  it("never crosses an installation boundary", async () => {
    const store = createSqlAffectedBoardsStore(database());
    const result = await store.resolveAffectedBoards(installationId, [{ mpn: "TPS62840DLCR" }]);

    // The other tenant's board carries the same part. Which of *your* boards contains a part is
    // not a fact about the world.
    expect(result.boards.map((board) => board.displayName)).not.toContain("other");
  });

  it("leaves out an archived board", async () => {
    const store = createSqlAffectedBoardsStore(database());
    const result = await store.resolveAffectedBoards(installationId, [{ mpn: "TPS62840DLCR" }]);

    expect(result.boards.map((board) => board.displayName)).not.toContain("archived");
  });

  it("reports truncation from the database, not from the row count alone", async () => {
    const store = createSqlAffectedBoardsStore(database());
    const result = await store.resolveAffectedBoards(installationId, [{ mpn: "TPS62840DLCR" }], { limit: 1 });

    expect(result.boards).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("resolves several parts in one pass", async () => {
    const store = createSqlAffectedBoardsStore(database());
    const result = await store.resolveAffectedBoards(installationId, [
      { mpn: "TPS62840DLCR" },
      { mpn: "GRM188R71H104KA93D", manufacturer: "Murata" },
    ]);

    const current = result.boards.find((board) => board.displayName === "current");
    // Both parts are on the same newest snapshot, so the references aggregate rather than
    // producing two rows for one board.
    expect(current?.references).toEqual(["C1", "U7", "U9"]);
  });

  it("returns nothing for a part nobody uses", async () => {
    const store = createSqlAffectedBoardsStore(database());
    const result = await store.resolveAffectedBoards(installationId, [{ mpn: "NOT-A-REAL-PART" }]);
    expect(result).toEqual({ boards: [], truncated: false });
  });
});
