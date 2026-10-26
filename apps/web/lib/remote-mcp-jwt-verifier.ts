import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { RemoteMcpTokenVerifier, SignedRemoteMcpClaims } from "./remote-mcp-access.js";
import { remoteMcpResource } from "./remote-mcp-foundation.js";

/** Access-token confusion defense (RFC 9068): only this issuer's RS256
 * at+jwt tokens authenticate MCP. Another JWT type (ID/session) or algorithm
 * must not be accepted, even if it contains the same claims and is signed.
 */
export function createRemoteMcpJwtVerifier(input: {
  issuer: string;
  verifyKey: JWTVerifyGetKey;
  activeGrant(jti: string, githubUserId: number, clientId: string, scope: string, issuer: string): Promise<boolean>;
}): RemoteMcpTokenVerifier {
  return {
    async verifySignedAccessToken(token) {
      try {
        const { payload } = await jwtVerify(token, input.verifyKey, {
          issuer: input.issuer,
          audience: remoteMcpResource,
          algorithms: ["RS256"],
          typ: "at+jwt",
          maxTokenAge: "1h",
        });
        if (
          typeof payload.iss !== "string" ||
          typeof payload.sub !== "string" ||
          typeof payload.jti !== "string" ||
          typeof payload.iat !== "number" ||
          typeof payload.exp !== "number" ||
          typeof payload.scope !== "string" ||
          typeof payload.githubUserId !== "number" ||
          typeof payload.clientId !== "string" ||
          payload.aud === undefined
        )
          return null;
        return payload as unknown as SignedRemoteMcpClaims;
      } catch {
        return null;
      }
    },
    grantIsActive: (jti, githubUserId, clientId, scope) =>
      input.activeGrant(jti, githubUserId, clientId, scope, input.issuer),
  };
}

/** A JWKS must come from the explicitly configured HTTPS issuer, not a JWT header URL. */
export function createProductionRemoteMcpJwtVerifier(input: {
  issuer: string;
  jwksUrl: string;
  activeGrant(jti: string, githubUserId: number, clientId: string, scope: string, issuer: string): Promise<boolean>;
}): RemoteMcpTokenVerifier | null {
  try {
    const issuer = new URL(input.issuer);
    const jwks = new URL(input.jwksUrl);
    if (
      issuer.protocol !== "https:" ||
      issuer.origin !== input.issuer ||
      jwks.protocol !== "https:" ||
      jwks.href !== `${input.issuer}/.well-known/jwks.json` ||
      issuer.origin !== jwks.origin ||
      jwks.username ||
      jwks.password ||
      issuer.username ||
      issuer.password ||
      issuer.hash ||
      issuer.search ||
      jwks.search ||
      jwks.hash ||
      jwks.pathname !== "/.well-known/jwks.json"
    )
      return null;
    return createRemoteMcpJwtVerifier({
      issuer: input.issuer,
      verifyKey: createRemoteJWKSet(jwks, { timeoutDuration: 3000, cooldownDuration: 30000 }),
      activeGrant: input.activeGrant,
    });
  } catch {
    return null;
  }
}
