import { createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { createLocalJWKSet, exportJWK, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { remoteMcpResource } from "../../../apps/web/lib/remote-mcp-foundation.js";
import { configuredRemoteMcpOAuth } from "../../../apps/web/lib/remote-mcp-oauth-config.js";
import { createRemoteMcpTokenIssuer } from "../../../apps/web/lib/remote-mcp-token-issuer.js";

const issuer = "https://boardreadyops.com";
function keyMaterial() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: createPublicKey(privateKey),
  };
}
const facts = () => ({
  githubUserId: 123,
  clientId: "https://client.example/meta",
  scope: "review:read",
  jti: randomUUID(),
  issuedAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 600,
});

describe("remote MCP planned RS256 public-key rotation", () => {
  it("validates tokens from both current and previous public keys without retaining an old private key", async () => {
    const old = keyMaterial();
    const current = keyMaterial();
    const oldIssuer = createRemoteMcpTokenIssuer({ issuer, privateKeyPem: old.privatePem, keyId: "old-2026-key" });
    const oldPublic = await exportJWK(old.publicKey);
    const previous = [{ ...oldPublic, kid: "old-2026-key", alg: "RS256", use: "sig" }];
    const newIssuer = createRemoteMcpTokenIssuer({
      issuer,
      privateKeyPem: current.privatePem,
      keyId: "new-2026-key",
      previousPublicKeys: previous,
    });
    const published = await newIssuer.publicJwks();
    expect(published.keys).toHaveLength(2);
    for (const key of published.keys) {
      expect(key).not.toHaveProperty("d");
      expect(key).not.toHaveProperty("p");
      expect(key).not.toHaveProperty("q");
      expect(key.alg).toBe("RS256");
    }
    const verifyingKeyset = createLocalJWKSet(published as never);
    for (const signed of [await oldIssuer.sign(facts()), await newIssuer.sign(facts())]) {
      const { payload } = await jwtVerify(signed, verifyingKeyset, {
        issuer,
        audience: remoteMcpResource,
        algorithms: ["RS256"],
      });
      expect(payload.githubUserId).toBe(123);
    }
    const freshWithoutOld = createRemoteMcpTokenIssuer({
      issuer,
      privateKeyPem: current.privatePem,
      keyId: "new-2026-key",
    });
    await expect(
      jwtVerify(await oldIssuer.sign(facts()), createLocalJWKSet((await freshWithoutOld.publicJwks()) as never), {
        issuer,
        audience: remoteMcpResource,
      }),
    ).rejects.toThrow();
  });

  it("rejects private JWK fields, reused kid, weak keys and unexpected algorithm", async () => {
    const old = keyMaterial();
    const current = keyMaterial();
    const oldPublic = await exportJWK(old.publicKey);
    const proper = { ...oldPublic, kid: "old-2026-key", alg: "RS256", use: "sig" };
    const base = { issuer, privateKeyPem: current.privatePem, keyId: "new-2026-key" };
    for (const invalid of [
      { ...proper, d: "private-data" },
      { ...proper, kid: "new-2026-key" },
      { ...proper, alg: "HS256" },
      { ...proper, n: "short" },
    ]) {
      expect(() => createRemoteMcpTokenIssuer({ ...base, previousPublicKeys: [invalid] })).toThrow();
    }
  });

  it("requires a strict JWKS document and fails configuration closed", async () => {
    const old = keyMaterial();
    const current = keyMaterial();
    const previous = { ...(await exportJWK(old.publicKey)), kid: "old-2026-key", alg: "RS256", use: "sig" };
    const base = {
      BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED: "true",
      BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER: issuer,
      BOARDREADYOPS_REMOTE_MCP_RSA_PRIVATE_KEY: current.privatePem,
      BOARDREADYOPS_REMOTE_MCP_KEY_ID: "new-2026-key",
      DATABASE_URL: "postgresql://somewhere/unused",
      SESSION_SECRET: "s".repeat(48),
    };
    const valid = configuredRemoteMcpOAuth({
      ...base,
      BOARDREADYOPS_REMOTE_MCP_PREVIOUS_PUBLIC_JWKS: JSON.stringify({ keys: [previous] }),
    });
    expect((await valid?.tokenIssuer.publicJwks())?.keys).toHaveLength(2);
    expect(
      configuredRemoteMcpOAuth({ ...base, BOARDREADYOPS_REMOTE_MCP_PREVIOUS_PUBLIC_JWKS: JSON.stringify([previous]) }),
    ).toBeNull();
    expect(
      configuredRemoteMcpOAuth({ ...base, BOARDREADYOPS_REMOTE_MCP_PREVIOUS_PUBLIC_JWKS: "untrusted" }),
    ).toBeNull();
  });
});
