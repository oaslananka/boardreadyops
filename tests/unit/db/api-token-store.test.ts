import { describe, expect, it, vi } from "vitest";
import { ApiTokenStore, type StoredApiTokenRow } from "../../../packages/db/src/api-token-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

describe("ApiTokenStore", () => {
  it("creates and validates token with explicit scopes", async () => {
    let mockRow: StoredApiTokenRow | null = null;
    const mockDb: SqlQueryExecutor = {
      query: vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes("insert into api_tokens")) {
          mockRow = {
            id: String(params[0]),
            repository_id: String(params[1]),
            name: String(params[2]),
            token_prefix: String(params[3]),
            token_hash: String(params[4]),
            scopes: params[5] as string[],
            created_by: String(params[6]),
            expires_at: params[7] as string | null,
            revoked_at: null,
            last_used_at: null,
            created_at: String(params[8]),
          };
          return { rows: [mockRow] };
        }
        if (sql.includes("select * from api_tokens")) {
          return { rows: [mockRow] };
        }
        return { rows: [] };
      }),
    };

    const store = new ApiTokenStore(mockDb);

    await expect(store.createToken({ repositoryId: "repo-1", name: "Test Token", scopes: [] })).rejects.toThrow(
      "Explicit scopes are required",
    );

    const { token, record } = await store.createToken({
      repositoryId: "repo-1",
      name: "Test Token",
      scopes: ["runs:write"],
    });

    expect(token).toMatch(/^bro_live_/);
    expect(record.scopes).toEqual(["runs:write"]);

    const validated = await store.validateToken(token);
    expect(validated).toBeDefined();
    expect(validated?.repositoryId).toBe("repo-1");
  });
});
