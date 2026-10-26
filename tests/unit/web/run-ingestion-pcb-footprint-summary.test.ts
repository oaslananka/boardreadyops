import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postRun } from "../../../apps/web/app/api/v1/runs/route.js";
import * as apiAuth from "../../../apps/web/lib/api-auth.js";
import * as cloudConfig from "../../../apps/web/lib/cloud-runtime-config.js";

const mockQuery = vi.fn();
const mockClose = vi.fn();
vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockQuery,
    withTransaction: async (callback: (db: { query: typeof mockQuery }) => Promise<unknown>) =>
      callback({ query: mockQuery }),
    close: mockClose,
  })),
}));
vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockQuery,
    withTransaction: async (callback: (db: { query: typeof mockQuery }) => Promise<unknown>) =>
      callback({ query: mockQuery }),
    close: mockClose,
  })),
}));

const summary = {
  schemaVersion: 1,
  scope: "pcb-footprints-only",
  provenance: "local-git-commits",
  disclosure: "counts-and-digests-only",
  baseCommitSha: "a".repeat(40),
  headCommitSha: "b".repeat(40),
  baseBlobSha: "c".repeat(40),
  headBlobSha: "d".repeat(40),
  baseSourceSha256: "e".repeat(64),
  headSourceSha256: "f".repeat(64),
  changes: {
    added: 1,
    removed: 0,
    modified: 1,
    byField: { reference: 0, libraryId: 0, layer: 0, positionMm: 1, rotationDeg: 0 },
  },
  riskAssessment: "not-evaluated",
} as const;
const payload = {
  repositoryId: "repo-1",
  commitSha: summary.headCommitSha,
  baseCommitSha: summary.baseCommitSha,
  evidenceDigest: "1".repeat(64),
  ref: "refs/heads/main",
  pcbFootprintSummary: summary,
  pcbFootprintSummaryConsent: true,
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  postRun(new Request("https://example.test/api/v1/runs", { method: "POST", headers, body: JSON.stringify(body) }));

describe("authorized, commit-bound client PCB summary ingestion", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClose.mockReset();
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://test/test",
    });
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      repositoryId: "repo-1",
      actorId: "authorized-cli",
      scopes: ["runs:write"],
      authType: "bearer_token",
    });
    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");
      if (norm.includes("from repositories")) return { rows: [{ github_installation_id: 4242 }] };
      if (norm.includes("insert into run_pcb_footprint_summaries")) return { rows: [{ run_id: params[0] }] };
      if (norm.includes("insert into reviews"))
        return {
          rows: [
            {
              id: "review-1",
              repository_id: "repo-1",
              pull_request_number: null,
              title: "Test review",
              status: "active",
              decision: "pending",
              base_run_id: null,
              head_run_id: "run-1",
              current_revision_id: "revision-1",
              created_by: "token-1",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              completed_at: null,
            },
          ],
        };
      return { rows: [] };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("accepts an explicitly supplied bounded summary and stores only run/repository/commit-bound facts", async () => {
    const response = await post(payload);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ acceptedFootprintSummary: true, status: "completed" });
    const insert = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("insert into run_pcb_footprint_summaries"),
    );
    expect(insert).toBeDefined();
    const args = insert?.[1] as unknown[];
    expect(args[1]).toBe("repo-1");
    expect(args[2]).toBe(summary.baseCommitSha);
    expect(args[3]).toBe(summary.headCommitSha);
    expect(args[4]).toBe(createHash("sha256").update(JSON.stringify(summary)).digest("hex"));
    expect(JSON.parse(args[5] as string)).toEqual(summary);
    expect(JSON.stringify(args)).not.toContain("(kicad_pcb");
  });

  it.each([
    { ...payload, commitSha: "9".repeat(40) },
    { ...payload, baseCommitSha: "9".repeat(40) },
    { ...payload, evidenceDigest: undefined },
    { ...payload, pcbFootprintSummaryConsent: undefined },
    { ...payload, pcbFootprintSummary: { ...summary, source: "(kicad_pcb private)" } },
    { ...payload, pcbFootprintSummary: { ...summary, riskAssessment: "pass" } },
    { ...payload, pcbFootprintSummary: { ...summary, changes: { ...summary.changes, added: -1 } } },
  ])("refuses a missing or forged source binding before making any DB writes (%#)", async (body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("preserves older client compatibility when no summary is submitted", async () => {
    const response = await post({ repositoryId: "repo-1", commitSha: "b".repeat(40), ref: "refs/heads/main" });
    expect(response.status).toBe(201);
    expect(await response.json()).not.toHaveProperty("acceptedFootprintSummary");
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("insert into run_pcb_footprint_summaries"))).toBe(
      false,
    );
  });

  it("idempotently acknowledges an identical summary but refuses a conflicting replay", async () => {
    const fingerprint = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
    mockQuery.mockImplementation(async (sql: string) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");
      if (norm.includes("from repositories")) return { rows: [{ github_installation_id: 4242 }] };
      if (norm.includes("from release_runs where repository_id"))
        return { rows: [{ id: "previous-run", status: "completed" }] };
      if (norm.includes("select summary_sha256 from run_pcb_footprint_summaries"))
        return { rows: [{ summary_sha256: fingerprint }] };
      return { rows: [] };
    });
    const valid = await post(payload, { "idempotency-key": "same-evidence" });
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ deduplicated: true, acceptedFootprintSummary: true });
    mockQuery.mockImplementation(async (sql: string) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");
      if (norm.includes("from repositories")) return { rows: [{ github_installation_id: 4242 }] };
      if (norm.includes("from release_runs where repository_id"))
        return { rows: [{ id: "previous-run", status: "completed" }] };
      if (norm.includes("select summary_sha256 from run_pcb_footprint_summaries"))
        return { rows: [{ summary_sha256: "0".repeat(64) }] };
      return { rows: [] };
    });
    const conflict = await post(payload, { "idempotency-key": "same-evidence" });
    expect(conflict.status).toBe(409);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("insert into run_pcb_footprint_summaries"))).toBe(
      false,
    );
  });
});
