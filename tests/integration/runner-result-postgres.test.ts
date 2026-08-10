import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleResultRequest, type ResultRouteDependencies } from "../../apps/web/app/api/v1/runs/result/route.js";
import { createSqlAuditLogStore } from "../../packages/db/src/audit-log-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlRunnerArtifactStore } from "../../packages/db/src/runner-artifact-store.js";
import { createSqlRunnerLeaseStore } from "../../packages/db/src/runner-lease-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 1 }) : undefined;
const installationId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const attemptId = "44444444-4444-4444-8444-444444444444";
const replacedArtifactId = "55555555-5555-4555-8555-555555555555";
const reusedArtifactId = "66666666-6666-4666-8666-666666666666";
const siblingRunId = "77777777-7777-4777-8777-777777777777";
const sharedArtifactId = "88888888-8888-4888-8888-888888888888";
const siblingArtifactId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const completedAt = "2026-07-12T12:00:00.000Z";

type QueryRow = Record<string, unknown>;

function rows(result: unknown): QueryRow[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as QueryRow[]) : [];
}

const dependencies: ResultRouteDependencies = {
  queryExecutor: () => executor,
  checkRunClient: () => undefined,
  detailsUrl: (id) => `https://boardreadyops.test/runs/${id}`,
  now: () => new Date(completedAt),
  verifyOidcToken: async (_token, expectedRunId, expectedAttemptId) =>
    expectedRunId === runId && expectedAttemptId === attemptId,
};

function callbackRequest(overrides: Record<string, unknown> = {}): Request {
  const url = new URL("https://boardreadyops.test/api/v1/runs/result");
  url.searchParams.set("run_id", runId);
  url.searchParams.set("attempt_id", attemptId);
  return new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer header.payload.signature", "content-type": "application/json" },
    body: JSON.stringify({
      version: 1,
      executionAttemptId: attemptId,
      status: "completed",
      conclusion: "failure",
      decision: "fail",
      findings: [
        {
          ruleId: "bom.missing-mpn",
          severity: "high",
          message: "A production part is missing its MPN.",
          path: "board.kicad_sch",
        },
      ],
      artifacts: [
        {
          kind: "html-report",
          name: "boardreadyops-report.html",
          storagePath: "runs/33333333-3333-4333-8333-333333333333/report.html",
          sha256: "a".repeat(64),
          bytes: 2048,
          role: "report",
        },
      ],
      metrics: { durationMs: 1250, readinessScore: 82 },
      reportLinks: [{ label: "HTML report", url: "https://reports.example.test/run-123/index.html" }],
      readiness: {
        score: 82,
        status: "blocked",
        blocking: 1,
        nonBlocking: 0,
        missingRequired: ["bom"],
        missingRecommended: [],
        warnings: ["A production finding blocks release."],
      },
      waivers: {
        active: [
          {
            rule: "bom.lifecycle",
            owner: "hardware-team",
            reason: "Prototype-only risk acceptance.",
            approvedBy: "release-manager",
            evidence: "internal-review-record",
            stale: true,
            expired: false,
            matched: 0,
          },
        ],
        expired: [
          {
            rule: "bom.missing-mpn",
            owner: "hardware-team",
            reason: "Expired exception.",
            expires: "2026-07-01",
            stale: false,
            expired: true,
            matched: 1,
          },
        ],
      },
      ...overrides,
    }),
  });
}

