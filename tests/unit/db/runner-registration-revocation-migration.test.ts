import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "packages/db/migrations");

describe("runner registration revocation migration", () => {
  it("permanently disables one tenant registration without exposing or reusing identity state", async () => {
    const sql = await readFile(join(migrationsDir, "0038_runner_registration_revocation.sql"), "utf8");

    expect(sql).toContain("boardreadyops_revoke_runner_registration");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = pg_catalog, public");
    expect(sql).toContain("status = 'disabled'");
    expect(sql).toContain("set revoked_at = p_now");
    expect(sql).toContain("runner.registration.revoked");
    expect(sql).toContain("revoked_at timestamptz");
    expect(sql).toContain("credential-rotation");
    expect(sql).toContain("host-decommissioned");
    expect(sql).toContain("policy-change");
    expect(sql).toContain("operator-request");
    expect(sql).toContain("suspected-compromise");
    expect(sql).not.toContain("boardreadyops_reissue_runner_registration_enrollment");
    expect(sql).not.toContain("status = 'pending'");
    expect(sql).not.toContain("public_key = null");
    expect(sql).not.toContain("public_key_fingerprint = null");
    expect(sql).not.toContain("private_key");
  });
});
