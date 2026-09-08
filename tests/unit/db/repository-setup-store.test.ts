import { describe, expect, it, vi } from "vitest";
import { createSqlRepositorySetupStore } from "../../../packages/db/src/repository-setup-store.js";

function executor(results: unknown[]) {
  const query = vi.fn<(sql: string, params?: readonly unknown[]) => Promise<unknown>>(
    async () => results.shift() ?? { rows: [] },
  );
  return {
    query,
    store: createSqlRepositorySetupStore(
      { query },
      { id: () => "11111111-1111-4111-8111-111111111111", now: () => new Date("2026-07-30T06:00:00.000Z") },
    ),
  };
}

const revisionRow = {
  setup_id: "22222222-2222-4222-8222-222222222222",
  installation_id: "installation-1",
  repository_id: "repository-1",
  revision: 2,
  preset: "production",
  preset_version: 1,
  source: "workflow_probe",
  actor_id: "github-actions",
  request_id: "probe-result:probe-1",
  workflow_path: "readiness-runner.yml",
  workflow_contract_version: 1,
  workflow_status: "ready",
  config_status: "ready",
  config_version: 1,
  observed_sha: "a".repeat(40),
  diagnostics: [],
  created_at: "2026-07-30T05:59:00.000Z",
};

describe("repository setup store", () => {
  it("loads a tenant-scoped repository and current setup provenance", async () => {
    const { query, store } = executor([
      {
        rows: [
          {
            ...revisionRow,
            github_installation_id: 123,
            github_repo_id: 456,
            owner: "octo",
            name: "board",
            private: true,
            default_branch: "main",
          },
        ],
      },
    ]);
    await expect(
      store.getContext({ installationId: "installation-1", repositoryId: "repository-1" }),
    ).resolves.toMatchObject({
      githubInstallationId: 123,
      githubRepositoryId: 456,
      owner: "octo",
      name: "board",
      private: true,
      current: { preset: "production", revision: 2, workflowStatus: "ready", configStatus: "ready" },
    });
    expect(query.mock.calls[0]?.[1]).toEqual(["installation-1", "repository-1"]);
  });

  it("loads a repository setup context by GitHub installation and repository IDs", async () => {
    const { query, store } = executor([
      {
        rows: [
          {
            ...revisionRow,
            github_installation_id: 123,
            github_repo_id: 456,
            owner: "octo",
            name: "board",
            private: false,
            default_branch: "main",
          },
        ],
      },
    ]);

    await expect(
      store.getContextByGitHub({ githubInstallationId: 123, githubRepositoryId: 456 }),
    ).resolves.toMatchObject({
      installationId: "installation-1",
      repositoryId: "repository-1",
      githubInstallationId: 123,
      githubRepositoryId: 456,
      current: { workflowStatus: "ready", configStatus: "ready" },
    });
    expect(String(query.mock.calls[0]?.[0])).toContain("installations.github_installation_id = $1");
    expect(String(query.mock.calls[0]?.[0])).toContain("repositories.github_repo_id = $2");
    expect(query.mock.calls[0]?.[1]).toEqual([123, 456]);
  });

  it("loads terminal probes so callbacks can replay and report precise lifecycle outcomes", async () => {
    const { query, store } = executor([
      {
        rows: [
          {
            probe_id: "33333333-3333-4333-8333-333333333333",
            installation_id: "installation-1",
            github_installation_id: 123,
            repository_id: "repository-1",
            github_repo_id: 456,
            owner: "octo",
            name: "board",
            default_branch: "main",
            preset: "production",
            preset_version: 1,
            status: "completed",
            expires_at: "2026-07-30T07:00:00.000Z",
          },
        ],
      },
    ]);

    await expect(store.getProbe("33333333-3333-4333-8333-333333333333")).resolves.toMatchObject({
      status: "completed",
      repositoryId: "repository-1",
      preset: "production",
    });
    expect(String(query.mock.calls[0]?.[0])).not.toContain("probe.status in");
  });

  it("applies an idempotent setup revision through the database function", async () => {
    const { query, store } = executor([
      { rows: [{ outcome: "applied", revision_id: "22222222-2222-4222-8222-222222222222", revision: 1 }] },
    ]);
    await expect(
      store.applyRevision({
        installationId: "installation-1",
        repositoryId: "repository-1",
        preset: "prototype",
        presetVersion: 1,
        source: "operator",
        actorId: "operator-1",
        requestId: "request-1",
        workflowStatus: "unknown",
        configStatus: "unknown",
      }),
    ).resolves.toEqual({ outcome: "applied", revisionId: "22222222-2222-4222-8222-222222222222", revision: 1 });
    expect(String(query.mock.calls[0]?.[0])).toContain("boardreadyops_apply_repository_setup_revision");
  });

  it("records an idempotent repository-scoped waiver PR request audit event", async () => {
    const { query, store } = executor([{ rows: [] }]);

    await store.recordWaiverPrRequestAudit({
      eventId: "55555555-5555-4555-8555-555555555555",
      installationId: "installation-1",
      repositoryId: "repository-1",
      actorId: "octocat",
      requestId: "github:delivery-waiver",
    });

    expect(String(query.mock.calls[0]?.[0])).toContain("insert into audit_events");
    expect(String(query.mock.calls[0]?.[0])).toContain("github_app.repository.waiver_pr_requested");
    expect(String(query.mock.calls[0]?.[0])).toContain("on conflict (id) do nothing");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "55555555-5555-4555-8555-555555555555",
      "installation-1",
      "repository-1",
      "octocat",
      "github:delivery-waiver",
      "2026-07-30T06:00:00.000Z",
    ]);
  });

  it("records an idempotent waiver PR result and permits an already-present no-op without a PR number", async () => {
    const { query, store } = executor([{ rows: [] }, { rows: [] }]);

    await store.recordWaiverPrResultAudit({
      eventId: "66666666-6666-4666-8666-666666666666",
      installationId: "installation-1",
      repositoryId: "repository-1",
      actorId: "octocat",
      requestId: "github:delivery-waiver",
      outcome: "created",
      pullRequestNumber: 14,
    });
    await store.recordWaiverPrResultAudit({
      eventId: "77777777-7777-4777-8777-777777777777",
      installationId: "installation-1",
      repositoryId: "repository-1",
      actorId: "octocat",
      requestId: "github:delivery-waiver-duplicate",
      outcome: "already_present",
    });

    expect(String(query.mock.calls[0]?.[0])).toContain("github_app.repository.waiver_pr_result");
    expect(String(query.mock.calls[0]?.[0])).toContain("on conflict (id) do nothing");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "66666666-6666-4666-8666-666666666666",
      "installation-1",
      "repository-1",
      "octocat",
      "github:delivery-waiver",
      "created",
      14,
      "2026-07-30T06:00:00.000Z",
    ]);
    expect(query.mock.calls[1]?.[1]?.[6]).toBeNull();
  });

  it("creates, dispatches and completes bounded probes", async () => {
    const { query, store } = executor([
      {
        rows: [
          {
            outcome: "created",
            probe_id: "33333333-3333-4333-8333-333333333333",
            setup_revision_id: "22222222-2222-4222-8222-222222222222",
          },
        ],
      },
      { rows: [{ outcome: "applied" }] },
      { rows: [{ outcome: "completed", revision_id: "44444444-4444-4444-8444-444444444444", revision: 2 }] },
    ]);
    await expect(
      store.createProbe({
        installationId: "installation-1",
        repositoryId: "repository-1",
        requestedBy: "operator-1",
        requestId: "probe-request-1",
        expiresAt: new Date("2026-07-30T06:15:00.000Z"),
      }),
    ).resolves.toMatchObject({ outcome: "created" });
    await expect(
      store.markProbeDispatched({ probeId: "33333333-3333-4333-8333-333333333333", workflowRunId: "123456" }),
    ).resolves.toBe("applied");
    await expect(
      store.completeProbe({
        probeId: "33333333-3333-4333-8333-333333333333",
        workflowContractVersion: 1,
        configStatus: "ready",
        configVersion: 1,
        observedSha: "a".repeat(40),
      }),
    ).resolves.toEqual({ outcome: "completed", revisionId: "44444444-4444-4444-8444-444444444444", revision: 2 });
    expect(query).toHaveBeenCalledTimes(3);
  });
});
