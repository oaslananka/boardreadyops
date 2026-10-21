import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL(
  "../../../packages/db/migrations/0089_protected_release_execution_seals.sql",
  import.meta.url,
);

describe("protected-release non-executing execution identity seals", () => {
  it("never enables dispatch or changes the PR pipeline", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("create table if not exists protected_release_execution_seals");
    expect(sql).toContain(
      "candidate_id text not null references protected_release_intent_candidates(id) on delete cascade",
    );
    expect(sql).toContain("dispatch_allowed boolean not null default false");
    expect(sql).toContain("check (dispatch_allowed = false)");
    expect(sql).toContain("snapshot_version integer not null default 1");
    expect(sql).toContain("protected_release_seals_immutable");
    expect(sql).not.toMatch(/insert into (?:public\.)?release_runs/iu);
    expect(sql).not.toMatch(/insert into (?:public\.)?control_plane_outbox/iu);
    expect(sql).not.toMatch(/insert into (?:public\.)?runner_job_leases/iu);
    expect(sql).not.toContain("github.workflow.dispatch");
  });

  it("binds canonical identities and rejects changed run/attempt on retry", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("unique (candidate_id)");
    expect(sql).toContain("unique (run_id)");
    expect(sql).toContain("unique (execution_attempt_id)");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("for share of candidate, repository, installation");
    expect(sql).toContain("repository.github_repo_id = p_github_repository_id");
    expect(sql).toContain("installation.github_installation_id = p_github_installation_id");
    expect(sql).toContain("repository.default_branch = substring(candidate.ref from 12)");
    expect(sql).toContain("repository.private = false");
    expect(sql).toContain("candidate.observed_at");
    expect(sql).toContain("clock_timestamp()");
    expect(sql).toContain("p_now < v_server_now - interval");
    expect(sql).toContain("on conflict (candidate_id) do nothing");
    expect(sql).toContain("v_existing.run_id is distinct from p_run_id");
    expect(sql).toContain("v_existing.execution_attempt_id is distinct from p_attempt_id");
    expect(sql).toContain("v_existing.snapshot_digest is distinct from v_digest");
    expect(sql).toContain("using errcode = '23505'");
  });
});
