import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL("../../../packages/db/migrations/0037_runner_fleet_health.sql", import.meta.url);

describe("runner fleet health migration", () => {
  it("stores strict last-reported runner versions without replacing the rollback-compatible claim function", async () => {
    const sql = await readFile(migration, "utf8");

    expect(sql).toContain("add column if not exists last_runner_version text");
    expect(sql).toContain("runner_registrations_last_runner_version_valid");
    expect(sql).toContain("char_length(last_runner_version) <= 64");
    expect(sql).toContain("9007199254740991");
    expect(sql).toContain("runner_registrations_active_version_idx");
    expect(sql).toContain("p_runner_version text");
    expect(sql).toContain("public.boardreadyops_claim_runner_job(");
    expect(sql).toContain("last_heartbeat_at = p_now");
    expect(sql).toContain("last_runner_version = coalesce(p_runner_version, runner_registrations.last_runner_version)");
    expect(sql).toContain("outcome in ('claimed', 'empty')");
    expect(sql).not.toContain("drop function if exists boardreadyops_claim_runner_job");
  });

  it("uses the accepted nonce as the authoritative presence-refresh gate", async () => {
    const sql = await readFile(migration, "utf8");

    expect(sql).toContain("request_was_accepted");
    expect(sql).toContain("from public.runner_request_nonces");
    expect(sql).toContain("runner_request_nonces.nonce_digest = p_nonce_digest");
    expect(sql).toContain("runner_request_nonces.runner_registration_id = p_runner_registration_id");
    expect(sql).toContain("runner_request_nonces.managed_runner_identity_id = p_managed_runner_identity_id");
    expect(sql.indexOf("request_was_accepted")).toBeLessThan(sql.indexOf("last_heartbeat_at = p_now"));
  });
});
