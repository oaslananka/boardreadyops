import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0027_guarded_release_run_supersession.sql");

describe("guarded release-run supersession migration", () => {
  it("publishes schema v27 with a dedicated multi-attempt supersession helper", async () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(27);
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("create or replace function boardreadyops_supersede_release_run_state(");
    expect(sql).toContain("p_expected_run_status text");
    expect(sql).toContain("p_expected_run_version bigint");
    expect(sql).toContain("p_expected_execution_attempt_id text");
    expect(sql).toContain("superseded_attempt_count integer");
    expect(sql).toContain("security invoker");
  });

  it("checks the run snapshot before locking every nonterminal attempt in deterministic order", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const helper = sql.slice(
      sql.indexOf("create or replace function boardreadyops_supersede_release_run_state"),
      sql.indexOf("create or replace function boardreadyops_enqueue_release_run_with_outbox"),
    );

    expect(helper).toContain("v_run.status is distinct from p_expected_run_status");
    expect(helper).toContain("v_run.version is distinct from p_expected_run_version");
    expect(helper).toContain("v_run.execution_attempt_id is distinct from p_expected_execution_attempt_id");
    expect(helper).toContain("order by release_run_attempts.attempt_number, release_run_attempts.id");
    expect(helper).toContain("for update of release_run_attempts");
    expect(helper).toContain("boardreadyops_release_run_transition_allowed");
    expect(helper).toContain("boardreadyops_release_run_attempt_transition_allowed");
  });

  it("increments versions and writes one append-only event for every changed entity", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const helper = sql.slice(
      sql.indexOf("create or replace function boardreadyops_supersede_release_run_state"),
      sql.indexOf("create or replace function boardreadyops_enqueue_release_run_with_outbox"),
    );

    expect(helper).toContain("version = release_run_attempts.version + 1");
    expect(helper).toContain("version = release_runs.version + 1");
    expect(helper).toContain("failure_class = coalesce(release_run_attempts.failure_class, 'newer_commit')");
    expect(helper).toContain("A newer commit superseded this execution attempt.");
    expect(helper).toContain("'execution_attempt'");
    expect(helper).toContain("'release_run'");
    expect(helper).toContain("p_reason_code");
    expect(helper).toContain("'applied'::text");
    expect(helper).toContain("'stale'::text");
    expect(helper).toContain("'not_found'::text");
    expect(helper).toContain("'invalid_transition'::text");
  });

  it("serializes repo and pull-request enqueue before guarded supersession", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const enqueue = sql.slice(sql.indexOf("create or replace function boardreadyops_enqueue_release_run_with_outbox"));

    expect(enqueue).toContain("pg_advisory_xact_lock");
    expect(enqueue).toContain("hashtextextended");
    expect(enqueue).toContain("boardreadyops_supersede_release_run_state(");
    expect(enqueue).toContain("order by release_runs.started_at, release_runs.id");
    expect(enqueue).toContain("v_transition_outcome <> 'applied'");
    expect(enqueue).not.toContain("with superseded_runs as (\n    update release_runs");
  });

  it("preserves the producer signature and Check Run outbox idempotency contract", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("p_github_repo_id bigint");
    expect(sql).toContain("p_pull_request_number integer");
    expect(sql).toContain("p_release_idempotency_key text");
    expect(sql).toContain("p_outbox_payload jsonb");
    expect(sql).toContain("on conflict (idempotency_key)");
    expect(sql).toContain("'github.check_run.create:' || v_run_id");
    expect(sql).toContain("return query");
    expect(sql).toContain("select v_run_id, p_release_idempotency_key, v_run_status, v_outbox_id");
  });
});
