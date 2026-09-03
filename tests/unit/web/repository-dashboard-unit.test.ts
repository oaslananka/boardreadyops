import { describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
const mockClose = vi.fn();

vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockQuery,
    close: mockClose,
  })),
}));

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockQuery,
    close: mockClose,
  })),
}));

vi.mock("../../../packages/db/src/pg-executor.ts", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockQuery,
    close: mockClose,
  })),
}));

import {
  loadRepositoryDetail,
  loadViewerRepositories,
  summarizeViewerRepositories,
} from "../../../apps/web/lib/repository-dashboard.js";
import { loadViewerRuns } from "../../../apps/web/lib/run-listing.js";
import { viewerInstallations } from "../../../apps/web/lib/viewer-installations.js";

const TEST_DB_URL = "postgres://test_user:test_secret@test_db_host:5432/test_db";

describe("repository dashboard and viewer loader branches", () => {
  it("returns empty groups when session is undefined or has no installations", async () => {
    expect(await loadViewerRepositories(undefined)).toEqual([]);
    expect(await loadViewerRepositories({ login: "alice", installationIds: [] })).toEqual([]);
  });

  it("returns empty groups when DATABASE_URL is not configured", async () => {
    const session = { login: "alice", installationIds: [123] };
    expect(await loadViewerRepositories(session, {})).toEqual([]);
  });

  it("parses database rows into repository groups when DATABASE_URL is present", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "repo-1",
          owner: "acme",
          name: "gateway",
          private: true,
          account_login: "acme-corp",
          run_id: "run-100",
          status: "completed",
          decision: "pass",
          started_at: "2026-08-20T10:00:00.000Z",
          open_findings: "2",
          watched_boards: "1",
          open_supply_findings: "0",
        },
      ],
    });

    const session = { login: "alice", installationIds: [123] };
    const groups = await loadViewerRepositories(session, { DATABASE_URL: TEST_DB_URL });
    expect(groups.length).toBe(1);
    expect(groups[0]?.accountLogin).toBe("acme-corp");
    expect(groups[0]?.repositories[0]?.name).toBe("gateway");
    expect(groups[0]?.repositories[0]?.openFindings).toBe(2);
  });

  it("summarizes only repository facts already present in the viewer groups", () => {
    const summary = summarizeViewerRepositories([
      {
        accountLogin: "acme",
        repositories: [
          {
            id: "repo-a",
            accountLogin: "acme",
            owner: "acme",
            name: "power",
            private: true,
            latestRunId: "run-1",
            latestRunStatus: "completed",
            latestRunDecision: "pass",
            latestRunAt: "2026-09-03T00:00:00.000Z",
            openFindings: 3,
            watchedBoards: 2,
            openSupplyFindings: 1,
          },
          {
            id: "repo-b",
            accountLogin: "acme",
            owner: "acme",
            name: "sensor",
            private: false,
            latestRunId: undefined,
            latestRunStatus: undefined,
            latestRunDecision: undefined,
            latestRunAt: undefined,
            openFindings: 0,
            watchedBoards: 1,
            openSupplyFindings: 0,
          },
        ],
      },
    ]);

    expect(summary).toEqual({
      repositories: 2,
      repositoriesWithOpenFindings: 1,
      supplyAlerts: 1,
      repositoriesWithoutRuns: 1,
      watchedBoards: 3,
    });
  });

  it("loads repository details and associated runs and supply findings", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "repo-1",
            owner: "acme",
            name: "gateway",
            private: false,
            account_login: "acme",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "run-1",
            status: "completed",
            decision: "pass",
            commit_sha: "abc1234",
            ref: "refs/heads/main",
            pull_request_number: 42,
            started_at: "2026-08-20T10:00:00.000Z",
            finding_count: "0",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            project_path: "boards/main.kicad_pro",
            mpn: "STM32F401RET6",
            manufacturer: "STMicroelectronics",
            reference: "U1",
            status: "active",
            severity: "low",
            detected_at: "2026-08-20T10:00:00.000Z",
          },
        ],
      });

    const session = { login: "alice", installationIds: [123] };
    const detail = await loadRepositoryDetail("repo-1", session, { DATABASE_URL: TEST_DB_URL });
    expect(detail).toBeDefined();
    expect(detail?.runs.length).toBe(1);
    expect(detail?.runs[0]?.pullRequestNumber).toBe(42);
    expect(detail?.supplyFindings.length).toBe(1);
    expect(detail?.supplyFindings[0]?.mpn).toBe("STM32F401RET6");
  });

  it("loads viewer installations from database rows", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "inst-1",
          github_installation_id: "12345",
          account_login: "acme",
          plan_tier: "team",
          has_credential: true,
          last_rejected_at: "2026-08-20T10:00:00.000Z",
          last_rejected_reason: "Invalid API token",
        },
      ],
    });

    const session = { login: "alice", installationIds: [12345] };
    const result = await viewerInstallations(session, "nexar", { DATABASE_URL: TEST_DB_URL });
    expect(result.length).toBe(1);
    expect(result[0]?.accountLogin).toBe("acme");
    expect(result[0]?.hasComponentCredential).toBe(true);
    expect(result[0]?.componentCredentialRejectedReason).toBe("Invalid API token");
  });

  it("loads viewer runs across repositories with cursor pagination", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "run-1",
          repository_id: "repo-1",
          status: "completed",
          decision: "pass",
          commit_sha: "abcdef1",
          ref: "refs/heads/main",
          pull_request_number: 10,
          started_at: "2026-08-20T12:00:00.000Z",
        },
        {
          id: "run-2",
          repository_id: "repo-1",
          status: "failed",
          decision: "fail",
          commit_sha: "abcdef2",
          ref: "refs/heads/main",
          pull_request_number: 11,
          started_at: "2026-08-20T11:00:00.000Z",
        },
      ],
    });

    const session = { login: "alice", installationIds: [12345] };
    const result = await loadViewerRuns(session, { limit: 1 }, { DATABASE_URL: TEST_DB_URL });
    expect(result.state).toBe("ok");
    if (result.state === "ok") {
      expect(result.runs.length).toBe(1);
      expect(result.runs[0]?.id).toBe("run-1");
      expect(result.next).toBeDefined();
    }
  });
});
