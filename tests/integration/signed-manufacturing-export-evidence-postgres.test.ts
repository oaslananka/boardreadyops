import { createHash, randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

afterAll(async () => {
  await executor?.close();
});

describeDatabase("signed manufacturing export evidence (PostgreSQL)", () => {
  it("persists immutable, tenant-scoped proof and distinguishes BoardReadyOps attempt from GitHub run_attempt", async () => {
    if (!executor) throw new Error("Disposable PostgreSQL executor is unavailable");
    const migration = await readFile(
      path.resolve("packages/db/migrations/0112_signed_manufacturing_export_evidence.sql"),
      "utf8",
    );
    await executor.query(migration);

    const installationId = randomUUID();
    const repositoryId = randomUUID();
    const runId = randomUUID();
    const executionAttemptId = randomUUID();
    const artifactId = randomUUID();
    const githubInstallationId = randomInt(1_000_000_000, 2_000_000_000);
    const githubRepositoryId = randomInt(1_000_000_000, 2_000_000_000);
    const githubRunId = String(randomInt(1_000_000_000, 2_000_000_000));
    const sourceSha = "a".repeat(40);
    const signerSha = "b".repeat(40);
    const archiveSha = createHash("sha256").update("signed manufacturing archive fixture").digest("hex");
    const manifestSha = createHash("sha256").update("signed manifest fixture").digest("hex");
    const bundleSha = createHash("sha256").update("signed bundle fixture").digest("hex");
    const now = "2026-11-03T00:00:00.000Z";

    try {
      await executor.query(
        "insert into installations (id, github_installation_id, account_login, account_type) values ($1, $2, $3, 'Organization')",
        [installationId, githubInstallationId, "signed-export-fixture"],
      );
      await executor.query(
        "insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch) " +
          "values ($1, $2, $3, $4, $5, true, 'main')",
        [repositoryId, installationId, githubRepositoryId, "signed-export-fixture", "hardware-board"],
      );
      await executor.query(
        "insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status, started_at, " +
          "execution_attempt_id, execution_attempt_started_at) " +
          "values ($1, $2, $3, 'refs/heads/main', 'push', 'running', $4::timestamptz, $5, $4::timestamptz)",
        [runId, repositoryId, sourceSha, now, executionAttemptId],
      );
      await executor.query(
        "insert into release_run_attempts (id, run_id, attempt_number, status, created_at, " +
          "dispatch_requested_at, dispatched_at, started_at, github_workflow_dispatch_id) " +
          "values ($1, $2, 2, 'in_progress', $3::timestamptz, $3::timestamptz, $3::timestamptz, $3::timestamptz, $4)",
        [executionAttemptId, runId, now, githubRunId],
      );

      const parameters = [
        now,
        runId,
        executionAttemptId,
        artifactId,
        `${runId}/${executionAttemptId}/${artifactId}.tar.gz`,
        archiveSha,
        512,
        sourceSha,
        signerSha,
        githubRepositoryId,
        githubRunId,
        1, // GitHub OIDC run_attempt, distinct from release_run_attempts.attempt_number (2).
        "refs/heads/main",
        ".github/workflows/readiness-runner.yml",
        manifestSha,
        bundleSha,
        29,
      ];
      const call =
        "select public.boardreadyops_record_signed_manufacturing_export(" +
        "$1::timestamptz, $2, $3, $4, $5, $6, $7::integer, $8, $9, $10::bigint, " +
        "$11, $12::integer, $13, $14, $15, $16, $17::integer) as outcome";
      const accepted = await executor.query(call, parameters);
      expect((accepted as { rows: Array<{ outcome: string }> }).rows[0]?.outcome).toBe("accepted");

      const evidence = await executor.query(
        "select evidence.run_id, evidence.execution_attempt_id, evidence.repository_id, " +
          "evidence.installation_id, evidence.github_run_id, evidence.run_attempt, " +
          "evidence.source_sha, evidence.signer_sha, evidence.subject_count, " +
          "artifact.role, artifact.kind, artifact.sha256, artifact.bytes " +
          "from signed_manufacturing_export_evidence as evidence " +
          "join artifacts as artifact on artifact.id = evidence.artifact_id " +
          "where evidence.run_id = $1",
        [runId],
      );
      expect((evidence as { rows: Array<Record<string, unknown>> }).rows[0]).toMatchObject({
        run_id: runId,
        execution_attempt_id: executionAttemptId,
        repository_id: repositoryId,
        installation_id: installationId,
        github_run_id: githubRunId,
        run_attempt: 1,
        source_sha: sourceSha,
        signer_sha: signerSha,
        subject_count: 29,
        role: "manufacturing",
        kind: "archive",
        sha256: archiveSha,
        bytes: 512,
      });

      const replay = await executor.query(call, parameters);
      expect((replay as { rows: Array<{ outcome: string }> }).rows[0]?.outcome).toBe("replayed");

      const rerunParameters = [...parameters];
      rerunParameters[11] = 2;
      const rerun = await executor.query(call, rerunParameters);
      expect((rerun as { rows: Array<{ outcome: string }> }).rows[0]?.outcome).toBe("stale");

      // A second BoardReadyOps execution attempt creates a fresh GitHub run.
      // Its GitHub OIDC run_attempt starts at 1 again; old proof must not make
      // this new current attempt look like a replay of the previous export.
      const nextAttemptId = randomUUID();
      const nextArtifactId = randomUUID();
      const nextGithubRunId = String(randomInt(1_000_000_000, 2_000_000_000));
      await executor.query(
        "insert into release_run_attempts (id, run_id, attempt_number, status, created_at, " +
          "dispatch_requested_at, dispatched_at, started_at, github_workflow_dispatch_id) " +
          "values ($1, $2, 3, 'in_progress', $3::timestamptz, $3::timestamptz, $3::timestamptz, $3::timestamptz, $4)",
        [nextAttemptId, runId, now, nextGithubRunId],
      );
      await executor.query(
        "update release_runs set status = 'running', completed_at = null, execution_attempt_id = $2, " +
          "execution_attempt_started_at = $3::timestamptz, terminal_result_digest = null where id = $1",
        [runId, nextAttemptId, now],
      );
      const nextParameters = [...parameters];
      nextParameters[2] = nextAttemptId;
      nextParameters[3] = nextArtifactId;
      nextParameters[4] = `${runId}/${nextAttemptId}/${nextArtifactId}.tar.gz`;
      nextParameters[10] = nextGithubRunId;
      expect(
        ((await executor.query(call, nextParameters)) as { rows: Array<{ outcome: string }> }).rows[0]?.outcome,
      ).toBe("accepted");

      await expect(
        executor.query("update signed_manufacturing_export_evidence set signer_sha = $2 where run_id = $1", [
          runId,
          "c".repeat(40),
        ]),
      ).rejects.toThrow(/immutable/u);
    } finally {
      await executor.query("delete from installations where id = $1", [installationId]);
    }
  });
});
