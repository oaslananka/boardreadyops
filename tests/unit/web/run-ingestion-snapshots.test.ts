import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postRun } from "../../../apps/web/app/api/v1/runs/route.js";
import * as apiAuth from "../../../apps/web/lib/api-auth.js";
import * as cloudConfig from "../../../apps/web/lib/cloud-runtime-config.js";

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

describe("POST /api/v1/runs persists review-canvas snapshots", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClose.mockReset();
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      repositoryId: "repo-1",
      actorId: "token-1",
      scopes: ["runs:write"],
      authType: "bearer_token",
    });
    mockQuery.mockImplementation(async (sql: string) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");
      if (norm.includes("from repositories")) {
        return { rows: [{ github_installation_id: 4242 }] };
      }
      return { rows: [] };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts a run_snapshots row for each published review-canvas snapshot", async () => {
    const request = new Request("https://boardreadyops.test/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo-1",
        commitSha: "a".repeat(40),
        ref: "refs/heads/main",
        triggerKind: "manual",
        findings: [],
        artifacts: [],
        snapshots: [
          {
            id: "snap_sch_board",
            name: "schematic_board.svg",
            kind: "schematic",
            format: "svg",
            sheetOrLayer: "board",
            width: 1200,
            height: 800,
            content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
            sha256: "f".repeat(64),
            anchors: [],
          },
        ],
      }),
    });

    const response = await postRun(request);
    expect(response.status).toBe(201);

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).toLowerCase().includes("insert into run_snapshots"),
    );
    expect(insertCall).toBeDefined();

    const params = insertCall?.[1] as unknown[];
    expect(params).toContain("snap_sch_board");
    expect(params).toContain("schematic_board.svg");
    expect(params).toContain('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(params).toContain("f".repeat(64));
  });

  it("does not touch run_snapshots when no snapshots are published", async () => {
    const request = new Request("https://boardreadyops.test/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo-1",
        commitSha: "a".repeat(40),
        ref: "refs/heads/main",
        triggerKind: "manual",
        findings: [],
        artifacts: [],
      }),
    });

    const response = await postRun(request);
    expect(response.status).toBe(201);

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).toLowerCase().includes("insert into run_snapshots"),
    );
    expect(insertCall).toBeUndefined();
  });
});
