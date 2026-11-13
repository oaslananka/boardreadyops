import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestRunRequestSchema, POST as postRun } from "../../../apps/web/app/api/v1/runs/route.js";
import * as apiAuth from "../../../apps/web/lib/api-auth.js";
import * as cloudConfig from "../../../apps/web/lib/cloud-runtime-config.js";

const mockQuery = vi.fn();
const mockClose = vi.fn();

vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockQuery,
    withTransaction: async (work: (transaction: { query: typeof mockQuery }) => Promise<unknown>) =>
      await work({ query: mockQuery }),
    close: mockClose,
  })),
}));

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockQuery,
    withTransaction: async (work: (transaction: { query: typeof mockQuery }) => Promise<unknown>) =>
      await work({ query: mockQuery }),
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

  it("rejects a forged approved archive in the CLI/Action upload contract", () => {
    const base = { repositoryId: "oaslananka/hardware", commitSha: "c".repeat(40), ref: "refs/heads/main" };
    const artifact = {
      kind: "archive",
      name: "gerbers.zip",
      storagePath: "run/gerbers.zip",
      role: "manufacturing",
      sha256: "a".repeat(64),
      bytes: 152,
    };
    expect(ingestRunRequestSchema.safeParse({ ...base, artifacts: [artifact] }).success).toBe(false);
    expect(
      ingestRunRequestSchema.safeParse({
        ...base,
        artifacts: [{ ...artifact, role: "draft-manufacturing" }],
      }).success,
    ).toBe(true);
    expect(
      ingestRunRequestSchema.safeParse({
        ...base,
        artifacts: [{ ...artifact, kind: "bom" }],
      }).success,
    ).toBe(true);
  });

  it("refuses a self-declared approved manufacturing archive before writing a run", async () => {
    const request = new Request("https://boardreadyops.test/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "oaslananka/hardware",
        commitSha: "a".repeat(40),
        ref: "refs/heads/main",
        artifacts: [
          {
            kind: "archive",
            name: "board.zip",
            storagePath: "run/board.zip",
            role: "manufacturing",
            sha256: "b".repeat(64),
            bytes: 512,
          },
        ],
      }),
    });
    const response = await postRun(request);
    expect(response.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("publishes a tokenless signed-in browser bundle to the canonical repository UUID", async () => {
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      actorId: "review-owner",
      scopes: ["runs:write"],
      authType: "session",
      installationIds: [4242],
      githubUserId: 89123,
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.toLowerCase().includes("from repositories")) {
        return { rows: [{ id: "canonical-repository-uuid", github_installation_id: "4242" }] };
      }
      return { rows: [] };
    });
    const request = new Request("https://boardreadyops.test/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "browser-unique-content" },
      body: JSON.stringify({
        repositoryId: "oaslananka-iot/RoyalBlue54L-Feather-Hardware",
        commitSha: "a".repeat(40),
        ref: "refs/heads/main",
        triggerKind: "manual",
        findings: [{ ruleId: "drc.hole_clearance", severity: "error", message: "Genuine board blocker" }],
      }),
    });
    const response = await postRun(request);
    expect(response.status).toBe(201);
    expect((await response.json()).decision).toBe("fail");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("lower(repositories.owner || '/' || repositories.name) = lower($1)"),
      ["oaslananka-iot/RoyalBlue54L-Feather-Hardware"],
    );
    const inserted = mockQuery.mock.calls.find(([sql]) => String(sql).includes("insert into release_runs"));
    expect(inserted?.[1]?.[1]).toBe("canonical-repository-uuid");
    expect(inserted?.[1]?.[7]).toBe("fail");
  });

  it("refuses a browser bundle for a repository outside the owner's GitHub installations", async () => {
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      actorId: "review-owner",
      scopes: ["runs:write"],
      authType: "session",
      installationIds: [4242],
    });
    mockQuery.mockResolvedValue({ rows: [{ id: "out-of-scope", github_installation_id: "9876" }] });
    const response = await postRun(
      new Request("https://boardreadyops.test/api/v1/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repositoryId: "different-owner/private-board",
          commitSha: "b".repeat(40),
          ref: "refs/heads/main",
          triggerKind: "manual",
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(mockClose).toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("insert into release_runs"))).toBe(false);
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
            width: 279.4,
            height: 115.6,
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
    // KiCad SVG viewBox dimensions can be fractional; SQL int4 columns cannot.
    // Stored dimensions round up without changing source SVG geometry.
    expect(params[7]).toBe(280);
    expect(params[8]).toBe(116);
  });

  it("rejects out-of-range SVG dimensions before inserting any run", async () => {
    const request = new Request("https://boardreadyops.test/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo-1",
        commitSha: "a".repeat(40),
        ref: "refs/heads/main",
        triggerKind: "manual",
        snapshots: [
          {
            id: "too-big",
            name: "pcb.svg",
            kind: "pcb_layer",
            format: "svg",
            sheetOrLayer: "F.Cu",
            width: 2_147_483_648,
            height: 100,
            sha256: "f".repeat(64),
            anchors: [],
          },
        ],
      }),
    });
    const response = await postRun(request);
    expect(response.status).toBe(400);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("insert into release_runs"))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("insert into run_snapshots"))).toBe(false);
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

  it.each([
    ["error", undefined, "fail"],
    ["high", undefined, "fail"],
    ["high", "pass", "fail"],
    ["high", "error", "error"],
    ["medium", undefined, "pass"],
    ["low", undefined, "pass"],
    ["info", undefined, "pass"],
    ["medium", "fail", "fail"],
  ] as const)(
    "persists %s findings with requested decision %s as %s",
    async (severity, requestedDecision, expected) => {
      const request = new Request("https://boardreadyops.test/api/v1/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repositoryId: "repo-1",
          commitSha: "a".repeat(40),
          ref: "refs/heads/main",
          triggerKind: "manual",
          ...(requestedDecision !== undefined ? { decision: requestedDecision } : {}),
          findings: [{ ruleId: "drc.track_dangling", severity, message: "Synthetic hardware finding" }],
        }),
      });

      const response = await postRun(request);
      expect(response.status).toBe(201);
      expect((await response.json()).decision).toBe(expected);
      const inserted = mockQuery.mock.calls.find(([sql]) =>
        String(sql).toLowerCase().includes("insert into release_runs"),
      );
      expect(inserted?.[1]?.[7]).toBe(expected);
    },
  );
});
