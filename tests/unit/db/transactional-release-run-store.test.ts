import { describe, expect, it } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import { createSqlTransactionalGitHubAppLifecycleStore } from "../../../packages/db/src/transactional-lifecycle-store.js";

const action = {
  type: "release_run.enqueue" as const,
  installation: { id: 12345 },
  repository: {
    id: 1283305324,
    owner: "oaslananka",
    name: "boardreadyops",
    fullName: "oaslananka/boardreadyops",
    private: false,
    defaultBranch: "main",
  },
  pullRequestNumber: 42,
  ref: "feature/ready",
  commitSha: "0123456789abcdef",
  baseCommitSha: "a".repeat(40),
  triggerKind: "pr" as const,
};

describe("transactional release-run outbox store", () => {
  it("uses one PostgreSQL function call for release state and Check Run planning", async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const executor: SqlQueryExecutor = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        return {
          rows: [
            {
              run_id: "run-row-id",
              idempotency_key: "1283305324:42:0123456789abcdef",
              run_status: "queued",
              outbox_id: "outbox-row-id",
            },
          ],
        };
      },
    };
    const ids = ["run-row-id", "outbox-row-id"];
    const store = createSqlTransactionalGitHubAppLifecycleStore(executor, {
      id: () => ids.shift() ?? "unexpected-id",
      now: () => new Date("2026-07-22T02:00:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });

    await expect(store.enqueueReleaseRunWithOutbox(action)).resolves.toEqual({
      idempotencyKey: "1283305324:42:0123456789abcdef",
      runId: "run-row-id",
      status: "queued",
      outboxId: "outbox-row-id",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("boardreadyops_enqueue_release_run_with_outbox");
    expect(calls[0]?.params).toHaveLength(11);
    expect(calls[0]?.params[9]).toBe("outbox-row-id");
    const payload = JSON.parse(String(calls[0]?.params[10]));
    expect(payload).toMatchObject({
      type: "github.check_run.create",
      action: {
        baseCommitSha: "a".repeat(40),
        commitSha: "0123456789abcdef",
      },
    });
  });

  it("does not create a run or outbox record outside the rollout policy", async () => {
    const executor: SqlQueryExecutor = {
      async query() {
        throw new Error("database should not be called");
      },
    };
    const store = createSqlTransactionalGitHubAppLifecycleStore(executor, {
      releaseRepositoryRolloutPolicy: { repositories: [] },
    });

    await expect(store.enqueueReleaseRunWithOutbox(action)).resolves.toEqual({
      idempotencyKey: "1283305324:42:0123456789abcdef",
    });
  });
});
