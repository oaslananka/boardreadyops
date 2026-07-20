import { describe, expect, it, vi } from "vitest";
import { checkCloudReadiness } from "../../../apps/web/lib/cloud-readiness.js";

describe("cloud readiness", () => {
  it("reports missing deployed configuration without calling PostgreSQL", async () => {
    const query = vi.fn();

    await expect(checkCloudReadiness({ environment: { NODE_ENV: "production" }, query })).resolves.toEqual({
      ok: false,
      service: "boardreadyops-cloud",
      check: "readiness",
      reason: "missing-configuration",
      missing: ["DATABASE_URL", "GITHUB_WEBHOOK_SECRET"],
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("reports ready after a successful select 1", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ready: 1 }] });

    await expect(
      checkCloudReadiness({
        environment: {
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://example.invalid/boardreadyops",
          GITHUB_WEBHOOK_SECRET: "secret",
        },
        query,
      }),
    ).resolves.toEqual({
      ok: true,
      service: "boardreadyops-cloud",
      check: "readiness",
      checks: {
        configuration: "pass",
        database: "pass",
      },
    });
    expect(query).toHaveBeenCalledWith("select 1 as ready");
  });

  it("reports database-unavailable without leaking the database error", async () => {
    const query = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED db.internal:5432"));

    const result = await checkCloudReadiness({
      environment: {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://example.invalid/boardreadyops",
        GITHUB_WEBHOOK_SECRET: "secret",
      },
      query,
    });

    expect(result).toEqual({
      ok: false,
      service: "boardreadyops-cloud",
      check: "readiness",
      reason: "database-unavailable",
    });
    expect(JSON.stringify(result)).not.toContain("db.internal");
  });

  it("reports database-timeout when the query exceeds the timeout", async () => {
    const query = vi.fn(() => new Promise(() => undefined));

    await expect(
      checkCloudReadiness({
        environment: {
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://example.invalid/boardreadyops",
          GITHUB_WEBHOOK_SECRET: "secret",
        },
        query,
        timeoutMs: 5,
      }),
    ).resolves.toEqual({
      ok: false,
      service: "boardreadyops-cloud",
      check: "readiness",
      reason: "database-timeout",
    });
  });
});
