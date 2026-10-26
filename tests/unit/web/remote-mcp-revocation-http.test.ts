import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as routeGet, POST as routePost } from "../../../apps/web/app/oauth/connections/route.js";
import {
  handleRemoteMcpConnectionsGet,
  handleRemoteMcpConnectionsPost,
} from "../../../apps/web/lib/remote-mcp-revocation-http.js";
import { encodeUserSession } from "../../../apps/web/lib/user-session.js";

const issuer = "https://boardreadyops.com";
const secret = "a".repeat(48);
const grantId = randomUUID();
const otherGrant = randomUUID();
const user = 123;
const connectionUrl = `${issuer}/oauth/connections`;
const session = encodeUserSession(
  {
    userId: user,
    login: "test-login",
    installationIds: [],
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  },
  secret,
);
const otherSession = encodeUserSession(
  {
    userId: 987,
    login: "other-login",
    installationIds: [],
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  },
  secret,
);

function database(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  const close = vi.fn().mockResolvedValue(undefined);
  return { query, close };
}
function dependencies(db: ReturnType<typeof database>) {
  return { issuer, sessionSecret: secret, openDb: vi.fn().mockResolvedValue(db) };
}
function requestGet(cookie = session) {
  return new Request(connectionUrl, { headers: { cookie: `brops_session=${cookie}` } });
}
function requestPost(form: URLSearchParams, cookie = session, origin = issuer) {
  return new Request(connectionUrl, {
    method: "POST",
    headers: {
      cookie: `brops_session=${cookie}`,
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
}
const record = (id: string, name = "ChatGPT") => ({
  jti: id,
  client_id: "https://chatgpt.com/client.json",
  display_name: name,
  scope: "review:read",
  expires_at: new Date(Date.now() + 900_000),
});
const extract = (html: string) =>
  [...html.matchAll(/name="grant_id" value="([^"]+)".*?name="csrf" value="([^"]+)"/gsu)].map((match) => ({
    id: match[1] as string,
    csrf: match[2] as string,
  }));

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test form");
  return value;
}
function grantedForm(id: string, csrf: string) {
  return new URLSearchParams({ grant_id: id, csrf });
}

describe("OAuth connection self-service revocation", () => {
  it("lists only the signed-in user's bounded grants with escaped client display and no cache", async () => {
    const db = database([record(grantId, '<img src=x onerror="malicious()">'), record(otherGrant)]);
    const config = dependencies(db);
    const response = await handleRemoteMcpConnectionsGet(requestGet(), config);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain("form-action 'self'");
    const html = await response.text();
    expect(html).toContain("&lt;img src=x onerror=&quot;malicious()&quot;&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain(session);
    expect(extract(html)).toHaveLength(2);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("g.github_user_id = $1"), [user, issuer, 50]);
    expect(db.query.mock.calls[0]?.[0]).toContain("g.revoked_at is null");
    expect(db.close).toHaveBeenCalledOnce();
  });

  it("revokes only the authenticated owner's grant with signed grant/session-bound CSRF", async () => {
    const db = database([record(grantId), record(otherGrant)]);
    const config = dependencies(db);
    const html = await (await handleRemoteMcpConnectionsGet(requestGet(), config)).text();
    const grants = extract(html);
    expect(grants).toHaveLength(2);
    const chosen = required(grants[0]);
    expect(chosen.id).toBe(grantId);
    db.query.mockResolvedValue({ rows: [{ jti: grantId }] });
    const response = await handleRemoteMcpConnectionsPost(requestPost(grantedForm(chosen.id, chosen.csrf)), config);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/oauth/connections");
    expect(db.query.mock.calls.at(-1)?.[0]).toContain("remote_mcp_oauth_security_events");
    expect(db.query.mock.calls.at(-1)?.[1]).toEqual([grantId, user]);
    expect(db.close).toHaveBeenCalledTimes(2);
  });

  it("denies forged grant, other-session CSRF and wrong owner before opening any database", async () => {
    const db = database([record(grantId), record(otherGrant)]);
    const config = dependencies(db);
    const grants = extract(await (await handleRemoteMcpConnectionsGet(requestGet(), config)).text());
    config.openDb.mockClear();
    for (const [id, cookie] of [
      [otherGrant, session],
      [grantId, otherSession],
      [grantId, "bad-token"],
    ]) {
      const response = await handleRemoteMcpConnectionsPost(
        requestPost(grantedForm(id, required(grants[0]).csrf), cookie),
        config,
      );
      expect(response.status).toBe(cookie === "bad-token" ? 401 : 403);
    }
    expect(config.openDb).not.toHaveBeenCalled();
  });

  it("rejects cross-origin, cross-site, missing-origin and duplicate form parameters", async () => {
    const db = database([record(grantId)]);
    const config = dependencies(db);
    const form = grantedForm(
      grantId,
      required(extract(await (await handleRemoteMcpConnectionsGet(requestGet(), config)).text())[0]).csrf,
    );
    config.openDb.mockClear();
    const evil = await handleRemoteMcpConnectionsPost(requestPost(form, session, "https://evil.example"), config);
    expect(evil.status).toBe(403);
    const site = requestPost(form);
    site.headers.set("sec-fetch-site", "cross-site");
    expect((await handleRemoteMcpConnectionsPost(site, config)).status).toBe(403);
    const absent = requestPost(form);
    absent.headers.delete("origin");
    expect((await handleRemoteMcpConnectionsPost(absent, config)).status).toBe(403);
    const duplicate = new URLSearchParams(form);
    duplicate.append("grant_id", otherGrant);
    expect((await handleRemoteMcpConnectionsPost(requestPost(duplicate), config)).status).toBe(400);
    expect(config.openDb).not.toHaveBeenCalled();
  });

  it("denies expired CSRF, malformed cookie and wrong route without listing or mutating grants", async () => {
    const db = database([record(grantId)]);
    const config = dependencies(db);
    expect((await handleRemoteMcpConnectionsGet(requestGet("forged"), config)).status).toBe(401);
    expect(
      (await handleRemoteMcpConnectionsGet(new Request(`${connectionUrl}?grant_id=${grantId}`), config)).status,
    ).toBe(400);
    expect(
      (await handleRemoteMcpConnectionsPost(requestPost(grantedForm(grantId, "123.invalid.invalid")), config)).status,
    ).toBe(403);
    expect(config.openDb).not.toHaveBeenCalled();
  });

  it("expires each consent-derived revocation token after ten minutes even when session remains active", async () => {
    const db = database([record(grantId)]);
    const config = dependencies(db);
    const html = await (await handleRemoteMcpConnectionsGet(requestGet(), config)).text();
    const csrf = required(extract(html)[0]).csrf;
    config.openDb.mockClear();
    try {
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 601_000);
      expect((await handleRemoteMcpConnectionsPost(requestPost(grantedForm(grantId, csrf)), config)).status).toBe(403);
      expect(config.openDb).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a bounded form exceeding two kilobytes before touching the revocation database", async () => {
    const db = database();
    const config = dependencies(db);
    const request = requestPost(
      new URLSearchParams({
        grant_id: grantId,
        csrf: "x".repeat(3_000),
      }),
    );
    expect((await handleRemoteMcpConnectionsPost(request, config)).status).toBe(400);
    expect(config.openDb).not.toHaveBeenCalled();
  });

  it("returns a generic redirect for idempotent revocation without revealing other users' grants", async () => {
    const db = database([record(grantId)]);
    const config = dependencies(db);
    const html = await (await handleRemoteMcpConnectionsGet(requestGet(), config)).text();
    db.query.mockResolvedValue({ rows: [] });
    const chosen = required(extract(html)[0]);
    const result = await handleRemoteMcpConnectionsPost(requestPost(grantedForm(chosen.id, chosen.csrf)), config);
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe("/oauth/connections");
  });

  it("fails closed without leaking SQL diagnostics and always closes its connection", async () => {
    const db = database([record(grantId)]);
    const config = dependencies(db);
    const csrf = required(extract(await (await handleRemoteMcpConnectionsGet(requestGet(), config)).text())[0]).csrf;
    db.query.mockRejectedValue(new Error("private database password"));
    const response = await handleRemoteMcpConnectionsPost(requestPost(grantedForm(grantId, csrf)), config);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("password");
    expect(db.close).toHaveBeenCalledTimes(2);
  });
});

describe("OAuth connections routes stay closed unless configured", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("keeps GET and POST behind the disabled-by-default OAuth release gate", async () => {
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED", "false");
    expect((await routeGet(requestGet())).status).toBe(503);
    expect((await routePost(requestPost(new URLSearchParams({ grant_id: grantId, csrf: "invalid" })))).status).toBe(
      503,
    );
  });
});
