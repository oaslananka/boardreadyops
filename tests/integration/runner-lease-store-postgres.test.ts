import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import {
  type ClaimRunnerJobResult,
  createSqlRunnerLeaseStore,
  type RunnerLeaseStore,
} from "../../packages/db/src/runner-lease-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 8 }) : undefined;
let githubIdentifier = 970_000_000;
const testEpochMilliseconds = Date.now() + 60_000;

function testTime(offsetSeconds: number): string {
  return new Date(testEpochMilliseconds + offsetSeconds * 1000).toISOString();
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function databaseExecutor() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requestTimestamp(value: string): number {
  return Math.floor(new Date(value).valueOf() / 1000);
}

function nonce(seed: string): string {
  return createHash("sha256").update(seed).digest("base64url");
}

function token(seed: string): string {
  return createHash("sha256").update(`lease:${seed}`).digest("base64url");
}

type TenantFixture = {
  installationId: string;
  repositoryId: string;
  owner: string;
  name: string;
};

async function createTenant(label: string, privateRepository = true): Promise<TenantFixture> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const owner = `lease-${label}`.slice(0, 39);
  const name = `board-${label}`.slice(0, 100);
  githubIdentifier += 1;
  const githubInstallationId = githubIdentifier;
  githubIdentifier += 1;
  const githubRepositoryId = githubIdentifier;

  await executor.query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, $3, 'Organization')`,
    [installationId, githubInstallationId, owner],
  );
  await executor.query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
     values ($1, $2, $3, $4, $5, $6, 'main')`,
    [repositoryId, installationId, githubRepositoryId, owner, name, privateRepository],
  );

  return { installationId, repositoryId, owner, name };
}

async function createQueuedRun(tenant: TenantFixture, startedAt: string): Promise<string> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const runId = randomUUID();
  await executor.query(
    `insert into release_runs (
       id, repository_id, commit_sha, ref, pull_request_number, trigger_kind, status, started_at
     ) values ($1, $2, $3, 'refs/pull/42/head', 42, 'pr', 'queued', $4::timestamptz)`,
    [runId, tenant.repositoryId, fingerprint(runId).slice(0, 40), startedAt],
  );
  return runId;
}

async function setExecutionPolicy(
  tenant: TenantFixture,
  mode: "disabled" | "managed_only" | "self_hosted_preferred" | "self_hosted_required",
  repositoryId: string | null = null,
  offlineAfterSeconds = 300,
): Promise<void> {
  if (!executor) throw new Error("DATABASE_URL is required");
  await executor.query(
    `insert into runner_execution_policies (
       installation_id, repository_id, mode, self_hosted_offline_after_seconds
     ) values ($1, $2, $3, $4)`,
    [tenant.installationId, repositoryId, mode, offlineAfterSeconds],
  );
}

async function createManagedIdentity(label: string, now: string, capabilities = ["kicad:10"]): Promise<string> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const identityId = randomUUID();
  await executor.query(
    `insert into managed_runner_identities (
       id, name, public_key, public_key_fingerprint, capabilities, status,
       created_at, activated_at, last_heartbeat_at
     ) values (
       $1, $2, $3, $4, $5::jsonb, 'active',
       $6::timestamptz, $6::timestamptz, $6::timestamptz
     )`,
    [
      identityId,
      `managed-${label}-${identityId}`,
      "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA0000000000000000000000000000000000000000000=\n-----END PUBLIC KEY-----",
      fingerprint(identityId),
      JSON.stringify(capabilities),
      now,
    ],
  );
  return identityId;
}

async function createSelfHostedRunner(
  tenant: TenantFixture,
  label: string,
  now: string,
  allowedRepositories: readonly string[],
): Promise<string> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const runnerId = randomUUID();
  await executor.query(
    `insert into runner_registrations (
       id, installation_id, name, allowed_repositories, public_key_fingerprint,
       signing_algorithm, public_key, capabilities, status, created_at, activated_at, last_heartbeat_at
     ) values (
       $1, $2, $3, $4::text[], $5, 'ed25519', $6, $7::jsonb,
       'active', $8::timestamptz, $8::timestamptz, $8::timestamptz
     )`,
    [
      runnerId,
      tenant.installationId,
      `self-${label}-${runnerId}`,
      [...allowedRepositories],
      fingerprint(runnerId).slice(0, 32),
      "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA1111111111111111111111111111111111111111111=\n-----END PUBLIC KEY-----",
      JSON.stringify(["kicad:10"]),
      now,
    ],
  );
  return runnerId;
}

