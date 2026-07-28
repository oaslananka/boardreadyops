import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSqlGitHubAppMetadataStore,
  lifecycleAuditEventForAction,
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
    expect(calls[0]?.sql).toContain("else installations.suspended_at");
    expect(calls[0]?.params).toEqual([
      "installation-row-id",
      12345,
      "octo-org",
      "Organization",
      "2026-07-04T00:00:00.000Z",
      null,
      null,
      null,
      null,
      "{}",
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
      null,
      null,
      null,
      null,
      "{}",
    ]);
  });

  it("exposes only installation and repository metadata operations", () => {
    const { executor } = recordingExecutor();
    const store = createSqlGitHubAppMetadataStore(executor);

    expect(Object.keys(store).sort()).toEqual([
      "deleteInstallation",
      "removeRepository",
      "suspendInstallation",
      "unsuspendInstallation",
      "upsertInstallation",
      "upsertRepository",
    ]);
    expect("enqueueReleaseRun" in store).toBe(false);
    expect("bindReleaseRunExecutionAttempt" in store).toBe(false);
    expect("markReleaseRunDispatched" in store).toBe(false);
    expect("markReleaseRunSkipped" in store).toBe(false);
  });
});

describe("GitHub lifecycle audit event selection", () => {
  const created = {
    deliveryId: "delivery-created",
    eventType: "installation",
    eventAction: "created",
  };

  it("selects tenant lifecycle events with deterministic retry-safe identifiers", () => {
    const installationAction = { type: "installation.upsert" as const, installation };
    const first = lifecycleAuditEventForAction(installationAction, created);
    const replay = lifecycleAuditEventForAction(installationAction, created);

    expect(first).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
      eventType: "github_app.installation.enabled",
      requestId: "delivery-created",
      subjectType: "installation",
      metadata: {
        action: "created",
        githubInstallationId: 12345,
      },
    });
    expect(replay?.id).toBe(first?.id);
  });

  it("selects repository add/remove and installation deletion events", () => {
    expect(
      lifecycleAuditEventForAction(
        { type: "repository.upsert", installation, repository },
        { deliveryId: "delivery-added", eventType: "installation_repositories", eventAction: "added" },
      ),
    ).toMatchObject({
      eventType: "github_app.repository.enabled",
      requestId: "delivery-added",
      subjectType: "repository",
      metadata: { action: "added", githubRepositoryId: 98765, repositoryPrivate: true },
    });
    expect(
      lifecycleAuditEventForAction(
        { type: "repository.removed", installation, repository },
        { deliveryId: "delivery-removed", eventType: "installation_repositories", eventAction: "removed" },
      ),
    ).toMatchObject({ eventType: "github_app.repository.disabled", subjectType: "repository" });
    expect(
      lifecycleAuditEventForAction(
        { type: "installation.deleted", installation },
        { deliveryId: "delivery-deleted", eventType: "installation", eventAction: "deleted" },
      ),
    ).toMatchObject({ eventType: "github_app.installation.disabled", subjectType: "installation" });
  });

  it("selects suspension and unsuspension events with retry-safe identifiers", () => {
    const suspendedAction = { type: "installation.suspended" as const, installation };
    const suspended = lifecycleAuditEventForAction(suspendedAction, {
      deliveryId: "delivery-suspend",
      eventType: "installation",
      eventAction: "suspend",
    });
    const replay = lifecycleAuditEventForAction(suspendedAction, {
      deliveryId: "delivery-suspend",
      eventType: "installation",
      eventAction: "suspend",
    });
    const unsuspended = lifecycleAuditEventForAction(
      { type: "installation.unsuspended", installation },
      { deliveryId: "delivery-unsuspend", eventType: "installation", eventAction: "unsuspend" },
    );

    expect(suspended).toMatchObject({
      eventType: "github_app.installation.suspended",
      requestId: "delivery-suspend",
      subjectType: "installation",
      metadata: { action: "suspend", githubInstallationId: 12345 },
    });
    expect(replay?.id).toBe(suspended?.id);
    expect(unsuspended).toMatchObject({
      eventType: "github_app.installation.unsuspended",
      requestId: "delivery-unsuspend",
      subjectType: "installation",
      metadata: { action: "unsuspend", githubInstallationId: 12345 },
    });
    expect(unsuspended?.id).not.toBe(suspended?.id);
  });

  it("does not misclassify pull-request metadata upserts as enablement changes", () => {
    const pullRequestContext = {
      deliveryId: "delivery-pr",
      eventType: "pull_request",
      eventAction: "synchronize",
    };
    expect(
      lifecycleAuditEventForAction({ type: "installation.upsert", installation }, pullRequestContext),
    ).toBeUndefined();
    expect(
      lifecycleAuditEventForAction({ type: "repository.upsert", installation, repository }, pullRequestContext),
    ).toBeUndefined();
    expect(
      lifecycleAuditEventForAction(
        { type: "installation.upsert", installation },
        {
          deliveryId: "delivery-permissions",
          eventType: "installation",
          eventAction: "new_permissions_accepted",
        },
      ),
    ).toBeUndefined();
  });
});

