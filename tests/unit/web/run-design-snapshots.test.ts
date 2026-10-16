import { describe, expect, it, vi } from "vitest";
import { loadRunDesignSnapshots } from "../../../apps/web/lib/run-design-snapshots.js";

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
