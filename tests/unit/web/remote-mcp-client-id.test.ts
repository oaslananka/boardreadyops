import { describe, expect, it } from "vitest";
import {
  validRemoteMcpOAuthAuthorizationParameters,
  validRemoteMcpOAuthClientId,
} from "../../../apps/web/lib/remote-mcp-authorization-code.js";
import { remoteMcpResource } from "../../../apps/web/lib/remote-mcp-foundation.js";

const consent = (clientId: string) => ({
  responseType: "code",
  clientId,
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
  codeChallenge: "A".repeat(43),
  codeChallengeMethod: "S256",
  state: "long-enough-state",
  scope: "review:read",
  resource: remoteMcpResource,
});

describe("pre-registered OAuth client IDs", () => {
  it.each([
    "https://chatgpt.com/oauth/client.json",
    "https://claude.ai/oauth/mcp-oauth-client-metadata",
    "claude-connector-2026",
    "f0286fe4-3c23-43b0-9071-0e2308241946",
    "client_2026~tenant.v2",
  ])("accepts supported HTTPS or opaque IDs only with complete OAuth parameters: %s", (id) => {
    expect(validRemoteMcpOAuthClientId(id)).toBe(true);
    expect(validRemoteMcpOAuthAuthorizationParameters(consent(id))).toBe(true);
  });

  it.each([
    "",
    "abcd",
    "client id",
    "client\nwith-newline",
    "https://evil.example/#fragment",
    "https://username:secret@evil.example/client",
    "http://evil.example/client",
    "ftp://evil.example/client",
    "//evil.example/client",
    "https://evil.example/a%ZZ",
    "x".repeat(2049),
  ])("denies malformed client identity: %s", (id) => {
    expect(validRemoteMcpOAuthClientId(id)).toBe(false);
    expect(validRemoteMcpOAuthAuthorizationParameters(consent(id))).toBe(false);
  });

  it("never permits redirect URI substitution or weak PKCE even for valid opaque IDs", () => {
    const valid = consent("claude-connector-2026");
    expect(validRemoteMcpOAuthAuthorizationParameters({ ...valid, redirectUri: "http://evil.example" })).toBe(false);
    expect(validRemoteMcpOAuthAuthorizationParameters({ ...valid, codeChallengeMethod: "plain" })).toBe(false);
    expect(validRemoteMcpOAuthAuthorizationParameters({ ...valid, resource: "https://evil.example/mcp" })).toBe(false);
  });
});
