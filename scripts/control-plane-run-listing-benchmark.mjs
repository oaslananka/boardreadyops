import { fileURLToPath } from "node:url";
import { CONTROL_PLANE_LOAD_CONFIRMATION, percentile, summarizeDurations } from "./control-plane-load.mjs";
import { boundedEnvironmentInteger } from "./lib/environment.mjs";

/**
 * Cloud run-list/query pagination benchmark.
 *
 * `apps/web/lib/run-listing.ts` paginates the cross-repository run listing with keyset
 * (cursor) pagination: `where (started_at, id) < (cursor.startedAt, cursor.id) order by
 * started_at desc, id desc limit $n`. Keyset pagination does not re-scan or re-sort skipped
 * rows the way `OFFSET n` does, so page latency should stay roughly flat as page depth
 * increases, even against a large history. This benchmark measures that directly rather than
 * asserting it: it seeds a small-history and a large-history tenant, walks each one page by
 * page at a few representative page sizes through the real `loadViewerRuns` query, and fails
 * with a stable signal if late-page p95 latency drifts far past early-page p95 latency.
 *
 * Mirrors `scripts/control-plane-load.mjs`: bounded env-driven configuration, an isolated
 * disposable-database confirmation gate, `percentile`/`summarizeDurations` reuse for
 * consistent p50/p95/p99 reporting, and a `main()` that shells out to the paired integration
 * test so the real PostgreSQL-backed run only executes under an explicit opt-in flag.
 */

const isolatedTables = Object.freeze(["installations", "repositories", "release_runs"]);

export const CONTROL_PLANE_RUN_LISTING_BENCHMARK_CONFIRMATION = CONTROL_PLANE_LOAD_CONFIRMATION;

export function parseRunListingBenchmarkConfiguration(environment = process.env) {
  if (environment.BOARDREADYOPS_LOAD_CONFIRMATION !== CONTROL_PLANE_RUN_LISTING_BENCHMARK_CONFIRMATION) {
    throw new Error("isolated load-test confirmation is required");
  }
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the run-listing pagination benchmark");

  const pageSizesRaw = environment.BOARDREADYOPS_RUN_LISTING_PAGE_SIZES?.trim() || "10,25,100";
  const pageSizes = pageSizesRaw.split(",").map((value) => {
    const trimmed = value.trim();
    if (!/^\d+$/u.test(trimmed)) {
      throw new Error("BOARDREADYOPS_RUN_LISTING_PAGE_SIZES must be a comma-separated list of positive integers");
    }
    const parsed = Number(trimmed);
    if (parsed < 1 || parsed > 200)
      throw new Error("BOARDREADYOPS_RUN_LISTING_PAGE_SIZES entries must be between 1 and 200");
    return parsed;
  });
  if (pageSizes.length === 0) throw new Error("BOARDREADYOPS_RUN_LISTING_PAGE_SIZES must list at least one page size");

  return {
    databaseUrl,
    smallDatasetRuns: boundedEnvironmentInteger(environment, "BOARDREADYOPS_RUN_LISTING_SMALL_DATASET", 200, 50, 2_000),
    largeDatasetRuns: boundedEnvironmentInteger(
      environment,
      "BOARDREADYOPS_RUN_LISTING_LARGE_DATASET",
      20_000,
      2_000,
      100_000,
    ),
    pageSizes,
    pageDepth: boundedEnvironmentInteger(environment, "BOARDREADYOPS_RUN_LISTING_PAGE_DEPTH", 20, 5, 200),
    thresholds: {
      p95Ms: boundedEnvironmentInteger(environment, "BOARDREADYOPS_RUN_LISTING_P95_MS", 500, 10, 60_000),
      depthDegradationRatioMax: boundedEnvironmentInteger(
        environment,
        "BOARDREADYOPS_RUN_LISTING_DEPTH_DEGRADATION_RATIO_MAX",
        3,
        1,
        50,
      ),
    },
  };
}

function rounded(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function databaseRows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

function integerColumn(row, name) {
  const value = row?.[name];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) return Number(value);
  return 0;
}