describe("SQL GitHub lifecycle audit writes", () => {
  it("persists installation enablement and its audit event atomically", async () => {
    const { calls, executor } = recordingExecutor();
    const store = createSqlGitHubAppMetadataStore(executor, {
      id: () => "installation-row-id",
      now: () => new Date("2026-07-04T00:00:00.000Z"),
    });

    await store.upsertInstallation(
      { type: "installation.upsert", installation },
      { deliveryId: "delivery-created", eventType: "installation", eventAction: "created" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("with persisted as");
    expect(calls[0]?.sql).toContain("insert into audit_events");
    expect(calls[0]?.sql).toContain("'github_webhook'");
    expect(calls[0]?.sql).toContain("on conflict (id) do nothing");
    expect(calls[0]?.sql).toContain("not exists (select 1 from audit_events where id = $6::text)");
    expect(calls[0]?.params).toEqual([
      "installation-row-id",
      12345,
      "octo-org",
      "Organization",
      "2026-07-04T00:00:00.000Z",
      expect.stringMatching(/^[0-9a-f-]{36}$/u),
      "github_app.installation.enabled",
      "installation",
      "delivery-created",
      JSON.stringify({ action: "created", githubInstallationId: 12345 }),
    ]);
  });

  it("persists guarded installation suspension transitions and audit events atomically", async () => {
    const { calls, executor } = recordingExecutor();
    const store = createSqlGitHubAppMetadataStore(executor, {
      now: () => new Date("2026-07-04T00:00:00.000Z"),
    });

    await store.suspendInstallation(
      { type: "installation.suspended", installation },
      { deliveryId: "delivery-suspend", eventType: "installation", eventAction: "suspend" },
    );
    await store.unsuspendInstallation(
      { type: "installation.unsuspended", installation },
      { deliveryId: "delivery-unsuspend", eventType: "installation", eventAction: "unsuspend" },
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("set suspended_at = $2::timestamptz");
    expect(calls[0]?.sql).toContain("$2::timestamptz is not null and suspended_at is null");
    expect(calls[0]?.sql).toContain("not exists (select 1 from audit_events where id = $4::text)");
    expect(calls[0]?.sql).toContain("insert into audit_events");
    expect(calls[0]?.sql).toContain("where $4::text is not null");
    expect(calls[0]?.params).toEqual([
      12345,
      "2026-07-04T00:00:00.000Z",
      "2026-07-04T00:00:00.000Z",
      expect.stringMatching(/^[0-9a-f-]{36}$/u),
      "github_app.installation.suspended",
      "installation",
      "delivery-suspend",
      JSON.stringify({ action: "suspend", githubInstallationId: 12345 }),
    ]);

    expect(calls[1]?.sql).toContain("set suspended_at = $2::timestamptz");
    expect(calls[1]?.sql).toContain("$2::timestamptz is null and suspended_at is not null");
    expect(calls[1]?.sql).toContain("not exists (select 1 from audit_events where id = $4::text)");
    expect(calls[1]?.sql).toContain("insert into audit_events");
    expect(calls[1]?.sql).toContain("where $4::text is not null");
    expect(calls[1]?.params).toEqual([
      12345,
      null,
      "2026-07-04T00:00:00.000Z",
      expect.stringMatching(/^[0-9a-f-]{36}$/u),
      "github_app.installation.unsuspended",
      "installation",
      "delivery-unsuspend",
      JSON.stringify({ action: "unsuspend", githubInstallationId: 12345 }),
    ]);
  });

  it("persists repository enablement with the internal tenant dimension", async () => {
    const { calls, executor } = recordingExecutor();
    const store = createSqlGitHubAppMetadataStore(executor, {
      id: () => "repository-row-id",
      now: () => new Date("2026-07-04T00:00:00.000Z"),
    });

    await store.upsertRepository(
      { type: "repository.upsert", installation, repository },
      { deliveryId: "delivery-added", eventType: "installation_repositories", eventAction: "added" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("returning id, installation_id");
    expect(calls[0]?.sql).toContain("else repositories.disabled_at");
    expect(calls[0]?.sql).toContain("not exists (select 1 from audit_events where id = $9::text)");
    expect(calls[0]?.sql).toContain("persisted.installation_id");
    expect(calls[0]?.sql).toContain("subject_type, subject_id");
    expect(calls[0]?.sql).toContain("repository_id, request_id");
    expect(calls[0]?.params).toEqual([
      12345,
      98765,
      "octo-org",
      "hardware-board",
      true,
      "main",
      "2026-07-04T00:00:00.000Z",
      "repository-row-id",
      expect.stringMatching(/^[0-9a-f-]{36}$/u),
      "github_app.repository.enabled",
      "repository",
      "delivery-added",
      JSON.stringify({ action: "added", githubRepositoryId: 98765, repositoryPrivate: true }),
    ]);
  });

  it("keeps pull-request metadata upserts audit-free with a null descriptor", async () => {
    const { calls, executor } = recordingExecutor();
    const store = createSqlGitHubAppMetadataStore(executor, {
      id: () => "installation-row-id",
      now: () => new Date("2026-07-04T00:00:00.000Z"),
    });

    await store.upsertInstallation(
      { type: "installation.upsert", installation },
      { deliveryId: "delivery-pr", eventType: "pull_request", eventAction: "synchronize" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("insert into audit_events");
    expect(calls[0]?.sql).toContain("where $6::text is not null");
    expect(calls[0]?.params).toEqual([
      "installation-row-id",
      12345,
      "octo-org",
      "Organization",
      "2026-07-04T00:00:00.000Z",
      null,
      null,
      null,
      null,
      "{}",
    ]);
  });

  it("persists repository and installation disablement atomically", async () => {
    const { calls, executor } = recordingExecutor();
    const store = createSqlGitHubAppMetadataStore(executor, {
      now: () => new Date("2026-07-04T00:00:00.000Z"),
    });

    await store.removeRepository(
      { type: "repository.removed", installation, repository },
      { deliveryId: "delivery-removed", eventType: "installation_repositories", eventAction: "removed" },
    );
    await store.deleteInstallation(
      { type: "installation.deleted", installation },
      { deliveryId: "delivery-deleted", eventType: "installation", eventAction: "deleted" },
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("returning id, installation_id");
    expect(calls[0]?.sql).toContain("not exists (select 1 from audit_events where id = $4::text)");
    expect(calls[0]?.sql).toContain("where $4::text is not null");
    expect(calls[0]?.params).toEqual([
      98765,
      12345,
      "2026-07-04T00:00:00.000Z",
      expect.stringMatching(/^[0-9a-f-]{36}$/u),
      "github_app.repository.disabled",
      "repository",
      "delivery-removed",
      JSON.stringify({ action: "removed", githubRepositoryId: 98765, repositoryPrivate: true }),
    ]);
    expect(calls[1]?.sql).toContain("update installations");
    expect(calls[1]?.sql).toContain("not exists (select 1 from audit_events where id = $3::text)");
    expect(calls[1]?.sql).toContain("where $3::text is not null");
    expect(calls[1]?.params).toEqual([
      12345,
      "2026-07-04T00:00:00.000Z",
      expect.stringMatching(/^[0-9a-f-]{36}$/u),
      "github_app.installation.disabled",
      "installation",
      "delivery-deleted",
      JSON.stringify({ action: "deleted", githubInstallationId: 12345 }),
    ]);
  });
});
