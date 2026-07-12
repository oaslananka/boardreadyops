import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import {
  type ClaimRunnerJobResult,
  createSqlRunnerLeaseStore,
  type RunnerLeaseStore,
} from "../../packages/db/src/runner-lease-store.js";

const connectionString = process.env.DATABASE_URL;
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
        await executor!.query(
          `select
             (select count(*)::int from runner_job_leases where run_id = $1 and status = 'active') as active_leases,
             (select count(*)::int from release_run_attempts where run_id = $1) as attempts,
             (select status from release_runs where id = $1) as run_status`,
          [runId],
        ),
      )[0];
      expect(state).toEqual({ active_leases: 1, attempts: 1, run_status: "running" });
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
        await executor!.query(
          `select status, execution_attempt_id from runner_job_leases where run_id = $1 order by claimed_at, id`,
          [runId],
        ),
      );
      expect(leaseRows).toEqual([
        { status: "expired", execution_attempt_id: first.executionAttemptId },
        { status: "active", execution_attempt_id: second.executionAttemptId },
      ]);
      const attemptRows = rows(
        await executor!.query(`select status, id from release_run_attempts where run_id = $1 order by attempt_number`, [
          runId,
        ]),
      );
      expect(attemptRows).toEqual([
        { status: "stale", id: first.executionAttemptId },
        { status: "in_progress", id: second.executionAttemptId },
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
        await executor!.query(
          `select release_runs.status as run_status,
                  release_run_attempts.status as attempt_status,
                  runner_job_leases.status as lease_status
           from release_runs
           join release_run_attempts on release_run_attempts.id = release_runs.execution_attempt_id
           join runner_job_leases on runner_job_leases.execution_attempt_id = release_run_attempts.id
           where release_runs.id = $1`,
          [runId],
        ),
      )[0];
      expect(state).toEqual({ run_status: "queued", attempt_status: "stale", lease_status: "relinquished" });

      const auditTypes = rows(
        await executor!.query(`select event_type from audit_events where release_run_id = $1 order by created_at, id`, [
          runId,
        ]),
      ).map((row) => row.event_type);
      expect(auditTypes).toEqual(["runner.lease.claimed", "runner.lease.renewed", "runner.lease.relinquished"]);
    } finally {
      await cleanupTenant(tenant);
    }
  });

  it("does not let a self-hosted runner claim another installation's run", async () => {
    const now = testTime(1800);
    const tenantA = await createTenant("lease-test-tenant-a", false);
    const tenantB = await createTenant("lease-test-tenant-b", false);
    const runB = await createQueuedRun(tenantB, now);
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
        await executor!.query(`select count(*)::int as count from release_run_attempts where run_id = $1`, [runB]),
      )[0]?.count;
      expect(attemptCount).toBe(0);
    } finally {
      await cleanupTenant(tenantA);
      await cleanupTenant(tenantB);
    }
  });
});