beforeAll(async () => {
  if (!executor) return;
  await executor.query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, 12345, 'octo-org', 'Organization')`,
    [installationId],
  );
  await executor.query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
     values ($1, $2, 67890, 'octo-org', 'hardware-board', 'main')`,
    [repositoryId, installationId],
  );
  await executor.query(
    `insert into release_runs (
       id, repository_id, commit_sha, ref, trigger_kind, status,
       execution_attempt_id, execution_attempt_started_at, started_at
     ) values ($1, $2, $3, 'refs/pull/42/head', 'pr', 'running', $4, $5::timestamptz, $5::timestamptz)`,
    [runId, repositoryId, "0123456789abcdef0123456789abcdef01234567", attemptId, "2026-07-12T11:59:58.750Z"],
  );
  await executor.query(
    `insert into release_runs (
       id, repository_id, commit_sha, ref, trigger_kind, status, started_at, completed_at
     ) values ($1, $2, $3, 'refs/heads/main', 'push', 'completed', $4::timestamptz, $4::timestamptz)`,
    [siblingRunId, repositoryId, "89abcdef0123456789abcdef0123456789abcdef", "2026-07-12T11:00:00.000Z"],
  );
  await executor.query(
    `insert into release_run_attempts (
       id, run_id, attempt_number, status, created_at, dispatch_requested_at, dispatched_at, started_at
     ) values ($1, $2, 1, 'in_progress', $3::timestamptz, $3::timestamptz, $3::timestamptz, $3::timestamptz)`,
    [attemptId, runId, "2026-07-12T11:59:58.750Z"],
  );
  await executor.query(
    `insert into artifacts (id, run_id, kind, name, storage_path, sha256, bytes, role)
     values ($1, $2, 'legacy-report', 'private-customer-report.html',
             'private/tenant/run/report.html', $3, 1024, 'legacy'),
            ($4, $2, 'html-report', 'old-report.html',
             'runs/33333333-3333-4333-8333-333333333333/report.html', $5, 1536, 'report'),
            ($6, $2, 'evidence', 'shared-current.bin',
             'shared/cross-run.bin', $7, 512, 'evidence'),
            ($8, $9, 'evidence', 'shared-sibling.bin',
             'shared/cross-run.bin', $10, 512, 'evidence')`,
    [
      replacedArtifactId,
      runId,
      "c".repeat(64),
      reusedArtifactId,
      "d".repeat(64),
      sharedArtifactId,
      "e".repeat(64),
      siblingArtifactId,
      siblingRunId,
      "f".repeat(64),
    ],
  );
});

afterAll(async () => {
  if (!executor) return;
  await executor.query("delete from installations where id = $1", [installationId]);
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function opaqueToken(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function secondsAfter(base: Date, seconds: number): Date {
  return new Date(base.valueOf() + seconds * 1000);
}

type LeaseBoundArtifactFixture = {
  base: Date;
  installationId: string;
  managedIdentityId: string;
  runId: string;
  attemptId: string;
  leaseId: string;
  artifactId: string;
  artifact: {
    kind: string;
    name: string;
    storagePath: string;
    sha256: string;
    bytes: number;
    role: string;
  };
};

async function setupLeaseBoundArtifact(label: string): Promise<LeaseBoundArtifactFixture> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const base = new Date(Date.now() + 60_000);
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const runId = randomUUID();
  const attemptId = randomUUID();
  const leaseId = randomUUID();
  const artifactId = randomUUID();
  const managedIdentityId = randomUUID();
  const leaseToken = opaqueToken(`lease:${label}`);
  const uploadToken = opaqueToken(`upload:${label}`);
  const artifactSha256 = sha256(`artifact:${label}`);
  const githubSeed = Number.parseInt(sha256(label).slice(0, 12), 16);
  const owner = `artifact-${label}`.slice(0, 39);
  const name = `board-${label}`.slice(0, 100);

  await executor.query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, $3, 'Organization')`,
    [installationId, githubSeed, owner],
  );
  await executor.query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
     values ($1, $2, $3, $4, $5, true, 'main')`,
    [repositoryId, installationId, githubSeed + 1, owner, name],
  );
  await executor.query(
    `insert into release_runs (
       id, repository_id, commit_sha, ref, pull_request_number, trigger_kind, status, started_at
     ) values ($1, $2, $3, 'refs/pull/26/head', 26, 'pr', 'queued', $4::timestamptz)`,
    [runId, repositoryId, sha256(runId).slice(0, 40), base.toISOString()],
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
      sha256(managedIdentityId),
      JSON.stringify(["kicad:10"]),
      base.toISOString(),
    ],
  );

  const generatedIds = [attemptId, leaseId];
  const claimed = await createSqlRunnerLeaseStore(executor, {
    now: () => base,
    id: () => generatedIds.shift() ?? randomUUID(),
    leaseToken: () => leaseToken,
    leaseDurationSeconds: 120,
    maximumLeaseDurationSeconds: 600,
  }).claimJob({
    workerClass: "managed",
    managedRunnerIdentityId: managedIdentityId,
    requestTimestamp: Math.floor(base.valueOf() / 1000),
    requestNonce: opaqueToken(`claim:${label}`),
    capabilities: ["kicad:10"],
  });
  if (claimed.status !== "claimed" || claimed.runId !== runId) {
    throw new Error(`expected lease-bound artifact fixture claim, received ${claimed.status}`);
  }

  const artifactStore = createSqlRunnerArtifactStore(executor, {
    now: () => secondsAfter(base, 10),
    id: () => artifactId,
    uploadToken: () => uploadToken,
  });
  const issued = await artifactStore.issueCapabilities({
    workerClass: "managed",
    managedRunnerIdentityId: managedIdentityId,
    requestTimestamp: Math.floor(secondsAfter(base, 10).valueOf() / 1000),
    requestNonce: opaqueToken(`artifact:${label}`),
    runId,
    executionAttemptId: attemptId,
    leaseId,
    leaseToken,
    artifacts: [
      {
        kind: "report/json",
        name: "boardreadyops-result.json",
        role: "primary",
        bytes: 2048,
        sha256: artifactSha256,
      },
    ],
  });
  if (issued.status !== "accepted" || issued.uploads.length !== 1) {
    throw new Error(`expected artifact capability, received ${issued.status}`);
  }
  const upload = issued.uploads[0];
  if (!upload) throw new Error("artifact upload capability is missing");
  const begun = await artifactStore.beginUpload({ artifactId, uploadToken: upload.uploadToken });
  if (begun.status !== "accepted") throw new Error(`expected artifact upload begin, received ${begun.status}`);
  const completed = await artifactStore.completeUpload({
    artifactId,
    uploadToken: upload.uploadToken,
    sha256: artifactSha256,
    bytes: 2048,
  });
  if (completed.status !== "accepted") {
    throw new Error(`expected artifact upload completion, received ${completed.status}`);
  }

  return {
    base,
    installationId,
    managedIdentityId,
    runId,
    attemptId,
    leaseId,
    artifactId,
    artifact: {
      kind: "report/json",
      name: "boardreadyops-result.json",
      storagePath: upload.storagePath,
      sha256: artifactSha256,
      bytes: 2048,
      role: "primary",
    },
  };
}

