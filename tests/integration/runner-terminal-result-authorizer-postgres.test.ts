import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlRunnerLeaseStore } from "../../packages/db/src/runner-lease-store.js";
import { createSqlRunnerTerminalResultAuthorizer } from "../../packages/db/src/runner-terminal-result-store.js";

const connectionString = process.env.DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 8 }) : undefined;
let githubIdentifier = 990_000_000;

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function nonce(seed: string): string {
  return createHash("sha256").update(seed).digest("base64url");
}

function token(seed: string): string {
  return createHash("sha256").update(`terminal:${seed}`).digest("base64url");
}

function at(base: Date, seconds: number): Date {
  return new Date(base.valueOf() + seconds * 1000);
}

function requestTimestamp(value: Date): number {
  return Math.floor(value.valueOf() / 1000);
}

type Fixture = {
  base: Date;
  installationId: string;
  repositoryId: string;
  runId: string;
  managedIdentityId: string;
  attemptId: string;
  leaseId: string;
  leaseToken: string;
};

async function setup(label: string): Promise<Fixture> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const base = new Date(Date.now() + 60_000);
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const runId = randomUUID();
  const managedIdentityId = randomUUID();
  const attemptId = randomUUID();
  const leaseId = randomUUID();
  const leaseToken = token(label);
  const owner = `terminal-${label}`.slice(0, 39);
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
  await executor.query(
    `insert into release_runs (
       id, repository_id, commit_sha, ref, pull_request_number, trigger_kind, status, started_at
     ) values ($1, $2, $3, 'refs/pull/91/head', 91, 'pr', 'queued', $4::timestamptz)`,
    [runId, repositoryId, fingerprint(runId).slice(0, 40), base.toISOString()],
  );
  await executor.query(
    `insert into managed_runner_identities (
       id, name, public_key, public_key_fingerprint, capabilities, status,
       created_at, activated_at, last_heartbeat_at
     ) values (
       $1, $2, $3, $4, $5::jsonb, 'active',
       $6::timestamptz, $6::timestamptz, $6::timestamptz
     )`,
    [
      managedIdentityId,
      `managed-${label}-${managedIdentityId}`,
      "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA3333333333333333333333333333333333333333333=\n-----END PUBLIC KEY-----",
      fingerprint(managedIdentityId),
      JSON.stringify(["kicad:10"]),
      base.toISOString(),
    ],
  );

  const ids = [attemptId, leaseId];
  const claimed = await createSqlRunnerLeaseStore(executor, {
    now: () => base,
    id: () => ids.shift() ?? randomUUID(),
    leaseToken: () => leaseToken,
    leaseDurationSeconds: 120,
    maximumLeaseDurationSeconds: 600,
  }).claimJob({
    workerClass: "managed",
    managedRunnerIdentityId: managedIdentityId,
    requestTimestamp: requestTimestamp(base),
    requestNonce: nonce(`claim-${label}`),
    capabilities: ["kicad:10"],
  });
  if (claimed.status !== "claimed" || claimed.runId !== runId) {
    throw new Error(`expected claimed terminal-result test lease, received ${claimed.status}`);
  }

  return { base, installationId, repositoryId, runId, managedIdentityId, attemptId, leaseId, leaseToken };
}

async function cleanup(fixture: Fixture): Promise<void> {
  if (!executor) return;
  await executor.query("delete from installations where id = $1", [fixture.installationId]);
  await executor.query("delete from managed_runner_identities where id = $1", [fixture.managedIdentityId]);
}

function authorizer(now: Date) {
  if (!executor) throw new Error("DATABASE_URL is required");
  return createSqlRunnerTerminalResultAuthorizer(executor, { now: () => now });
}

function input(fixture: Fixture, requestBody: string, requestNonce: string) {
  const requestAt = at(fixture.base, 10);
  return {
    workerClass: "managed" as const,
    managedRunnerIdentityId: fixture.managedIdentityId,
    requestTimestamp: requestTimestamp(requestAt),
    requestNonce,
    runId: fixture.runId,
    executionAttemptId: fixture.attemptId,
    leaseId: fixture.leaseId,
    leaseToken: fixture.leaseToken,
    requestBody,
  };
}

