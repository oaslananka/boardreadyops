import { describe, expect, it, vi } from "vitest";
import {
  formatArtifactBytes,
  formatRunDate,
  formatRunDuration,
  loadRunDashboard,
  lookupRunDashboard,
  type RunDashboardQueryExecutor,
} from "../../../apps/web/lib/run-dashboard.js";

function executorWithResults(results: unknown[]): {
  executor: RunDashboardQueryExecutor;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  for (const result of results) {
    query.mockResolvedValueOnce(result);
  }
  return {
    executor: { query },
    query,
  };
}

describe("run dashboard data", () => {
  it("reports an unconfigured dashboard without opening a database connection", async () => {
    await expect(loadRunDashboard("run-123", {})).resolves.toEqual({ state: "not-configured" });
  });

  it("returns not-found after the run lookup without querying child rows", async () => {
    const { executor, query } = executorWithResults([{ rows: [] }]);

    await expect(lookupRunDashboard("missing-run", executor)).resolves.toEqual({ state: "not-found" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("maps run details, orders findings, and excludes internal artifact storage paths", async () => {
    const startedAt = new Date("2026-07-10T17:00:00.000Z");
    const completedAt = new Date("2026-07-10T17:00:02.500Z");
    const uploadedAt = new Date("2026-07-10T17:00:03.000Z");
    const { executor, query } = executorWithResults([
      {
        rows: [
          {
            id: "run-123",
            status: "completed",
            decision: "pass",
            commit_sha: "0123456789abcdef",
            ref: "feature/ready",
            pull_request_number: 42,
            trigger_kind: "pr",
            started_at: startedAt,
            completed_at: completedAt,
            duration_ms: 2500,
            board_ready_ops_version: "1.8.0",
            kicad_version: "10.0",
            github_check_run_id: 9876543210n,
            readiness_score: 98,
            contract_version: 1,
            conclusion: "success",
            metrics: { durationMs: 2500, readinessScore: 98 },
            report_links: [{ label: "HTML report", url: "https://reports.example.test/run-123" }],
            last_publication_attempt_at: completedAt,
            github_check_published_at: completedAt,
            github_comment_published_at: uploadedAt,
            last_publication_error: null,
            owner: "octo-org",
            name: "hardware-board",
          },
        ],
      },
      {
        rows: [
          {
            rule_id: "low.rule",
            severity: "low",
            message: "Low finding",
            path: "board.kicad_pcb",
            kind: "drc",
            waived_at: null,
          },
          {
            rule_id: "error.rule",
            severity: "error",
            message: "Blocking finding",
            path: null,
            kind: "policy",
            waived_at: completedAt,
          },
        ],
      },
      {
        rows: [
          {
            id: "artifact-456",
            kind: "release-archive",
            name: "boardreadyops-release.zip",
            storage_path: "/data/artifacts/private/internal/path.zip",
            sha256: "a".repeat(64),
            bytes: 2048,
            role: "primary",
            uploaded_at: uploadedAt,
          },
        ],
      },
    ]);

    const result = await lookupRunDashboard("run-123", executor, {
      artifactDownloadUrl: ({ runId, artifactId }) => `https://boardreadyops.test/download/${runId}/${artifactId}`,
    });

    expect(result).toEqual({
      state: "found",
      run: {
        id: "run-123",
        status: "completed",
        decision: "pass",
        commitSha: "0123456789abcdef",
        ref: "feature/ready",
        pullRequestNumber: 42,
        triggerKind: "pr",
        startedAt: "2026-07-10T17:00:00.000Z",
        completedAt: "2026-07-10T17:00:02.500Z",
        durationMs: 2500,
        boardReadyOpsVersion: "1.8.0",
        kicadVersion: "10.0",
        githubCheckRunId: "9876543210",
        readinessScore: 98,
        resultContractVersion: 1,
        conclusion: "success",
        metrics: { durationMs: 2500, readinessScore: 98 },
        reportLinks: [{ label: "HTML report", url: "https://reports.example.test/run-123" }],
        lastPublicationAttemptAt: "2026-07-10T17:00:02.500Z",
        githubCheckPublishedAt: "2026-07-10T17:00:02.500Z",
        githubCommentPublishedAt: "2026-07-10T17:00:03.000Z",
        lastPublicationError: undefined,
        repository: "octo-org/hardware-board",
        findings: [
          {
            ruleId: "error.rule",
            severity: "error",
            message: "Blocking finding",
            path: undefined,
            kind: "policy",
            waivedAt: "2026-07-10T17:00:02.500Z",
          },
          {
            ruleId: "low.rule",
            severity: "low",
            message: "Low finding",
            path: "board.kicad_pcb",
            kind: "drc",
            waivedAt: undefined,
          },
        ],
        artifacts: [
          {
            id: "artifact-456",
            kind: "release-archive",
            name: "boardreadyops-release.zip",
            sha256: "a".repeat(64),
            bytes: 2048,
            role: "primary",
            uploadedAt: "2026-07-10T17:00:03.000Z",
            downloadUrl: "https://boardreadyops.test/download/run-123/artifact-456",
          },
        ],
      },
    });

    const runSql = String(query.mock.calls[0]?.[0]);
    const artifactSql = String(query.mock.calls[2]?.[0]);
    expect(runSql).not.toContain("installations");
    expect(runSql).not.toContain("account_login");
    expect(runSql).toContain("left join release_run_results");
    expect(artifactSql).toContain("select id, kind");
    expect(artifactSql).not.toContain("storage_path");
    expect(JSON.stringify(result)).not.toContain("/data/artifacts/private/internal/path.zip");
  });
});

describe("run dashboard formatting", () => {
  it("formats timestamps, durations, and artifact sizes deterministically", () => {
    expect(formatRunDate("2026-07-10T17:00:00Z")).toBe("2026-07-10T17:00:00.000Z");
    expect(formatRunDate("not-a-date")).toBe("not-a-date");
    expect(formatRunDate(undefined)).toBe("—");

    expect(formatRunDuration(undefined)).toBe("—");
    expect(formatRunDuration(999)).toBe("999 ms");
    expect(formatRunDuration(2500)).toBe("2.5 s");

    expect(formatArtifactBytes(512)).toBe("512 B");
    expect(formatArtifactBytes(2048)).toBe("2.0 KB");
    expect(formatArtifactBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