async function cleanupLeaseBoundArtifact(fixture: LeaseBoundArtifactFixture): Promise<void> {
  if (!executor) return;
  await executor.query("delete from installations where id = $1", [fixture.installationId]);
  await executor.query("delete from managed_runner_identities where id = $1", [fixture.managedIdentityId]);
}

function leaseBoundResultRequest(
  fixture: LeaseBoundArtifactFixture,
  artifact: LeaseBoundArtifactFixture["artifact"],
): Request {
  const url = new URL("https://boardreadyops.internal/api/v1/runs/result");
  url.searchParams.set("run_id", fixture.runId);
  url.searchParams.set("attempt_id", fixture.attemptId);
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      version: 1,
      executionAttemptId: fixture.attemptId,
      status: "completed",
      decision: "pass",
      findings: [],
      artifacts: [artifact],
      metrics: {},
      reportLinks: [],
    }),
  });
}

describeDatabase("runner result PostgreSQL integration", () => {
  it("rejects lease-bound terminal artifact metadata that diverges from the verified upload", async () => {
    if (!executor) throw new Error("DATABASE_URL is required");
    const fixture = await setupLeaseBoundArtifact("result-integrity-mismatch");

    try {
      const response = await handleResultRequest(
        leaseBoundResultRequest(fixture, { ...fixture.artifact, sha256: "b".repeat(64) }),
        {
          ...dependencies,
          authenticationVerified: true,
          verifiedLeaseId: fixture.leaseId,
          now: () => secondsAfter(fixture.base, 20),
        },
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: "runner artifact metadata does not match verified uploads",
        runId: fixture.runId,
        executionAttemptId: fixture.attemptId,
      });

      const state = rows(
        await executor.query(
          `select release_runs.status,
                  (select count(*)::int from release_run_results where run_id = $1) as result_count,
                  artifacts.id as artifact_id,
                  artifacts.sha256,
                  artifacts.bytes
             from release_runs
             join artifacts on artifacts.run_id = release_runs.id
            where release_runs.id = $1`,
          [fixture.runId],
        ),
      );
      expect(state).toEqual([
        {
          status: "running",
          result_count: 0,
          artifact_id: fixture.artifactId,
          sha256: fixture.artifact.sha256,
          bytes: fixture.artifact.bytes,
        },
      ]);
    } finally {
      await cleanupLeaseBoundArtifact(fixture);
    }
  });

  it("retains the authoritative upload record for an exact lease-bound terminal artifact", async () => {
    if (!executor) throw new Error("DATABASE_URL is required");
    const fixture = await setupLeaseBoundArtifact("result-integrity-match");

    try {
      const response = await handleResultRequest(leaseBoundResultRequest(fixture, fixture.artifact), {
        ...dependencies,
        authenticationVerified: true,
        verifiedLeaseId: fixture.leaseId,
        now: () => secondsAfter(fixture.base, 20),
      });

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({ ok: true, status: "accepted", runId: fixture.runId });
      const artifactRows = rows(
        await executor.query(
          `select id, kind, name, storage_path, sha256, bytes, role
             from artifacts
            where run_id = $1`,
          [fixture.runId],
        ),
      );
      expect(artifactRows).toEqual([
        {
          id: fixture.artifactId,
          kind: fixture.artifact.kind,
          name: fixture.artifact.name,
          storage_path: fixture.artifact.storagePath,
          sha256: fixture.artifact.sha256,
          bytes: fixture.artifact.bytes,
          role: fixture.artifact.role,
        },
      ]);
    } finally {
      await cleanupLeaseBoundArtifact(fixture);
    }
  });

  it("persists the versioned result atomically and accepts exact replay", async () => {
    if (!executor) throw new Error("DATABASE_URL is required");
    const accepted = await handleResultRequest(callbackRequest(), dependencies);
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({ ok: true, status: "accepted", runId });

    const replayed = await handleResultRequest(callbackRequest(), dependencies);
    expect(replayed.status).toBe(200);
    await expect(replayed.json()).resolves.toMatchObject({ ok: true, status: "replayed", runId });

    const conflicting = await handleResultRequest(
      callbackRequest({ status: "failed", decision: "error", findings: [] }),
      dependencies,
    );
    expect(conflicting.status).toBe(409);
    await expect(conflicting.json()).resolves.toMatchObject({
      ok: false,
      error: "terminal result conflicts with the persisted result",
      runId,
      executionAttemptId: attemptId,
    });

    const runRows = rows(
      await executor.query(
        `select status, version::int as version, decision, completed_at, duration_ms, terminal_result_digest
       from release_runs where id = $1`,
        [runId],
      ),
    );
    expect(runRows).toEqual([
      expect.objectContaining({
        status: "completed",
        version: 1,
        decision: "fail",
        completed_at: new Date(completedAt),
        duration_ms: 1250,
        terminal_result_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    ]);

    const attemptRows = rows(
      await executor.query(
        `select status, version::int as version, completed_at, result_digest
           from release_run_attempts
          where id = $1`,
        [attemptId],
      ),
    );
    expect(attemptRows).toEqual([
      expect.objectContaining({
        status: "completed",
        version: 1,
        completed_at: new Date(completedAt),
        result_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    ]);

    const transitionRows = rows(
      await executor.query(
        `select entity_type, from_status, to_status, from_version::int, to_version::int, reason_code
           from release_run_transition_events
          where release_run_id = $1
          order by entity_type`,
        [runId],
      ),
    );
    expect(transitionRows).toEqual([
      {
        entity_type: "execution_attempt",
        from_status: "in_progress",
        to_status: "completed",
        from_version: 0,
        to_version: 1,
        reason_code: "runner_result_completed",
      },
      {
        entity_type: "release_run",
        from_status: "running",
        to_status: "completed",
        from_version: 0,
        to_version: 1,
        reason_code: "runner_result_completed",
      },
    ]);

    const resultRows = rows(
      await executor.query(
        `select contract_version, status, conclusion, decision, metrics, report_links,
              result_digest, last_publication_attempt_at, last_publication_error
       from release_run_results where run_id = $1`,
        [runId],
      ),
    );
    expect(resultRows).toEqual([
      expect.objectContaining({
        contract_version: 1,
        status: "completed",
        conclusion: "failure",
        decision: "fail",
        metrics: { durationMs: 1250, readinessScore: 82 },
        report_links: [{ label: "HTML report", url: "https://reports.example.test/run-123/index.html" }],
        result_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        last_publication_attempt_at: new Date(completedAt),
        last_publication_error: null,
      }),
    ]);

    const childRows = rows(
      await executor.query(
        `select
         (select count(*)::int from findings where run_id = $1) as findings,
         (select count(*)::int from artifacts where run_id = $1) as artifacts,
         (select count(*)::int from artifacts where id = $2) as replaced_artifacts,
         (select count(*)::int from artifacts where id = $3) as reused_artifacts,
         (select count(*)::int from artifact_deletion_jobs where artifact_id = $2) as artifact_deletion_jobs,
         (select count(*)::int from artifact_deletion_jobs where artifact_id = $3) as reused_artifact_deletion_jobs,
         (select count(*)::int from artifact_deletion_jobs where artifact_id = $4) as shared_artifact_deletion_jobs,
         (select count(*)::int from artifacts where id = $5 and run_id = $6) as sibling_shared_artifacts`,
        [runId, replacedArtifactId, reusedArtifactId, sharedArtifactId, siblingArtifactId, siblingRunId],
      ),
    );
    expect(childRows).toEqual([
      {
        findings: 1,
        artifacts: 1,
        replaced_artifacts: 0,
        reused_artifacts: 0,
        artifact_deletion_jobs: 1,
        reused_artifact_deletion_jobs: 0,
        shared_artifact_deletion_jobs: 0,
        sibling_shared_artifacts: 1,
      },
    ]);

    const auditRows = rows(
      await executor.query(
        `select event_type, subject_id, artifact_id, metadata
           from audit_events
          where release_run_id = $1
          order by created_at, id`,
        [runId],
      ),
    );
    expect(auditRows.map((row) => row.event_type).sort()).toEqual([
      "artifact.object.deletion_skipped",
      "artifact.object.deletion_skipped",
      "artifact.record.deleted",
      "artifact.record.deleted",
      "artifact.record.deleted",
      "runner.result.persisted",
      "runner.result.publication_succeeded",
      "runner.result.publication_succeeded",
    ]);
    const persistedAudit = auditRows.find((row) => row.event_type === "runner.result.persisted");
    expect(persistedAudit?.metadata).toMatchObject({
      decisionSummaryVersion: 1,
      decision: "fail",
      conclusion: "failure",
      githubCheckConclusion: "failure",
      readinessReported: true,
      readinessStatus: "blocked",
      readinessScore: 82,
      blockingCount: 1,
      nonBlockingCount: 0,
      missingRequiredCount: 1,
      missingRecommendedCount: 0,
      warningCount: 1,
      waiversReported: true,
      activeWaiverCount: 1,
      expiredWaiverCount: 1,
      staleWaiverCount: 1,
      findingCount: 1,
      artifactCount: 1,
      artifactDeletionJobCount: 1,
      artifactDeletionSkippedCount: 2,
    });
    expect(JSON.stringify(persistedAudit?.metadata)).not.toContain("hardware-team");
    expect(JSON.stringify(persistedAudit?.metadata)).not.toContain("Prototype-only");
    expect(JSON.stringify(persistedAudit?.metadata)).not.toContain("internal-review-record");

    const deletionAudit = auditRows.find(
      (row) => row.event_type === "artifact.record.deleted" && row.subject_id === replacedArtifactId,
    );
    expect(deletionAudit).toMatchObject({
      subject_id: replacedArtifactId,
      artifact_id: null,
      metadata: {
        reason: "result_replaced",
        resultDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        executionAttemptId: attemptId,
        bytes: 1024,
        sha256: "c".repeat(64),
        itemType: "legacy-report",
        scope: "legacy",
      },
    });
    expect(JSON.stringify(deletionAudit)).not.toContain("private-customer-report.html");
    expect(JSON.stringify(deletionAudit)).not.toContain("private/tenant/run/report.html");

    const skippedDeletionAudit = auditRows.find(
      (row) => row.event_type === "artifact.object.deletion_skipped" && row.subject_id === reusedArtifactId,
    );
    expect(skippedDeletionAudit).toMatchObject({
      subject_id: reusedArtifactId,
      artifact_id: null,
      metadata: {
        reason: "storage_path_still_referenced",
        resultDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        executionAttemptId: attemptId,
        bytes: 1536,
        sha256: "d".repeat(64),
        itemType: "html-report",
        scope: "report",
      },
    });
    expect(JSON.stringify(skippedDeletionAudit)).not.toContain("runs/33333333-3333-4333-8333-333333333333/report.html");

    const sharedDeletionAudit = auditRows.find(
      (row) => row.event_type === "artifact.object.deletion_skipped" && row.subject_id === sharedArtifactId,
    );
    expect(sharedDeletionAudit).toMatchObject({
      subject_id: sharedArtifactId,
      artifact_id: null,
      metadata: expect.objectContaining({
        reason: "storage_path_still_referenced",
        sha256: "e".repeat(64),
        itemType: "evidence",
        scope: "evidence",
      }),
    });
    expect(JSON.stringify(sharedDeletionAudit)).not.toContain("shared/cross-run.bin");

    const deletionJobRows = rows(
      await executor.query(
        `select artifact_id, installation_id, repository_id, release_run_id, storage_driver,
                storage_path, deletion_reason, artifact_kind, artifact_role, artifact_sha256, artifact_bytes, status
           from artifact_deletion_jobs where artifact_id = $1`,
        [replacedArtifactId],
      ),
    );
    expect(deletionJobRows).toEqual([
      {
        artifact_id: replacedArtifactId,
        installation_id: installationId,
        repository_id: repositoryId,
        release_run_id: runId,
        storage_driver: "local",
        storage_path: "private/tenant/run/report.html",
        deletion_reason: "result_replaced",
        artifact_kind: "legacy-report",
        artifact_role: "legacy",
        artifact_sha256: "c".repeat(64),
        artifact_bytes: 1024,
        status: "available",
      },
    ]);

    const exportedDeletion = await createSqlAuditLogStore(executor).listAuditEvents({
      installationId,
      releaseRunId: runId,
      eventType: "artifact.record.deleted",
    });
    expect(exportedDeletion).toHaveLength(3);
    const exportedReplacedDeletion = exportedDeletion.find((event) => event.subjectId === replacedArtifactId);
    expect(exportedReplacedDeletion).toEqual(
      expect.objectContaining({
        installationId,
        repositoryId,
        releaseRunId: runId,
        eventType: "artifact.record.deleted",
        actorType: "runner",
        actorId: attemptId,
        subjectType: "artifact",
        subjectId: replacedArtifactId,
        metadata: {
          reason: "result_replaced",
          resultDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
          executionAttemptId: attemptId,
          bytes: 1024,
          sha256: "c".repeat(64),
          itemType: "legacy-report",
          scope: "legacy",
        },
      }),
    );
    expect(exportedReplacedDeletion).not.toHaveProperty("artifactId");

    const exportedDecision = await createSqlAuditLogStore(executor).listAuditEvents({
      installationId,
      releaseRunId: runId,
      eventType: "runner.result.persisted",
    });
    expect(exportedDecision).toEqual([
      expect.objectContaining({
        installationId,
        repositoryId,
        releaseRunId: runId,
        eventType: "runner.result.persisted",
        metadata: expect.objectContaining({
          decisionSummaryVersion: 1,
          decision: "fail",
          conclusion: "failure",
          githubCheckConclusion: "failure",
          readinessStatus: "blocked",
          readinessScore: 82,
          activeWaiverCount: 1,
          expiredWaiverCount: 1,
          staleWaiverCount: 1,
        }),
      }),
    ]);

    await expect(executor.query("delete from audit_events where release_run_id = $1", [runId])).rejects.toThrow(
      "audit_events is append-only",
    );
    await executor.query("delete from installations where id = $1", [installationId]);
    const remainingRows = rows(
      await executor.query(
        `select
           (select count(*)::int from installations where id = $1) as installations,
           (select count(*)::int from repositories where id = $2) as repositories,
           (select count(*)::int from release_runs where id = $3) as runs,
           (select count(*)::int from audit_events where release_run_id = $3) as audit_events`,
        [installationId, repositoryId, runId],
      ),
    );
    expect(remainingRows).toEqual([{ installations: 0, repositories: 0, runs: 0, audit_events: 0 }]);
  });
  it("fails closed on stale runner-result run and attempt versions without metadata or events", async () => {
    if (!executor) throw new Error("DATABASE_URL is required");
    const staleInstallationId = "99999999-9999-4999-8999-999999999991";
    const staleRepositoryId = "99999999-9999-4999-8999-999999999992";
    const staleRunId = "99999999-9999-4999-8999-999999999993";
    const staleAttemptId = "99999999-9999-4999-8999-999999999994";
    const digest = "b".repeat(64);

    await executor.query("delete from installations where id = $1", [staleInstallationId]);
    await executor.query(
      `insert into installations (id, github_installation_id, account_login, account_type)
       values ($1, 33333, 'stale-org', 'Organization')`,
      [staleInstallationId],
    );
    await executor.query(
      `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
       values ($1, $2, 33334, 'stale-org', 'stale-board', 'main')`,
      [staleRepositoryId, staleInstallationId],
    );
    await executor.query(
      `insert into release_runs (
         id, repository_id, commit_sha, ref, trigger_kind, status,
         execution_attempt_id, execution_attempt_started_at, started_at
       ) values ($1, $2, $3, 'refs/heads/main', 'manual', 'running', $4, $5::timestamptz, $5::timestamptz)`,
      [staleRunId, staleRepositoryId, "3".repeat(40), staleAttemptId, "2026-07-12T13:00:00.000Z"],
    );
    await executor.query(
      `insert into release_run_attempts (
         id, run_id, attempt_number, status, created_at, dispatch_requested_at, dispatched_at, started_at
       ) values ($1, $2, 1, 'in_progress', $3::timestamptz, $3::timestamptz, $3::timestamptz, $3::timestamptz)`,
      [staleAttemptId, staleRunId, "2026-07-12T13:00:00.000Z"],
    );

    const staleRun = rows(
      await executor.query(
        `select * from boardreadyops_apply_runner_result_state(
           $1, true, 'running', 1, $2, 'in_progress', 0,
           'completed', 'pass', $3::timestamptz, $4, $4
         )`,
        [staleRunId, staleAttemptId, "2026-07-12T13:01:00.000Z", digest],
      ),
    );
    expect(staleRun[0]?.transition_outcome).toBe("stale");

    const staleAttempt = rows(
      await executor.query(
        `select * from boardreadyops_apply_runner_result_state(
           $1, true, 'running', 0, $2, 'in_progress', 1,
           'completed', 'pass', $3::timestamptz, $4, $4
         )`,
        [staleRunId, staleAttemptId, "2026-07-12T13:01:00.000Z", digest],
      ),
    );
    expect(staleAttempt[0]?.transition_outcome).toBe("stale");

    expect(
      rows(
        await executor.query(
          `select release_runs.status as run_status,
                  release_runs.version::int as run_version,
                  release_runs.decision,
                  release_run_attempts.status as attempt_status,
                  release_run_attempts.version::int as attempt_version,
                  release_run_attempts.result_digest,
                  (select count(*)::int from release_run_transition_events where release_run_id = $1) as events
             from release_runs
             join release_run_attempts on release_run_attempts.id = release_runs.execution_attempt_id
            where release_runs.id = $1`,
          [staleRunId],
        ),
      )[0],
    ).toEqual({
      run_status: "running",
      run_version: 0,
      decision: null,
      attempt_status: "in_progress",
      attempt_version: 0,
      result_digest: null,
      events: 0,
    });

    await executor.query("delete from installations where id = $1", [staleInstallationId]);
  });

  it("maps running and no-attempt callbacks while emitting events only for changed entities", async () => {
    if (!executor) throw new Error("DATABASE_URL is required");
    const progressInstallationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const progressRepositoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    const progressRunId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
    const progressAttemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
    const noAttemptRunId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
    const digest = "c".repeat(64);

    await executor.query("delete from installations where id = $1", [progressInstallationId]);
    await executor.query(
      `insert into installations (id, github_installation_id, account_login, account_type)
       values ($1, 44444, 'progress-org', 'Organization')`,
      [progressInstallationId],
    );
    await executor.query(
      `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
       values ($1, $2, 44445, 'progress-org', 'progress-board', 'main')`,
      [progressRepositoryId, progressInstallationId],
    );
    await executor.query(
      `insert into release_runs (
         id, repository_id, commit_sha, ref, trigger_kind, status,
         execution_attempt_id, execution_attempt_started_at, started_at
       ) values
         ($1, $3, $4, 'refs/heads/main', 'manual', 'dispatched', $2, $6::timestamptz, $6::timestamptz),
         ($5, $3, $7, 'refs/heads/main', 'manual', 'queued', null, null, $6::timestamptz)`,
      [
        progressRunId,
        progressAttemptId,
        progressRepositoryId,
        "4".repeat(40),
        noAttemptRunId,
        "2026-07-12T14:00:00.000Z",
        "5".repeat(40),
      ],
    );
    await executor.query(
      `insert into release_run_attempts (
         id, run_id, attempt_number, status, created_at, dispatch_requested_at, dispatched_at
       ) values ($1, $2, 1, 'dispatching', $3::timestamptz, $3::timestamptz, $3::timestamptz)`,
      [progressAttemptId, progressRunId, "2026-07-12T14:00:00.000Z"],
    );

    const progress = rows(
      await executor.query(
        `select transition_outcome,
                run_status,
                run_version::int as run_version,
                attempt_status,
                attempt_version::int as attempt_version,
                run_changed,
                attempt_changed
           from boardreadyops_apply_runner_result_state(
             $1, true, 'dispatched', 0, $2, 'dispatching', 0,
             'running', null, $3::timestamptz, null, $4
           )`,
        [progressRunId, progressAttemptId, "2026-07-12T14:01:00.000Z", digest],
      ),
    );
    expect(progress[0]).toMatchObject({
      transition_outcome: "applied",
      run_status: "running",
      run_version: 1,
      attempt_status: "in_progress",
      attempt_version: 1,
      run_changed: true,
      attempt_changed: true,
    });

    const noAttempt = rows(
      await executor.query(
        `select transition_outcome,
                run_status,
                run_version::int as run_version,
                attempt_status,
                attempt_version::int as attempt_version,
                run_changed,
                attempt_changed
           from boardreadyops_apply_runner_result_state(
             $1, true, 'queued', 0, null, null, null,
             'running', null, $2::timestamptz, null, $3
           )`,
        [noAttemptRunId, "2026-07-12T14:01:00.000Z", digest],
      ),
    );
    expect(noAttempt[0]).toMatchObject({
      transition_outcome: "applied",
      run_status: "running",
      run_version: 1,
      attempt_status: null,
      attempt_version: null,
      run_changed: true,
      attempt_changed: false,
    });

    expect(
      rows(
        await executor.query(
          `select release_run_id, entity_type, from_status, to_status, reason_code
             from release_run_transition_events
            where release_run_id = any($1::text[])
            order by release_run_id, entity_type`,
          [[progressRunId, noAttemptRunId]],
        ),
      ),
    ).toEqual([
      {
        release_run_id: progressRunId,
        entity_type: "execution_attempt",
        from_status: "dispatching",
        to_status: "in_progress",
        reason_code: "runner_result_running",
      },
      {
        release_run_id: progressRunId,
        entity_type: "release_run",
        from_status: "dispatched",
        to_status: "running",
        reason_code: "runner_result_running",
      },
      {
        release_run_id: noAttemptRunId,
        entity_type: "release_run",
        from_status: "queued",
        to_status: "running",
        reason_code: "runner_result_running",
      },
    ]);

    await executor.query("delete from installations where id = $1", [progressInstallationId]);
  });
});
