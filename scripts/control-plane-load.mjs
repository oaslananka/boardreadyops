import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

export const CONTROL_PLANE_LOAD_CONFIRMATION = "isolated-disposable-database";

const defaultThresholds = Object.freeze({
  intakeP95Ms: 1_000,
  lifecycleP95Ms: 1_500,
  dashboardP95Ms: 1_000,
  minimumThroughputPerSecond: 10,
  recoveryMaxConvergenceMs: 5_000,
});

const isolatedTables = Object.freeze([
  "installations",
  "repositories",
  "managed_runner_identities",
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
  const profile = environment.BOARDREADYOPS_LOAD_PROFILE?.trim() || "representative";
  if (
    profile !== "representative" &&
    profile !== "soak-recovery" &&
    profile !== "database-interruption" &&
    profile !== "worker-process-interruption" &&
    profile !== "worker-fleet-interruption" &&
    profile !== "github-api-interruption"
  ) {
    throw new Error(
      "BOARDREADYOPS_LOAD_PROFILE must be representative, soak-recovery, database-interruption, worker-process-interruption, worker-fleet-interruption, or github-api-interruption",
    );
  }

  const uniqueDeliveries = boundedInteger(environment, "BOARDREADYOPS_LOAD_UNIQUE_DELIVERIES", 200, 10, 5_000);
  const duplicateDeliveries = boundedInteger(environment, "BOARDREADYOPS_LOAD_DUPLICATE_DELIVERIES", 50, 0, 5_000);
  if (duplicateDeliveries > uniqueDeliveries) {
    throw new Error("duplicate deliveries cannot exceed unique deliveries");
  }

  return {
    databaseUrl,
    profile,
    recoveryRounds: boundedInteger(environment, "BOARDREADYOPS_LOAD_RECOVERY_ROUNDS", 3, 1, 20),
    workerFleetSize: boundedInteger(environment, "BOARDREADYOPS_LOAD_WORKER_FLEET_SIZE", 3, 2, 20),
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
      recoveryMaxConvergenceMs: boundedInteger(
        environment,
        "BOARDREADYOPS_LOAD_RECOVERY_MAX_CONVERGENCE_MS",
        5_000,
        100,
        60_000,
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

  if (report.scenario.profile !== "representative") {
    signals.push(...evaluateRecoveryEvidence(report, thresholds));
  }
  if (report.scenario.profile === "database-interruption") {
    signals.push(...evaluateDatabaseRecoveryEvidence(report, thresholds));
  }
  if (report.scenario.profile === "worker-process-interruption") {
    signals.push(...evaluateWorkerProcessRecoveryEvidence(report, thresholds));
  }
  if (report.scenario.profile === "worker-fleet-interruption") {
    signals.push(...evaluateWorkerFleetRecoveryEvidence(report, thresholds));
  }
  if (report.scenario.profile === "github-api-interruption") {
    signals.push(...evaluateGitHubApiRecoveryEvidence(report, thresholds));
  }
  return signals;
}

function evaluateRecoveryEvidence(report, thresholds) {
  const recovery = report.recovery;
  const rounds = report.scenario.recoveryRounds;
  const checks = [
    ["recovery_rounds_incomplete", recovery?.roundsCompleted >= rounds],
    ["recovery_job_lease_incomplete", recovery?.jobLeaseRecoveries >= rounds],
    ["recovery_stale_job_rejection_incomplete", recovery?.staleJobCompletionsRejected >= rounds],
    ["recovery_outbox_retry_incomplete", recovery?.outboxRetries >= rounds],
    ["recovery_uncertain_outbox_quarantine_incomplete", recovery?.uncertainOutboxQuarantines >= rounds],
    ["recovery_delayed_callback_incomplete", recovery?.delayedCallbackRepairs >= rounds],
    ["recovery_stale_attempt_rejection_incomplete", recovery?.staleAttemptResultsRejected >= rounds],
    ["recovery_convergence_exceeded", recovery?.maximumConvergenceMs <= thresholds.recoveryMaxConvergenceMs],
    ["recovery_dead_letters_detected", recovery?.deadLetters === 0],
    ["recovery_ambiguous_state_detected", recovery?.ambiguousNonterminalStates === 0],
  ];
  return checks.filter(([, passed]) => !passed).map(([signal]) => signal);
}

function evaluateDatabaseRecoveryEvidence(report, thresholds) {
  const recovery = report.databaseRecovery;
  const rounds = report.scenario.recoveryRounds;
  const checks = [
    ["database_recovery_rounds_incomplete", recovery?.roundsCompleted >= rounds],
    ["database_backend_termination_incomplete", recovery?.backendTerminations >= rounds],
    ["database_interrupted_transaction_rejection_incomplete", recovery?.interruptedTransactionsRejected >= rounds],
    ["database_transaction_rollback_incomplete", recovery?.transactionRollbacksVerified >= rounds],
    ["database_replacement_connection_incomplete", recovery?.replacementConnectionsEstablished >= rounds],
    ["database_recovery_convergence_exceeded", recovery?.maximumConvergenceMs <= thresholds.recoveryMaxConvergenceMs],
  ];
  return checks.filter(([, passed]) => !passed).map(([signal]) => signal);
}

function evaluateWorkerProcessRecoveryEvidence(report, thresholds) {
  const recovery = report.workerProcessRecovery;
  const rounds = report.scenario.recoveryRounds;
  const checks = [
    ["worker_process_recovery_rounds_incomplete", recovery?.roundsCompleted >= rounds],
    ["worker_process_start_incomplete", recovery?.childProcessesStarted >= rounds],
    ["worker_process_kill_incomplete", recovery?.childProcessesKilled >= rounds],
    ["worker_process_lease_reclaim_incomplete", recovery?.abandonedLeasesReclaimed >= rounds],
    ["worker_process_completion_incomplete", recovery?.replacementCompletions >= rounds],
    [
      "worker_process_recovery_convergence_exceeded",
      recovery?.maximumConvergenceMs <= thresholds.recoveryMaxConvergenceMs,
    ],
  ];
  return checks.filter(([, passed]) => !passed).map(([signal]) => signal);
}

function evaluateWorkerFleetRecoveryEvidence(report, thresholds) {
  const recovery = report.workerFleetRecovery;
  const rounds = report.scenario.recoveryRounds;
  const fleetSize = report.scenario.workerFleetSize;
  const expectedActions = rounds * fleetSize;
  const checks = [
    ["worker_fleet_recovery_rounds_incomplete", recovery?.roundsCompleted >= rounds],
    ["worker_fleet_start_incomplete", recovery?.childProcessesStarted >= expectedActions],
    ["worker_fleet_kill_incomplete", recovery?.childProcessesKilled >= expectedActions],
    ["worker_fleet_lease_reclaim_incomplete", recovery?.abandonedLeasesReclaimed >= expectedActions],
    ["worker_fleet_completion_incomplete", recovery?.replacementCompletions >= expectedActions],
    [
      "worker_fleet_recovery_convergence_exceeded",
      recovery?.maximumConvergenceMs <= thresholds.recoveryMaxConvergenceMs,
    ],
  ];
  return checks.filter(([, passed]) => !passed).map(([signal]) => signal);
}

function evaluateGitHubApiRecoveryEvidence(report, thresholds) {
  const recovery = report.githubApiRecovery;
  const rounds = report.scenario.recoveryRounds;
  const checks = [
    ["github_api_recovery_rounds_incomplete", recovery?.roundsCompleted >= rounds],
    ["github_api_service_unavailable_incomplete", recovery?.serviceUnavailableResponses >= rounds],
    ["github_api_rate_limit_incomplete", recovery?.rateLimitResponses >= rounds],
    ["github_api_retries_incomplete", recovery?.retriesScheduled >= rounds * 2],
    ["github_api_convergence_incomplete", recovery?.successfulConvergences >= rounds],
    ["github_api_requests_incomplete", recovery?.requestsObserved >= rounds * 3],
    ["github_api_recovery_convergence_exceeded", recovery?.maximumConvergenceMs <= thresholds.recoveryMaxConvergenceMs],
  ];
  return checks.filter(([, passed]) => !passed).map(([signal]) => signal);
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

export function syntheticCommitSha(prefix, repositoryIndex, runIndex) {
  return createHash("sha256").update(`${prefix}:${repositoryIndex}:${runIndex}`).digest("hex").slice(0, 40);
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
    commitSha: syntheticCommitSha(prefix, repository.index, runIndex),
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

function offsetDate(value, milliseconds) {
  return new Date(value.valueOf() + milliseconds);
}

function requestTimestamp(value) {
  return Math.floor(value.valueOf() / 1_000);
}

function syntheticSecret(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function requiredRecoveryDependency(dependencies, name) {
  const dependency = dependencies[name];
  if (typeof dependency !== "function") throw new Error(`soak-recovery dependency is required: ${name}`);
  return dependency;
}

async function validateJobLeaseRecovery(input) {
  let now = input.baseTime;
  const store = input.createSqlControlPlaneJobStore(input.executor, {
    now: () => now,
    leaseSeconds: 1,
    maximumAttempts: 4,
    retryBaseSeconds: 1,
  });
  const webhook = webhookInput(`${input.prefix}-recovery-job-${input.round}`, 0, input.repository.githubInstallationId);
  const accepted = await store.acceptGitHubWebhook(webhook);
  if (accepted.outcome !== "accepted") throw new Error("recovery job intake was not accepted");

  const abandonedWorker = `${input.prefix}-job-abandoned-${input.round}`;
  const abandoned = (await store.claimJobs({ workerId: abandonedWorker, limit: 1 }))[0];
  if (abandoned?.attemptCount !== 1) throw new Error("recovery job lease was not claimed");

  now = offsetDate(now, 2_000);
  const recoveryWorker = `${input.prefix}-job-recovery-${input.round}`;
  const recovered = (await store.claimJobs({ workerId: recoveryWorker, limit: 1 }))[0];
  if (!recovered || recovered.jobId !== abandoned.jobId || recovered.attemptCount !== 2) {
    throw new Error("expired recovery job lease was not reclaimed");
  }
  const staleCompletion = await store.completeJob({ jobId: abandoned.jobId, workerId: abandonedWorker });
  if (staleCompletion !== "stale") throw new Error("abandoned job completion was not rejected as stale");
  const completion = await store.completeJob({ jobId: recovered.jobId, workerId: recoveryWorker });
  if (completion !== "completed") throw new Error("reclaimed recovery job did not complete");
  return { jobLeaseRecoveries: 1, staleJobCompletionsRejected: 1 };
}

async function enqueueRecoveryReleaseRun(input, label, runIndex) {
  const lifecycle = input.createSqlTransactionalGitHubAppLifecycleStore(input.executor, {
    releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
  });
  const result = await lifecycle.enqueueReleaseRunWithOutbox(
    releaseAction(input.repository, runIndex, `${input.prefix}-recovery-${label}-${input.round}`),
  );
  if (!result.runId) throw new Error(`recovery ${label} run was not enqueued`);
  return result.runId;
}

async function validateOutboxRecovery(input) {
  let now = offsetDate(input.baseTime, 5_000);
  const retryRunId = await enqueueRecoveryReleaseRun(input, "retry", 10_000 + input.round * 10);
  const retryStore = input.createSqlControlPlaneOutboxStore(input.executor, {
    now: () => now,
    leaseSeconds: 1,
    retryBaseSeconds: 1,
  });
  const retryWorker = `${input.prefix}-outbox-retry-${input.round}`;
  const first = (await retryStore.claimEffects({ workerId: retryWorker, limit: 1 }))[0];
  if (!first || first.releaseRunId !== retryRunId) throw new Error("recovery retry effect was not claimed");
  const retryOutcome = await retryStore.failEffect({
    outboxId: first.outboxId,
    workerId: retryWorker,
    attemptCount: first.attemptCount,
    errorClass: "SyntheticTransientFailure",
    errorMessage: "Synthetic transient delivery failure.",
  });
  if (retryOutcome !== "retry") throw new Error("transient recovery effect was not scheduled for retry");

  now = offsetDate(now, 2_000);
  const retryRecoveryWorker = `${input.prefix}-outbox-retry-recovery-${input.round}`;
  const retried = (await retryStore.claimEffects({ workerId: retryRecoveryWorker, limit: 1 }))[0];
  if (!retried || retried.outboxId !== first.outboxId || retried.attemptCount !== 2) {
    throw new Error("transient recovery effect was not reclaimed");
  }
  const retryCompletion = await retryStore.completeCheckRunCreateEffect({
    effect: retried,
    workerId: retryRecoveryWorker,
    githubCheckRunId: 9_400_000_000 + input.round,
    dispatchMode: "none",
  });
  if (retryCompletion.outcome !== "completed") throw new Error("retried recovery effect did not complete");

  const uncertainRunId = await enqueueRecoveryReleaseRun(input, "uncertain", 20_000 + input.round * 10);
  const uncertainCreateWorker = `${input.prefix}-outbox-create-${input.round}`;
  const createEffect = (await retryStore.claimEffects({ workerId: uncertainCreateWorker, limit: 1 }))[0];
  if (!createEffect || createEffect.releaseRunId !== uncertainRunId) {
    throw new Error("uncertain-delivery creation effect was not claimed");
  }
  const dispatchOutboxId = randomUUID();
  const executionAttemptId = randomUUID();
  const createCompletion = await retryStore.completeCheckRunCreateEffect({
    effect: createEffect,
    workerId: uncertainCreateWorker,
    githubCheckRunId: 9_500_000_000 + input.round,
    dispatchMode: "github-actions",
    executionAttemptId,
    nextOutboxId: dispatchOutboxId,
  });
  if (createCompletion.outcome !== "completed" || createCompletion.nextOutboxId !== dispatchOutboxId) {
    throw new Error("uncertain-delivery dispatch effect was not created");
  }

  const dispatchWorker = `${input.prefix}-outbox-dispatch-${input.round}`;
  const dispatchEffect = (await retryStore.claimEffects({ workerId: dispatchWorker, limit: 1 }))[0];
  if (
    !dispatchEffect ||
    dispatchEffect.outboxId !== dispatchOutboxId ||
    dispatchEffect.effectType !== "github.workflow.dispatch"
  ) {
    throw new Error("uncertain workflow dispatch effect was not claimed");
  }
  if ((await retryStore.markDeliveryStarted({ outboxId: dispatchOutboxId, workerId: dispatchWorker })) !== "started") {
    throw new Error("uncertain workflow dispatch did not record delivery start");
  }
  const quarantine = await retryStore.failEffect({
    outboxId: dispatchOutboxId,
    workerId: dispatchWorker,
    attemptCount: dispatchEffect.attemptCount,
    errorClass: "SyntheticTransportInterruption",
    errorMessage: "Synthetic transport interruption after dispatch began.",
    deliveryUncertain: true,
  });
  if (quarantine !== "reconciliation_required") {
    throw new Error("uncertain workflow dispatch was not quarantined for reconciliation");
  }
  const quarantineState = databaseRows(
    await input.executor.query(
      "select status, completed_at is not null as terminal from control_plane_outbox where id = $1",
      [dispatchOutboxId],
    ),
  )[0];
  if (quarantineState?.status !== "reconciliation_required" || quarantineState?.terminal !== true) {
    throw new Error("uncertain workflow dispatch quarantine state was ambiguous");
  }
  return { outboxRetries: 1, uncertainOutboxQuarantines: 1 };
}

function listenOnLoopback(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("GitHub API fault server did not expose a TCP address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function closeLoopbackServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function withGitHubApiFaultServer(operation) {
  const evidence = {
    serviceUnavailableResponses: 0,
    rateLimitResponses: 0,
    requestsObserved: 0,
  };
  const server = createServer((request, response) => {
    evidence.requestsObserved += 1;
    response.setHeader("content-type", "application/json");
    if (request.method !== "GET" || !request.url?.includes("/actions/runs/")) {
      response.statusCode = 400;
      response.end(JSON.stringify({ message: "unsupported synthetic request" }));
      return;
    }
    if (evidence.requestsObserved === 1) {
      evidence.serviceUnavailableResponses += 1;
      response.statusCode = 503;
      response.end(JSON.stringify({ message: "token=do-not-report private repository unavailable" }));
      return;
    }
    if (evidence.requestsObserved === 2) {
      evidence.rateLimitResponses += 1;
      response.statusCode = 429;
      response.setHeader("retry-after", "1");
      response.end(JSON.stringify({ message: "private rate-limit detail must not be persisted" }));
      return;
    }
    if (evidence.requestsObserved === 3) {
      response.statusCode = 200;
      response.end(
        JSON.stringify({
          status: "completed",
          conclusion: "success",
          html_url: "https://github.invalid/private/run",
          head_commit: { message: "private commit message" },
        }),
      );
      return;
    }
    response.statusCode = 500;
    response.end(JSON.stringify({ message: "unexpected synthetic request count" }));
  });
  const apiBaseUrl = await listenOnLoopback(server);
  try {
    const result = await operation(apiBaseUrl);
    if (evidence.requestsObserved !== 3) {
      throw new Error("GitHub API fault server observed an unexpected request count");
    }
    return { ...result, ...evidence };
  } finally {
    await closeLoopbackServer(server);
  }
}

async function seedWorkflowReconciliationSubject(input, label, commitOffset, workflowRunId) {
  const releaseRunId = randomUUID();
  const executionAttemptId = randomUUID();
  const staleAt = offsetDate(input.baseTime, -10 * 60_000);
  await input.executor.query(
    `insert into release_runs (
       id, repository_id, idempotency_key, commit_sha, ref, trigger_kind,
       status, started_at, execution_attempt_id, execution_attempt_started_at
     ) values ($1, $2, $3, $4, 'refs/heads/main', 'push',
       'dispatched', $5::timestamptz, $6, $5::timestamptz)`,
    [
      releaseRunId,
      input.repository.repositoryId,
      `${input.prefix}:recovery-${label}:${input.round}`,
      syntheticCommitSha(input.prefix, input.repository.index, commitOffset + input.round),
      staleAt.toISOString(),
      executionAttemptId,
    ],
  );
  await input.executor.query(
    `insert into release_run_attempts (
       id, run_id, attempt_number, status, created_at,
       dispatch_requested_at, dispatched_at, github_workflow_dispatch_id
     ) values ($1, $2, 1, 'dispatched', $3::timestamptz,
       $3::timestamptz, $3::timestamptz, $4)`,
    [executionAttemptId, releaseRunId, staleAt.toISOString(), String(workflowRunId)],
  );
  return { releaseRunId, executionAttemptId };
}

async function assertWorkflowReconciliationConverged(input, releaseRunId) {
  const state = databaseRows(
    await input.executor.query(
      `select rr.status as run_status, rra.status as attempt_status,
              cpri.status as reconciliation_status, cpri.repaired
         from release_runs rr
         join release_run_attempts rra on rra.id = rr.execution_attempt_id
         join control_plane_reconciliation_items cpri on cpri.release_run_id = rr.id
        where rr.id = $1`,
      [releaseRunId],
    ),
  )[0];
  if (
    state?.run_status !== "failed" ||
    state?.attempt_status !== "failed" ||
    state?.reconciliation_status !== "completed" ||
    state?.repaired !== true
  ) {
    throw new Error("workflow reconciliation left ambiguous state");
  }
}

async function validateGitHubApiRecoveryRound(input) {
  const { releaseRunId } = await seedWorkflowReconciliationSubject(
    input,
    "github-api",
    50_000,
    9_700_000_000 + input.round,
  );
  const readGitHubWorkflowRun = requiredRecoveryDependency(input, "readGitHubWorkflowRun");
  return withGitHubApiFaultServer(async (apiBaseUrl) => {
    let now = input.baseTime;
    const github = {
      readWorkflowRun(scope) {
        return readGitHubWorkflowRun({
          apiBaseUrl,
          token: syntheticSecret(`${input.prefix}:github-api:${input.round}`),
          repositoryOwner: scope.repositoryOwner,
          repositoryName: scope.repositoryName,
          workflowRunId: scope.workflowRunId,
        });
      },
    };
    const createOperations = () =>
      input.createSqlControlPlaneOperationsStore(input.executor, {
        now: () => now,
        leaseSeconds: 60,
        retryBaseSeconds: 1,
      });
    let operations = createOperations();
    const detected = await operations.detectWorkflowReconciliationCandidates({
      observationDelaySeconds: 300,
      terminalDeadlineSeconds: 1_800,
      limit: 10,
    });
    if (detected !== 1) throw new Error("GitHub API recovery candidate was not detected");

    const processAttempt = async (workerId, expectedAttemptCount) => {
      operations = createOperations();
      const item = (await operations.claimWorkflowReconciliationItems({ workerId, limit: 1 }))[0];
      if (!item || item.releaseRunId !== releaseRunId || item.attemptCount !== expectedAttemptCount) {
        throw new Error("GitHub API recovery item was not claimed at the expected attempt");
      }
      return input.processControlPlaneWorkflowReconciliation(item, {
        workerId,
        operations,
        github,
        now: () => now,
        nextCheckSeconds: 1,
      });
    };

    const first = await processAttempt(`${input.prefix}-github-api-503-${input.round}`, 1);
    if (first.status !== "retry" || first.outcomeCode !== "github_lookup_failed") {
      throw new Error("GitHub API 503 did not enter bounded retry");
    }
    now = offsetDate(input.baseTime, 2_000);
    const second = await processAttempt(`${input.prefix}-github-api-429-${input.round}`, 2);
    if (second.status !== "retry" || second.outcomeCode !== "github_lookup_failed") {
      throw new Error("GitHub API 429 did not enter bounded retry");
    }
    now = offsetDate(input.baseTime, 1_300_000);
    const final = await processAttempt(`${input.prefix}-github-api-success-${input.round}`, 3);
    if (final.status !== "applied" || final.outcomeCode !== "github_result_callback_missing") {
      throw new Error("GitHub API recovery did not converge after transient failures");
    }
    await assertWorkflowReconciliationConverged(input, releaseRunId);
    return { retriesScheduled: 2, successfulConvergences: 1 };
  });
}

async function runGitHubApiInterruptionValidation(configuration, input) {
  const githubApiRecovery = {
    roundsRequested: configuration.recoveryRounds,
    roundsCompleted: 0,
    serviceUnavailableResponses: 0,
    rateLimitResponses: 0,
    retriesScheduled: 0,
    successfulConvergences: 0,
    requestsObserved: 0,
    maximumConvergenceMs: 0,
  };
  for (let round = 0; round < configuration.recoveryRounds; round += 1) {
    const startedAt = performance.now();
    const evidence = await validateGitHubApiRecoveryRound({
      ...input,
      round,
      baseTime: new Date(Date.now() + 30_000 + round * 10_000),
      repository: input.repositories[round % input.repositories.length],
      createSqlControlPlaneOperationsStore: requiredRecoveryDependency(
        input.dependencies,
        "createSqlControlPlaneOperationsStore",
      ),
      processControlPlaneWorkflowReconciliation: requiredRecoveryDependency(
        input.dependencies,
        "processControlPlaneWorkflowReconciliation",
      ),
      readGitHubWorkflowRun: requiredRecoveryDependency(input.dependencies, "readGitHubWorkflowRun"),
    });
    githubApiRecovery.roundsCompleted += 1;
    githubApiRecovery.serviceUnavailableResponses += evidence.serviceUnavailableResponses;
    githubApiRecovery.rateLimitResponses += evidence.rateLimitResponses;
    githubApiRecovery.retriesScheduled += evidence.retriesScheduled;
    githubApiRecovery.successfulConvergences += evidence.successfulConvergences;
    githubApiRecovery.requestsObserved += evidence.requestsObserved;
    githubApiRecovery.maximumConvergenceMs = Math.max(
      githubApiRecovery.maximumConvergenceMs,
      rounded(performance.now() - startedAt),
    );
  }
  return githubApiRecovery;
}

async function validateDelayedCallbackRecovery(input) {
  const { releaseRunId } = await seedWorkflowReconciliationSubject(
    input,
    "callback",
    30_000,
    9_600_000_000 + input.round,
  );

  const workerId = `${input.prefix}-callback-${input.round}`;
  let now = input.baseTime;
  let operations = input.createSqlControlPlaneOperationsStore(input.executor, { now: () => now, leaseSeconds: 60 });
  const detected = await operations.detectWorkflowReconciliationCandidates({
    observationDelaySeconds: 300,
    terminalDeadlineSeconds: 1_800,
    limit: 10,
  });
  if (detected !== 1) throw new Error("delayed callback reconciliation candidate was not detected");
  const first = (await operations.claimWorkflowReconciliationItems({ workerId, limit: 1 }))[0];
  if (!first || first.releaseRunId !== releaseRunId) throw new Error("delayed callback item was not claimed");
  const pending = await input.processControlPlaneWorkflowReconciliation(first, {
    workerId,
    operations,
    github: {
      async readWorkflowRun() {
        return { kind: "pending", status: "in_progress" };
      },
    },
    now: () => now,
    nextCheckSeconds: 1,
  });
  if (pending.status !== "rescheduled") throw new Error("delayed callback item was not rescheduled");

  now = offsetDate(input.baseTime, 1_300_000);
  const terminalWorker = `${input.prefix}-callback-terminal-${input.round}`;
  operations = input.createSqlControlPlaneOperationsStore(input.executor, { now: () => now, leaseSeconds: 60 });
  const second = (await operations.claimWorkflowReconciliationItems({ workerId: terminalWorker, limit: 1 }))[0];
  if (!second || second.reconciliationId !== first.reconciliationId) {
    throw new Error("delayed callback item was not reclaimed after reschedule");
  }
  const repaired = await input.processControlPlaneWorkflowReconciliation(second, {
    workerId: terminalWorker,
    operations,
    github: {
      async readWorkflowRun() {
        return { kind: "completed", conclusion: "success" };
      },
    },
    now: () => now,
  });
  if (repaired.status !== "applied" || repaired.outcomeCode !== "github_result_callback_missing") {
    throw new Error("delayed callback reconciliation did not converge");
  }
  await assertWorkflowReconciliationConverged(input, releaseRunId);
  return { delayedCallbackRepairs: 1 };
}

async function validateStaleAttemptRejection(input) {
  const managedRunnerIdentityId = randomUUID();
  const releaseRunId = randomUUID();
  const startedAt = offsetDate(input.baseTime, -86_400_000 - input.round * 1_000);
  const identityName = `${input.prefix}-managed-${input.round}`;
  await input.executor.query(
    `insert into managed_runner_identities (
       id, name, public_key, public_key_fingerprint, capabilities, status,
       created_at, activated_at, last_heartbeat_at
     ) values ($1, $2, $3, $4, $5::jsonb, 'active',
       $6::timestamptz, $6::timestamptz, $6::timestamptz)`,
    [
      managedRunnerIdentityId,
      identityName,
      "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA4444444444444444444444444444444444444444444=\n-----END PUBLIC KEY-----",
      createHash("sha256").update(managedRunnerIdentityId).digest("hex"),
      JSON.stringify(["kicad:10"]),
      startedAt.toISOString(),
    ],
  );
  await input.executor.query(
    `insert into release_runs (
       id, repository_id, idempotency_key, commit_sha, ref, trigger_kind, status, started_at
     ) values ($1, $2, $3, $4, 'refs/heads/main', 'push', 'queued', $5::timestamptz)`,
    [
      releaseRunId,
      input.repository.repositoryId,
      `${input.prefix}:recovery-stale-attempt:${input.round}`,
      syntheticCommitSha(input.prefix, input.repository.index, 40_000 + input.round),
      startedAt.toISOString(),
    ],
  );

  const attemptId = randomUUID();
  const leaseId = randomUUID();
  const leaseToken = syntheticSecret(`${input.prefix}:lease:${input.round}`);
  const claimAt = input.baseTime;
  const ids = [attemptId, leaseId];
  const leaseStore = input.createSqlRunnerLeaseStore(input.executor, {
    now: () => claimAt,
    id: () => ids.shift() ?? randomUUID(),
    leaseToken: () => leaseToken,
    leaseDurationSeconds: 120,
    maximumLeaseDurationSeconds: 600,
  });
  const claimed = await leaseStore.claimJob({
    workerClass: "managed",
    managedRunnerIdentityId,
    requestTimestamp: requestTimestamp(claimAt),
    requestNonce: syntheticSecret(`${input.prefix}:claim:${input.round}`),
    capabilities: ["kicad:10"],
  });
  if (claimed.status !== "claimed" || claimed.runId !== releaseRunId) {
    throw new Error("stale-attempt recovery fixture was not claimed");
  }

  const replacementAttemptId = randomUUID();
  const movedAt = offsetDate(claimAt, 1_000);
  await input.executor.query(
    `insert into release_run_attempts (
       id, run_id, attempt_number, status, created_at, started_at, heartbeat_at
     ) values ($1, $2, 2, 'in_progress', $3::timestamptz, $3::timestamptz, $3::timestamptz)`,
    [replacementAttemptId, releaseRunId, movedAt.toISOString()],
  );
  await input.executor.query(
    `update release_runs
        set execution_attempt_id = $1, execution_attempt_started_at = $2::timestamptz, status = 'running'
      where id = $3`,
    [replacementAttemptId, movedAt.toISOString(), releaseRunId],
  );

  const authorization = await input
    .createSqlRunnerTerminalResultAuthorizer(input.executor, {
      now: () => offsetDate(claimAt, 2_000),
    })
    .authorize({
      workerClass: "managed",
      managedRunnerIdentityId,
      requestTimestamp: requestTimestamp(offsetDate(claimAt, 2_000)),
      requestNonce: syntheticSecret(`${input.prefix}:result:${input.round}`),
      runId: releaseRunId,
      executionAttemptId: claimed.executionAttemptId,
      leaseId: claimed.leaseId,
      leaseToken: claimed.leaseToken,
      requestBody: JSON.stringify({ protocolVersion: 1, result: { status: "completed", decision: "pass" } }),
    });
  if (authorization.status !== "stale") throw new Error("stale attempt terminal result was not rejected");
  return { staleAttemptResultsRejected: 1 };
}

function incrementRecoveryEvidence(recovery, evidence) {
  for (const [name, value] of Object.entries(evidence)) recovery[name] += value;
}

const workerProcessFixtureSource = `
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(name + " is required");
  return value;
}

const root = required("BOARDREADYOPS_WORKER_FIXTURE_ROOT");
const [{ createPgQueryExecutor }, { createSqlControlPlaneJobStore }] = await Promise.all([
  import(pathToFileURL(resolve(root, "packages/db/src/pg-executor.ts")).href),
  import(pathToFileURL(resolve(root, "packages/db/src/control-plane-job-store.ts")).href),
]);
const executor = createPgQueryExecutor({ connectionString: required("DATABASE_URL"), max: 1 });
try {
  const store = createSqlControlPlaneJobStore(executor, {
    now: () => new Date(required("BOARDREADYOPS_WORKER_FIXTURE_CLAIM_AT")),
    leaseSeconds: 1,
    maximumAttempts: 4,
    retryBaseSeconds: 1,
  });
  const claimed = (await store.claimJobs({
    workerId: required("BOARDREADYOPS_WORKER_FIXTURE_ID"),
    limit: 1,
  }))[0];
  if (!claimed) throw new Error("worker fixture did not claim a job");
  process.stdout.write(JSON.stringify({
    event: "claimed",
    jobId: claimed.jobId,
    attemptCount: claimed.attemptCount,
  }) + "\\n");
  await new Promise(() => {});
} finally {
  await executor.close();
}
`;

function waitForWorkerClaim(child, expectedJobId, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const stdout = child.stdout;
    if (!stdout) {
      reject(new Error("worker process fixture stdout was unavailable"));
      return;
    }
    let settled = false;
    let buffer = "";
    const cleanup = () => {
      clearTimeout(timer);
      stdout.removeListener("data", onData);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
    };
    const fail = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const succeed = (claim) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(claim);
    };
    const onData = (chunk) => {
      buffer += String(chunk);
      if (buffer.length > 4_096) {
        fail("worker process fixture emitted an oversized claim response");
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      let claim;
      try {
        claim = JSON.parse(buffer.slice(0, newline));
      } catch {
        fail("worker process fixture emitted an invalid claim response");
        return;
      }
      if (claim?.event !== "claimed" || claim.jobId !== expectedJobId || claim.attemptCount !== 1) {
        fail("worker process fixture claimed an unexpected job");
        return;
      }
      succeed(claim);
    };
    const onError = () => fail("worker process fixture could not start");
    const onExit = () => fail("worker process fixture exited before claiming a job");
    const timer = setTimeout(() => fail("worker process fixture claim timed out"), timeoutMs);
    stdout.setEncoding("utf8");
    stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function waitForWorkerExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      reject(new Error("worker process fixture termination timed out"));
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    child.once("exit", onExit);
  });
}

async function terminateWorkerProcess(child) {
  const exited = waitForWorkerExit(child);
  if (!child.kill("SIGKILL")) throw new Error("worker process fixture could not be terminated");
  const result = await exited;
  if (result.code !== null || result.signal !== "SIGKILL") {
    throw new Error("worker process fixture did not terminate with SIGKILL");
  }
}

async function cleanupWorkerProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForWorkerExit(child).catch(() => undefined);
  child.kill("SIGKILL");
  await exited;
}

function createWorkerInterruptionRecovery(roundsRequested) {
  return {
    roundsRequested,
    roundsCompleted: 0,
    childProcessesStarted: 0,
    childProcessesKilled: 0,
    abandonedLeasesReclaimed: 0,
    replacementCompletions: 0,
    maximumConvergenceMs: 0,
  };
}

function createWorkerInterruptionStore(input, now) {
  return input.dependencies.createSqlControlPlaneJobStore(input.executor, {
    now,
    leaseSeconds: 1,
    maximumAttempts: 4,
    retryBaseSeconds: 1,
  });
}

function spawnWorkerFixture(configuration, repositoryRoot, baseTime, workerId) {
  return spawn(process.execPath, ["--input-type=module", "--eval", workerProcessFixtureSource], {
    cwd: repositoryRoot,
    env: {
      DATABASE_URL: configuration.databaseUrl,
      BOARDREADYOPS_WORKER_FIXTURE_ROOT: repositoryRoot,
      BOARDREADYOPS_WORKER_FIXTURE_CLAIM_AT: baseTime.toISOString(),
      BOARDREADYOPS_WORKER_FIXTURE_ID: workerId,
    },
    stdio: ["ignore", "pipe", "ignore"],
  });
}

async function runWorkerProcessInterruptionValidation(configuration, input) {
  const workerProcessRecovery = createWorkerInterruptionRecovery(configuration.recoveryRounds);
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

  for (let round = 0; round < configuration.recoveryRounds; round += 1) {
    const startedAt = performance.now();
    const baseTime = new Date(Date.now() + 60_000 + round * 10_000);
    let now = baseTime;
    const store = createWorkerInterruptionStore(input, () => now);
    const deliveryId = `${input.prefix}-worker-process-${round}`;
    const accepted = await store.acceptGitHubWebhook({
      deliveryId,
      eventType: "installation",
      eventAction: "created",
      installationExternalId: input.repositories[round % input.repositories.length].githubInstallationId,
      payloadSha256: createHash("sha256").update(deliveryId).digest("hex"),
      actions: [
        {
          type: "installation.upsert",
          installation: {
            id: input.repositories[round % input.repositories.length].githubInstallationId,
            accountLogin: `${input.prefix}-worker-process-account`,
            accountType: "Organization",
          },
        },
      ],
      receivedAt: baseTime,
    });
    if (accepted.outcome !== "accepted" || !accepted.jobId) {
      throw new Error("worker process interruption fixture was not accepted");
    }

    const abandonedWorker = `${input.prefix}-process-abandoned-${round}`;
    let child;
    try {
      child = spawnWorkerFixture(configuration, repositoryRoot, baseTime, abandonedWorker);
      workerProcessRecovery.childProcessesStarted += 1;
      await waitForWorkerClaim(child, accepted.jobId);
      await terminateWorkerProcess(child);
      workerProcessRecovery.childProcessesKilled += 1;
    } finally {
      await cleanupWorkerProcess(child);
    }

    now = offsetDate(baseTime, 2_000);
    const replacementWorker = `${input.prefix}-process-replacement-${round}`;
    const reclaimed = (await store.claimJobs({ workerId: replacementWorker, limit: 1 }))[0];
    if (!reclaimed || reclaimed.jobId !== accepted.jobId || reclaimed.attemptCount !== 2) {
      throw new Error("terminated worker lease was not reclaimed");
    }
    workerProcessRecovery.abandonedLeasesReclaimed += 1;
    if ((await store.completeJob({ jobId: reclaimed.jobId, workerId: replacementWorker })) !== "completed") {
      throw new Error("replacement worker did not complete the reclaimed job");
    }
    workerProcessRecovery.replacementCompletions += 1;
    workerProcessRecovery.roundsCompleted += 1;
    workerProcessRecovery.maximumConvergenceMs = Math.max(
      workerProcessRecovery.maximumConvergenceMs,
      rounded(performance.now() - startedAt),
    );
  }
  return workerProcessRecovery;
}

async function startWorkerFleetRound({
  configuration,
  input,
  round,
  baseTime,
  store,
  repositoryRoot,
  children,
  expectedJobIds,
  workerFleetRecovery,
}) {
  for (let workerIndex = 0; workerIndex < configuration.workerFleetSize; workerIndex += 1) {
    const repository =
      input.repositories[(round * configuration.workerFleetSize + workerIndex) % input.repositories.length];
    const deliveryId = `${input.prefix}-worker-fleet-${round}-${workerIndex}`;
    const accepted = await store.acceptGitHubWebhook({
      deliveryId,
      eventType: "installation",
      eventAction: "created",
      installationExternalId: repository.githubInstallationId,
      payloadSha256: createHash("sha256").update(deliveryId).digest("hex"),
      actions: [
        {
          type: "installation.upsert",
          installation: {
            id: repository.githubInstallationId,
            accountLogin: `${input.prefix}-worker-fleet-account`,
            accountType: "Organization",
          },
        },
      ],
      receivedAt: baseTime,
    });
    if (accepted.outcome !== "accepted" || !accepted.jobId) {
      throw new Error("worker fleet interruption fixture was not accepted");
    }

    const workerId = `${input.prefix}-fleet-abandoned-${round}-${workerIndex}`;
    const child = spawnWorkerFixture(configuration, repositoryRoot, baseTime, workerId);
    children.push(child);
    workerFleetRecovery.childProcessesStarted += 1;
    await waitForWorkerClaim(child, accepted.jobId);
    expectedJobIds.push(accepted.jobId);
  }
}

async function reclaimWorkerFleetRound(configuration, input, round, store, expectedJobIds, workerFleetRecovery) {
  const reclaimedIds = new Set();
  for (let workerIndex = 0; workerIndex < configuration.workerFleetSize; workerIndex += 1) {
    const replacementWorker = `${input.prefix}-fleet-replacement-${round}-${workerIndex}`;
    const reclaimed = (await store.claimJobs({ workerId: replacementWorker, limit: 1 }))[0];
    if (!reclaimed || !expectedJobIds.includes(reclaimed.jobId) || reclaimed.attemptCount !== 2) {
      throw new Error("terminated worker fleet lease was not reclaimed");
    }
    if (reclaimedIds.has(reclaimed.jobId)) throw new Error("terminated worker fleet job was reclaimed twice");
    reclaimedIds.add(reclaimed.jobId);
    workerFleetRecovery.abandonedLeasesReclaimed += 1;
    if ((await store.completeJob({ jobId: reclaimed.jobId, workerId: replacementWorker })) !== "completed") {
      throw new Error("replacement worker fleet did not complete a reclaimed job");
    }
    workerFleetRecovery.replacementCompletions += 1;
  }
  if (reclaimedIds.size !== expectedJobIds.length) {
    throw new Error("replacement worker fleet did not reclaim every abandoned job");
  }
}

async function runWorkerFleetInterruptionValidation(configuration, input) {
  const workerFleetRecovery = {
    ...createWorkerInterruptionRecovery(configuration.recoveryRounds),
    fleetSize: configuration.workerFleetSize,
  };
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

  for (let round = 0; round < configuration.recoveryRounds; round += 1) {
    const startedAt = performance.now();
    const baseTime = new Date(Date.now() + 60_000 + round * 10_000);
    let now = baseTime;
    const store = createWorkerInterruptionStore(input, () => now);
    const children = [];
    const expectedJobIds = [];

    try {
      await startWorkerFleetRound({
        configuration,
        input,
        round,
        baseTime,
        store,
        repositoryRoot,
        children,
        expectedJobIds,
        workerFleetRecovery,
      });
      await Promise.all(
        children.map(async (child) => {
          await terminateWorkerProcess(child);
          workerFleetRecovery.childProcessesKilled += 1;
        }),
      );
    } finally {
      await Promise.all(children.map((child) => cleanupWorkerProcess(child)));
    }

    now = offsetDate(baseTime, 2_000);
    await reclaimWorkerFleetRound(configuration, input, round, store, expectedJobIds, workerFleetRecovery);
    workerFleetRecovery.roundsCompleted += 1;
    workerFleetRecovery.maximumConvergenceMs = Math.max(
      workerFleetRecovery.maximumConvergenceMs,
      rounded(performance.now() - startedAt),
    );
  }
  return workerFleetRecovery;
}

function requiredDatabaseInterruptionDependency(dependencies, name) {
  const dependency = dependencies[name];
  if (typeof dependency !== "function") {
    throw new Error(`database-interruption dependency is required: ${name}`);
  }
  return dependency;
}

async function closeInterruptedPostgresClient(client) {
  try {
    await client.end();
  } catch {
    // A backend terminated by PostgreSQL may already have closed the socket.
  }
}

async function runDatabaseInterruptionValidation(configuration, input) {
  const createPostgresClient = requiredDatabaseInterruptionDependency(input.dependencies, "createPostgresClient");
  const databaseRecovery = {
    roundsRequested: configuration.recoveryRounds,
    roundsCompleted: 0,
    backendTerminations: 0,
    interruptedTransactionsRejected: 0,
    transactionRollbacksVerified: 0,
    replacementConnectionsEstablished: 0,
    maximumConvergenceMs: 0,
  };

  for (let round = 0; round < configuration.recoveryRounds; round += 1) {
    const startedAt = performance.now();
    const repository = input.repositories[round % input.repositories.length];
    const interruptedName = `${input.prefix}-interrupted-${round}`;
    const interruptedClient = createPostgresClient({ connectionString: configuration.databaseUrl });
    let connectionErrorObserved = false;
    interruptedClient.on("error", () => {
      connectionErrorObserved = true;
    });

    try {
      await interruptedClient.connect();
      await interruptedClient.query("begin");
      await interruptedClient.query("update repositories set name = $1 where id = $2", [
        interruptedName,
        repository.repositoryId,
      ]);
      const backend = databaseRows(await interruptedClient.query("select pg_backend_pid()::int as pid"))[0];
      const backendPid = integerColumn(backend, "pid");
      if (backendPid < 1) throw new Error("database interruption backend pid was unavailable");

      const termination = databaseRows(
        await input.executor.query("select pg_terminate_backend($1)::boolean as terminated", [backendPid]),
      )[0];
      if (termination?.terminated !== true) throw new Error("PostgreSQL backend termination was not acknowledged");
      databaseRecovery.backendTerminations += 1;

      try {
        await interruptedClient.query("select 1");
      } catch {
        connectionErrorObserved = true;
      }
      if (!connectionErrorObserved) throw new Error("interrupted PostgreSQL transaction remained usable");
      databaseRecovery.interruptedTransactionsRejected += 1;
    } finally {
      await closeInterruptedPostgresClient(interruptedClient);
    }

    const persisted = databaseRows(
      await input.executor.query("select name from repositories where id = $1", [repository.repositoryId]),
    )[0];
    if (persisted?.name !== repository.name) {
      throw new Error("interrupted PostgreSQL transaction did not roll back atomically");
    }
    databaseRecovery.transactionRollbacksVerified += 1;

    const replacementClient = createPostgresClient({ connectionString: configuration.databaseUrl });
    try {
      await replacementClient.connect();
      const replacement = databaseRows(
        await replacementClient.query("select name from repositories where id = $1", [repository.repositoryId]),
      )[0];
      if (replacement?.name !== repository.name) {
        throw new Error("replacement PostgreSQL connection observed inconsistent state");
      }
      databaseRecovery.replacementConnectionsEstablished += 1;
    } finally {
      await replacementClient.end();
    }

    databaseRecovery.roundsCompleted += 1;
    databaseRecovery.maximumConvergenceMs = Math.max(
      databaseRecovery.maximumConvergenceMs,
      rounded(performance.now() - startedAt),
    );
  }

  return databaseRecovery;
}

async function runSoakRecoveryValidation(configuration, input) {
  const createSqlControlPlaneOperationsStore = requiredRecoveryDependency(
    input.dependencies,
    "createSqlControlPlaneOperationsStore",
  );
  const createSqlRunnerLeaseStore = requiredRecoveryDependency(input.dependencies, "createSqlRunnerLeaseStore");
  const createSqlRunnerTerminalResultAuthorizer = requiredRecoveryDependency(
    input.dependencies,
    "createSqlRunnerTerminalResultAuthorizer",
  );
  const processControlPlaneWorkflowReconciliation = requiredRecoveryDependency(
    input.dependencies,
    "processControlPlaneWorkflowReconciliation",
  );
  const recovery = {
    roundsRequested: configuration.recoveryRounds,
    roundsCompleted: 0,
    jobLeaseRecoveries: 0,
    staleJobCompletionsRejected: 0,
    outboxRetries: 0,
    uncertainOutboxQuarantines: 0,
    delayedCallbackRepairs: 0,
    staleAttemptResultsRejected: 0,
    maximumConvergenceMs: 0,
    deadLetters: 0,
    ambiguousNonterminalStates: 0,
  };

  for (let round = 0; round < configuration.recoveryRounds; round += 1) {
    const startedAt = performance.now();
    const repository = input.repositories[round % input.repositories.length];
    const baseTime = new Date(Date.now() + 60_000 + round * 2_000_000);
    const common = {
      executor: input.executor,
      prefix: input.prefix,
      round,
      baseTime,
      repository,
      createSqlControlPlaneJobStore: input.dependencies.createSqlControlPlaneJobStore,
      createSqlControlPlaneOutboxStore: input.dependencies.createSqlControlPlaneOutboxStore,
      createSqlControlPlaneOperationsStore,
      createSqlRunnerLeaseStore,
      createSqlRunnerTerminalResultAuthorizer,
      createSqlTransactionalGitHubAppLifecycleStore: input.dependencies.createSqlTransactionalGitHubAppLifecycleStore,
      processControlPlaneWorkflowReconciliation,
    };
    incrementRecoveryEvidence(recovery, await validateJobLeaseRecovery(common));
    incrementRecoveryEvidence(recovery, await validateOutboxRecovery(common));
    incrementRecoveryEvidence(recovery, await validateDelayedCallbackRecovery(common));
    incrementRecoveryEvidence(recovery, await validateStaleAttemptRejection(common));
    recovery.roundsCompleted += 1;
    recovery.maximumConvergenceMs = Math.max(recovery.maximumConvergenceMs, rounded(performance.now() - startedAt));
  }

  const recoveryJobs = databaseRows(
    await input.executor.query(
      `select
         count(*) filter (where cpj.status = 'dead_letter')::int as dead_letters,
         count(*) filter (where cpj.status <> 'completed')::int as ambiguous
       from control_plane_jobs cpj
       join webhook_inbox wi on wi.id = cpj.inbox_id
      where wi.delivery_id like $1`,
      [`${input.prefix}-recovery-job-%`],
    ),
  )[0];
  recovery.deadLetters = integerColumn(recoveryJobs, "dead_letters");
  recovery.ambiguousNonterminalStates = integerColumn(recoveryJobs, "ambiguous");
  return recovery;
}

async function cleanupScenario(executor, prefix) {
  await executor.query("delete from webhook_inbox where delivery_id like $1", [`${prefix}%`]);
  await executor.query("delete from installations where account_login like $1", [`${prefix}-owner-%`]);
  await executor.query("delete from managed_runner_identities where name like $1", [`${prefix}-managed-%`]);
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
    const githubApiRecovery =
      configuration.profile === "github-api-interruption"
        ? await runGitHubApiInterruptionValidation(configuration, {
            executor,
            prefix,
            repositories,
            dependencies,
          })
        : undefined;
    const workerProcessRecovery =
      configuration.profile === "worker-process-interruption"
        ? await runWorkerProcessInterruptionValidation(configuration, {
            executor,
            prefix,
            repositories,
            dependencies,
          })
        : undefined;
    const workerFleetRecovery =
      configuration.profile === "worker-fleet-interruption"
        ? await runWorkerFleetInterruptionValidation(configuration, {
            executor,
            prefix,
            repositories,
            dependencies,
          })
        : undefined;
    const databaseRecovery =
      configuration.profile === "database-interruption"
        ? await runDatabaseInterruptionValidation(configuration, {
            executor,
            prefix,
            repositories,
            dependencies,
          })
        : undefined;
    const recovery =
      configuration.profile !== "representative"
        ? await runSoakRecoveryValidation(configuration, {
            executor,
            prefix,
            repositories,
            dependencies,
          })
        : undefined;
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
        profile: configuration.profile,
        recoveryRounds: configuration.recoveryRounds,
        workerFleetSize: configuration.workerFleetSize,
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
      ...(recovery ? { recovery } : {}),
      ...(databaseRecovery ? { databaseRecovery } : {}),
      ...(workerProcessRecovery ? { workerProcessRecovery } : {}),
      ...(workerFleetRecovery ? { workerFleetRecovery } : {}),
      ...(githubApiRecovery ? { githubApiRecovery } : {}),
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
