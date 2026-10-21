import { describe, expect, it, vi } from "vitest";
import { loadRunDesignBaseSnapshots, loadRunDesignSnapshots } from "../../../apps/web/lib/run-design-snapshots.js";

const snapshot = {
  snapshot_id: "snap-1",
  name: "kicad_native_F_Cu.svg",
  kind: "pcb_layer",
  format: "svg",
  sheet_or_layer: "F.Cu",
  width: 100,
  height: 80,
  content: '<svg viewBox="0 0 100 80"></svg>',
  sha256: "a".repeat(64),
  anchors: '[{"id":"1","kind":"component","targetRef":"U1","x":0.1,"y":0.4}]',
};
const runId = "11111111-2222-3333-4444-555555555555";
const repoId = "authorized-repository";

describe("run design snapshot loader", () => {
  it("does not connect to Postgres when no database is configured", async () => {
    const create = vi.fn();
    const result = await loadRunDesignSnapshots(runId, repoId, {}, create);
    expect(result).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("scopes images by BOTH the authorized repository and exact run, returning native images", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [snapshot] });
    const close = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn(() => ({ query, close }));
    const result = await loadRunDesignSnapshots(runId, repoId, { DATABASE_URL: "postgres://test-db" }, create);
    expect(create).toHaveBeenCalledWith({ connectionString: "postgres://test-db" });
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/JOIN release_runs[\s\S]*r\.id = \$1 AND r\.repository_id = \$2/u),
      [runId, repoId],
    );
    expect(result).toMatchObject([
      {
        id: snapshot.snapshot_id,
        name: snapshot.name,
        sheetOrLayer: "F.Cu",
        anchors: [{ targetRef: "U1" }],
      },
    ]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not invent snapshots or anchors when the DB has no valid records", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { ...snapshot, anchors: "not json" },
        { ...snapshot, anchors: null },
      ],
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const result = await loadRunDesignSnapshots(runId, repoId, { DATABASE_URL: "db" }, () => ({ query, close }));
    expect(result.map((row) => row.anchors)).toEqual([[], []]);
  });

  it("closes the database even when loading source-derived images fails", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(
      loadRunDesignSnapshots(runId, repoId, { DATABASE_URL: "db" }, () => ({ query, close })),
    ).rejects.toThrow("database unavailable");
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("source-bound run visual baseline", () => {
  it("never opens a database when unconfigured", async () => {
    const create = vi.fn();
    await expect(loadRunDesignBaseSnapshots(runId, repoId, {}, create)).resolves.toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("selects one baseline snapshot run only from the authorized current Review and exact base SHA", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [snapshot] });
    const close = vi.fn().mockResolvedValue(undefined);
    const result = await loadRunDesignBaseSnapshots(runId, repoId, { DATABASE_URL: "db" }, () => ({ query, close }));
    expect(result).toMatchObject([{ id: "snap-1", name: "kicad_native_F_Cu.svg" }]);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(query.mock.calls[0]?.[1]).toEqual([runId, repoId]);
    expect(sql).toContain("review.head_run_id = $1 AND review.repository_id = $2");
    expect(sql).toContain("revision.id = review.current_revision_id");
    expect(sql).toContain("revision.head_run_id = head.id AND revision.head_commit_sha = head.commit_sha");
    expect(sql).toContain("base.repository_id = $2 AND base.commit_sha = revision.base_commit_sha");
    expect(sql).toContain("base.id <> $1");
    expect(sql).toContain("EXISTS (SELECT 1 FROM run_snapshots");
    expect(sql).toContain("JOIN baseline ON baseline.id = s.run_id");
    expect(sql).toContain("LIMIT 64");
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns nothing without a matching baseline and always closes the connection", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    await expect(
      loadRunDesignBaseSnapshots(runId, repoId, { DATABASE_URL: "db" }, () => ({ query, close })),
    ).resolves.toEqual([]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("propagates failure without revealing a fallback image and closes the connection", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockRejectedValue(new Error("no connection"));
    await expect(
      loadRunDesignBaseSnapshots(runId, repoId, { DATABASE_URL: "db" }, () => ({ query, close })),
    ).rejects.toThrow("no connection");
    expect(close).toHaveBeenCalledOnce();
  });
});
