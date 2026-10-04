import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { componentKey } from "../../packages/cloud-core/src/component-intelligence.js";
import { constantComponentIntelligence, runSupplyWatchPass } from "../../packages/cloud-core/src/supply-watch.js";
import { createSqlBoardSupplyWatchStore } from "../../packages/db/src/board-supply-watch-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlSupplyFindingStore } from "../../packages/db/src/supply-finding-store.js";
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

async function insertOpenFinding(
  findingId: string,
  mpn: string,
  manufacturer: string,
  reference: string,
  detectedAt: Date,
): Promise<void> {
  await database().query(
    `insert into board_supply_findings (
       id, board_id, mpn, manufacturer, reference, status, severity, observation_source, detected_at
     ) values ($1, $2, $3, $4, $5, 'eol', 'high', 'integration-provider', $6::timestamptz)`,
    [findingId, boardId, mpn, manufacturer, reference, detectedAt.toISOString()],
  );
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

beforeEach(async () => {
  if (!executor) return;
  await database().query("delete from board_supply_findings where id = any($1::text[])", [
    ["7c000000-0000-4000-8000-000000000078", "7c000000-0000-4000-8000-000000000079"],
  ]);
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
        "select mpn, status, severity, reference, observation_source, resolved_at from board_supply_findings where board_id = $1",
        [boardId],
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.mpn).toBe("WATCH-EOL-1");
    expect(findings[0]?.severity).toBe("high");
    expect(findings[0]?.reference).toBe("U1");
    expect(findings[0]?.observation_source).toBe("integration-provider");
    expect(findings[0]?.resolved_at).toBeNull();
  });

  it("acknowledges an open finding idempotently and refuses a cross-repository mutation", async () => {
    const finding = rows(
      await database().query(
        "select id from board_supply_findings where board_id = $1 and resolved_at is null order by detected_at desc limit 1",
        [boardId],
      ),
    )[0];
    const findingId = String(finding?.id ?? "");
    expect(findingId).not.toBe("");

    const store = createSqlSupplyFindingStore(database());
    const acknowledgedAt = new Date("2026-08-24T12:05:00.000Z");

    await expect(store.acknowledge("other-repository", findingId, "mallory", acknowledgedAt)).resolves.toBe(
      "not_found",
    );
    await expect(store.acknowledge(repositoryId, findingId, "alice", acknowledgedAt)).resolves.toBe("acknowledged");
    await expect(
      store.acknowledge(repositoryId, findingId, "bob", new Date(acknowledgedAt.getTime() + 60_000)),
    ).resolves.toBe("already_acknowledged");

    const [stored] = rows(
      await database().query("select acknowledged_at, acknowledged_by from board_supply_findings where id = $1", [
        findingId,
      ]),
    );
    expect(stored?.acknowledged_by).toBe("alice");
    expect(new Date(String(stored?.acknowledged_at)).toISOString()).toBe(acknowledgedAt.toISOString());
  });

  it("suppresses one open finding with audit history and resumes alerts without deleting that history", async () => {
    const findingId = "7c000000-0000-4000-8000-000000000078";
    const suppressedAt = new Date("2026-08-24T12:10:00.000Z");
    const expiresAt = new Date("2026-08-31T12:10:00.000Z");
    await insertOpenFinding(findingId, "WATCH-SUPPRESS-1", "ST", "U78", suppressedAt);

    const findingStore = createSqlSupplyFindingStore(database());
    const watchStore = createSqlBoardSupplyWatchStore(database());

    await expect(
      findingStore.suppress(
        repositoryId,
        findingId,
        "alice",
        "Approved alternate is already qualified",
        expiresAt,
        suppressedAt,
      ),
    ).resolves.toBe("suppressed");

    await expect(watchStore.suppressedPartKeys(boardId, suppressedAt)).resolves.toContain(
      componentKey({ mpn: "WATCH-SUPPRESS-1", manufacturer: "ST" }),
    );

    await expect(
      findingStore.clearSuppression(repositoryId, findingId, "bob", new Date("2026-08-24T12:20:00.000Z")),
    ).resolves.toBe("cleared");
    await expect(watchStore.suppressedPartKeys(boardId, new Date("2026-08-24T12:21:00.000Z"))).resolves.toEqual(
      new Set(),
    );

    const history = rows(
      await database().query(
        "select reason, created_by, cleared_by from supply_finding_suppressions where finding_id = $1",
        [findingId],
      ),
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      reason: "Approved alternate is already qualified",
      created_by: "alice",
      cleared_by: "bob",
    });
  });

  it("replaces an expired suppression on the first retry while preserving both audit rows", async () => {
    const findingId = "7c000000-0000-4000-8000-000000000079";
    const firstAt = new Date("2026-08-24T13:00:00.000Z");
    const firstExpiry = new Date("2026-08-24T14:00:00.000Z");
    const retryAt = new Date("2026-08-24T14:01:00.000Z");
    const retryExpiry = new Date("2026-08-25T14:01:00.000Z");
    await insertOpenFinding(findingId, "WATCH-SUPPRESS-2", "ST", "U79", firstAt);

    const findingStore = createSqlSupplyFindingStore(database());

    await expect(
      findingStore.suppress(repositoryId, findingId, "alice", "Short sourcing exception", firstExpiry, firstAt),
    ).resolves.toBe("suppressed");
    await expect(
      findingStore.suppress(repositoryId, findingId, "bob", "Extended sourcing exception", retryExpiry, retryAt),
    ).resolves.toBe("suppressed");

    const history = rows(
      await database().query(
        "select reason, created_by, cleared_by from supply_finding_suppressions where finding_id = $1 order by created_at",
        [findingId],
      ),
    );
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      reason: "Short sourcing exception",
      created_by: "alice",
      cleared_by: "system:expiry",
    });
    expect(history[1]).toMatchObject({
      reason: "Extended sourcing exception",
      created_by: "bob",
      cleared_by: null,
    });
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

  it("reuses a non-transferable provider only through the owning installation cache", async () => {
    const store = createSqlBoardSupplyWatchStore(database());
    const firstPassAt = new Date(now.getTime() + 90_000);
    const secondPassAt = new Date(now.getTime() + 91_000);
    await database().query("delete from installation_component_observations where installation_id = $1", [
      installationId,
    ]);
    await database().query("delete from component_lifecycle_observations where source = $1", ["tenant-provider"]);
    await database().query("update board_supply_watch set next_due_at = $2 where board_id = $1", [
      boardId,
      firstPassAt.toISOString(),
    ]);

    let lookups = 0;
    const tenantProvider = constantComponentIntelligence({
      name: "tenant-provider",
      cachePolicy: { maximumCacheAgeMs: 24 * 60 * 60 * 1000, shareableAcrossTenants: false },
      async lookup(parts) {
        lookups += parts.length;
        return parts.map((part) => ({
          ...part,
          // This test is about cache isolation, not finding transitions. Preserve the eOL fixture
          // so the later test remains responsible for resolving that finding.
          status: part.mpn === "WATCH-EOL-1" ? ("eol" as const) : ("active" as const),
          source: "tenant-provider",
          observedAt: firstPassAt,
          availableUnits: 1000,
          leadTimeDays: 21,
        }));
      },
    });

    await runSupplyWatchPass(store, tenantProvider, firstPassAt);
    const firstLookupCount = lookups;
    expect(firstLookupCount).toBe(2);

    const tenantRows = rows(
      await database().query(
        `select installation_id, provider, available_units, lead_time_days
           from installation_component_observations
          where installation_id = $1 and provider = $2`,
        [installationId, "tenant-provider"],
      ),
    );
    expect(tenantRows).toHaveLength(2);
    expect(tenantRows[0]?.installation_id).toBe(installationId);
    expect(tenantRows[0]?.available_units).toBe(1000);
    expect(tenantRows[0]?.lead_time_days).toBe(21);

    const sharedRows = rows(
      await database().query("select id from component_lifecycle_observations where source = $1", ["tenant-provider"]),
    );
    expect(sharedRows).toHaveLength(0);

    await database().query("update board_supply_watch set next_due_at = $2 where board_id = $1", [
      boardId,
      secondPassAt.toISOString(),
    ]);
    await runSupplyWatchPass(store, tenantProvider, secondPassAt);
    expect(lookups).toBe(firstLookupCount);
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
