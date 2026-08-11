import { describe, expect, it, vi } from "vitest";
import {
  formatArtifactBytes,
  formatRunDate,
  formatRunDuration,
  githubActionsRunUrl,
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
    repository_id: "7b000000-0000-4000-8000-000000000002",
    installation_id: "7b000000-0000-4000-8000-000000000001",
    owner: "octo",
    name: "board",
    private: false,
    trust_mode: "standard",
    safe_mode_reasons: [],
    setup_preset: "production",
    setup_preset_version: 1,
    setup_revision: 3,
    setup_workflow_contract_version: 1,
    setup_workflow_status: "ready",
    setup_config_status: "ready",
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
  it("builds canonical GitHub Actions run links only for numeric workflow run IDs", () => {
    expect(githubActionsRunUrl("octo-org/hardware-board", "456789")).toBe(
      "https://github.com/octo-org/hardware-board/actions/runs/456789",
    );
    expect(githubActionsRunUrl("octo org/hardware board", "456789")).toBe(
      "https://github.com/octo%20org/hardware%20board/actions/runs/456789",
    );
    expect(githubActionsRunUrl("octo-org/hardware-board", "dispatch-456")).toBeUndefined();
    expect(githubActionsRunUrl("octo-org/hardware-board", "0")).toBeUndefined();
  });

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

  it("binds the initial run lookup to an explicit installation and repository scope", async () => {
    const installationId = "7b000000-0000-4000-8000-000000000011";
    const repositoryId = "7b000000-0000-4000-8000-000000000012";
    const { executor, query } = executorWithResults([{ rows: [] }]);

    await expect(
      lookupRunDashboard("run-scoped", executor, { scope: { installationId, repositoryId } }),
    ).resolves.toEqual({ state: "not-found" });

    expect(String(query.mock.calls[0]?.[0])).toContain("repositories.installation_id = $2");
    expect(String(query.mock.calls[0]?.[0])).toContain("repositories.id = $3");
    expect(query.mock.calls[0]?.[1]).toEqual(["run-scoped", installationId, repositoryId]);
  });

  it("rejects malformed dashboard scopes before database access", async () => {
    const { executor, query } = executorWithResults([]);

    await expect(
      lookupRunDashboard("run-scoped", executor, {
        scope: {
          installationId: "not-a-uuid",
          repositoryId: "7b000000-0000-4000-8000-000000000012",
        },
      }),
    ).resolves.toEqual({ state: "not-found" });

    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    true,
    null,
    undefined,
    "not-a-boolean",
  ])("fails repository dashboards closed for private or malformed visibility %j", async (privateValue) => {
    const { executor, query } = executorWithResults([{ rows: [baseRunRow({ private: privateValue })] }]);

    await expect(lookupRunDashboard("private-run", executor)).resolves.toEqual({ state: "not-found" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([false, "false", "f", 0, "0"])("treats explicit public visibility %j as public", async (privateValue) => {
    const { executor, query } = executorWithResults([
      { rows: [baseRunRow({ private: privateValue })] },
      ...emptyDashboardRows(),
    ]);

    const result = await lookupRunDashboard("public-run", executor);

    expect(result).toMatchObject({ state: "found", run: { repositoryPrivate: false } });
    expect(query).toHaveBeenCalledTimes(7);
  });

  it("loads a private repository dashboard only after explicit repository authorization", async () => {
    const authorizeRepository = vi.fn(async () => true);
    const { executor, query } = executorWithResults([
      { rows: [baseRunRow({ private: true, owner: "private-org", name: "hardware" })] },
      ...emptyDashboardRows(),
    ]);

    const result = await lookupRunDashboard("private-run", executor, { authorizeRepository });

    expect(result).toMatchObject({
      state: "found",
      run: { repository: "private-org/hardware", repositoryPrivate: true },
    });
    expect(authorizeRepository).toHaveBeenCalledWith({
      id: "7b000000-0000-4000-8000-000000000002",
      installationId: "7b000000-0000-4000-8000-000000000001",
      owner: "private-org",
      name: "hardware",
      private: true,
    });
    expect(query).toHaveBeenCalledTimes(7);
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
            content_type: "text/html",
            execution_attempt_id: "22222222-2222-4222-8222-222222222222",
            retention_until: null,
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
        artifacts: [
          {
            availability: "available",
            bytes: 2048,
            contentType: "text/html",
            executionAttemptId: "22222222-2222-4222-8222-222222222222",
            retentionUntil: undefined,
            downloadUrl: undefined,
          },
        ],
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
            trust_mode: "safe",
            safe_mode_reasons: ["private-repository"],
            last_activity_at: completedAt,
          }),
        ],
      },
      { rows: [{ total: 27 }] },
      {
        rows: [
          {
            total: 1,
            deleted_artifact_count: 2,
            missing_artifact_count: 1,
            pending_artifact_deletion_count: 3,
            failed_artifact_deletion_count: 1,
          },
        ],
      },
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
            github_workflow_dispatch_id: "456789",
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
            content_type: "application/zip",
            execution_attempt_id: "22222222-2222-4222-8222-222222222222",
            retention_until: "2026-09-01T00:00:00.000Z",
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
      authorizeRepository: async () => true,
    });

    expect(result).toMatchObject({
      state: "found",
      run: {
        id: "run-123",
        repository: "octo-org/hardware-board",
        repositoryPrivate: true,
        trustMode: "safe",
        safeModeReasons: ["private-repository"],
        setupPreset: "production",
        setupPresetVersion: 1,
        setupRevision: 3,
        setupWorkflowContractVersion: 1,
        setupWorkflowStatus: "ready",
        setupConfigStatus: "ready",
        investigationState: "completed",
        reconciliationCount: 0,
        deadLetterCount: 0,
        findingsPage: { page: 2, pageSize: 10, total: 27, totalPages: 3 },
        artifactsPage: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
        artifactLifecycle: {
          deleted: 2,
          missing: 1,
          pendingDeletion: 3,
          failedDeletion: 1,
        },
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
            retention: "retained-until",
            retentionUntil: "2026-09-01T00:00:00.000Z",
            contentType: "application/zip",
            executionAttemptId: "22222222-2222-4222-8222-222222222222",
            downloadUrl: "https://boardreadyops.test/download/run-123/artifact-456",
          },
        ],
        attempts: [
          {
            id: "attempt-2",
            attemptNumber: 2,
            workflowDispatchId: "456789",
            workflowRunUrl: "https://github.com/octo-org/hardware-board/actions/runs/456789",
          },
        ],
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
    expect(artifactCountSql).toContain("artifact_deletion_jobs.release_run_id = $1");
    expect(artifactCountSql).toContain("deletion_outcome = 'deleted'");
    expect(artifactCountSql).toContain("deletion_outcome = 'missing'");
    expect(artifactCountSql).toContain("status in ('available', 'leased')");
    expect(artifactCountSql).toContain("status = 'dead_letter'");
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
