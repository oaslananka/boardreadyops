import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("POST /api/v1/runs persists finding rule category", () => {
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

  it("inserts the finding's rule category when the CLI/Action sends one", async () => {
    const request = new Request("https://boardreadyops.test/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo-1",
        commitSha: "a".repeat(40),
        ref: "refs/heads/main",
        triggerKind: "manual",
        findings: [
          { ruleId: "drc.clearance", severity: "error", message: "Clearance violation.", category: "electrical" },
        ],
        artifacts: [],
      }),
    });

    const response = await postRun(request);
    expect(response.status).toBe(201);

    const insertCall = mockQuery.mock.calls.find(([sql]) => String(sql).toLowerCase().includes("insert into findings"));
    expect(insertCall).toBeDefined();
    const params = insertCall?.[1] as unknown[];
    expect(params).toContain("electrical");
  });

  it("inserts a null category for an older CLI/Action finding that never sent one", async () => {
    const request = new Request("https://boardreadyops.test/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo-1",
        commitSha: "a".repeat(40),
        ref: "refs/heads/main",
        triggerKind: "manual",
        findings: [{ ruleId: "drc.clearance", severity: "error", message: "Clearance violation." }],
        artifacts: [],
      }),
    });

    const response = await postRun(request);
    expect(response.status).toBe(201);

    const insertCall = mockQuery.mock.calls.find(([sql]) => String(sql).toLowerCase().includes("insert into findings"));
    const [sql, params] = insertCall as [string, unknown[]];
    const categoryIndex = sql
      .split("(")[1]
      ?.split(")")[0]
      ?.split(",")
      .map((column) => column.trim())
      .indexOf("category");
    expect(categoryIndex).toBeGreaterThan(-1);
    expect(params[categoryIndex as number]).toBeNull();
  });
});
