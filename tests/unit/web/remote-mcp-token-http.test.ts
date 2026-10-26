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

function streamedTokenRequest(chunks: Uint8Array[], length?: string, onCancel?: () => void): Request {
  let cursor = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (cursor >= chunks.length) controller.close();
      else controller.enqueue(chunks[cursor++] as Uint8Array);
    },
    cancel() {
      onCancel?.();
    },
  });
  return new Request(`${issuer}/oauth/token`, {
    method: "POST",
    body: stream,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(length === undefined ? {} : { "content-length": length }),
    },
    duplex: "half",
  } as RequestInit & { duplex: "half" });
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

  it("rejects a chunked oversized token form before opening any database connection", async () => {
    let canceled = false;
    const encoded = new TextEncoder().encode(new URLSearchParams(validForm).toString());
    const chunks = [encoded, new Uint8Array(4097), new TextEncoder().encode("hidden_secret")];
    const config = deps();
    const response = await handleRemoteMcpTokenRequest(
      streamedTokenRequest(chunks, "5", () => {
        canceled = true;
      }),
      config as never,
    );
    expect(response.status).toBe(400);
    expect(canceled).toBe(true);
    expect(config.openDb).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("rejects invalid token form encoding without opening a database connection", async () => {
    const config = deps();
    const invalidUtf8 = streamedTokenRequest([new Uint8Array([255, 254])]);
    expect((await handleRemoteMcpTokenRequest(invalidUtf8, config as never)).status).toBe(400);
    const invalidLength = streamedTokenRequest([new TextEncoder().encode("valid=1")], "bad");
    expect((await handleRemoteMcpTokenRequest(invalidLength, config as never)).status).toBe(400);
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
