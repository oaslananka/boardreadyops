import { describe, expect, it } from "vitest";

describe("Tenant Isolation and RLS Policies", () => {
  it("enforces tenant boundary isolation policies in SQL migration", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const sql = await readFile(join(process.cwd(), "packages/db/migrations/0070_tenant_rls_policies.sql"), "utf8");

    expect(sql).toContain("alter table repositories enable row level security;");
    expect(sql).toContain("alter table release_runs enable row level security;");
    expect(sql).toContain("alter table findings enable row level security;");
    expect(sql).toContain("alter table artifacts enable row level security;");
    expect(sql).toContain("alter table reviews enable row level security;");
    expect(sql).toContain("alter table api_tokens enable row level security;");
    expect(sql).toContain("current_setting('app.current_tenant_id', true)");
  });
});
