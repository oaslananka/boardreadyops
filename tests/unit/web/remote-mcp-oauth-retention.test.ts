import { describe, expect, it, vi } from "vitest";
import { purgeExpiredRemoteMcpOAuthSecurityData } from "../../../apps/web/lib/remote-mcp-oauth-abuse.js";

describe("OAuth maintenance migration and database safety", () => {
  it("skips cleanly before either OAuth migration table exists", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ has_buckets: false, has_events: false }] });
    await expect(purgeExpiredRemoteMcpOAuthSecurityData({ query } as never)).resolves.toEqual({
      rateLimitBucketsPurged: 0,
      securityEventsPurged: 0,
      loginResumptionsPurged: 0,
      expiredGrantsPurged: 0,
      expiredAuthorizationsPurged: 0,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("to_regclass");
  });

  it("reports incomplete migration instead of silently ignoring missing audit records", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ has_buckets: true, has_events: false }] });
    await expect(purgeExpiredRemoteMcpOAuthSecurityData({ query } as never)).rejects.toThrow(
      "Incomplete MCP OAuth retention migration",
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("fails closed when OAuth rate-limit/audit migration exists without required grant tables", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ has_buckets: true, has_events: true, has_authorizations: true, has_grants: false }],
    });
    await expect(purgeExpiredRemoteMcpOAuthSecurityData({ query } as never)).rejects.toThrow(
      "Incomplete MCP OAuth retention migration",
    );
    expect(query).toHaveBeenCalledOnce();
  });

  it("requires PostgreSQL to return both bounded delete counts", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ has_buckets: true, has_events: true, has_grants: true, has_authorizations: true }],
      })
      .mockResolvedValueOnce({ rows: [{ n: 2 }] })
      .mockResolvedValueOnce({ rows: [{ n: 3 }] })
      .mockResolvedValueOnce({ rows: [{ n: 4 }] })
      .mockResolvedValueOnce({ rows: [{ n: 5 }] });
    await expect(purgeExpiredRemoteMcpOAuthSecurityData({ query } as never, 7)).resolves.toEqual({
      rateLimitBucketsPurged: 2,
      securityEventsPurged: 3,
      loginResumptionsPurged: 0,
      expiredGrantsPurged: 4,
      expiredAuthorizationsPurged: 5,
    });
    expect(query.mock.calls[1]?.[1]).toEqual([7]);
    expect(query.mock.calls[2]?.[1]).toEqual([7]);
    expect(query.mock.calls[1]?.[0]).toContain("skip locked");
    expect(query.mock.calls[2]?.[0]).toContain("skip locked");
    expect(query.mock.calls[3]?.[0]).toContain("skip locked");
    expect(query.mock.calls[4]?.[0]).toContain("skip locked");
  });

  it("fails closed when PostgreSQL result is malformed", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ has_buckets: true, has_events: true, has_grants: true, has_authorizations: true }],
      })
      .mockResolvedValueOnce({ rows: [{ n: "nonsense" }] })
      .mockResolvedValueOnce({ rows: [{ n: 1 }] })
      .mockResolvedValueOnce({ rows: [{ n: 0 }] })
      .mockResolvedValueOnce({ rows: [{ n: 0 }] });
    await expect(purgeExpiredRemoteMcpOAuthSecurityData({ query } as never)).rejects.toThrow(
      "Invalid MCP OAuth retention result",
    );
  });
});
