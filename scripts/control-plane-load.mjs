import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const CONTROL_PLANE_LOAD_CONFIRMATION = "isolated-disposable-database";

const defaultThresholds = Object.freeze({
  intakeP95Ms: 1_000,
  lifecycleP95Ms: 1_500,
  dashboardP95Ms: 1_000,
  minimumThroughputPerSecond: 10,
});

const isolatedTables = Object.freeze([
  "installations",
  "repositories",
  "release_runs",
  "webhook_inbox",
  "control_plane_jobs",
  "control_plane_outbox",
]);

function boundedInteger(environment, name, fallback, minimum, maximum) {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  const normalized = raw.trim();
  if (!/^\d+$/u.test(normalized)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function parseControlPlaneLoadConfiguration(environment = process.env) {
  if (environment.BOARDREADYOPS_LOAD_CONFIRMATION !== CONTROL_PLANE_LOAD_CONFIRMATION) {
    throw new Error("isolated load-test confirmation is required");
  }
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for control-plane load validation");

  const uniqueDeliveries = boundedInteger(environment, "BOARDREADYOPS_LOAD_UNIQUE_DELIVERIES", 200, 10, 5_000);
  const duplicateDeliveries = boundedInteger(environment, "BOARDREADYOPS_LOAD_DUPLICATE_DELIVERIES", 50, 0, 5_000);
  if (duplicateDeliveries > uniqueDeliveries) {
    throw new Error("duplicate deliveries cannot exceed unique deliveries");
  }

  return {
    databaseUrl,
    uniqueDeliveries,
    duplicateDeliveries,
    repositoryCount: boundedInteger(environment, "BOARDREADYOPS_LOAD_REPOSITORIES", 4, 2, 20),
    runsPerRepository: boundedInteger(environment, "BOARDREADYOPS_LOAD_RUNS_PER_REPOSITORY", 20, 5, 100),
    concurrency: boundedInteger(environment, "BOARDREADYOPS_LOAD_CONCURRENCY", 20, 1, 100),
    thresholds: {
      intakeP95Ms: boundedInteger(environment, "BOARDREADYOPS_LOAD_INTAKE_P95_MS", 1_000, 10, 60_000),
      lifecycleP95Ms: boundedInteger(environment, "BOARDREADYOPS_LOAD_LIFECYCLE_P95_MS", 1_500, 10, 60_000),
      dashboardP95Ms: boundedInteger(environment, "BOARDREADYOPS_LOAD_DASHBOARD_P95_MS", 1_000, 10, 60_000),
      minimumThroughputPerSecond: boundedInteger(
        environment,
        "BOARDREADYOPS_LOAD_MINIMUM_THROUGHPUT_PER_SECOND",
        10,
        1,
        10_000,
      ),
    },
  };
}

export function percentile(values, quantile) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("percentile values are required");
  if (!Number.isFinite(quantile) || quantile <= 0 || quantile > 1) {
    throw new Error("percentile quantile must be greater than zero and at most one");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

function rounded(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function summarizeDurations(durations, elapsedMs) {
  if (!Array.isArray(durations) || durations.length === 0) throw new Error("measured durations are required");
  const boundedElapsedMs = Math.max(1, elapsedMs);
  return {
    count: durations.length,
    elapsedMs: rounded(boundedElapsedMs),
    throughputPerSecond: rounded((durations.length * 1_000) / boundedElapsedMs, 2),
    p50Ms: rounded(percentile(durations, 0.5)),
    p95Ms: rounded(percentile(durations, 0.95)),
    p99Ms: rounded(percentile(durations, 0.99)),
    maximumMs: rounded(Math.max(...durations)),
  };
}

export async function mapWithConcurrency(values, concurrency, operation) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be positive");
  const results = new Array(values.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await operation(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

export function evaluateControlPlaneLoadReport(report, thresholds = defaultThresholds) {
  const signals = [];
  const phases = [
    ["intake", report.intake, thresholds.intakeP95Ms],
    ["lifecycle", report.lifecycle, thresholds.lifecycleP95Ms],
    ["dashboard", report.dashboard, thresholds.dashboardP95Ms],
  ];
  for (const [name, phase, p95Threshold] of phases) {
    if (phase.p95Ms > p95Threshold) signals.push(`${name}_p95_exceeded`);
    if (phase.throughputPerSecond < thresholds.minimumThroughputPerSecond) {
      signals.push(`${name}_throughput_below_minimum`);
    }
  }
  return signals;
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
  if (populated.length > 0) {
    throw new Error("control-plane load database must be isolated and empty");
  }
}

async function measuredMap(values, concurrency, operation) {
  const startedAt = performance.now();
  const measurements = await mapWithConcurrency(values, concurrency, async (value, index) => {
    const operationStartedAt = performance.now();
    const result = await operation(value, index);
    return { durationMs: performance.now() - operationStartedAt, result };
  });
  return {
    durations: measurements.map((measurement) => measurement.durationMs),
    elapsedMs: performance.now() - startedAt,
    results: measurements.map((measurement) => measurement.result),
  };
}

function loadPrefix() {
  return `load-${randomUUID()}`;
}

function commitSha(prefix, repositoryIndex, runIndex) {
  return createHash("sha1").update(`${prefix}:${repositoryIndex}:${runIndex}`).digest("hex");
}

function webhookInput(prefix, index, installationExternalId) {
  const deliveryId = `${prefix}-delivery-${index}`;
  return {
    deliveryId,
    eventType: "installation",
    eventAction: "created",
    installationExternalId,
    payloadSha256: createHash("sha256").update(deliveryId).digest("hex"),
    actions: [
      {
        type: "installation.upsert",
        installation: {
          id: installationExternalId,
          accountLogin: `${prefix}-account`,
          accountType: "Organization",
        },
      },
    ],
  };
}

function releaseAction(repository, runIndex, prefix) {
  const pullRequestNumber = runIndex + 1;
  return {
    type: "release_run.enqueue",
    installation: { id: repository.githubInstallationId },
    repository: {
      id: repository.githubRepositoryId,
      owner: repository.owner,
      name: repository.name,
      fullName: `${repository.owner}/${repository.name}`,
      private: false,
      defaultBranch: "main",
    },
    pullRequestNumber,
    ref: `refs/pull/${pullRequestNumber}/head`,
    commitSha: commitSha(prefix, repository.index, runIndex),
    triggerKind: "pr",
  };
}

async function seedRepositories(executor, prefix, repositoryCount) {
  const repositories = Array.from({ length: repositoryCount }, (_, index) => ({
    index,
    installationId: randomUUID(),
    repositoryId: randomUUID(),
    githubInstallationId: 9_100_000_000 + index,
    githubRepositoryId: 9_200_000_000 + index,
    owner: `${prefix}-owner-${index}`,
    name: `repository-${index}`,
  }));

  for (const repository of repositories) {
    await executor.query(
      `insert into installations (id, github_installation_id, account_login, account_type)
       values ($1, $2, $3, 'Organization')`,
      [repository.installationId, repository.githubInstallationId, repository.owner],
    );
    await executor.query(
      `insert into repositories (
         id, installation_id, github_repo_id, owner, name, default_branch, private
       ) values ($1, $2, $3, $4, $5, 'main', false)`,
      [
        repository.repositoryId,
        repository.installationId,
        repository.githubRepositoryId,
        repository.owner,
        repository.name,
      ],
    );
  }
  return repositories;
}

async function processAcceptedJobs(store, prefix, concurrency) {
  const durations = [];
  let completedJobs = 0;
  const startedAt = performance.now();
  let batch = 0;
  while (true) {
    const workerId = `${prefix}-job-worker-${batch}`;
    const claimStartedAt = performance.now();
    const jobs = await store.claimJobs({ workerId, limit: 100 });
    durations.push(performance.now() - claimStartedAt);
    if (jobs.length === 0) break;
    const completed = await measuredMap(jobs, concurrency, (job) => store.completeJob({ jobId: job.jobId, workerId }));
    durations.push(...completed.durations);
    if (completed.results.some((outcome) => outcome !== "completed")) {
      throw new Error("control-plane lifecycle job completion did not converge");
    }
    completedJobs += jobs.length;
    batch += 1;
  }
  return { completedJobs, durations, elapsedMs: performance.now() - startedAt };
}

async function completeOutboxEffects(store, prefix, concurrency) {
  const durations = [];
  let completedEffects = 0;
  let githubCheckRunId = 9_300_000_000;
  const startedAt = performance.now();
  let batch = 0;
  while (true) {
    const workerId = `${prefix}-outbox-worker-${batch}`;
    const claimStartedAt = performance.now();
    const effects = await store.claimEffects({ workerId, limit: 100 });
    durations.push(performance.now() - claimStartedAt);
    if (effects.length === 0) break;
    const completed = await measuredMap(effects, concurrency, (effect) =>
      store.completeCheckRunCreateEffect({
        effect,
        workerId,
        githubCheckRunId: githubCheckRunId++,
        dispatchMode: "none",
      }),
    );
    durations.push(...completed.durations);
    if (completed.results.some((result) => result.outcome !== "completed")) {
      throw new Error("control-plane outbox publication did not converge");
    }
    completedEffects += effects.length;
    batch += 1;
  }
  return { completedEffects, durations, elapsedMs: performance.now() - startedAt };
}

async function exactState(executor, prefix, runIds) {
  const row = databaseRows(
    await executor.query(
      `select
         (select count(*)::int from webhook_inbox where delivery_id like $1) as accepted_deliveries,
         (select coalesce(sum(duplicate_count), 0)::int from webhook_inbox where delivery_id like $1)
           as duplicate_deliveries,
         (select count(*)::int
            from control_plane_jobs
           where inbox_id in (select id from webhook_inbox where delivery_id like $1)
             and status = 'completed') as completed_jobs,
         (select count(*)::int from release_runs where id = any($2::text[])) as release_runs,
         (select count(*)::int
            from control_plane_outbox
           where release_run_id = any($2::text[])
             and effect_type = 'github.check_run.create'
             and status = 'completed') as completed_outbox_effects`,
      [`${prefix}-delivery-%`, runIds],
    ),
  )[0];
  return {
    acceptedDeliveries: integerColumn(row, "accepted_deliveries"),
    duplicateDeliveries: integerColumn(row, "duplicate_deliveries"),
    completedJobs: integerColumn(row, "completed_jobs"),
    releaseRuns: integerColumn(row, "release_runs"),
    completedOutboxEffects: integerColumn(row, "completed_outbox_effects"),
  };
}

async function crossTenantMismatchCount(executor, runIds) {
  const row = databaseRows(
    await executor.query(
      `select count(*)::int as count
         from control_plane_outbox
         join release_runs on release_runs.id = control_plane_outbox.release_run_id
         join repositories on repositories.id = release_runs.repository_id
         join installations on installations.id = repositories.installation_id
        where release_runs.id = any($1::text[])
          and (
            (control_plane_outbox.payload #>> '{action,installation,id}')::bigint
              is distinct from installations.github_installation_id
            or (control_plane_outbox.payload #>> '{action,repository,id}')::bigint
              is distinct from repositories.github_repo_id
          )`,
      [runIds],
    ),
  )[0];
  return integerColumn(row, "count");
}

async function measureDashboardReads(executor, repositories, runIdsByRepository, concurrency, lookupDashboard) {
  const inputs = repositories.flatMap((repository, index) => {
    const runId = runIdsByRepository[index]?.[0];
    if (!runId) throw new Error("load scenario did not produce a dashboard run");
    const wrongRepository = repositories[(index + 1) % repositories.length];
    return [
      { expected: "found", repository, runId },
      { expected: "not-found", repository: wrongRepository, runId },
    ];
  });
  let crossTenantMismatches = 0;
  const measured = await measuredMap(inputs, concurrency, async (input) => {
    const result = await lookupDashboard(input.runId, executor, {
      scope: {
        installationId: input.repository.installationId,
        repositoryId: input.repository.repositoryId,
      },
    });
    if (result.state !== input.expected) crossTenantMismatches += 1;
    return result.state;
  });
  return {
    durations: measured.durations,
    elapsedMs: measured.elapsedMs,
    scopedDashboardReads: inputs.length,
    crossTenantMismatches,
  };
}

function assertExpectedState(actual, expected) {
  for (const [name, value] of Object.entries(expected)) {
    if (actual[name] !== value) throw new Error(`control-plane load invariant failed: ${name}`);
  }
}

async function cleanupScenario(executor, prefix) {
  await executor.query("delete from webhook_inbox where delivery_id like $1", [`${prefix}-delivery-%`]);
  await executor.query("delete from installations where account_login like $1", [`${prefix}-owner-%`]);
}

export async function runControlPlaneLoadValidation(configuration, dependencies) {
  const {
    createPgQueryExecutor,
    createSqlControlPlaneJobStore,
    createSqlControlPlaneOutboxStore,
    createSqlTransactionalGitHubAppLifecycleStore,
    lookupRunDashboard,
  } = dependencies;
  const executor = createPgQueryExecutor({
    connectionString: configuration.databaseUrl,
    max: Math.min(50, configuration.concurrency + 4),
  });
  const prefix = loadPrefix();
  try {
    await assertIsolatedDatabase(executor);
    const repositories = await seedRepositories(executor, prefix, configuration.repositoryCount);
    const jobStore = createSqlControlPlaneJobStore(executor);
    const webhookInputs = Array.from({ length: configuration.uniqueDeliveries }, (_, index) =>
      webhookInput(prefix, index, repositories[index % repositories.length].githubInstallationId),
    );
    const accepted = await measuredMap(webhookInputs, configuration.concurrency, (input) =>
      jobStore.acceptGitHubWebhook(input),
    );
    const duplicateInputs = webhookInputs.slice(0, configuration.duplicateDeliveries);
    const duplicates = await measuredMap(duplicateInputs, configuration.concurrency, (input) =>
      jobStore.acceptGitHubWebhook(input),
    );
    if (accepted.results.some((result) => result.outcome !== "accepted")) {
      throw new Error("unique webhook intake did not remain unique");
    }
    if (duplicates.results.some((result) => result.outcome !== "duplicate")) {
      throw new Error("webhook replay did not deduplicate");
    }

    const jobs = await processAcceptedJobs(jobStore, prefix, configuration.concurrency);
    const runInputs = repositories.flatMap((repository) =>
      Array.from({ length: configuration.runsPerRepository }, (_, runIndex) => ({ repository, runIndex })),
    );
    const enqueued = await measuredMap(runInputs, configuration.concurrency, ({ repository, runIndex }) => {
      const store = createSqlTransactionalGitHubAppLifecycleStore(executor, {
        releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
      });
      return store.enqueueReleaseRunWithOutbox(releaseAction(repository, runIndex, prefix));
    });
    const runIds = enqueued.results.map((result) => result.runId);
    if (runIds.some((runId) => !runId)) throw new Error("release-run load scenario did not persist every run");
    const persistedRunIds = runIds;

    const outboxStore = createSqlControlPlaneOutboxStore(executor);
    const outbox = await completeOutboxEffects(outboxStore, prefix, configuration.concurrency);
    const runIdsByRepository = repositories.map((repository) =>
      runInputs
        .map((input, index) => ({ input, runId: persistedRunIds[index] }))
        .filter(({ input }) => input.repository.repositoryId === repository.repositoryId)
        .map(({ runId }) => runId),
    );
    const dashboard = await measureDashboardReads(
      executor,
      repositories,
      runIdsByRepository,
      configuration.concurrency,
      lookupRunDashboard,
    );
    const state = await exactState(executor, prefix, persistedRunIds);
    const databaseMismatches = await crossTenantMismatchCount(executor, persistedRunIds);
    const expectedRuns = configuration.repositoryCount * configuration.runsPerRepository;
    assertExpectedState(state, {
      acceptedDeliveries: configuration.uniqueDeliveries,
      duplicateDeliveries: configuration.duplicateDeliveries,
      completedJobs: configuration.uniqueDeliveries,
      releaseRuns: expectedRuns,
      completedOutboxEffects: expectedRuns,
    });
    if (dashboard.crossTenantMismatches + databaseMismatches !== 0) {
      throw new Error("control-plane load tenant isolation invariant failed");
    }

    const report = {
      event: "control_plane_load_verified",
      scenario: {
        uniqueDeliveries: configuration.uniqueDeliveries,
        duplicateDeliveries: configuration.duplicateDeliveries,
        repositoryCount: configuration.repositoryCount,
        runsPerRepository: configuration.runsPerRepository,
        concurrency: configuration.concurrency,
      },
      intake: summarizeDurations(
        [...accepted.durations, ...duplicates.durations],
        accepted.elapsedMs + duplicates.elapsedMs,
      ),
      lifecycle: summarizeDurations(
        [...jobs.durations, ...enqueued.durations, ...outbox.durations],
        jobs.elapsedMs + enqueued.elapsedMs + outbox.elapsedMs,
      ),
      dashboard: summarizeDurations(dashboard.durations, dashboard.elapsedMs),
      invariants: {
        ...state,
        scopedDashboardReads: dashboard.scopedDashboardReads,
        crossTenantMismatches: dashboard.crossTenantMismatches + databaseMismatches,
      },
    };
    return {
      ...report,
      signals: evaluateControlPlaneLoadReport(report, configuration.thresholds),
    };
  } finally {
    try {
      await cleanupScenario(executor, prefix);
    } finally {
      await executor.close();
    }
  }
}

async function main() {
  parseControlPlaneLoadConfiguration(process.env);
  const vitestCli = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [vitestCli, "run", "tests/integration/control-plane-load.test.ts", "--no-file-parallelism"],
    {
      env: {
        ...process.env,
        BOARDREADYOPS_CONTROL_PLANE_LOAD_TESTS: "true",
        BOARDREADYOPS_POSTGRES_TESTS: "true",
      },
      stdio: "inherit",
    },
  );
  if (result.error) throw new Error(`control-plane load validation could not start (${result.error.name})`);
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "control-plane load validation failed"}\n`);
    process.exitCode = 1;
  }
}
