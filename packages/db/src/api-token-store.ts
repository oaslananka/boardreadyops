import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type ApiTokenScope = "runs:write" | "reviews:read" | "reviews:write" | "admin";

export type StoredApiTokenRow = {
  id: string;
  repository_id: string;
  name: string;
  token_prefix: string;
  token_hash: string;
  scopes: string[] | string;
  created_by: string;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
  last_used_at: string | Date | null;
  created_at: string | Date;
};

export type ApiTokenRecord = {
  id: string;
  repositoryId: string;
  name: string;
  tokenPrefix: string;
  scopes: ApiTokenScope[];
  createdBy: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  createdAt: string;
};

function normalizeScopes(scopes: string[] | string): ApiTokenScope[] {
  if (Array.isArray(scopes)) {
    return scopes as ApiTokenScope[];
  }
  if (typeof scopes === "string") {
    // Postgres array string like "{runs:write,reviews:read}"
    const clean = scopes.replace(/^\{|\}$/g, "");
    return clean.split(",").map((s) => s.trim()) as ApiTokenScope[];
  }
  return [];
}

function mapToken(row: StoredApiTokenRow): ApiTokenRecord {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: normalizeScopes(row.scopes),
    createdBy: row.created_by,
    ...(row.expires_at !== null ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.revoked_at !== null ? { revokedAt: new Date(row.revoked_at).toISOString() } : {}),
    ...(row.last_used_at !== null ? { lastUsedAt: new Date(row.last_used_at).toISOString() } : {}),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class ApiTokenStore {
  constructor(private readonly db: SqlQueryExecutor) {}

  async createToken(params: {
    repositoryId: string;
    name: string;
    scopes?: ApiTokenScope[];
    createdBy?: string;
    durationDays?: number;
  }): Promise<{ token: string; record: ApiTokenRecord }> {
    const rawSecret = randomBytes(24).toString("hex");
    const token = `bro_live_${rawSecret}`;
    const tokenPrefix = token.slice(0, 16);
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const id = randomUUID();
    const now = new Date();
    const expiresAt = params.durationDays
      ? new Date(now.getTime() + params.durationDays * 86400 * 1000).toISOString()
      : null;
    const scopes = params.scopes ?? ["runs:write", "reviews:read", "reviews:write"];
    const createdBy = params.createdBy ?? "system";

    const result = await this.db.query(
      `insert into api_tokens (
        id, repository_id, name, token_prefix, token_hash, scopes, created_by, expires_at, created_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      returning *`,
      [id, params.repositoryId, params.name, tokenPrefix, tokenHash, scopes, createdBy, expiresAt, now.toISOString()],
    );

    const rows = ((result as { rows?: StoredApiTokenRow[] }).rows ?? []) as StoredApiTokenRow[];
    const first = rows[0];
    if (!first) {
      throw new Error("Failed to insert api token");
    }

    return {
      token,
      record: mapToken(first),
    };
  }

  async validateToken(rawToken: string): Promise<ApiTokenRecord | undefined> {
    if (!rawToken?.startsWith("bro_live_")) {
      return undefined;
    }

    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const now = new Date().toISOString();

    const result = await this.db.query(
      `select * from api_tokens
       where token_hash = $1
         and revoked_at is null
         and (expires_at is null or expires_at > $2)
       limit 1`,
      [tokenHash, now],
    );

    const rows = ((result as { rows?: StoredApiTokenRow[] }).rows ?? []) as StoredApiTokenRow[];
    const first = rows[0];
    if (!first) {
      return undefined;
    }

    // Touch last_used_at in background
    void this.db.query(`update api_tokens set last_used_at = $1 where id = $2`, [now, first.id]);

    return mapToken(first);
  }

  async revokeToken(repositoryId: string, tokenId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.db.query(
      `update api_tokens set revoked_at = $1 where id = $2 and repository_id = $3 and revoked_at is null returning id`,
      [now, tokenId, repositoryId],
    );
    const rows = ((result as { rows?: { id: string }[] }).rows ?? []) as { id: string }[];
    return rows.length > 0;
  }

  async listTokens(repositoryId: string): Promise<ApiTokenRecord[]> {
    const result = await this.db.query(`select * from api_tokens where repository_id = $1 order by created_at desc`, [
      repositoryId,
    ]);
    const rows = ((result as { rows?: StoredApiTokenRow[] }).rows ?? []) as StoredApiTokenRow[];
    return rows.map(mapToken);
  }
}