afterAll(async () => {
  if (!executor) return;
  await executor.query("delete from installations where account_login like 'terminal-terminal-test-%'");
  await executor.query("delete from managed_runner_identities where name like 'managed-terminal-test-%'");
});

describeDatabase("runner terminal-result PostgreSQL authorization", () => {
  it("accepts a current lease, permits exact retry, and rejects nonce reuse with another body", async () => {
    const fixture = await setup("terminal-test-replay");
    const requestAt = at(fixture.base, 10);
    const store = authorizer(requestAt);
    const requestNonce = nonce("terminal-result-replay");
    const firstBody = JSON.stringify({ protocolVersion: 1, result: { status: "completed", decision: "pass" } });
    const changedBody = JSON.stringify({ protocolVersion: 1, result: { status: "failed", decision: "error" } });

    try {
      await expect(store.authorize(input(fixture, firstBody, requestNonce))).resolves.toEqual({ status: "accepted" });
      await expect(store.authorize(input(fixture, firstBody, requestNonce))).resolves.toEqual({ status: "replayed" });
      await expect(store.authorize(input(fixture, changedBody, requestNonce))).resolves.toEqual({
        status: "conflicting_replay",
      });

      const nonceRows = await executor!.query(
        `select nonce_digest, request_digest
         from runner_request_nonces
         where runner_job_lease_id = $1 and request_digest is not null`,
        [fixture.leaseId],
      );
      const rows = (nonceRows as { rows: Array<Record<string, unknown>> }).rows;
      expect(rows).toEqual([
        {
          nonce_digest: fingerprint(requestNonce),
          request_digest: fingerprint(firstBody),
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain(requestNonce);
      expect(JSON.stringify(rows)).not.toContain(firstBody);
    } finally {
      await cleanup(fixture);
    }
  });

  it("rejects a wrong lease token without reserving the result nonce", async () => {
    const fixture = await setup("terminal-test-token");
    const requestAt = at(fixture.base, 10);
    const requestNonce = nonce("terminal-result-wrong-token");

    try {
      await expect(
        authorizer(requestAt).authorize({
          ...input(fixture, JSON.stringify({ result: "terminal" }), requestNonce),
          leaseToken: token("wrong-token"),
        }),
      ).resolves.toEqual({ status: "stale" });

      const count = await executor!.query(
        `select count(*)::int as count
         from runner_request_nonces
         where runner_job_lease_id = $1 and nonce_digest = $2`,
        [fixture.leaseId, fingerprint(requestNonce)],
      );
      expect((count as { rows: Array<{ count: number }> }).rows[0]?.count).toBe(0);
    } finally {
      await cleanup(fixture);
    }
  });

  it("rejects a lease after the logical run moves to another execution attempt", async () => {
    const fixture = await setup("terminal-test-stale");
    const replacementAttemptId = randomUUID();
    const movedAt = at(fixture.base, 20);

    try {
      await executor!.query(
        `insert into release_run_attempts (
           id, run_id, attempt_number, status, created_at, started_at, heartbeat_at
         ) values ($1, $2, 2, 'in_progress', $3::timestamptz, $3::timestamptz, $3::timestamptz)`,
        [replacementAttemptId, fixture.runId, movedAt.toISOString()],
      );
      await executor!.query(
        `update release_runs
         set execution_attempt_id = $1, execution_attempt_started_at = $2::timestamptz, status = 'running'
         where id = $3`,
        [replacementAttemptId, movedAt.toISOString(), fixture.runId],
      );

      await expect(
        authorizer(at(fixture.base, 30)).authorize(
          input(fixture, JSON.stringify({ result: "stale" }), nonce("terminal-result-stale")),
        ),
      ).resolves.toEqual({ status: "stale" });
    } finally {
      await cleanup(fixture);
    }
  });
});