function fixedStore(input: {
  now: string;
  ids: string[];
  tokens: string[];
  leaseDurationSeconds?: number;
  maximumLeaseDurationSeconds?: number;
}): RunnerLeaseStore {
  if (!executor) throw new Error("DATABASE_URL is required");
  const ids = [...input.ids];
  const tokens = [...input.tokens];
  return createSqlRunnerLeaseStore(executor, {
    now: () => new Date(input.now),
    id: () => ids.shift() ?? randomUUID(),
    leaseToken: () => tokens.shift() ?? token(randomUUID()),
    ...(input.leaseDurationSeconds === undefined ? {} : { leaseDurationSeconds: input.leaseDurationSeconds }),
    ...(input.maximumLeaseDurationSeconds === undefined
      ? {}
      : { maximumLeaseDurationSeconds: input.maximumLeaseDurationSeconds }),
  });
}

async function cleanupTenant(tenant: TenantFixture, managedIdentityId?: string): Promise<void> {
  if (!executor) return;
  await executor.query(
    `delete from runner_job_leases
     where runner_registration_id in (
       select id from runner_registrations where installation_id = $1
     )`,
    [tenant.installationId],
  );
  await executor.query("delete from installations where id = $1", [tenant.installationId]);
  if (managedIdentityId) {
    await executor.query("delete from managed_runner_identities where id = $1", [managedIdentityId]);
  }
}

function claimed(result: ClaimRunnerJobResult) {
  if (result.status !== "claimed") throw new Error(`expected claimed result, received ${result.status}`);
  return result;
}

afterAll(async () => {
  if (!executor) return;
  await executor.query("delete from installations where account_login like 'lease-lease-test-%'");
  await executor.query("delete from managed_runner_identities where name like 'managed-lease-test-%'");
});

