import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL(
  "../../../packages/db/migrations/0090_protected_release_verified_owner_evidence.sql",
  import.meta.url,
);

describe("protected-release versioned GitHub owner evidence", () => {
  it("retains v1 historical records while requiring validated v2 owner identity", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("github_owner_id bigint");
    expect(sql).toContain("evidence_version = 1 and github_owner_id is null");
    expect(sql).toContain("evidence_version = 2 and github_owner_id > 0");
    expect(sql).toContain("boardreadyops_record_protected_release_intent_candidate_v2");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("for share of repository, installation");
  });

  it("keeps the evidence append-only and refuses cross-owner idempotent replay", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("on conflict (installation_id, repository_id, request_id) do nothing");
    expect(sql).toContain("v_candidate.github_owner_id is distinct from p_github_owner_id");
    expect(sql).toContain("v_candidate.evidence_version <> 2");
    expect(sql).toContain("using errcode = '23505'");
    expect(sql).not.toMatch(/insert into (?:public\.)?release_runs/iu);
    expect(sql).not.toMatch(/insert into (?:public\.)?control_plane_outbox/iu);
    expect(sql).not.toContain("dispatch_allowed = true");
  });
});
