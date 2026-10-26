import { createPrivateKey, createPublicKey } from "node:crypto";
import { exportJWK, SignJWT } from "jose";
import type { SignedRemoteMcpTokenFacts } from "./remote-mcp-authorization-code.js";
import { remoteMcpResource } from "./remote-mcp-foundation.js";

type PublicRsaJwk = {
  kty: "RSA";
  kid: string;
  alg: "RS256";
  use: "sig";
  n: string;
  e: string;
};

/** Accept ONLY public, 2048-bit-or-better RSA signing keys from operator
 * configuration; reject embedded private material, duplicates and ambiguity.
 */
function verifiedPreviousPublicKeys(value: unknown, currentKid: string): PublicRsaJwk[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) throw new Error("Invalid previous MCP JWKS keys");
  const known = new Set([currentKid]);
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid previous MCP JWK");
    const key = entry as Record<string, unknown>;
    if (
      Object.keys(key).some((name) => !["kty", "kid", "alg", "use", "n", "e"].includes(name)) ||
      key.kty !== "RSA" ||
      key.alg !== "RS256" ||
      key.use !== "sig" ||
      typeof key.kid !== "string" ||
      !/^[a-zA-Z0-9_-]{8,128}$/u.test(key.kid) ||
      typeof key.n !== "string" ||
      !/^[A-Za-z0-9_-]{342,1024}$/u.test(key.n) ||
      typeof key.e !== "string" ||
      !/^[A-Za-z0-9_-]{3,12}$/u.test(key.e) ||
      known.has(key.kid)
    )
      throw new Error("Untrusted or duplicate previous MCP JWK");
    const publicKey = createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" });
    if (publicKey.asymmetricKeyType !== "rsa" || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      throw new Error("Previous MCP public key is too short");
    }
    known.add(key.kid);
    return { kty: "RSA", kid: key.kid, alg: "RS256", use: "sig", n: key.n, e: key.e };
  });
}

/** Signing keys arrive only from authorized server-side secret configuration
 * (Doppler in production); never generate a fresh key for each request.
 * A signing key rotation must preserve prior public keys until grants expire.
 */
export function createRemoteMcpTokenIssuer(config: {
  issuer: string;
  privateKeyPem: string;
  keyId: string;
  previousPublicKeys?: unknown;
}): {
  sign: (claims: SignedRemoteMcpTokenFacts) => Promise<string>;
  publicJwks: () => Promise<{ keys: Record<string, unknown>[] }>;
} {
  const parsed = new URL(config.issuer);
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== config.issuer ||
    parsed.username ||
    parsed.password ||
    !/^[a-zA-Z0-9_-]{8,128}$/u.test(config.keyId)
  )
    throw new Error("Invalid MCP token issuer settings");
  const privateKey = createPrivateKey(config.privateKeyPem);
  if (privateKey.asymmetricKeyType !== "rsa" || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new Error("MCP token issuer requires an RSA key of at least 2048 bits");
  }
  const publicKey = createPublicKey(privateKey);
  const previousPublicKeys = verifiedPreviousPublicKeys(config.previousPublicKeys, config.keyId);
  return {
    async sign(claims) {
      if (
        !Number.isSafeInteger(claims.githubUserId) ||
        claims.githubUserId <= 0 ||
        !Number.isSafeInteger(claims.issuedAt) ||
        !Number.isSafeInteger(claims.expiresAt) ||
        claims.expiresAt <= claims.issuedAt ||
        claims.expiresAt - claims.issuedAt > 3600 ||
        !/^[0-9a-f-]{36}$/iu.test(claims.jti) ||
        claims.clientId.length < 1 ||
        claims.clientId.length > 2048 ||
        !["review:read", "evidence:read", "review:read evidence:read", "evidence:read review:read"].includes(
          claims.scope,
        )
      )
        throw new Error("Invalid MCP grant claims");
      return new SignJWT({ githubUserId: claims.githubUserId, clientId: claims.clientId, scope: claims.scope })
        .setProtectedHeader({ alg: "RS256", kid: config.keyId, typ: "at+jwt" })
        .setIssuer(config.issuer)
        .setAudience(remoteMcpResource)
        .setSubject(`github:${claims.githubUserId}`)
        .setJti(claims.jti)
        .setIssuedAt(claims.issuedAt)
        .setExpirationTime(claims.expiresAt)
        .sign(privateKey);
    },
    async publicJwks() {
      const jwk = await exportJWK(publicKey);
      return { keys: [{ ...jwk, kid: config.keyId, alg: "RS256", use: "sig" }, ...previousPublicKeys] };
    },
  };
}

/** RFC 8414, not published until the authorization, token and JWKS routes exist. */
export function remoteMcpAuthorizationServerMetadata(issuer: string) {
  const url = new URL(issuer);
  if (url.protocol !== "https:" || url.origin !== issuer || url.username || url.password) {
    throw new Error("OAuth issuer must be a configured HTTPS origin");
  }
  return {
    issuer,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["review:read", "evidence:read"],
  };
}
