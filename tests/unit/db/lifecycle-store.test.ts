import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSqlGitHubAppMetadataStore,
  parseReleaseRepositoryRolloutPolicy,
  releaseRepositoryRolloutEnvName,
  releaseRepositoryRolloutFileEnvName,
  releaseRepositoryRolloutPolicyFromEnvironment,
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

describe("SQL GitHub App metadata store", () => {
  it("documents the environment variables used for rollout opt-in", () => {
    expect(releaseRepositoryRolloutEnvName).toBe("BOARDREADYOPS_RELEASE_REPOSITORIES");
    expect(releaseRepositoryRolloutFileEnvName).toBe("BOARDREADYOPS_RELEASE_REPOSITORIES_FILE");
  });

  it("loads rollout repositories from a bounded policy file and gives it precedence", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-rollout-policy-"));
    const policyFile = path.join(directory, "repositories");
    try {
      await writeFile(policyFile, "oaslananka/boardreadyops\noaslananka/boardreadyops-private-acceptance\n");
      expect(
        releaseRepositoryRolloutPolicyFromEnvironment({
          [releaseRepositoryRolloutEnvName]: "octo-org/ignored",
          [releaseRepositoryRolloutFileEnvName]: policyFile,
        }),
      ).toEqual({
        repositories: ["oaslananka/boardreadyops", "oaslananka/boardreadyops-private-acceptance"],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when a configured rollout policy file cannot be read", () => {
    expect(
      releaseRepositoryRolloutPolicyFromEnvironment({
        [releaseRepositoryRolloutEnvName]: "all",
        [releaseRepositoryRolloutFileEnvName]: "/missing/boardreadyops-rollout-policy",
      }),
    ).toEqual({ repositories: [] });
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
    const store = createSqlGitHubAppMetadataStore(executor, {
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
    const store = createSqlGitHubAppMetadataStore(executor, {
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

  it("exposes only installation and repository metadata operations", () => {
    const { executor } = recordingExecutor();
    const store = createSqlGitHubAppMetadataStore(executor);

    expect(Object.keys(store).sort()).toEqual([
      "deleteInstallation",
      "removeRepository",
      "upsertInstallation",
      "upsertRepository",
    ]);
    expect("enqueueReleaseRun" in store).toBe(false);
    expect("bindReleaseRunExecutionAttempt" in store).toBe(false);
    expect("markReleaseRunDispatched" in store).toBe(false);
    expect("markReleaseRunSkipped" in store).toBe(false);
  });
});
