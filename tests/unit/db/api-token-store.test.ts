import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiTokenStore, type StoredApiTokenRow } from "../../../packages/db/src/api-token-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

class MockTokenDb implements SqlQueryExecutor {
  tokens: StoredApiTokenRow[] = [];

  async query(sql: string, params: readonly unknown[] = []): Promise<{ rows: unknown[] }> {
    const s = sql.toLowerCase();

    // Insert token
    if (s.includes("insert into api_tokens")) {
      const row: StoredApiTokenRow = {
        id: params[0] as string,
        repository_id: params[1] as string,
        name: params[2] as string,
        token_prefix: params[3] as string,
        token_hash: params[4] as string,
        scopes: params[5] as string[],
        created_by: params[6] as string,
        expires_at: (params[7] as string | null) ?? null,
        revoked_at: null,
        last_used_at: null,
        created_at: params[8] as string,
      };
      this.tokens.push(row);
      return { rows: [row] };
    }

    // Validate token
    if (s.includes("from api_tokens") && s.includes("token_hash = $1")) {
      const hash = params[0] as string;
      const now = new Date(params[1] as string).getTime();
      const match = this.tokens.find(
        (t) =>
          t.token_hash === hash &&
          t.revoked_at === null &&
          (t.expires_at === null || new Date(t.expires_at).getTime() > now),
      );
      return { rows: match ? [match] : [] };
    }

    // Update last_used_at
    if (s.includes("update api_tokens set last_used_at = $1")) {
      const lastUsed = params[0] as string;
      const id = params[1] as string;
      const match = this.tokens.find((t) => t.id === id);
      if (match) {
        match.last_used_at = lastUsed;
      }
      return { rows: [] };
    }

    // Revoke token
    if (s.includes("update api_tokens set revoked_at = $1")) {
      const now = params[0] as string;
      const id = params[1] as string;
      const repoId = params[2] as string;
      const match = this.tokens.find((t) => t.id === id && t.repository_id === repoId && t.revoked_at === null);
      if (match) {
        match.revoked_at = now;
        return { rows: [{ id: match.id }] };
      }
      return { rows: [] };
    }

    // List tokens
    if (s.includes("select * from api_tokens where repository_id = $1")) {
      const repoId = params[0] as string;
      const matches = this.tokens.filter((t) => t.repository_id === repoId);
      return { rows: matches };
    }

    return { rows: [] };
  }
}

describe("ApiTokenStore", () => {
  it("creates, validates, and revokes workspace API tokens with SHA-256 hashing", async () => {
    const db = new MockTokenDb();
    const store = new ApiTokenStore(db);

    const { token, record } = await store.createToken({
      repositoryId: "repo-123",
      name: "CI Action Token",
      scopes: ["runs:write", "reviews:read"],
      createdBy: "user-1",
      durationDays: 30,
    });

    expect(token).toMatch(/^bro_live_[0-9a-f]{48}$/);
    expect(record.repositoryId).toBe("repo-123");
    expect(record.name).toBe("CI Action Token");
    expect(record.tokenPrefix).toBe(token.slice(0, 16));
    expect(record.scopes).toEqual(["runs:write", "reviews:read"]);

    // Raw token is NEVER stored in database
    const storedHash = createHash("sha256").update(token).digest("hex");
    expect(db.tokens[0]?.token_hash).toBe(storedHash);
    expect(db.tokens[0]?.token_hash).not.toBe(token);

    // Validation
    const validated = await store.validateToken(token);
    expect(validated).toBeDefined();
    expect(validated?.id).toBe(record.id);
    expect(validated?.repositoryId).toBe("repo-123");

    // Invalid token returns undefined
    const badToken = await store.validateToken("bro_live_invalidinvalidinvalid");
    expect(badToken).toBeUndefined();

    // Revoke token
    const revoked = await store.revokeToken("repo-123", record.id);
    expect(revoked).toBe(true);

    // After revocation, validation fails
    const revalidated = await store.validateToken(token);
    expect(revalidated).toBeUndefined();
  });
});
