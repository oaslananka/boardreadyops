import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { constantComponentIntelligence, runSupplyWatchPass } from "../../packages/cloud-core/src/supply-watch.js";
import { createSqlBoardSupplyWatchStore } from "../../packages/db/src/board-supply-watch-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = "7c000000-0000-4000-8000-000000000001";
const repositoryId = "7c000000-0000-4000-8000-000000000002";
const runId = "7c000000-0000-4000-8000-000000000003";
const boardId = "7c000000-0000-4000-8000-000000000004";
const snapshotId = "7c000000-0000-4000-8000-000000000005";
const now = new Date("2026-08-24T12:00:00.000Z");

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
  await database().query("delete from component_lifecycle_observations where lower(mpn) = lower($1)", ["WATCH-EOL-1"]);
  await database().query(
    // A tier that includes supply watch: these cases assert evaluation behaviour, and the
    // default 'free' tier is deliberately excluded from the capability.
    `insert into installations (id, github_installation_id, account_login, account_type, plan_tier)
     values ($1, 47201, 'supply-watch', 'Organization', 'team')`,
    [installationId],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
     values ($1, $2, 47202, 'acme', 'hardware', 'main')`,
    [repositoryId, installationId],
  );
  await database().query(
    `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status)
     values ($1, $2, $3, 'refs/heads/main', 'pr', 'completed')`,
    [runId, repositoryId, "d".repeat(40)],
  );
  await database().query(
    `insert into boards (id, repository_id, project_path, display_name)
     values ($1, $2, 'hardware/watched/watched.kicad_pro', 'watched')`,
    [boardId, repositoryId],
  );
  await database().query(
    `insert into board_bom_snapshots (id, board_id, run_id, commit_sha, component_count)
     values ($1, $2, $3, $4, 2)`,
    [snapshotId, boardId, runId, "d".repeat(40)],
  );
  await database().query(
    `insert into board_bom_components (snapshot_id, reference, mpn, manufacturer)
     values ($1, 'U1', 'WATCH-EOL-1', 'ST'),
            ($1, 'R1', 'WATCH-OK-1', 'Yageo')`,
    [snapshotId],
  );
  // This fixture inserts the board directly rather than through the BOM store, so it enrols
  // the watch row the store would otherwise create, and makes it due immediately.
  await database().query(
    `insert into board_supply_watch (board_id, next_due_at) values ($1, $2::timestamptz)
     on conflict (board_id) do update set next_due_at = excluded.next_due_at`,
    [boardId, now.toISOString()],
  );
});

afterAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where id = $1", [installationId]);
  await database().query("delete from component_lifecycle_observations where lower(mpn) like 'watch-%'", []);
  await executor.close();
});

describeDatabase("board supply watch", () => {
  it("raises a finding when a part is reported end of life, with no run involved", async () => {
    const store = createSqlBoardSupplyWatchStore(database());
    const report = await runSupplyWatchPass(
      store,
      constantComponentIntelligence({
        name: "integration-provider",
        cachePolicy: { maximumCacheAgeMs: 24 * 60 * 60 * 1000, shareableAcrossTenants: true },
        async lookup(parts) {
          return parts
            .filter((part) => part.mpn === "WATCH-EOL-1")
            .map((part) => ({ ...part, status: "eol" as const, source: "integration-provider", observedAt: now }));
        },
      }),
      now,
    );

    expect(report.boardsEvaluated).toBe(1);
    expect(report.findingsOpened).toBe(1);

    const findings = rows(
      await database().query(
        "select mpn, status, severity, reference, resolved_at from board_supply_findings where board_id = $1",
        [boardId],
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.mpn).toBe("WATCH-EOL-1");
    expect(findings[0]?.severity).toBe("high");
    expect(findings[0]?.reference).toBe("U1");
    expect(findings[0]?.resolved_at).toBeNull();
  });

  it("skips the board and never queries the provider when the plan excludes supply watch", async () => {
    const store = createSqlBoardSupplyWatchStore(database());
    await database().query("update installations set plan_tier = 'free' where id = $1", [installationId]);
    await database().query("update board_supply_watch set next_due_at = $2 where board_id = $1", [boardId, now]);
    let lookups = 0;

    try {
      const report = await runSupplyWatchPass(
        store,
        constantComponentIntelligence({
          name: "integration-provider",
          cachePolicy: { maximumCacheAgeMs: 24 * 60 * 60 * 1000, shareableAcrossTenants: true },
          async lookup(parts) {
            lookups += 1;
            return parts.map((part) => ({
              ...part,
              status: "eol" as const,
              source: "integration-provider",
              observedAt: now,
            }));
          },
        }),
        now,
      );

      expect(report.boardsEvaluated).toBe(0);
      expect(report.boardsSkipped).toBe(1);
      // The part would come back end of life, so a leak here costs a lookup the plan did not buy.
      expect(lookups).toBe(0);

      const watch = rows(
        await database().query("select last_outcome, next_due_at from board_supply_watch where board_id = $1", [
          boardId,
        ]),
      );
      expect(watch[0]?.last_outcome).toBe("not_entitled");
      // Still due later rather than disabled, so upgrading the plan resumes the watch.
      expect(new Date(String(watch[0]?.next_due_at)).getTime()).toBeGreaterThan(now.getTime());
    } finally {
      await database().query("update installations set plan_tier = 'team' where id = $1", [installationId]);
    }
  });

  it("caches the observation so the next pass does not re-query the provider", async () => {
    const store = createSqlBoardSupplyWatchStore(database());
    await database().query("update board_supply_watch set next_due_at = $2 where board_id = $1", [
      boardId,
      now.toISOString(),
    ]);

    let lookups = 0;
    const report = await runSupplyWatchPass(
      store,
      constantComponentIntelligence({
        name: "integration-provider",
        cachePolicy: { maximumCacheAgeMs: 24 * 60 * 60 * 1000, shareableAcrossTenants: true },
        async lookup(parts) {
          lookups += parts.length;
          return [];
        },
      }),
      new Date(now.getTime() + 60_000),
      {
        onError: (boardId, error) => {
          throw new Error(`supply watch failed for ${boardId}: ${error instanceof Error ? error.message : error}`);
        },
      },
    );

    // WATCH-EOL-1 is cached from the first pass; only the uncached part is asked about.
    expect(lookups).toBe(1);
    expect(report.boardsEvaluated).toBe(1);
  });

  it("resolves the finding once the part is reported active again", async () => {
    const store = createSqlBoardSupplyWatchStore(database());
    const later = new Date(now.getTime() + 120_000);
    await database().query("update board_supply_watch set next_due_at = $2 where board_id = $1", [
      boardId,
      later.toISOString(),
    ]);
    // Expire the cached observation so the provider is consulted again.
    await database().query("update component_lifecycle_observations set expires_at = $1 where lower(mpn) = lower($2)", [
      now.toISOString(),
      "WATCH-EOL-1",
    ]);

    const report = await runSupplyWatchPass(
      store,
      constantComponentIntelligence({
        name: "integration-provider",
        cachePolicy: { maximumCacheAgeMs: 24 * 60 * 60 * 1000, shareableAcrossTenants: true },
        async lookup(parts) {
          return parts.map((part) => ({
            ...part,
            status: "active" as const,
            source: "integration-provider",
            observedAt: later,
          }));
        },
      }),
      later,
    );

    expect(report.findingsResolved).toBe(1);

    const open = rows(
      await database().query("select id from board_supply_findings where board_id = $1 and resolved_at is null", [
        boardId,
      ]),
    );
    expect(open).toHaveLength(0);
  });

  it("keeps supply findings scoped to their own installation", async () => {
    const scoped = rows(
      await database().query(
        `select finding.id
         from board_supply_findings as finding
         join boards on boards.id = finding.board_id
         join repositories on repositories.id = boards.repository_id
         where repositories.installation_id = $1`,
        [installationId],
      ),
    );
    const all = rows(await database().query("select id from board_supply_findings where board_id = $1", [boardId]));
    expect(scoped.length).toBe(all.length);
  });
});
