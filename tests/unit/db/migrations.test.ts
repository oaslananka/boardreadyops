import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseModels, cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationsDir = join(process.cwd(), "packages/db/migrations");

describe("BoardReadyOps Cloud migrations", () => {
  it("publishes the runner registration schema version and model", () => {
    expect(cloudDatabaseSchemaVersion).toBe(3);
    expect(cloudDatabaseModels).toContain("RunnerRegistration");
  });

  it("discovers SQL migrations in deterministic order", async () => {
    const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.sql$/u.test(file)).sort();

    expect(files).toEqual(["0001_cloud_schema.sql", "0002_release_run_lifecycle.sql", "0003_runner_registrations.sql"]);
  });

  it("keeps the release-run lifecycle index migration idempotent", async () => {
    const sql = await readFile(join(migrationsDir, "0002_release_run_lifecycle.sql"), "utf8");

    expect(sql).toContain("create index if not exists release_runs_active_pr_idx");
    expect(sql).toContain("where status in ('queued', 'dispatched', 'running')");
  });

  it("keeps runner registrations tenant-scoped and lifecycle constrained", async () => {
    const sql = await readFile(join(migrationsDir, "0003_runner_registrations.sql"), "utf8");

    expect(sql).toContain("references installations(id) on delete cascade");
    expect(sql).toContain("unique (installation_id, name)");
    expect(sql).toContain("check (scope in ('installation', 'organization', 'repository'))");
    expect(sql).toContain("check (status in ('pending', 'active', 'stale', 'disabled'))");
    expect(sql).toContain("constraint runner_registrations_active_identity_valid");
    expect(sql).toContain("public_key_fingerprint is not null");
    expect(sql).toContain("last_heartbeat_at is not null");
    expect(sql).toContain("constraint runner_registrations_disabled_state_valid");
    expect(sql).toContain("create unique index if not exists runner_registrations_installation_fingerprint_idx");
    expect(sql).toContain("create index if not exists runner_registrations_active_heartbeat_idx");
    expect(sql).toContain("where status = 'active' and disabled_at is null");
  });

  it("keeps the initial schema idempotent", async () => {
    const sql = await readFile(join(migrationsDir, "0001_cloud_schema.sql"), "utf8");

    expect(sql).toContain("create table if not exists installations");
    expect(sql).toContain("create table if not exists repositories");
    expect(sql).toContain("create table if not exists release_runs");
    expect(sql).toContain("cloud_schema_migrations");
    expect(sql).toContain("idempotency_key text unique");
    expect(sql).toContain("github_check_run_id bigint");
  });
});
