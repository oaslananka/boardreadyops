import { describe, expect, it, vi } from "vitest";
import {
  formatArtifactBytes,
  formatRunDate,
  formatRunDuration,
  lookupRunDashboard,
  type RunDashboardQueryExecutor,
} from "../../../apps/web/lib/run-dashboard.js";

function executorWithResults(results: unknown[]): {
  executor: RunDashboardQueryExecutor;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  for (const result of results) query.mockResolvedValueOnce(result);
  return { executor: { query }, query };
}

function emptyDashboardRows(): unknown[] {
  return [{ rows: [{ total: 0 }] }, { rows: [{ total: 0 }] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];
}

function baseRunRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "run-state",
    status: "running",
    decision: null,
    commit_sha: "c".repeat(40),
    ref: "main",
    pull_request_number: null,
    trigger_kind: "push",
    started_at: "2026-07-10T16:00:00.000Z",
    completed_at: null,
    duration_ms: null,
    board_ready_ops_version: null,
    kicad_version: null,
    github_check_run_id: null,
    readiness_score: null,
    contract_version: null,
    conclusion: null,
    metrics: {},
    report_links: [],
    last_publication_attempt_at: null,
    github_check_published_at: null,
    github_comment_published_at: null,
    last_publication_error: null,
    owner: "octo",
    name: "board",
    private: false,
    reconciliation_count: 0,
    dead_letter_count: 0,
    last_activity_at: "2026-07-10T16:30:00.000Z",
    ...overrides,
  };
}

async function stateFor(row: Record<string, unknown>): Promise<string | undefined> {
  const executor = executorWithResults([{ rows: [row] }, ...emptyDashboardRows()]).executor;
  const result = await lookupRunDashboard("run-state", executor, {
    now: () => new Date("2026-07-10T17:00:00.000Z"),
  });
  return result.state === "found" ? result.run.investigationState : undefined;
}

