import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRunDashboard } from "../../../apps/web/lib/run-dashboard.js";

const mocks = {
  artifactDownloadExpiry: vi.fn(),
  artifactDownloadUrl: vi.fn(),
  close: vi.fn(),
  configuredArtifactDownloadSigningKey: vi.fn(),
  createQueryExecutor: vi.fn(),
  query: vi.fn(),
};

const dependencies = {
  artifactDownloadExpiry: mocks.artifactDownloadExpiry,
  artifactDownloadUrl: mocks.artifactDownloadUrl,
  configuredArtifactDownloadSigningKey: mocks.configuredArtifactDownloadSigningKey,
  createQueryExecutor: mocks.createQueryExecutor,
};

function runRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "run-load",
    status: "completed",
    decision: "pass",
    commit_sha: "a".repeat(40),
    ref: "refs/heads/main",
    pull_request_number: 221,
    trigger_kind: "pr",
    started_at: "2026-07-10T16:00:00.000Z",
    completed_at: "2026-07-10T16:01:00.000Z",
    duration_ms: 60_000,
    board_ready_ops_version: "1.22.0",
    kicad_version: "10.0",
    github_check_run_id: "123",
    readiness_score: 98,
    contract_version: 1,
    conclusion: "success",
    metrics: {},
    report_links: [],
    last_publication_attempt_at: null,
    github_check_published_at: null,
    github_comment_published_at: null,
    last_publication_error: null,
    repository_id: "7c000000-0000-4000-8000-000000000002",
    installation_id: "7c000000-0000-4000-8000-000000000001",
    owner: "octo",
    name: "board",
    private: false,
    reconciliation_count: 0,
    dead_letter_count: 0,
    last_activity_at: "2026-07-10T16:01:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.createQueryExecutor.mockReturnValue({ query: mocks.query, close: mocks.close });
  mocks.close.mockResolvedValue(undefined);
});

