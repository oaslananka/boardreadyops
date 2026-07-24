import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0022_control_plane_lifecycle_reconciliation.sql");

describe("control-plane lifecycle reconciliation migration", () => {
  it("publishes schema v22 and tenant-scopes webhook inbox subjects", async () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(22);
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("subject_type in ('job', 'outbox', 'release_run', 'execution_attempt', 'webhook_inbox')");
    expect(sql).toContain("new.subject_type = 'webhook_inbox'");
    expect(sql).toContain("join installations i on i.github_installation_id = wi.installation_external_id");
    expect(sql).toContain("new.repository_id := coalesce(new.repository_id, v_repository_id)");
  });

  it("detects missing jobs and authoritative inbox-state drift after the observation window", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("boardreadyops_detect_control_plane_lifecycle_reconciliation");
    expect(sql).toContain("wi.accepted_at <= p_now - make_interval(secs => p_observation_delay_seconds)");
    expect(sql).toContain("'lifecycle_job_missing'");
    expect(sql).toContain("'lifecycle_inbox_state_drift'");
    expect(sql).toContain("for update of wi skip locked");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("p_now + make_interval(secs => p_terminal_deadline_seconds)");
  });

  it("claims only lifecycle reconciliation items", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const start = sql.indexOf("create or replace function boardreadyops_claim_control_plane_lifecycle_reconciliation");
    const end = sql.indexOf("create or replace function boardreadyops_apply_control_plane_lifecycle_reconciliation");
    const claimSql = sql.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(claimSql).toContain("reason_code in ('lifecycle_job_missing', 'lifecycle_inbox_state_drift')");
    expect(claimSql).toContain("for update skip locked");
    expect(claimSql).toContain("attempt_count = cpri.attempt_count + 1");
  });

  it("recreates missing jobs and projects every job status onto the inbox", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("boardreadyops_apply_control_plane_lifecycle_reconciliation");
    expect(sql).toContain("insert into control_plane_jobs");
    expect(sql).toContain("v_inbox.provider || ':' || v_inbox.delivery_id");
    expect(sql).toContain("when 'available' then 'accepted'");
    expect(sql).toContain("when 'leased' then 'processing'");
    expect(sql).toContain("when 'completed' then 'processed'");
    expect(sql).toContain("when 'dead_letter' then 'dead_letter'");
    expect(sql).toContain("normalized_actions = case when v_expected_state = 'processed' then '[]'::jsonb");
    expect(sql).toContain("boardreadyops_complete_control_plane_reconciliation");
    expect(sql).toContain("lifecycle job idempotency conflict");
    expect(sql).not.toContain("raise notice");
  });
});
