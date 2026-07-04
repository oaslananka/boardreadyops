import { describe, expect, it } from "vitest";
import { createSqlGitHubAppLifecycleStore, type SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

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

function recordingExecutor() {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const executor: SqlQueryExecutor = {
    async query(sql, params = []) {
      calls.push({ sql, params });
    },
  };

  return { calls, executor };
}

describe("SQL GitHub App lifecycle store", () => {
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

  it("enqueues release runs with an idempotency key", async () => {
    const { calls, executor } = recordingExecutor();
    const store = createSqlGitHubAppLifecycleStore(executor, {
      id: () => "run-row-id",
      now: () => new Date("2026-07-04T00:00:00.000Z"),
    });

    await store.enqueueReleaseRun({
      type: "release_run.enqueue",
      installation,
      repository,
      pullRequestNumber: 42,
      ref: "feature/ready",
      commitSha: "0123456789abcdef",
      triggerKind: "pr",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("insert into release_runs");
    expect(calls[0]?.sql).toContain("on conflict (idempotency_key) do nothing");
    expect(calls[0]?.params).toEqual([
      98765,
      "0123456789abcdef",
      "feature/ready",
      42,
      "pr",
      "2026-07-04T00:00:00.000Z",
      12345,
      "run-row-id",
      "98765:42:0123456789abcdef",
    ]);
  });
});
