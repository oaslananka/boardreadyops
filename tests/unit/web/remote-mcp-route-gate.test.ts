import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "../../../apps/web/app/mcp/route.js";
import { remoteMcpResource } from "../../../apps/web/lib/remote-mcp-foundation.js";

const gate = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("../../../apps/web/lib/remote-mcp-production.js", () => ({
  prepareConfiguredRemoteMcpProductionHandler: gate.prepare,
}));

const methods = [
  ["GET", GET],
  ["POST", POST],
  ["DELETE", DELETE],
] as const;

function request(method: string): Request {
  return new Request(remoteMcpResource, {
    method,
    headers: { authorization: "Bearer fixture", cookie: "brops_session=never-authorize-from-cookie" },
  });
}

describe("remote MCP route explicit double release gate", () => {
  beforeEach(() => {
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED", "false");
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_HANDLER_READY", "false");
    gate.prepare.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("always returns 503 for GET/POST/DELETE while disabled, without constructing an OAuth verifier", async () => {
    for (const [method, handler] of methods) {
      const result = await handler(request(method));
      expect(result.status).toBe(503);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(await result.json()).toMatchObject({ error: "remote_mcp_not_available" });
    }
    expect(gate.prepare).not.toHaveBeenCalled();
  });

  it.each([
    ["true", "false"],
    ["false", "true"],
    ["true", "missing"],
  ])("denies when OAuth=%s MCP=%s without touching signing material", async (oauth, mcp) => {
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED", oauth);
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_HANDLER_READY", mcp);
    const result = await POST(request("POST"));
    expect(result.status).toBe(503);
    expect(gate.prepare).not.toHaveBeenCalled();
  });

  it("fails closed if the prepared handler is unavailable or throws", async () => {
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED", "true");
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_HANDLER_READY", "true");
    gate.prepare
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("secret should never appear"))
      .mockResolvedValueOnce(async () => {
        throw new Error("remote signing failure");
      });
    for (const [method, handler] of methods) {
      const result = await handler(request(method));
      expect(result.status).toBe(503);
      expect(await result.text()).not.toContain("secret");
      expect(result.headers.get("cache-control")).toBe("no-store");
    }
    expect(gate.prepare).toHaveBeenCalledTimes(3);
  });

  it("passes the unchanged request through only after both explicit flags and a prepared handler", async () => {
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED", "true");
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_HANDLER_READY", "true");
    const handle = vi.fn(
      async (_req: Request) =>
        new Response("authorized MCP adapter", {
          status: 200,
          headers: { "cache-control": "private, no-store" },
        }),
    );
    gate.prepare.mockResolvedValue(handle);
    for (const [method, route] of methods) {
      const input = request(method);
      const result = await route(input);
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("private, no-store");
      expect(await result.text()).toBe("authorized MCP adapter");
      expect(handle).toHaveBeenLastCalledWith(input);
    }
  });
});
