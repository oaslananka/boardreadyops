import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL(
  "../../../packages/db/migrations/0088_protected_release_intent_candidates.sql",
  import.meta.url,
);

describe("protected-release evidence-only candidate migration", () => {
  it("persists explicit scoped immutable evidence without creating privileged release runs", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("create table if not exists protected_release_intent_candidates");
    expect(sql).toContain("installation_id text not null references installations(id) on delete cascade");
    expect(sql).toContain("repository_id text not null references repositories(id) on delete cascade");
    expect(sql).toContain("unique (installation_id, repository_id, request_id)");
    expect(sql).toContain("evidence_version integer not null default 1");
    expect(sql).toContain("check (evidence_version = 1)");
    expect(sql).toContain("protected_release_intent_immutable");
    expect(sql).toContain("before update on protected_release_intent_candidates");
    expect(sql).not.toMatch(/insert into (?:public\.)?release_runs/iu);
    expect(sql).not.toMatch(/insert into (?:public\.)?control_plane_outbox/iu);
    expect(sql).not.toContain("github.workflow.dispatch");
  });

  it("re-binds the existing live installation, repository ID and protected default-branch ref", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = pg_catalog, public");
    expect(sql).toContain("repository.github_repo_id = p_github_repository_id");
    expect(sql).toContain("installation.github_installation_id = p_github_installation_id");
    expect(sql).toContain("repository.disabled_at is null");
    expect(sql).toContain("repository.private = false");
    expect(sql).toContain("installation.suspended_at is null");
    expect(sql).toContain("for share of repository, installation");
    expect(sql).toContain("p_ref is distinct from 'refs/heads/' || v_default_branch");
  });

  it("returns the existing request only for exact evidence, never rewriting mismatched claims", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("on conflict (installation_id, repository_id, request_id) do nothing");
    expect(sql).toContain("v_candidate.github_repository_id is distinct from p_github_repository_id");
    expect(sql).toContain("v_candidate.actor_github_user_id is distinct from p_actor_github_user_id");
    expect(sql).toContain("v_candidate.actor_login is distinct from p_actor_login");
    expect(sql).toContain("v_candidate.ref is distinct from p_ref");
    expect(sql).toContain("v_candidate.commit_sha is distinct from p_commit_sha");
    expect(sql).toContain("v_candidate.evidence_digest is distinct from p_evidence_digest");
    expect(sql).toContain("using errcode = '23505'");
    expect(sql).not.toContain("on conflict (installation_id, repository_id, request_id) do update");
  });
});
