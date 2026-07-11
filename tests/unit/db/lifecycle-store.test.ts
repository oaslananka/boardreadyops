import { describe, expect, it } from "vitest";
import {
  createSqlGitHubAppLifecycleStore,
  parseReleaseRepositoryRolloutPolicy,
  releaseRepositoryRolloutEnvName,
  type SqlQueryExecutor,
} from "../../../packages/db/src/lifecycle-store.js";

const installation = {
  id: 12345,
  accountLogin: "octo-org",
  accountType: "Organization",
};

const repository = {
  id: 98765,
  owner: "octo-org",
  name: "hardware-board",
  fullName: "octo-org/hardware-board",
  private: true,
  defaultBranch: "main",
};

const enabledRepository = {
  id: 1283305324,
  owner: "oaslananka",
  name: "boardreadyops",
  fullName: "oaslananka/boardreadyops",
  private: false,
  defaultBranch: "main",
};

function recordingExecutor() {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const executor: SqlQueryExecutor = {
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("returning id")) {
        return { rows: [{ id: "run-row-id", github_check_run_id: null, status: "queued" }] };
      }

      return { rows: [] };
    },
  };

  return { calls, executor };
}

describe("SQL GitHub App lifecycle store", () => {
  it("documents the environment variable used for rollout opt-in", () => {
    expect(releaseRepositoryRolloutEnvName).toBe("BOARDREADYOPS_RELEASE_REPOSITORIES");
  });

  it("parses explicit release repository rollout lists", () => {
    expect(
      parseReleaseRepositoryRolloutPolicy(" Oaslananka/BoardReadyOps, octo-org/hardware-board invalid-token "),
    ).toEqual({
      repositories: ["oaslananka/boardreadyops", "octo-org/hardware-board"],
    });
  });

  it("requires an explicit all-repositories rollout token", () => {
    expect(parseReleaseRepositoryRolloutPolicy("all")).toEqual({ allowAllRepositories: true });
    expect(parseReleaseRepositoryRolloutPolicy("*")).toEqual({ allowAllRepositories: true });
    expect(parseReleaseRepositoryRolloutPolicy(undefined)).toEqual({ repositories: [] });
  });

  it("upserts installations into the mapped installations table", async () => {
    const { calls, executor } = recordingExecutor();
    const store = createSqlGitHubAppLifecycleStore(executor, {
      id: () => "installation-row-id",
      now: () => new Date("2026-07-04T00:00:00.000Z"),
    });

    await store.upsertInstallation({ type: "installation.upsert", installation });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("insert into installations");
    expect(calls[0]?.sql).toContain("on conflict (github_installation_id)");
    expect(calls[0]?.params).toEqual([
      "installation-row-id",
      12345,
      "octo-org",
      "Organization",
      "2026-07-04T00:00:00.000Z",
    ]);
  });

  it("upserts repositories under an installation", async () => {
    const { calls, executor } = recordingExecutor();
    const store = createSqlGitHubAppLifecycleStore(executor, {
      id: () => "repository-row-id",
      now: () => new Date("2026-07-04T00:00:00.000Z"),
    });

    await store.upsertRepository({ type: "repository.upsert", installation, repository });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("insert into repositories");
    expect(calls[0]?.sql).toContain("where github_installation_id = $1");
    expect(calls[0]?.sql).toContain("installation_id = excluded.installation_id");
    expect(calls[0]?.params).toEqual([
      12345,
      98765,
      "octo-org",
      "hardware-board",
      true,
      "main",
      "2026-07-04T00:00:00.000Z",
      "repository-row-id",
    ]);
  });

  it("enqueues release runs with an idempotency key for configured repositories", async () => {
    const { calls, executor } = recordingExecutor();
    const store = createSqlGitHubAppLifecycleStore(executor, {
      id: () => "run-row-id",
      now: () => new Date("2026-07-04T00:00:00.000Z"),
      releaseRepositoryRolloutPolicy: parseReleaseRepositoryRolloutPolicy("OASLANANKA/BOARDREADYOPS"),
    });

    const result = await store.enqueueReleaseRun({
      type: "release_run.enqueue",
      installation,
      repository: enabledRepository,
      pullRequestNumber: 42,
      ref: "feature/ready",
      commitSha: "0123456789abcdef",
      triggerKind: "pr",
    });

    expect(result).toMatchObject({ runId: "run-row-id", status: "queued" });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("set status = 'superseded'");
    expect(calls[0]?.sql).toContain("release_runs.status in ('queued', 'dispatched', 'running')");
    expect(calls[0]?.params).toEqual([1283305324, 42, "0123456789abcdef", "2026-07-04T00:00:00.000Z"]);
    expect(calls[1]?.sql).toContain("insert into release_runs");
    expect(calls[1]?.sql).toContain("on conflict (idempotency_key)");
    expect(calls[1]?.params).toEqual([
      1283305324,
      "0123456789abcdef",
      "feature/ready",
      42,
      "pr",
      "2026-07-04T00:00:00.000Z",
      12345,
      "run-row-id",
      "1283305324:42:0123456789abcdef",
    ]);
  });

  it("can explicitly roll out release runs to all installed repositories", async () => {
    const { calls, executor } = recordingExecutor();
    const store = createSqlGitHubAppLifecycleStore(executor, {
      id: () => "run-row-id",
      now: () => new Date("2026-07-04T00:00:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });

    const result = await store.enqueueReleaseRun({
      type: "release_run.enqueue",
      installation,
      repository,
      pullRequestNumber: 42,
      ref: "feature/ready",
      commitSha: "0123456789abcdef",
      triggerKind: "pr",
    });

    expect(result.runId).toBe("run-row-id");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("set status = 'superseded'");
    expect(calls[1]?.sql).toContain("insert into release_runs");
  });

  it("binds and marks the exact workflow execution attempt", async () => {
    const { calls, executor } = recordingExecutor();
    const store = createSqlGitHubAppLifecycleStore(executor);
    const executionAttemptId = "6ec0d9ac-a4e4-4dd3-9f91-777f43f1e801";

    await expect(
      store.bindReleaseRunExecutionAttempt({
        runId: "run-row-id",
        executionAttemptId,
        startedAt: "2026-07-11T15:00:00.000Z",
      }),
    ).resolves.toBe(true);
    await store.markReleaseRunDispatched({ runId: "run-row-id", executionAttemptId });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("execution_attempt_id = $2");
    expect(calls[0]?.sql).toContain("execution_attempt_started_at = $3::timestamptz");
    expect(calls[0]?.sql).toContain("status = 'queued'");
    expect(calls[0]?.params).toEqual(["run-row-id", executionAttemptId, "2026-07-11T15:00:00.000Z"]);
    expect(calls[1]?.sql).toContain("set status = 'dispatched'");
    expect(calls[1]?.sql).not.toContain("decision");
    expect(calls[1]?.sql).toContain("execution_attempt_id = $2");
    expect(calls[1]?.params).toEqual(["run-row-id", executionAttemptId]);
  });

  it("terminalizes safe-mode skips as completed and neutral", async () => {
    const { calls, executor } = recordingExecutor();
    const store = createSqlGitHubAppLifecycleStore(executor);

    await store.markReleaseRunSkipped({
      runId: "run-row-id",
      completedAt: "2026-07-10T18:00:00.000Z",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("set status = 'completed'");
    expect(calls[0]?.sql).toContain("decision = 'neutral'");
    expect(calls[0]?.sql).toContain("completed_at = coalesce");
    expect(calls[0]?.sql).toContain("duration_ms");
    expect(calls[0]?.sql).toContain("status = 'queued'");
    expect(calls[0]?.params).toEqual(["run-row-id", "2026-07-10T18:00:00.000Z"]);
  });

  it("skips release-run enqueue for repositories that are not enabled", async () => {
    const { calls, executor } = recordingExecutor();
    const store = createSqlGitHubAppLifecycleStore(executor, {
      id: () => "run-row-id",
      now: () => new Date("2026-07-04T00:00:00.000Z"),
    });

    const result = await store.enqueueReleaseRun({
      type: "release_run.enqueue",
      installation,
      repository,
      pullRequestNumber: 42,
      ref: "feature/ready",
      commitSha: "0123456789abcdef",
      triggerKind: "pr",
    });

    expect(result).toEqual({ idempotencyKey: "98765:42:0123456789abcdef" });
    expect(calls).toHaveLength(0);
  });
});