describe("run dashboard environment loader", () => {
  it("returns not-configured without creating a database executor", async () => {
    await expect(loadRunDashboard("run-load", {}, {}, dependencies)).resolves.toEqual({ state: "not-configured" });
    expect(mocks.createQueryExecutor).not.toHaveBeenCalled();
  });

  it("uses the default pool size and closes the executor when the run is absent", async () => {
    mocks.configuredArtifactDownloadSigningKey.mockReturnValue(undefined);
    mocks.query.mockResolvedValueOnce({ rows: [] });

    await expect(
      loadRunDashboard("run-load", { DATABASE_URL: "postgresql://boardreadyops.test/database" }, {}, dependencies),
    ).resolves.toEqual({ state: "not-found" });

    expect(mocks.createQueryExecutor).toHaveBeenCalledWith({
      connectionString: "postgresql://boardreadyops.test/database",
      max: 5,
    });
    expect(mocks.artifactDownloadExpiry).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("fails private repository runs closed unless loader authorization is supplied", async () => {
    mocks.configuredArtifactDownloadSigningKey.mockReturnValue(undefined);
    mocks.query.mockResolvedValueOnce({ rows: [runRow({ private: true })] });

    await expect(
      loadRunDashboard("run-load", { DATABASE_URL: "postgresql://boardreadyops.test/database" }, {}, dependencies),
    ).resolves.toEqual({ state: "not-found" });
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("passes an explicit repository authorization dependency to the dashboard lookup", async () => {
    const authorizeRepository = vi.fn(async () => true);
    mocks.configuredArtifactDownloadSigningKey.mockReturnValue(undefined);
    for (const result of [
      { rows: [runRow({ private: true, owner: "private-org", name: "board" })] },
      { rows: [{ total: 0 }] },
      { rows: [{ total: 0 }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]) {
      mocks.query.mockResolvedValueOnce(result);
    }

    const result = await loadRunDashboard(
      "run-load",
      { DATABASE_URL: "postgresql://boardreadyops.test/database" },
      {},
      { ...dependencies, authorizeRepository },
    );

    expect(result).toMatchObject({ state: "found", run: { repository: "private-org/board", repositoryPrivate: true } });
    expect(authorizeRepository).toHaveBeenCalledWith({
      id: "7c000000-0000-4000-8000-000000000002",
      installationId: "7c000000-0000-4000-8000-000000000001",
      owner: "private-org",
      name: "board",
      private: true,
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("creates bounded signed artifact URLs with the configured pool size", async () => {
    mocks.configuredArtifactDownloadSigningKey.mockReturnValue("k".repeat(32));
    mocks.artifactDownloadExpiry.mockReturnValue(1_900_000_000);
    mocks.artifactDownloadUrl.mockReturnValue("https://boardreadyops.test/signed-artifact");
    for (const result of [
      { rows: [runRow()] },
      { rows: [{ total: 0 }] },
      { rows: [{ total: 1 }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      {
        rows: [
          {
            id: "artifact-load",
            kind: "report",
            name: "report.html",
            sha256: "b".repeat(64),
            bytes: 2048,
            role: "evidence",
            uploaded_at: "2026-07-10T16:01:00.000Z",
          },
        ],
      },
    ]) {
      mocks.query.mockResolvedValueOnce(result);
    }

    const result = await loadRunDashboard(
      "run-load",
      {
        DATABASE_URL: "postgresql://boardreadyops.test/database",
        DATABASE_POOL_MAX: "9",
        BOARDREADYOPS_PUBLIC_URL: "https://boardreadyops.test",
        ARTIFACT_DOWNLOAD_SIGNING_KEY: "k".repeat(32),
      },
      {},
      dependencies,
    );

    expect(result).toMatchObject({
      state: "found",
      run: {
        artifacts: [
          {
            id: "artifact-load",
            availability: "available",
            downloadUrl: "https://boardreadyops.test/signed-artifact",
          },
        ],
      },
    });
    expect(mocks.createQueryExecutor).toHaveBeenCalledWith({
      connectionString: "postgresql://boardreadyops.test/database",
      max: 9,
    });
    expect(mocks.artifactDownloadExpiry).toHaveBeenCalledOnce();
    expect(mocks.artifactDownloadUrl).toHaveBeenCalledWith({
      runId: "run-load",
      artifactId: "artifact-load",
      expiresAt: 1_900_000_000,
      baseUrl: "https://boardreadyops.test",
      key: "k".repeat(32),
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  describe("demo fixture environment guard", () => {
    it("returns demo fixture when NODE_ENV is development and DATABASE_URL is unconfigured", async () => {
      const result = await loadRunDashboard("demo-1", { NODE_ENV: "development" }, {}, dependencies);
      expect(result).toMatchObject({
        state: "found",
        run: expect.objectContaining({ id: "demo-1", repository: "boardreadyops/drone-flight-controller" }),
      });
      expect(mocks.createQueryExecutor).not.toHaveBeenCalled();
    });

    it("returns demo fixture when NODE_ENV is test and DATABASE_URL is unconfigured", async () => {
      const result = await loadRunDashboard("demo-pass", { NODE_ENV: "test" }, {}, dependencies);
      expect(result).toMatchObject({
        state: "found",
        run: expect.objectContaining({ id: "demo-pass", decision: "pass" }),
      });
      expect(mocks.createQueryExecutor).not.toHaveBeenCalled();
    });

    it("NEVER returns demo fixture when NODE_ENV is production without DATABASE_URL", async () => {
      const result = await loadRunDashboard("demo-1", { NODE_ENV: "production" }, {}, dependencies);
      expect(result).toEqual({ state: "not-configured" });
      expect(mocks.createQueryExecutor).not.toHaveBeenCalled();
    });

    it("returns not-configured for non-demo runId when DATABASE_URL is unconfigured in development", async () => {
      const result = await loadRunDashboard("real-run-99", { NODE_ENV: "development" }, {}, dependencies);
      expect(result).toEqual({ state: "not-configured" });
      expect(mocks.createQueryExecutor).not.toHaveBeenCalled();
    });

    it("uses database executor when DATABASE_URL is configured, even for demo runId", async () => {
      mocks.configuredArtifactDownloadSigningKey.mockReturnValue(undefined);
      mocks.query.mockResolvedValueOnce({ rows: [] });

      const result = await loadRunDashboard(
        "demo-db",
        { DATABASE_URL: "postgresql://boardreadyops.test/database", NODE_ENV: "development" },
        {},
        dependencies,
      );

      expect(result).toEqual({ state: "not-found" });
      expect(mocks.createQueryExecutor).toHaveBeenCalledWith({
        connectionString: "postgresql://boardreadyops.test/database",
        max: 5,
      });
      expect(mocks.close).toHaveBeenCalledOnce();
    });
  });
});