describeDatabase("runner lease PostgreSQL store", () => {
  it("allows only one concurrent claim for one queued logical run", async () => {
    const now = testTime(0);
    const tenant = await createTenant("lease-test-race");
    const runId = await createQueuedRun(tenant, now);
    const managedIdentityId = await createManagedIdentity("lease-test-race", now);
    const attemptOne = randomUUID();
    const leaseOne = randomUUID();
    const attemptTwo = randomUUID();
    const leaseTwo = randomUUID();
    const store = fixedStore({
      now,
      ids: [attemptOne, leaseOne, attemptTwo, leaseTwo],
      tokens: [token("race-one"), token("race-two")],
    });

    try {
      const base = {
        workerClass: "managed" as const,
        managedRunnerIdentityId: managedIdentityId,
        requestTimestamp: requestTimestamp(now),
        capabilities: ["kicad:10"],
      };
      const [first, second] = await Promise.all([
        store.claimJob({ ...base, requestNonce: nonce("race-one") }),
        store.claimJob({ ...base, requestNonce: nonce("race-two") }),
      ]);
      expect([first.status, second.status].sort()).toEqual(["claimed", "empty"]);

      const state = rows(
        await databaseExecutor().query(
          `select release_runs.status as run_status,
                  release_runs.version::int as run_version,
                  release_run_attempts.status as attempt_status,
                  release_run_attempts.version::int as attempt_version,
                  runner_job_leases.expected_run_status,
                  runner_job_leases.expected_run_version::int as expected_run_version,
                  runner_job_leases.expected_attempt_status,
                  runner_job_leases.expected_attempt_version::int as expected_attempt_version
             from release_runs
             join release_run_attempts on release_run_attempts.id = release_runs.execution_attempt_id
             join runner_job_leases on runner_job_leases.execution_attempt_id = release_run_attempts.id
            where release_runs.id = $1
              and runner_job_leases.status = 'active'`,
          [runId],
        ),
      )[0];
      expect(state).toEqual({
        run_status: "running",
        run_version: 1,
        attempt_status: "in_progress",
        attempt_version: 0,
        expected_run_status: "running",
        expected_run_version: 1,
        expected_attempt_status: "in_progress",
        expected_attempt_version: 0,
      });
      const transitions = rows(
        await databaseExecutor().query(
          `select entity_type, from_status, to_status,
                  from_version::int as from_version, to_version::int as to_version, reason_code
             from release_run_transition_events
            where release_run_id = $1`,
          [runId],
        ),
      );
      expect(transitions).toEqual([
        {
          entity_type: "release_run",
          from_status: "queued",
          to_status: "running",
          from_version: 0,
          to_version: 1,
          reason_code: "runner_lease_claimed",
        },
      ]);
    } finally {
      await cleanupTenant(tenant, managedIdentityId);
    }
  });

  it("expires an abandoned lease and creates a fresh execution attempt", async () => {
    const claimedAt = testTime(600);
    const recoveredAt = testTime(720);
    const tenant = await createTenant("lease-test-expiry");
    const runId = await createQueuedRun(tenant, claimedAt);
    const managedIdentityId = await createManagedIdentity("lease-test-expiry", claimedAt);
    const firstAttempt = randomUUID();
    const firstLease = randomUUID();
    const secondAttempt = randomUUID();
    const secondLease = randomUUID();

    try {
      const first = claimed(
        await fixedStore({
          now: claimedAt,
          ids: [firstAttempt, firstLease],
          tokens: [token("expiry-one")],
          leaseDurationSeconds: 60,
          maximumLeaseDurationSeconds: 300,
        }).claimJob({
          workerClass: "managed",
          managedRunnerIdentityId: managedIdentityId,
          requestTimestamp: requestTimestamp(claimedAt),
          requestNonce: nonce("expiry-one"),
          capabilities: ["kicad:10"],
        }),
      );

      const second = claimed(
        await fixedStore({
          now: recoveredAt,
          ids: [secondAttempt, secondLease],
          tokens: [token("expiry-two")],
          leaseDurationSeconds: 60,
          maximumLeaseDurationSeconds: 300,
        }).claimJob({
          workerClass: "managed",
          managedRunnerIdentityId: managedIdentityId,
          requestTimestamp: requestTimestamp(recoveredAt),
          requestNonce: nonce("expiry-two"),
          capabilities: ["kicad:10"],
        }),
      );

      expect(second.executionAttemptId).not.toBe(first.executionAttemptId);
      const leaseRows = rows(
        await databaseExecutor().query(
          `select status, execution_attempt_id,
                  expected_run_status, expected_run_version::int as expected_run_version,
                  expected_attempt_status, expected_attempt_version::int as expected_attempt_version
             from runner_job_leases
            where run_id = $1
            order by claimed_at, id`,
          [runId],
        ),
      );
      expect(leaseRows).toEqual([
        {
          status: "expired",
          execution_attempt_id: first.executionAttemptId,
          expected_run_status: "queued",
          expected_run_version: 2,
          expected_attempt_status: "stale",
          expected_attempt_version: 1,
        },
        {
          status: "active",
          execution_attempt_id: second.executionAttemptId,
          expected_run_status: "running",
          expected_run_version: 3,
          expected_attempt_status: "in_progress",
          expected_attempt_version: 0,
        },
      ]);
      const attemptRows = rows(
        await databaseExecutor().query(
          `select status, version::int as version, id
             from release_run_attempts
            where run_id = $1
            order by attempt_number`,
          [runId],
        ),
      );
      expect(attemptRows).toEqual([
        { status: "stale", version: 1, id: first.executionAttemptId },
        { status: "in_progress", version: 0, id: second.executionAttemptId },
      ]);
      const runState = rows(
        await databaseExecutor().query(`select status, version::int as version from release_runs where id = $1`, [
          runId,
        ]),
      )[0];
      expect(runState).toEqual({ status: "running", version: 3 });
      const transitionCounts = rows(
        await databaseExecutor().query(
          `select reason_code, entity_type, count(*)::int as count
             from release_run_transition_events
            where release_run_id = $1
            group by reason_code, entity_type
            order by reason_code, entity_type`,
          [runId],
        ),
      );
      expect(transitionCounts).toEqual([
        { reason_code: "runner_lease_claimed", entity_type: "release_run", count: 2 },
        { reason_code: "runner_lease_expired", entity_type: "execution_attempt", count: 1 },
        { reason_code: "runner_lease_expired", entity_type: "release_run", count: 1 },
      ]);
    } finally {
      await cleanupTenant(tenant, managedIdentityId);
    }
  });

  it("renews and relinquishes a self-hosted lease with nonce replay protection", async () => {
    const claimedAt = testTime(1200);
    const heartbeatAt = testTime(1230);
    const relinquishedAt = testTime(1250);
    const tenant = await createTenant("lease-test-self-hosted");
    const runId = await createQueuedRun(tenant, claimedAt);
    await setExecutionPolicy(tenant, "self_hosted_required");
    const runnerId = await createSelfHostedRunner(tenant, "lease-test-self-hosted", claimedAt, [
      `${tenant.owner}/${tenant.name}`,
    ]);
    const attemptId = randomUUID();
    const leaseId = randomUUID();
    const leaseSecret = token("self-hosted");

    try {
      const job = claimed(
        await fixedStore({ now: claimedAt, ids: [attemptId, leaseId], tokens: [leaseSecret] }).claimJob({
          workerClass: "self_hosted",
          runnerRegistrationId: runnerId,
          requestTimestamp: requestTimestamp(claimedAt),
          requestNonce: nonce("self-claim"),
          capabilities: ["kicad:10"],
        }),
      );
      expect(job.sourceMode).toBe("customer_checkout");
      expect(job.safeMode).toEqual({ enabled: true, reasons: ["private-repository"] });

      const heartbeatInput = {
        workerClass: "self_hosted" as const,
        runnerRegistrationId: runnerId,
        runId,
        executionAttemptId: job.executionAttemptId,
        leaseId: job.leaseId,
        leaseToken: job.leaseToken,
        requestTimestamp: requestTimestamp(heartbeatAt),
        requestNonce: nonce("self-heartbeat"),
        stage: "running" as const,
        progressPercent: 40,
      };
      const heartbeat = await fixedStore({ now: heartbeatAt, ids: [], tokens: [] }).heartbeat(heartbeatInput);
      expect(heartbeat.status).toBe("active");
      const replayedHeartbeat = await fixedStore({ now: heartbeatAt, ids: [], tokens: [] }).heartbeat(heartbeatInput);
      expect(replayedHeartbeat).toEqual({ status: "replayed" });

      const staleHeartbeat = await fixedStore({
        now: testTime(1240),
        ids: [],
        tokens: [],
      }).heartbeat({
        ...heartbeatInput,
        leaseToken: token("wrong"),
        requestTimestamp: requestTimestamp(testTime(1240)),
        requestNonce: nonce("wrong-heartbeat"),
      });
      expect(staleHeartbeat).toEqual({ status: "stale" });

      const relinquishInput = {
        workerClass: "self_hosted" as const,
        runnerRegistrationId: runnerId,
        runId,
        executionAttemptId: job.executionAttemptId,
        leaseId: job.leaseId,
        leaseToken: job.leaseToken,
        requestTimestamp: requestTimestamp(relinquishedAt),
        requestNonce: nonce("self-relinquish"),
        reason: "shutdown" as const,
      };
      const relinquished = await fixedStore({ now: relinquishedAt, ids: [], tokens: [] }).relinquish(relinquishInput);
      expect(relinquished).toEqual({ status: "accepted" });
      const replayed = await fixedStore({ now: relinquishedAt, ids: [], tokens: [] }).relinquish(relinquishInput);
      expect(replayed).toEqual({ status: "replayed" });

      const state = rows(
        await databaseExecutor().query(
          `select release_runs.status as run_status,
                  release_runs.version::int as run_version,
                  release_run_attempts.status as attempt_status,
                  release_run_attempts.version::int as attempt_version,
                  runner_job_leases.status as lease_status,
                  runner_job_leases.expected_run_status,
                  runner_job_leases.expected_run_version::int as expected_run_version,
                  runner_job_leases.expected_attempt_status,
                  runner_job_leases.expected_attempt_version::int as expected_attempt_version
           from release_runs
           join release_run_attempts on release_run_attempts.id = release_runs.execution_attempt_id
           join runner_job_leases on runner_job_leases.execution_attempt_id = release_run_attempts.id
           where release_runs.id = $1`,
          [runId],
        ),
      )[0];
      expect(state).toEqual({
        run_status: "queued",
        run_version: 2,
        attempt_status: "stale",
        attempt_version: 1,
        lease_status: "relinquished",
        expected_run_status: "queued",
        expected_run_version: 2,
        expected_attempt_status: "stale",
        expected_attempt_version: 1,
      });

      const auditTypes = rows(
        await databaseExecutor().query(
          `select event_type from audit_events where release_run_id = $1 order by created_at, id`,
          [runId],
        ),
      ).map((row) => row.event_type);
      expect(auditTypes).toEqual(["runner.lease.claimed", "runner.lease.renewed", "runner.lease.relinquished"]);
      const transitionCounts = rows(
        await databaseExecutor().query(
          `select reason_code, entity_type, count(*)::int as count
             from release_run_transition_events
            where release_run_id = $1
            group by reason_code, entity_type
            order by reason_code, entity_type`,
          [runId],
        ),
      );
      expect(transitionCounts).toEqual([
        { reason_code: "runner_lease_claimed", entity_type: "release_run", count: 1 },
        { reason_code: "runner_lease_relinquished", entity_type: "execution_attempt", count: 1 },
        { reason_code: "runner_lease_relinquished", entity_type: "release_run", count: 1 },
      ]);
    } finally {
      await cleanupTenant(tenant);
    }
  });

  it("versions only real heartbeat status changes and keeps lease snapshots current", async () => {
    const claimedAt = testTime(1500);
    const uploadingAt = testTime(1510);
    const repeatedAt = testTime(1520);
    const reportingAt = testTime(1530);
    const tenant = await createTenant("lease-test-heartbeat-version");
    const runId = await createQueuedRun(tenant, claimedAt);
    const managedIdentityId = await createManagedIdentity("lease-test-heartbeat-version", claimedAt);
    const attemptId = randomUUID();
    const leaseId = randomUUID();

    try {
      const job = claimed(
        await fixedStore({ now: claimedAt, ids: [attemptId, leaseId], tokens: [token("heartbeat-version")] }).claimJob({
          workerClass: "managed",
          managedRunnerIdentityId: managedIdentityId,
          requestTimestamp: requestTimestamp(claimedAt),
          requestNonce: nonce("heartbeat-version-claim"),
          capabilities: ["kicad:10"],
        }),
      );

      const heartbeatBase = {
        workerClass: "managed" as const,
        managedRunnerIdentityId: managedIdentityId,
        runId,
        executionAttemptId: job.executionAttemptId,
        leaseId: job.leaseId,
        leaseToken: job.leaseToken,
      };
      await expect(
        fixedStore({ now: uploadingAt, ids: [], tokens: [] }).heartbeat({
          ...heartbeatBase,
          requestTimestamp: requestTimestamp(uploadingAt),
          requestNonce: nonce("heartbeat-uploading"),
          stage: "uploading_artifacts",
          progressPercent: 70,
        }),
      ).resolves.toMatchObject({ status: "active" });
      await expect(
        fixedStore({ now: repeatedAt, ids: [], tokens: [] }).heartbeat({
          ...heartbeatBase,
          requestTimestamp: requestTimestamp(repeatedAt),
          requestNonce: nonce("heartbeat-uploading-repeat"),
          stage: "uploading_artifacts",
          progressPercent: 75,
        }),
      ).resolves.toMatchObject({ status: "active" });
      await expect(
        fixedStore({ now: reportingAt, ids: [], tokens: [] }).heartbeat({
          ...heartbeatBase,
          requestTimestamp: requestTimestamp(reportingAt),
          requestNonce: nonce("heartbeat-reporting"),
          stage: "reporting",
          progressPercent: 90,
        }),
      ).resolves.toMatchObject({ status: "active" });

      const state = rows(
        await databaseExecutor().query(
          `select release_runs.version::int as run_version,
                  release_run_attempts.status as attempt_status,
                  release_run_attempts.version::int as attempt_version,
                  runner_job_leases.stage,
                  runner_job_leases.progress_percent,
                  runner_job_leases.expected_attempt_status,
                  runner_job_leases.expected_attempt_version::int as expected_attempt_version
             from release_runs
             join release_run_attempts on release_run_attempts.id = release_runs.execution_attempt_id
             join runner_job_leases on runner_job_leases.execution_attempt_id = release_run_attempts.id
            where release_runs.id = $1`,
          [runId],
        ),
      )[0];
      expect(state).toEqual({
        run_version: 1,
        attempt_status: "reporting",
        attempt_version: 2,
        stage: "reporting",
        progress_percent: 90,
        expected_attempt_status: "reporting",
        expected_attempt_version: 2,
      });
      const heartbeatTransitions = rows(
        await databaseExecutor().query(
          `select from_status, to_status,
                  from_version::int as from_version, to_version::int as to_version
             from release_run_transition_events
            where release_run_id = $1
              and reason_code = 'runner_lease_heartbeat'
            order by occurred_at`,
          [runId],
        ),
      );
      expect(heartbeatTransitions).toEqual([
        { from_status: "in_progress", to_status: "uploading_artifacts", from_version: 0, to_version: 1 },
        { from_status: "uploading_artifacts", to_status: "reporting", from_version: 1, to_version: 2 },
      ]);
    } finally {
      await cleanupTenant(tenant, managedIdentityId);
    }
  });

  it("fails closed when a lease run version, attempt version, or current-attempt pointer drifts", async () => {
    const scenarios = ["run-version", "attempt-version", "attempt-pointer"] as const;

    for (const [index, scenario] of scenarios.entries()) {
      const claimedAt = testTime(2100 + index * 120);
      const heartbeatAt = testTime(2110 + index * 120);
      const tenant = await createTenant(`lease-test-stale-${scenario}`);
      const runId = await createQueuedRun(tenant, claimedAt);
      const managedIdentityId = await createManagedIdentity(`lease-test-stale-${scenario}`, claimedAt);
      const attemptId = randomUUID();
      const leaseId = randomUUID();

      try {
        const job = claimed(
          await fixedStore({
            now: claimedAt,
            ids: [attemptId, leaseId],
            tokens: [token(`stale-${scenario}`)],
          }).claimJob({
            workerClass: "managed",
            managedRunnerIdentityId: managedIdentityId,
            requestTimestamp: requestTimestamp(claimedAt),
            requestNonce: nonce(`stale-${scenario}-claim`),
            capabilities: ["kicad:10"],
          }),
        );

        if (scenario === "run-version") {
          await databaseExecutor().query("update release_runs set version = version + 1 where id = $1", [runId]);
        } else if (scenario === "attempt-version") {
          await databaseExecutor().query("update release_run_attempts set version = version + 1 where id = $1", [
            attemptId,
          ]);
        } else {
          const replacementAttemptId = randomUUID();
          await databaseExecutor().query(
            `insert into release_run_attempts (
               id, run_id, attempt_number, status, created_at, started_at, heartbeat_at
             ) values ($1, $2, 2, 'in_progress', $3::timestamptz, $3::timestamptz, $3::timestamptz)`,
            [replacementAttemptId, runId, heartbeatAt],
          );
          await databaseExecutor().query("update release_runs set execution_attempt_id = $1 where id = $2", [
            replacementAttemptId,
            runId,
          ]);
        }

        const result = await fixedStore({ now: heartbeatAt, ids: [], tokens: [] }).heartbeat({
          workerClass: "managed",
          managedRunnerIdentityId: managedIdentityId,
          runId,
          executionAttemptId: job.executionAttemptId,
          leaseId: job.leaseId,
          leaseToken: job.leaseToken,
          requestTimestamp: requestTimestamp(heartbeatAt),
          requestNonce: nonce(`stale-${scenario}-heartbeat`),
          stage: "uploading_artifacts",
          progressPercent: 50,
        });
        expect(result).toEqual({ status: "stale" });

        const state = rows(
          await databaseExecutor().query(
            `select runner_job_leases.status as lease_status,
                    runner_job_leases.stage,
                    runner_job_leases.expected_run_version::int as expected_run_version,
                    runner_job_leases.expected_attempt_version::int as expected_attempt_version,
                    (select count(*)::int
                       from release_run_transition_events
                      where release_run_id = $1) as transition_count
               from runner_job_leases
              where runner_job_leases.id = $2`,
            [runId, leaseId],
          ),
        )[0];
        expect(state).toEqual({
          lease_status: "active",
          stage: "claimed",
          expected_run_version: 1,
          expected_attempt_version: 0,
          transition_count: 1,
        });
      } finally {
        await cleanupTenant(tenant, managedIdentityId);
      }
    }
  });

  it("expires a stale-bound lease without mutating a newer lifecycle snapshot", async () => {
    const claimedAt = testTime(2700);
    const expiredAt = testTime(2820);
    const tenant = await createTenant("lease-test-stale-expiry");
    const runId = await createQueuedRun(tenant, claimedAt);
    const managedIdentityId = await createManagedIdentity("lease-test-stale-expiry", claimedAt);
    const attemptId = randomUUID();
    const leaseId = randomUUID();

    try {
      await fixedStore({
        now: claimedAt,
        ids: [attemptId, leaseId],
        tokens: [token("stale-expiry")],
        leaseDurationSeconds: 60,
        maximumLeaseDurationSeconds: 300,
      }).claimJob({
        workerClass: "managed",
        managedRunnerIdentityId: managedIdentityId,
        requestTimestamp: requestTimestamp(claimedAt),
        requestNonce: nonce("stale-expiry-claim"),
        capabilities: ["kicad:10"],
      });
      await databaseExecutor().query("update release_runs set version = version + 1 where id = $1", [runId]);

      const expired = rows(
        await databaseExecutor().query("select boardreadyops_expire_runner_leases($1::timestamptz)::int as count", [
          expiredAt,
        ]),
      )[0]?.count;
      expect(expired).toBe(1);

      const state = rows(
        await databaseExecutor().query(
          `select release_runs.status as run_status,
                  release_runs.version::int as run_version,
                  release_run_attempts.status as attempt_status,
                  release_run_attempts.version::int as attempt_version,
                  runner_job_leases.status as lease_status,
                  (select count(*)::int
                     from release_run_transition_events
                    where release_run_id = $1) as transition_count
             from release_runs
             join runner_job_leases on runner_job_leases.run_id = release_runs.id
             join release_run_attempts on release_run_attempts.id = runner_job_leases.execution_attempt_id
            where release_runs.id = $1
              and runner_job_leases.id = $2`,
          [runId, leaseId],
        ),
      )[0];
      expect(state).toEqual({
        run_status: "running",
        run_version: 2,
        attempt_status: "in_progress",
        attempt_version: 0,
        lease_status: "expired",
        transition_count: 1,
      });
    } finally {
      await cleanupTenant(tenant, managedIdentityId);
    }
  });

  it("does not let a self-hosted runner claim another installation's run", async () => {
    const now = testTime(1800);
    const tenantA = await createTenant("lease-test-tenant-a", false);
    const tenantB = await createTenant("lease-test-tenant-b", false);
    const runB = await createQueuedRun(tenantB, now);
    await setExecutionPolicy(tenantB, "self_hosted_required");
    const runnerA = await createSelfHostedRunner(tenantA, "lease-test-tenant-a", now, []);

    try {
      const result = await fixedStore({
        now,
        ids: [randomUUID(), randomUUID()],
        tokens: [token("cross-tenant")],
      }).claimJob({
        workerClass: "self_hosted",
        runnerRegistrationId: runnerA,
        requestTimestamp: requestTimestamp(now),
        requestNonce: nonce("cross-tenant"),
        capabilities: ["kicad:10"],
      });
      expect(result).toEqual({ status: "empty", retryAfterSeconds: 15 });

      const attemptCount = rows(
        await databaseExecutor().query(`select count(*)::int as count from release_run_attempts where run_id = $1`, [
          runB,
        ]),
      )[0]?.count;
      expect(attemptCount).toBe(0);
    } finally {
      await cleanupTenant(tenantA);
      await cleanupTenant(tenantB);
    }
  });
});
