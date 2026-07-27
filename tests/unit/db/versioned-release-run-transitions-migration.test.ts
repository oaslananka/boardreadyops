import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0023_versioned_release_run_transitions.sql");

describe("versioned release-run transitions migration", () => {
  it("publishes schema v23 and versions both authoritative entities", async () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(23);
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("alter table release_runs");
    expect(sql).toContain("add column if not exists version bigint not null default 0");
    expect(sql).toContain("alter table release_run_attempts");
    expect(sql).toContain("release_runs_version_valid");
    expect(sql).toContain("release_run_attempts_version_valid");
  });

  it("stores tenant-scoped append-only transition events", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("create table if not exists release_run_transition_events");
    expect(sql).toContain("installation_id text not null references installations(id) on delete cascade");
    expect(sql).toContain("repository_id text not null references repositories(id) on delete cascade");
    expect(sql).toContain("release_run_id text not null references release_runs(id) on delete cascade");
    expect(sql).toContain("execution_attempt_id text references release_run_attempts(id) on delete cascade");
    expect(sql).toContain("entity_type in ('release_run', 'execution_attempt')");
    expect(sql).toContain("to_version = from_version + 1");
    expect(sql).toContain("boardreadyops_validate_release_run_transition_event_scope");
    expect(sql).toContain("boardreadyops_reject_release_run_transition_event_mutation");
    expect(sql).toContain("release_run_transition_events is append-only");
    expect(sql).toContain("before update or delete on release_run_transition_events");
  });

  it("defines explicit run and attempt transition graphs", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("boardreadyops_release_run_transition_allowed");
    expect(sql).toContain("boardreadyops_release_run_attempt_transition_allowed");
    expect(sql).toContain("p_from_status = 'queued' and p_to_status in (");
    expect(sql).toContain("'dispatched', 'running', 'completed', 'failed', 'timed_out', 'cancelled', 'superseded'");
    expect(sql).toContain("p_from_status = 'reporting' and p_to_status in (");
    expect(sql).toContain("'completed', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded'");
  });

  it("applies run and current-attempt transitions with optimistic concurrency", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("create or replace function boardreadyops_transition_release_run_state(");
    expect(sql).toContain("p_expected_run_status text");
    expect(sql).toContain("p_expected_run_version bigint");
    expect(sql).toContain("p_expected_execution_attempt_id text");
    expect(sql).toContain("p_expected_attempt_status text default null");
    expect(sql).toContain("p_expected_attempt_version bigint default null");
    expect(sql).toContain("for update of release_runs");
    expect(sql).toContain("for update of release_run_attempts");
    expect(sql).toContain("v_run.status is distinct from p_expected_run_status");
    expect(sql).toContain("v_run.version is distinct from p_expected_run_version");
    expect(sql).toContain("v_run.execution_attempt_id is distinct from p_expected_execution_attempt_id");
    expect(sql).toContain("v_attempt.version is distinct from p_expected_attempt_version");
    expect(sql).toContain("set status = p_next_run_status");
    expect(sql).toContain("version = release_runs.version + 1");
    expect(sql).toContain("version = release_run_attempts.version + 1");
    expect(sql).toContain("insert into release_run_transition_events");
    expect(sql).toContain("security invoker");
  });

  it("returns stable no-write outcomes for stale, missing, and invalid requests", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("'applied'::text");
    expect(sql).toContain("'stale'::text");
    expect(sql).toContain("'not_found'::text");
    expect(sql).toContain("'invalid_transition'::text");
    expect(sql).toContain("return query");
    expect(sql).toContain("if not boardreadyops_release_run_transition_allowed(");
    expect(sql).toContain(
      "if p_next_attempt_status is not null and not boardreadyops_release_run_attempt_transition_allowed(",
    );
  });
});
