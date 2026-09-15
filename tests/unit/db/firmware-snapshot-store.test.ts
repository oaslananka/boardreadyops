import { describe, expect, it, vi } from "vitest";
import { createSqlFirmwareSnapshotStore } from "../../../packages/db/src/firmware-snapshot-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const runId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "33333333-3333-4333-8333-333333333333";

function executor(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async () => ({ rows }));
  return {
    store: createSqlFirmwareSnapshotStore({ query } as unknown as SqlQueryExecutor, {
      now: () => new Date("2026-09-15T00:00:00.000Z"),
    }),
    query,
  };
}

function payloadOf(query: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  const params = query.mock.calls[0]?.[1] as unknown[] | undefined;
  if (!params) throw new Error("no query was issued");
  return JSON.parse(String(params[3])) as Array<Record<string, unknown>>;
}

const dependency = {
  name: "led_strip",
  manifestPath: "firmware/idf_component.yml",
  origin: "registry" as const,
  versionSpec: "2.4.1",
  pinned: true,
  searchable: false,
};

describe("firmware snapshot store", () => {
  it("writes nothing and does not query when there are no dependencies", async () => {
    const { store, query } = executor();

    const result = await store.recordSnapshot({ runId, repositoryId, commitSha: "abc", dependencies: [] });

    // A repository with no firmware gets no snapshot rather than an empty one, so a reader can
    // tell "no firmware here" from "firmware with nothing in it".
    expect(result).toEqual({
      snapshotsWritten: 0,
      dependenciesWritten: 0,
      searchableWritten: 0,
      runMatched: true,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("scopes the write to the run and its repository", async () => {
    const { store, query } = executor([{ snapshots_written: 1, dependencies_written: 1, run_matches: 1 }]);

    await store.recordSnapshot({ runId, repositoryId, commitSha: "abc123", dependencies: [dependency] });

    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    // A run that does not belong to the repository must write nothing, so the insert selects
    // from run_scope rather than trusting the caller's repository id.
    expect(sql).toContain("release_runs.repository_id = $2");
    expect(sql).toContain("from run_scope");
    expect(params[0]).toBe(runId);
    expect(params[1]).toBe(repositoryId);
    expect(params[2]).toBe("abc123");
  });

  it("reports a run that does not belong to the repository as unmatched", async () => {
    const { store } = executor([{ snapshots_written: 0, dependencies_written: 0, run_matches: 0 }]);

    const result = await store.recordSnapshot({ runId, repositoryId, commitSha: "abc", dependencies: [dependency] });

    expect(result.runMatched).toBe(false);
    expect(result.snapshotsWritten).toBe(0);
  });

  it("strips an identifier from a dependency that does not claim to be searchable", async () => {
    const { store, query } = executor([{ snapshots_written: 1, dependencies_written: 1, run_matches: 1 }]);

    await store.recordSnapshot({
      runId,
      repositoryId,
      commitSha: "abc",
      dependencies: [{ ...dependency, searchable: false, purl: "pkg:generic/espressif/led_strip" }],
    });

    // The database refuses a row claiming one and showing the other, and the two must never be
    // confusable: an identifier present on an unsearchable dependency is the false clean bill.
    const [row] = payloadOf(query);
    expect(row?.purl).toBeNull();
    expect(row?.cpe).toBeNull();
    expect(row?.searchable).toBe(false);
  });

  it("keeps both identifiers on a searchable dependency", async () => {
    const { store, query } = executor([{ snapshots_written: 1, dependencies_written: 1, run_matches: 1 }]);

    await store.recordSnapshot({
      runId,
      repositoryId,
      commitSha: "abc",
      dependencies: [
        {
          name: "idf",
          manifestPath: "firmware/idf_component.yml",
          origin: "framework",
          versionSpec: "5.2.1",
          pinned: true,
          cpe: "cpe:2.3:a:espressif:esp-idf:5.2.1:*:*:*:*:*:*:*",
          searchable: true,
          identitySource: "NVD CPE dictionary",
        },
      ],
    });

    const [row] = payloadOf(query);
    expect(row?.cpe).toBe("cpe:2.3:a:espressif:esp-idf:5.2.1:*:*:*:*:*:*:*");
    expect(row?.searchable).toBe(true);
    expect(row?.identity_source).toBe("NVD CPE dictionary");
  });

  it("downgrades a searchable claim with no identifier rather than writing a row the database rejects", async () => {
    const { store, query } = executor([{ snapshots_written: 1, dependencies_written: 1, run_matches: 1 }]);

    await store.recordSnapshot({
      runId,
      repositoryId,
      commitSha: "abc",
      dependencies: [{ ...dependency, searchable: true }],
    });

    // Inconsistent input loses the stronger claim, not the weaker one: "cannot be looked up" is
    // the safe direction to fail in.
    const [row] = payloadOf(query);
    expect(row?.searchable).toBe(false);
    expect(row?.purl).toBeNull();
  });

  it("counts only the searchable dependencies in the snapshot", async () => {
    const { store, query } = executor([
      { snapshots_written: 1, dependencies_written: 2, searchable_written: 1, run_matches: 1 },
    ]);

    const result = await store.recordSnapshot({
      runId,
      repositoryId,
      commitSha: "abc",
      dependencies: [
        dependency,
        {
          name: "mcuboot",
          manifestPath: "firmware/idf_component.yml",
          origin: "git",
          pinned: false,
          purl: "pkg:golang/github.com/mcu-tools/mcuboot",
          searchable: true,
        },
      ],
    });

    // The coverage gap has to be readable without scanning rows: "no advisories found" against
    // 1 of 2 searchable components means something different from 2 of 2.
    expect(result.dependenciesWritten).toBe(2);
    expect(result.searchableWritten).toBe(1);
    const searchableFlags = payloadOf(query).map((row) => row.searchable);
    expect(searchableFlags).toEqual([false, true]);
  });

  it("sends null rather than undefined for absent optional columns", async () => {
    const { store, query } = executor([{ snapshots_written: 1, dependencies_written: 1, run_matches: 1 }]);

    await store.recordSnapshot({
      runId,
      repositoryId,
      commitSha: "abc",
      dependencies: [{ name: "mine", manifestPath: "fw/idf_component.yml", origin: "local", pinned: false }],
    });

    // jsonb_to_recordset needs the key present; undefined would drop it from the JSON entirely.
    const [row] = payloadOf(query);
    expect(row).toEqual({
      name: "mine",
      manifest_path: "fw/idf_component.yml",
      origin: "local",
      version_spec: null,
      pinned: false,
      purl: null,
      cpe: null,
      searchable: false,
      identity_source: null,
    });
  });
});

describe("firmware snapshot store: advisory scan scheduling", () => {
  it("enrols the repository for advisory scanning when a snapshot is written", async () => {
    const { store, query } = executor([{ snapshots_written: 1, dependencies_written: 1, run_matches: 1 }]);

    await store.recordSnapshot({ runId, repositoryId, commitSha: "abc", dependencies: [dependency] });

    const [sql] = query.mock.calls[0] as unknown as [string, unknown[]];
    // A snapshot is only ever recorded here, so this is the one place that can enrol the
    // repository. Without it a repository whose firmware first appeared after the watch
    // migration would never become due and the whole scan would sit built and unused.
    expect(sql).toContain("insert into repository_firmware_advisory_watch");
    expect(sql).toContain("where exists (select 1 from inserted_snapshot)");
    // New dependency data pulls the due time forward rather than pushing it back.
    expect(sql).toContain("least(repository_firmware_advisory_watch.next_due_at, excluded.next_due_at)");
  });

  it("claims only the newest snapshot per due repository", async () => {
    const { store, query } = executor([]);

    await store.claimDueScans(new Date("2026-09-15T00:00:00.000Z"), 10);

    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    // Scanning an older snapshot would ask about dependencies the project has already moved off.
    expect(sql).toContain("select distinct on (snapshot.repository_id)");
    expect(sql).toContain("order by snapshot.repository_id, snapshot.captured_at desc, snapshot.id desc");
    expect(sql).toContain("and dependency.searchable");
    expect(params[1]).toBe(10);
  });

  it("asks for nothing when the limit is not positive", async () => {
    const { store, query } = executor([]);

    expect(await store.claimDueScans(new Date(), 0)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("reads the aggregated identifiers back", async () => {
    const { store } = executor([
      {
        repository_id: repositoryId,
        installation_id: "install-1",
        repository_full_name: "acme/gateway",
        snapshot_id: "snap-1",
        commit_sha: "abc123",
        dependency_count: 40,
        scannable: [
          { name: "idf", manifestPath: "fw/idf_component.yml", cpe: "cpe:2.3:a:espressif:esp-idf:5.2.1:*", purl: null },
          {
            name: "mcuboot",
            manifestPath: "fw/idf_component.yml",
            purl: "pkg:golang/github.com/mcu-tools/mcuboot",
            cpe: null,
          },
        ],
      },
    ]);

    const claimed = await store.claimDueScans(new Date(), 5);

    expect(claimed).toEqual([
      {
        repositoryId,
        installationId: "install-1",
        repositoryFullName: "acme/gateway",
        snapshotId: "snap-1",
        commitSha: "abc123",
        dependencyCount: 40,
        scannable: [
          { name: "idf", manifestPath: "fw/idf_component.yml", cpe: "cpe:2.3:a:espressif:esp-idf:5.2.1:*" },
          { name: "mcuboot", manifestPath: "fw/idf_component.yml", purl: "pkg:golang/github.com/mcu-tools/mcuboot" },
        ],
      },
    ]);
  });

  it("drops a row that claims to be searchable but carries no identifier", async () => {
    const { store } = executor([
      {
        repository_id: repositoryId,
        installation_id: "install-1",
        repository_full_name: "acme/gateway",
        snapshot_id: "snap-1",
        commit_sha: "abc",
        dependency_count: 2,
        scannable: [
          { name: "broken", manifestPath: "fw/idf_component.yml", purl: null, cpe: null },
          { name: "ok", manifestPath: "fw/idf_component.yml", purl: "pkg:npm/x", cpe: null },
        ],
      },
    ]);

    // The 0068 constraint makes this impossible, so reaching it means the invariant broke.
    // Skipping beats querying on an empty string and recording the answer.
    expect((await store.claimDueScans(new Date(), 5))[0]?.scannable.map((entry) => entry.name)).toEqual(["ok"]);
  });

  it("selects the readable repository name, not just its id", async () => {
    const { store, query } = executor([]);

    await store.claimDueScans(new Date(), 5);

    const [sql] = query.mock.calls[0] as unknown as [string, unknown[]];
    // A notification showing a UUID where the contract promises acme/gateway is a defect the
    // supply path already made once. The join for installation_id is already here, so the
    // readable name costs nothing.
    expect(sql).toContain("repositories.owner || '/' || repositories.name as repository_full_name");
  });

  it("skips a claim with no readable repository name rather than falling back to the id", async () => {
    const { store } = executor([
      {
        repository_id: repositoryId,
        installation_id: "install-1",
        snapshot_id: "snap-1",
        commit_sha: "abc",
        dependency_count: 1,
        scannable: [],
      },
    ]);

    // Better to scan nothing than to queue a message naming a raw identifier.
    expect(await store.claimDueScans(new Date(), 5)).toEqual([]);
  });

  it("skips a claimed row missing the columns it needs", async () => {
    const { store } = executor([
      { repository_id: repositoryId, snapshot_id: "snap-1", commit_sha: "abc", scannable: [] },
      {
        repository_id: repositoryId,
        installation_id: "install-1",
        repository_full_name: "acme/gateway",
        snapshot_id: "snap-2",
        commit_sha: "def",
        dependency_count: 0,
        scannable: [],
      },
    ]);

    expect((await store.claimDueScans(new Date(), 5)).map((entry) => entry.snapshotId)).toEqual(["snap-2"]);
  });

  it("resets the failure count only for an outcome that actually completed", async () => {
    const { store, query } = executor([]);

    await store.completeScan({
      repositoryId,
      snapshotId: "snap-1",
      outcome: "unavailable",
      scannedAt: new Date("2026-09-15T00:00:00.000Z"),
      nextDueAt: new Date("2026-09-15T01:00:00.000Z"),
    });

    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    // Only answered and nothing_searchable mean the repository was actually looked at.
    expect(sql).toContain("when $4 in ('answered', 'nothing_searchable') then 0");
    expect(sql).toContain("else repository_firmware_advisory_watch.consecutive_failures + 1");
    expect(params[3]).toBe("unavailable");
  });
});
