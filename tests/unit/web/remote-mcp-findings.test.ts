import { describe, expect, it, vi } from "vitest";
import { loadAuthorizedRemoteFindings } from "../../../apps/web/lib/remote-mcp-findings.js";

const reviewId = "123e4567-e89b-42d3-a456-426614174000";
const principal = { githubUserId: 123, grantId: "grant-test", scopes: ["review:read"] };
const review = {
  id: reviewId,
  repository_id: "private-id",
  head_run_id: "head-run-now",
  current_revision_id: "revision-now",
  status: "active",
  decision: "pending",
  owner: "secret-owner",
  name: "private-board",
  github_repo_id: "456",
  github_installation_id: "789",
};
const revision = { head_commit_sha: "a".repeat(40), evidence_digest: "b".repeat(64) };
const row = (index: number) => ({
  id: String(index).padStart(6, "0"),
  rule_id: "drc.clearance",
  severity: "error",
  kind: "electrical",
  fingerprint: `fp_${index}`,
  message: "PRIVATE BOARD DESIGN",
  path: "/mnt/secret-board.kicad_pcb",
});
function store(findings: unknown[] = [row(1)]) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [review] })
    .mockResolvedValueOnce({ rows: [revision] })
    .mockResolvedValueOnce({ rows: findings });
  return { query };
}

describe("hosted read-only MCP finding pages", () => {
  it("returns only bounded identifiers from the current revision after live collaborator access", async () => {
    const db = store();
    const access = vi.fn().mockResolvedValue(true);
    const result = await loadAuthorizedRemoteFindings(db, principal, reviewId, undefined, access);
    expect(result).toEqual({
      schemaVersion: 1,
      availability: "available",
      evidenceDigest: revision.evidence_digest,
      headCommitSha: revision.head_commit_sha,
      findings: [{ ruleId: "drc.clearance", severity: "error", kind: "electrical", fingerprint: "fp_1" }],
      nextCursor: null,
    });
    expect(access).toHaveBeenCalledWith({
      githubUserId: 123,
      githubRepositoryId: 456,
      githubInstallationId: 789,
      owner: "secret-owner",
      name: "private-board",
    });
    expect(db.query).toHaveBeenCalledTimes(3);
    expect(db.query.mock.calls[0]?.[0]).toContain("head_run.repository_id = reviews.repository_id");
    const [sql, params] = db.query.mock.calls[2] ?? [];
    expect(sql).toContain("from findings");
    expect(sql).toContain("run_id = $1");
    expect(sql).toContain("order by id asc");
    expect(sql).not.toMatch(/message|path|storage_path|select \*/u);
    expect(params).toEqual(["head-run-now", null, 31]);
    const output = JSON.stringify(result);
    expect(output).not.toContain("PRIVATE BOARD DESIGN");
    expect(output).not.toContain("/mnt/secret-board");
    expect(output).not.toContain("private-board");
  });

  it("blocks denied, revoked, or unreachable collaborator authority before reading findings", async () => {
    for (const access of [vi.fn().mockResolvedValue(false), vi.fn().mockRejectedValue(new Error("GitHub down"))]) {
      const db = store();
      expect(await loadAuthorizedRemoteFindings(db, principal, reviewId, undefined, access)).toBeNull();
      expect(db.query).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects malformed IDs, cursors and missing scopes without DB/network", async () => {
    const db = store();
    const access = vi.fn();
    for (const [caller, id, cursor] of [
      [{ ...principal, scopes: ["evidence:read"] }, reviewId, undefined],
      [principal, "../../other", undefined],
      [principal, reviewId, "../leak"],
      [principal, reviewId, "a".repeat(121)],
    ] as const) {
      expect(await loadAuthorizedRemoteFindings(db, caller, id, cursor, access)).toBeNull();
    }
    expect(db.query).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
  });

  it("pages 30 results with bounded SQL and an opaque next cursor", async () => {
    const db = store(Array.from({ length: 31 }, (_, i) => row(i + 1)));
    const result = await loadAuthorizedRemoteFindings(
      db,
      principal,
      reviewId,
      undefined,
      vi.fn().mockResolvedValue(true),
    );
    expect(result?.findings).toHaveLength(30);
    expect(result?.nextCursor).toBe("000030");
    const paged = store([row(31)]);
    const next = await loadAuthorizedRemoteFindings(
      paged,
      principal,
      reviewId,
      result?.nextCursor ?? undefined,
      vi.fn().mockResolvedValue(true),
    );
    expect(paged.query.mock.calls[2]?.[1]).toEqual(["head-run-now", "000030", 31]);
    expect(next?.findings).toHaveLength(1);
    expect(next?.nextCursor).toBeNull();
  });

  it("preserves unavailable legacy fingerprints without inventing a digest", async () => {
    const db = store([{ ...row(1), fingerprint: null, kind: null }]);
    const result = await loadAuthorizedRemoteFindings(
      db,
      principal,
      reviewId,
      undefined,
      vi.fn().mockResolvedValue(true),
    );
    expect(result?.findings[0]).toEqual({ ruleId: "drc.clearance", severity: "error", fingerprint: null, kind: null });
  });

  it("fails closed on unavailable database rows instead of claiming a finding-free Review", async () => {
    const db = store();
    db.query
      .mockReset()
      .mockResolvedValueOnce({ rows: [review] })
      .mockResolvedValueOnce({ rows: [revision] })
      .mockResolvedValueOnce({ rows: undefined });
    expect(
      await loadAuthorizedRemoteFindings(db, principal, reviewId, undefined, vi.fn().mockResolvedValue(true)),
    ).toBeNull();
  });

  it("fails closed on malformed and unbounded records instead of leaking source text", async () => {
    for (const rows of [
      Array.from({ length: 32 }, (_, i) => row(i)),
      [{ ...row(1), rule_id: "/absolute/source/path" }],
      [{ ...row(1), severity: "urgent" }],
      [{ ...row(1), fingerprint: "private key with spaces" }],
      [{ ...row(1), kind: "<script>" }],
    ]) {
      const result = await loadAuthorizedRemoteFindings(
        store(rows),
        principal,
        reviewId,
        undefined,
        vi.fn().mockResolvedValue(true),
      );
      expect(result).toBeNull();
    }
  });
});
