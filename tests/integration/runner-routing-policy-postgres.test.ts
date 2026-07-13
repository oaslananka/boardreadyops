import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlRunnerLeaseStore } from "../../packages/db/src/runner-lease-store.js";

const connectionString = process.env.DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 8 }) : undefined;
let githubIdentifier = 980_000_000;
const testEpochMilliseconds = Date.now() + 120_000;

type RoutingMode = "disabled" | "managed_only" | "self_hosted_preferred" | "self_hosted_required";
type TenantFixture = {
  installationId: string;
  repositoryId: string;
  owner: string;
  name: string;
};

function testTime(offsetSeconds: number): string {
  return new Date(testEpochMilliseconds + offsetSeconds * 1000).toISOString();
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

function leaseToken(seed: string): string {
  return createHash("sha256").update(`routing:${seed}`).digest("base64url");
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

async function createTenant(label: string): Promise<TenantFixture> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const owner = `routing-${label}`.slice(0, 39);
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
     values ($1, $2, $3, $4, $5, true, 'main')`,
    [repositoryId, installationId, githubRepositoryId, owner, name],
  );
  return { installationId, repositoryId, owner, name };
}

async function createQueuedRun(tenant: TenantFixture, startedAt: string): Promise<string> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const runId = randomUUID();
  await executor.query(
    `insert into release_runs (
       id, repository_id, commit_sha, ref, pull_request_number, trigger_kind, status, started_at
     ) values ($1, $2, $3, 'refs/pull/70/head', 70, 'pr', 'queued', $4::timestamptz)`,
    [runId, tenant.repositoryId, fingerprint(runId).slice(0, 40), startedAt],
  );
  return runId;
}

async function setPolicy(
  tenant: TenantFixture,
  mode: RoutingMode,
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

async function createManagedIdentity(label: string, now: string): Promise<string> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const identityId = randomUUID();
  await executor.query(
    `insert into managed_runner_identities (
       id, name, public_key, public_key_fingerprint, capabilities, status,
       created_at, activated_at, last_heartbeat_at
     ) values ($1, $2, $3, $4, '["kicad:10"]'::jsonb, 'active',
               $5::timestamptz, $5::timestamptz, $5::timestamptz)`,
    [
      identityId,
      `managed-routing-${label}-${identityId}`,
      "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA2222222222222222222222222222222222222222222=\n-----END PUBLIC KEY-----",
      fingerprint(identityId),
      now,
    ],
  );
  return identityId;
}

async function createSelfHostedRunner(
  tenant: TenantFixture,
  label: string,
  heartbeatAt: string,
  allowedRepositories: readonly string[],
): Promise<string> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const runnerId = randomUUID();
  await executor.query(
    `insert into runner_registrations (
       id, installation_id, name, allowed_repositories, public_key_fingerprint,
       signing_algorithm, public_key, capabilities, status, created_at, activated_at, last_heartbeat_at
     ) values ($1, $2, $3, $4::text[], $5, 'ed25519', $6, '["kicad:10"]'::jsonb,
               'active', $7::timestamptz, $7::timestamptz, $7::timestamptz)`,
    [
      runnerId,
      tenant.installationId,
      `self-routing-${label}-${runnerId}`,
      [...allowedRepositories],
      fingerprint(runnerId).slice(0, 32),
      "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA3333333333333333333333333333333333333333333=\n-----END PUBLIC KEY-----",
      heartbeatAt,
    ],
  );
  return runnerId;
}

function store(now: string) {
  if (!executor) throw new Error("DATABASE_URL is required");
  const ids = [randomUUID(), randomUUID()];
  return createSqlRunnerLeaseStore(executor, {
    now: () => new Date(now),
    id: () => ids.shift() ?? randomUUID(),
    leaseToken: () => leaseToken(randomUUID()),
  });
}

async function managedClaim(now: string, identityId: string, seed: string) {
  return await store(now).claimJob({
    workerClass: "managed",
    managedRunnerIdentityId: identityId,
    requestTimestamp: requestTimestamp(now),
    requestNonce: nonce(seed),
    capabilities: ["kicad:10"],
  });
}

async function selfHostedClaim(now: string, runnerId: string, seed: string) {
  return await store(now).claimJob({
    workerClass: "self_hosted",
    runnerRegistrationId: runnerId,
    requestTimestamp: requestTimestamp(now),
    requestNonce: nonce(seed),
    capabilities: ["kicad:10"],
  });
}

async function cleanup(tenants: readonly TenantFixture[], managedIdentityIds: readonly string[]): Promise<void> {
  if (!executor) return;
  for (const tenant of tenants) {
    await executor.query(
      `delete from runner_job_leases
     where run_id in (
       select release_runs.id
       from release_runs
       join repositories on repositories.id = release_runs.repository_id
       where repositories.installation_id = $1
     )`,
      [tenant.installationId],
    );
    await executor.query("delete from installations where id = $1", [tenant.installationId]);
  }
  for (const identityId of managedIdentityIds) {
    await executor.query("delete from managed_runner_identities where id = $1", [identityId]);
  }
}

afterAll(async () => {
  if (!executor) return;
  await executor.query("delete from installations where account_login like 'routing-%'");
  await executor.query("delete from managed_runner_identities where name like 'managed-routing-%'");
});

describeDatabase("runner execution routing policy", () => {
  it("uses managed-only as the implicit default and blocks self-hosted claims", async () => {
    const now = testTime(0);
    const tenant = await createTenant("implicit-default");
    await createQueuedRun(tenant, now);
    const managedIdentityId = await createManagedIdentity("implicit-default", now);
    const runnerId = await createSelfHostedRunner(tenant, "implicit-default", now, []);

    try {
      expect(await selfHostedClaim(now, runnerId, "implicit-self")).toEqual({
        status: "empty",
        retryAfterSeconds: 15,
      });
      expect((await managedClaim(now, managedIdentityId, "implicit-managed")).status).toBe("claimed");
    } finally {
      await cleanup([tenant], [managedIdentityId]);
    }
  });

  it("enforces repository override precedence for required self-hosted execution", async () => {
    const now = testTime(600);
    const tenant = await createTenant("repository-override");
    const runId = await createQueuedRun(tenant, now);
    await setPolicy(tenant, "managed_only");
    await setPolicy(tenant, "self_hosted_required", tenant.repositoryId);
    const managedIdentityId = await createManagedIdentity("repository-override", now);
    const runnerId = await createSelfHostedRunner(tenant, "repository-override", now, [
      `${tenant.owner}/${tenant.name}`,
    ]);

    try {
      expect(await managedClaim(now, managedIdentityId, "override-managed")).toEqual({
        status: "empty",
        retryAfterSeconds: 15,
      });
      const claimed = await selfHostedClaim(now, runnerId, "override-self");
      expect(claimed.status).toBe("claimed");
      const metadata = rows(
        await executor!.query(
          "select metadata from audit_events where release_run_id = $1 and event_type = 'runner.lease.claimed'",
          [runId],
        ),
      )[0]?.metadata;
      expect(metadata).toMatchObject({
        routingPolicyMode: "self_hosted_required",
        routingPolicySource: "repository",
        workerClass: "self_hosted",
      });
    } finally {
      await cleanup([tenant], [managedIdentityId]);
    }
  });

  it("allows preferred managed fallback only after eligible self-hosted runners become offline", async () => {
    const freshAt = testTime(1200);
    const staleAt = testTime(1600);
    const tenant = await createTenant("preferred-fallback");
    const runId = await createQueuedRun(tenant, freshAt);
    await setPolicy(tenant, "self_hosted_preferred", null, 300);
    const managedIdentityId = await createManagedIdentity("preferred-fallback", freshAt);
    await createSelfHostedRunner(tenant, "preferred-fallback", freshAt, [`${tenant.owner}/${tenant.name}`]);

    try {
      expect(await managedClaim(freshAt, managedIdentityId, "preferred-fresh")).toEqual({
        status: "empty",
        retryAfterSeconds: 15,
      });
      const claimed = await managedClaim(staleAt, managedIdentityId, "preferred-stale");
      expect(claimed.status).toBe("claimed");
      const metadata = rows(
        await executor!.query(
          "select metadata from audit_events where release_run_id = $1 and event_type = 'runner.lease.claimed'",
          [runId],
        ),
      )[0]?.metadata;
      expect(metadata).toMatchObject({
        fallbackReason: "no_eligible_self_hosted_runner_online",
        routingPolicyMode: "self_hosted_preferred",
        routingPolicySource: "installation",
        workerClass: "managed",
      });
    } finally {
      await cleanup([tenant], [managedIdentityId]);
    }
  });

  it("does not let an online but repository-ineligible runner block preferred fallback", async () => {
    const now = testTime(2200);
    const tenant = await createTenant("preferred-ineligible");
    await createQueuedRun(tenant, now);
    await setPolicy(tenant, "self_hosted_preferred");
    const managedIdentityId = await createManagedIdentity("preferred-ineligible", now);
    await createSelfHostedRunner(tenant, "preferred-ineligible", now, ["other/repository"]);

    try {
      expect((await managedClaim(now, managedIdentityId, "preferred-ineligible")).status).toBe("claimed");
    } finally {
      await cleanup([tenant], [managedIdentityId]);
    }
  });

  it("blocks both worker classes when execution is disabled", async () => {
    const now = testTime(2800);
    const tenant = await createTenant("disabled");
    await createQueuedRun(tenant, now);
    await setPolicy(tenant, "disabled");
    const managedIdentityId = await createManagedIdentity("disabled", now);
    const runnerId = await createSelfHostedRunner(tenant, "disabled", now, []);

    try {
      expect(await managedClaim(now, managedIdentityId, "disabled-managed")).toEqual({
        status: "empty",
        retryAfterSeconds: 15,
      });
      expect(await selfHostedClaim(now, runnerId, "disabled-self")).toEqual({
        status: "empty",
        retryAfterSeconds: 15,
      });
    } finally {
      await cleanup([tenant], [managedIdentityId]);
    }
  });
});
