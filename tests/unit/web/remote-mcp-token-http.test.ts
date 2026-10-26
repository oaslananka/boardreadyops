import { describe, expect, it, vi } from "vitest";
import { remoteMcpResource } from "../../../apps/web/lib/remote-mcp-foundation.js";
import { handleRemoteMcpTokenRequest } from "../../../apps/web/lib/remote-mcp-token-http.js";

const issuer = "https://id.boardreadyops.com";
const validForm = {
  grant_type: "authorization_code",
  client_id: "https://trusted.example/oauth-client.json",
  redirect_uri: "https://trusted.example/callback",
  code_verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  code: "A".repeat(43),
  resource: remoteMcpResource,
};
const deps = () => ({ issuer, openDb: vi.fn(), signAccessToken: vi.fn() });
function request(form: Record<string, string>, headers: HeadersInit = {}, url = `${issuer}/oauth/token`) {
  return new Request(url, {
    method: "POST",
    body: new URLSearchParams(form).toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
  });
}

describe("OAuth token HTTP input boundary", () => {
  it.each([
    ["wrong resource", { ...validForm, resource: "https://other.example/mcp" }],
    ["unknown grant", { ...validForm, grant_type: "refresh_token" }],
    ["missing code", { ...validForm, code: "" }],
    ["missing verifier", { ...validForm, code_verifier: "" }],
  ] as const)("rejects %s without opening database", async (_, form) => {
    const config = deps();
    const response = await handleRemoteMcpTokenRequest(request(form), config as never);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(config.openDb).not.toHaveBeenCalled();
  });

  it("rejects duplicate parameters, client secrets, cookies, query tokens and wrong endpoint", async () => {
    const config = deps();
    for (const req of [
      new Request(`${issuer}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...validForm, client_secret: "forbidden" }).toString(),
      }),
      new Request(`${issuer}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `${new URLSearchParams(validForm).toString()}&client_id=https%3A%2F%2Fevil.example`,
      }),
      request(validForm, { cookie: "brops_session=unsafe" }),
      request(validForm, {}, `${issuer}/oauth/token?access_token=secret`),
      request(validForm, {}, "https://evil.example/oauth/token"),
      new Request(`${issuer}/oauth/token`, { method: "GET" }),
    ]) {
      expect((await handleRemoteMcpTokenRequest(req, config as never)).status).toBe(400);
    }
    expect(config.openDb).not.toHaveBeenCalled();
  });
});
