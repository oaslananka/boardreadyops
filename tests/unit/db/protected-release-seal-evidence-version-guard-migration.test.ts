import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL(
  "../../../packages/db/migrations/0091_protected_release_seal_evidence_version_guard.sql",
  import.meta.url,
);

describe("protected release seal cannot downgrade verified owner evidence", () => {
  it("requires matching version and owner identity at the database boundary", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("before insert on protected_release_execution_seals");
    expect(sql).toContain("new.snapshot_version is distinct from v_version");
    expect(sql).toContain("new.github_owner_id is distinct from v_owner_id");
    expect(sql).toContain("snapshot_version = 1 and github_owner_id is null");
    expect(sql).toContain("snapshot_version = 2 and github_owner_id > 0");
    expect(sql).toContain("for share");
    expect(sql).toContain("security invoker");
    expect(sql).not.toMatch(/insert into (?:public\.)?release_runs/iu);
    expect(sql).not.toMatch(/insert into (?:public\.)?control_plane_outbox/iu);
    expect(sql).not.toContain("dispatch_allowed = true");
  });
});