describe("run dashboard data", () => {
  it("returns not-found after the run lookup without querying child rows", async () => {
    const { executor, query } = executorWithResults([{ rows: [] }]);
    await expect(lookupRunDashboard("missing-run", executor)).resolves.toEqual({ state: "not-found" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("treats malformed query results as not found", async () => {
    const { executor, query } = executorWithResults([null]);
    await expect(lookupRunDashboard("missing-run", executor)).resolves.toEqual({ state: "not-found" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("normalizes malformed scalar, collection, and report-link values", async () => {
    const malformedRow = baseRunRow({
      github_check_run_id: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      duration_ms: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      readiness_score: "9007199254740992",
      metrics: "not-an-object",
      report_links: "not-an-array",
      reconciliation_count: undefined,
      dead_letter_count: undefined,
      last_activity_at: "not-a-date",
    });
    const { executor } = executorWithResults([
      { rows: [malformedRow] },
      { rows: [{ total: "9007199254740992" }] },
      { rows: "not-an-array" },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      {
        rows: [
          {
            id: "artifact-metadata-only",
            kind: "report",
            name: "report.html",
            sha256: "f".repeat(64),
            bytes: "2048",
            role: "evidence",
            uploaded_at: "2026-07-10T16:45:00.000Z",
          },
        ],
      },
    ]);

    const result = await lookupRunDashboard("run-state", executor, {
      now: () => new Date("2026-07-10T17:00:00.000Z"),
    });

    expect(result).toMatchObject({
      state: "found",
      run: {
        githubCheckRunId: "9007199254740992",
        durationMs: undefined,
        readinessScore: undefined,
        metrics: {},
        reportLinks: [],
        reconciliationCount: 0,
        deadLetterCount: 0,
        investigationState: "current",
        findingsPage: { total: 0 },
        artifactsPage: { total: 0 },
        artifacts: [{ availability: "metadata-only", bytes: 2048 }],
      },
    });
  });

  it("rejects malformed report link entries and invalid URLs", async () => {
    const { executor } = executorWithResults([
      {
        rows: [
          baseRunRow({
            report_links: [
              null,
              [],
              { label: 42, url: "https://reports.example.test/invalid-label" },
              { label: "Missing URL", url: 42 },
              { label: "Invalid URL", url: "not a url" },
            ],
          }),
        ],
      },
      ...emptyDashboardRows(),
    ]);

    const result = await lookupRunDashboard("run-state", executor);
    expect(result).toMatchObject({ state: "found", run: { reportLinks: [] } });
  });

  it("maps bounded pages, applies parameterized filters, and excludes internal storage paths", async () => {
    const startedAt = new Date("2026-07-10T17:00:00.000Z");
    const completedAt = new Date("2026-07-10T17:00:02.500Z");
    const uploadedAt = new Date("2026-07-10T17:00:03.000Z");
    const { executor, query } = executorWithResults([
      {
        rows: [
          baseRunRow({
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
            report_links: [
              { label: "HTML report", url: "https://reports.example.test/run-123" },
              { label: "Unsafe", url: "http://reports.example.test/run-123" },
            ],
            last_publication_attempt_at: completedAt,
            github_check_published_at: completedAt,
            github_comment_published_at: uploadedAt,
            owner: "octo-org",
            name: "hardware-board",
            private: true,
            last_activity_at: completedAt,
          }),
        ],
      },
      { rows: [{ total: 27 }] },
      { rows: [{ total: 1 }] },
      {
        rows: [
          {
            id: "attempt-2",
            attempt_number: 2,
            status: "completed",
            created_at: startedAt,
            dispatch_requested_at: startedAt,
            dispatched_at: startedAt,
            started_at: startedAt,
            heartbeat_at: completedAt,
            completed_at: completedAt,
            retry_after_at: null,
            github_workflow_dispatch_id: "dispatch-456",
            failure_class: null,
            failure_message: null,
            result_digest: "b".repeat(64),
          },
        ],
      },
      {
        rows: [
          {
            entity_type: "release_run",
            execution_attempt_id: null,
            from_status: "running",
            to_status: "completed",
            from_version: 2,
            to_version: 3,
            reason_code: "runner_result_completed",
            occurred_at: completedAt,
          },
        ],
      },
      {
        rows: [
          {
            id: "finding-error",
            rule_id: "error.rule",
            severity: "error",
            message: "Blocking finding",
            path: null,
            kind: "policy",
            waived_at: completedAt,
          },
          {
            id: "finding-low",
            rule_id: "low.rule",
            severity: "low",
            message: "Low finding",
            path: "board.kicad_pcb",
            kind: "drc",
            waived_at: null,
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
      now: () => new Date("2026-07-10T17:05:00.000Z"),
      filters: {
        findingSearch: "board_100%",
        findingSeverity: "ERROR",
        findingState: "waived",
        findingSort: "path",
        findingsPage: 2,
        artifactSearch: "release",
        artifactRole: "primary",
        artifactKind: "release-archive",
        artifactSort: "size",
        artifactsPage: 999,
        pageSize: 10,
      },
      artifactDownloadUrl: ({ runId, artifactId }) => `https://boardreadyops.test/download/${runId}/${artifactId}`,
    });

    expect(result).toMatchObject({
      state: "found",
      run: {
        id: "run-123",
        repository: "octo-org/hardware-board",
        repositoryPrivate: true,
        investigationState: "completed",
        reconciliationCount: 0,
        deadLetterCount: 0,
        findingsPage: { page: 2, pageSize: 10, total: 27, totalPages: 3 },
        artifactsPage: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
        findings: [
          {
            id: "finding-error",
            ruleId: "error.rule",
            severity: "error",
            waivedAt: "2026-07-10T17:00:02.500Z",
          },
          { id: "finding-low", ruleId: "low.rule", severity: "low", path: "board.kicad_pcb" },
        ],
        artifacts: [
          {
            id: "artifact-456",
            availability: "available",
            retention: "no-automatic-expiry",
            downloadUrl: "https://boardreadyops.test/download/run-123/artifact-456",
          },
        ],
        attempts: [{ id: "attempt-2", attemptNumber: 2, workflowDispatchId: "dispatch-456" }],
        transitions: [{ entityType: "release_run", reasonCode: "runner_result_completed" }],
        reportLinks: [{ label: "HTML report", url: "https://reports.example.test/run-123" }],
      },
    });

    const runSql = String(query.mock.calls[0]?.[0]);
    const findingCountSql = String(query.mock.calls[1]?.[0]);
    const artifactCountSql = String(query.mock.calls[2]?.[0]);
    const findingSql = String(query.mock.calls[5]?.[0]);
    const artifactSql = String(query.mock.calls[6]?.[0]);
    expect(runSql).toContain("control_plane_reconciliation_items");
    expect(runSql).toContain("dead_letter_count");
    expect(runSql).toContain("last_activity_at");
    expect(findingCountSql).toContain("lower(findings.message)");
    expect(query.mock.calls[1]?.[1]).toEqual(["run-123", "%board\\_100\\%%", "error"]);
    expect(findingSql).toContain("findings.waived_at is not null");
    expect(findingSql).toContain("limit $4");
    expect(findingSql).toContain("offset $5");
    expect(query.mock.calls[5]?.[1]).toEqual(["run-123", "%board\\_100\\%%", "error", 10, 10]);
    expect(artifactCountSql).toContain("lower(artifacts.kind)");
    expect(query.mock.calls[2]?.[1]).toEqual(["run-123", "%release%", "primary", "release-archive"]);
    expect(artifactSql).toContain("artifacts.bytes desc");
    expect(artifactSql).toContain("limit $5");
    expect(artifactSql).toContain("offset $6");
    expect(query.mock.calls[6]?.[1]).toEqual(["run-123", "%release%", "primary", "release-archive", 10, 0]);
    expect(artifactSql).not.toContain("storage_path");
    expect(JSON.stringify(result)).not.toContain("/data/artifacts/private/internal/path.zip");
    expect(query).toHaveBeenCalledTimes(7);
  });

  it("surfaces stale, reconciliation, dead-letter, and partial-data states from durable data", async () => {
    await expect(stateFor(baseRunRow())).resolves.toBe("stale");
    await expect(stateFor(baseRunRow({ reconciliation_count: 2 }))).resolves.toBe("reconciliation");
    await expect(stateFor(baseRunRow({ reconciliation_count: 2, dead_letter_count: 1 }))).resolves.toBe("dead_letter");
    await expect(
      stateFor(
        baseRunRow({
          status: "completed",
          completed_at: "2026-07-10T16:35:00.000Z",
          contract_version: null,
        }),
      ),
    ).resolves.toBe("partial_data");
    await expect(stateFor(baseRunRow({ status: "failed" }))).resolves.toBe("failed");
    await expect(stateFor(baseRunRow({ status: "timed_out" }))).resolves.toBe("timed_out");
    await expect(stateFor(baseRunRow({ status: "superseded" }))).resolves.toBe("superseded");
    await expect(stateFor(baseRunRow({ status: "queued", last_activity_at: null }))).resolves.toBe("current");
    await expect(stateFor(baseRunRow({ status: "queued", last_activity_at: "not-a-date" }))).resolves.toBe("current");
  });

  it("ignores invalid free-form artifact facets and unsupported sort values", async () => {
    const { executor, query } = executorWithResults([{ rows: [baseRunRow()] }, ...emptyDashboardRows()]);
    await lookupRunDashboard("run-state", executor, {
      filters: {
        findingState: "active",
        findingSort: "rule",
        artifactRole: "invalid role with spaces",
        artifactKind: "../../path",
        artifactSort: "name",
      },
    });
    expect(query.mock.calls[2]?.[1]).toEqual(["run-state"]);
    expect(String(query.mock.calls[1]?.[0])).toContain("findings.waived_at is null");
    expect(String(query.mock.calls[5]?.[0])).toContain("findings.rule_id asc");
    expect(String(query.mock.calls[6]?.[0])).toContain("artifacts.name asc");
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