async function assertIsolatedDatabase(executor) {
  const unions = isolatedTables.map(
    (table) => `select '${table}' as table_name, count(*)::bigint as count from ${table}`,
  );
  const rows = databaseRows(await executor.query(unions.join(" union all ")));
  const populated = rows.filter((row) => integerColumn(row, "count") > 0).map((row) => String(row.table_name));
  if (populated.length > 0) throw new Error("run-listing benchmark database must be isolated and empty");
}

/**
 * Confirms the run listing still uses keyset (cursor) pagination rather than `OFFSET`. Reads
 * the same source module the benchmark exercises so a future switch to offset pagination fails
 * this check instead of silently invalidating the "no full-scan-shaped depth degradation"
 * claim below.
 */
export function assertKeysetPagination(runListingSource) {
  if (/\boffset\b/iu.test(runListingSource)) {
    throw new Error("run listing query appears to use OFFSET pagination; benchmark assumptions no longer hold");
  }
  if (!/started_at,\s*release_runs\.id\)\s*<\s*\(\$2::timestamptz,\s*\$3::text\)/u.test(runListingSource)) {
    throw new Error("run listing query no longer matches the expected keyset predicate shape");
  }
  return "cursor";
}

function loadPrefix() {
  return `runlist-bench-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function seedTenant(executor, prefix) {
  const installationId = `${prefix}-installation`;
  const repositoryId = `${prefix}-repository`;
  const githubInstallationId = 9_800_000_001;
  await executor.query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, $3, 'Organization')`,
    [installationId, githubInstallationId, `${prefix}-owner`],
  );
  await executor.query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch, private)
     values ($1, $2, $3, $4, 'repository', 'main', false)`,
    [repositoryId, installationId, 9_900_000_001, `${prefix}-owner`],
  );
  return { installationId, repositoryId, githubInstallationId };
}

/**
 * Bulk-inserts `count` synthetic release runs for one repository with strictly decreasing
 * `started_at` timestamps (newest first), one second apart, so keyset pagination has a
 * well-ordered, tie-free history to walk. Uses a single set-based INSERT rather than one
 * round trip per row so seeding a large dataset stays fast.
 */
async function seedRunHistory(executor, prefix, repositoryId, count) {
  await executor.query(
    `insert into release_runs (
       id, repository_id, idempotency_key, commit_sha, ref, trigger_kind, status, decision, started_at
     )
     select
       md5(random()::text || gs::text)::uuid::text,
       $1,
       $2 || ':' || gs,
       lpad(to_hex(gs), 40, '0'),
       'refs/heads/main',
       'push',
       'completed',
       'pass',
       now() - (gs || ' seconds')::interval
     from generate_series(1, $3) as gs`,
    [repositoryId, prefix, count],
  );
}

/**
 * Walks `pageDepth` pages of `pageSize` runs via the real `loadViewerRuns` cursor pagination,
 * timing each page fetch. Stops early if the history is exhausted before `pageDepth` pages.
 */
async function walkPages(loadViewerRuns, decodeRunListingCursor, session, environment, pageSize, pageDepth) {
  const durations = [];
  let cursor;
  const startedAt = performance.now();
  for (let page = 0; page < pageDepth; page += 1) {
    const pageStartedAt = performance.now();
    const result = await loadViewerRuns(session, { ...(cursor ? { cursor } : {}), limit: pageSize }, environment);
    durations.push(performance.now() - pageStartedAt);
    if (result.state !== "ok") throw new Error("run-listing benchmark query did not return a page");
    if (!result.next) break;
    cursor = decodeRunListingCursor(result.next);
    if (!cursor) throw new Error("run-listing benchmark received an undecodable cursor");
  }
  return { durations, elapsedMs: performance.now() - startedAt };
}

/** Compares early-page vs late-page p95 latency to detect offset-shaped depth degradation. */
function depthDegradation(durations) {
  if (durations.length < 4) {
    return {
      firstQuarterP95Ms: rounded(durations[0] ?? 0),
      lastQuarterP95Ms: rounded(durations.at(-1) ?? 0),
      ratio: 1,
    };
  }
  const quarter = Math.max(1, Math.floor(durations.length / 4));
  const firstQuarterP95Ms = rounded(percentile(durations.slice(0, quarter), 0.95));
  const lastQuarterP95Ms = rounded(percentile(durations.slice(-quarter), 0.95));
  const ratio = rounded(lastQuarterP95Ms / Math.max(firstQuarterP95Ms, 1), 2);
  return { firstQuarterP95Ms, lastQuarterP95Ms, ratio };
}

async function benchmarkTier(
  loadViewerRuns,
  decodeRunListingCursor,
  session,
  environment,
  dataset,
  pageSize,
  pageDepth,
) {
  const { durations, elapsedMs } = await walkPages(
    loadViewerRuns,
    decodeRunListingCursor,
    session,
    environment,
    pageSize,
    pageDepth,
  );
  const degradation = depthDegradation(durations);
  return {
    dataset,
    pageSize,
    pagesWalked: durations.length,
    ...summarizeDurations(durations, elapsedMs),
    firstQuarterP95Ms: degradation.firstQuarterP95Ms,
    lastQuarterP95Ms: degradation.lastQuarterP95Ms,
    depthDegradationRatio: degradation.ratio,
  };
}

export function evaluateRunListingBenchmarkReport(report, thresholds) {
  const signals = [];
  for (const tier of report.tiers) {
    if (tier.p95Ms > thresholds.p95Ms) signals.push(`${tier.dataset}_page${tier.pageSize}_p95_exceeded`);
    if (tier.depthDegradationRatio > thresholds.depthDegradationRatioMax) {
      signals.push(`${tier.dataset}_page${tier.pageSize}_depth_degradation_exceeded`);
    }
  }
  return signals;
}

async function cleanupTenant(executor, repositoryId, installationId) {
  await executor.query("delete from release_runs where repository_id = $1", [repositoryId]);
  await executor.query("delete from repositories where id = $1", [repositoryId]);
  await executor.query("delete from installations where id = $1", [installationId]);
}

export async function runRunListingPaginationBenchmark(configuration, dependencies) {
  const { createPgQueryExecutor, loadViewerRuns, decodeRunListingCursor, runListingSource } = dependencies;
  const paginationStyle = assertKeysetPagination(runListingSource);
  const executor = createPgQueryExecutor({ connectionString: configuration.databaseUrl, max: 10 });
  const environment = { DATABASE_URL: configuration.databaseUrl };
  const datasets = [
    { name: "small", runs: configuration.smallDatasetRuns },
    { name: "large", runs: configuration.largeDatasetRuns },
  ];
  try {
    await assertIsolatedDatabase(executor);
    const tenant = await seedTenant(executor, loadPrefix());
    const session = { userId: 1, login: "bench", installationIds: [tenant.githubInstallationId] };
    const tiers = [];
    try {
      for (const dataset of datasets) {
        await seedRunHistory(executor, loadPrefix(), tenant.repositoryId, dataset.runs);
        for (const pageSize of configuration.pageSizes) {
          tiers.push(
            await benchmarkTier(
              loadViewerRuns,
              decodeRunListingCursor,
              session,
              environment,
              dataset.name,
              pageSize,
              configuration.pageDepth,
            ),
          );
        }
        await executor.query("delete from release_runs where repository_id = $1", [tenant.repositoryId]);
      }
    } finally {
      await cleanupTenant(executor, tenant.repositoryId, tenant.installationId);
    }

    const report = {
      event: "control_plane_run_listing_pagination_benchmark_verified",
      scenario: {
        smallDatasetRuns: configuration.smallDatasetRuns,
        largeDatasetRuns: configuration.largeDatasetRuns,
        pageSizes: configuration.pageSizes,
        pageDepth: configuration.pageDepth,
      },
      paginationStyle,
      tiers,
    };
    return { ...report, signals: evaluateRunListingBenchmarkReport(report, configuration.thresholds) };
  } finally {
    await executor.close();
  }
}

async function main() {
  parseRunListingBenchmarkConfiguration(process.env);
  const { spawnSync } = await import("node:child_process");
  const vitestCli = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [vitestCli, "run", "tests/integration/control-plane-run-listing-benchmark.test.ts", "--no-file-parallelism"],
    {
      env: {
        ...process.env,
        BOARDREADYOPS_RUN_LISTING_BENCHMARK_TESTS: "true",
        BOARDREADYOPS_POSTGRES_TESTS: "true",
      },
      stdio: "inherit",
    },
  );
  if (result.error) throw new Error(`run-listing pagination benchmark could not start (${result.error.name})`);
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "run-listing pagination benchmark failed"}\n`);
    process.exitCode = 1;
  }
}
