import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../apps/web/lib/cloud-runtime-config.js", () => ({
  optionalCloudPersistenceConfiguration: () => ({
    mode: "postgres",
    databaseUrl: process.env.DATABASE_URL ?? "",
  }),
}));

import {
  consumeHistoricalStepUp,
  startHistoricalStepUp,
} from "../../apps/web/lib/data-export-historical-oauth-roundtrip.js";
import { encodeUserSession } from "../../apps/web/lib/user-session.js";
import {
  confirmHistoricalUserLiveOAuthProof,
  consumeHistoricalUserOAuthChallenge,
  inspectHistoricalUserLiveOAuthProof,
  registerHistoricalUserOAuthChallenge,
  revokeHistoricalUserLiveOAuthProof,
} from "../../packages/db/src/data-export-historical-oauth-challenges.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDb = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString, max: 8 }) : null;
const tenant = `nonce-original-user-${randomUUID()}`;
const exportId = randomUUID();
const installationId = randomUUID();
const userId = 9_235_788_881;
const holdId = randomUUID();
const erasureId = randomUUID();
const issue = () => randomBytes(32).toString("base64url");
const identity = (state: string, override?: Partial<{ exportId: string; verifiedGitHubUserId: number }>) => ({
  exportId,
  verifiedGitHubUserId: userId,
  state,
  ...override,
});

function executor() {
  if (!db) throw new Error("Disposable PostgreSQL required");
  return db;
}
async function rows(sql: string, params: unknown[] = []) {
  const result = await executor().query(sql, params);
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

beforeAll(async () => {
  if (!db) return;
  await executor().query(
    "INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at) VALUES($1,$2,$3,'User',$4,NOW())",
    [installationId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant, userId],
  );
  await executor().query(
    "INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id) VALUES($1,$2,'github_app_uninstall','pending','user',$2,$3)",
    [exportId, tenant, userId],
  );
});
afterAll(async () => {
  if (!db) return;
  try {
    await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
    await executor().query("DELETE FROM erasure_requests WHERE id=$1", [erasureId]);
    await executor().query("DELETE FROM data_exports WHERE id=$1", [exportId]);
    await executor().query("DELETE FROM installations WHERE id=$1", [installationId]);
  } finally {
    await db.close();
  }
});

describeDb("disposable PostgreSQL: original USER OAuth digest challenge is irreversible", () => {
  it("registers an original-user scoped hashed nonce and atomically consumes once, never storing raw nonce", async () => {
    const state = issue();
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(false);
    const matched = await rows(
      "SELECT state_sha256,original_github_user_id,consumed_at,purpose FROM historical_user_oauth_challenges WHERE export_id=$1 AND original_github_user_id=$2 AND consumed_at IS NULL",
      [exportId, userId],
    );
    expect(matched).toHaveLength(1);
    expect(matched[0]?.state_sha256).toBe(
      createHash("sha256")
        .update("boardreadyops-original-user-oauth-state-v1")
        .update("\0")
        .update(state)
        .digest("hex"),
    );
    expect(JSON.stringify(matched)).not.toContain(state);
    expect(matched[0]?.purpose).toBe("historical-user-oauth-private-authentication");
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(false);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(issue()))).toBe(false);
    const after = await rows("SELECT consumed_at FROM historical_user_oauth_challenges WHERE state_sha256=$1", [
      matched[0]?.state_sha256,
    ]);
    expect(after[0]?.consumed_at).not.toBeNull();
    await expect(
      executor().query("UPDATE historical_user_oauth_challenges SET consumed_at=NULL WHERE state_sha256=$1", [
        matched[0]?.state_sha256,
      ]),
    ).rejects.toThrow();
    await expect(
      executor().query("DELETE FROM historical_user_oauth_challenges WHERE state_sha256=$1", [
        matched[0]?.state_sha256,
      ]),
    ).rejects.toThrow();
  });

  it("durably confirms and one-way revokes ONLY a consumed successful original-user OAuth challenge", async () => {
    const state = issue();
    const subject = identity(state);
    const hashedState = createHash("sha256")
      .update("boardreadyops-original-user-oauth-state-v1")
      .update("\0")
      .update(state)
      .digest("hex");
    expect(await registerHistoricalUserOAuthChallenge(executor(), subject)).toBe(true);
    expect(await confirmHistoricalUserLiveOAuthProof(executor(), subject)).toBe(false);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), subject)).toBe(true);
    expect(await confirmHistoricalUserLiveOAuthProof(executor(), subject)).toBe(true);
    expect(await confirmHistoricalUserLiveOAuthProof(executor(), subject)).toBe(false);
    expect(await inspectHistoricalUserLiveOAuthProof(executor(), subject)).toBe("current");
    const confirmed = await rows(
      "SELECT state_sha256,original_github_user_id,verified_at,expires_at,revoked_at,purpose,complete_customer_export,customer_delivery_allowed FROM historical_user_live_oauth_verified_proofs WHERE export_id=$1 AND state_sha256=$2",
      [exportId, hashedState],
    );
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({
      state_sha256: hashedState,
      original_github_user_id: String(userId),
      revoked_at: null,
      purpose: "private-original-user-live-oauth-proof",
      complete_customer_export: false,
      customer_delivery_allowed: false,
    });
    expect(JSON.stringify(confirmed)).not.toContain(state);
    expect(confirmed[0]?.verified_at).toBeInstanceOf(Date);
    expect(confirmed[0]?.expires_at).toBeInstanceOf(Date);
    const record = confirmed[0];
    if (!(record?.verified_at instanceof Date) || !(record.expires_at instanceof Date))
      throw new Error("Missing bounded live OAuth evidence timestamps");
    const delta = record.expires_at.getTime() - record.verified_at.getTime();
    expect(delta).toBe(5 * 60_000);
    await expect(
      executor().query(
        "UPDATE historical_user_live_oauth_verified_proofs SET customer_delivery_allowed=true WHERE state_sha256=$1",
        [hashedState],
      ),
    ).rejects.toThrow();
    await expect(
      executor().query(
        "UPDATE historical_user_live_oauth_verified_proofs SET original_github_user_id=$2 WHERE state_sha256=$1",
        [hashedState, userId + 1],
      ),
    ).rejects.toThrow();
    await expect(
      executor().query("DELETE FROM historical_user_live_oauth_verified_proofs WHERE state_sha256=$1", [hashedState]),
    ).rejects.toThrow();
    expect(await revokeHistoricalUserLiveOAuthProof(executor(), subject)).toBe(true);
    expect(await revokeHistoricalUserLiveOAuthProof(executor(), subject)).toBe(false);
    expect(await inspectHistoricalUserLiveOAuthProof(executor(), subject)).toBe("stale");
    await expect(
      executor().query("UPDATE historical_user_live_oauth_verified_proofs SET revoked_at=NULL WHERE state_sha256=$1", [
        hashedState,
      ]),
    ).rejects.toThrow();
  });

  it("never allows a proof from another original USER, wrong export, expired nonce or revoked source", async () => {
    const state = issue();
    const subject = identity(state);
    expect(await registerHistoricalUserOAuthChallenge(executor(), subject)).toBe(true);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), subject)).toBe(true);
    expect(
      await confirmHistoricalUserLiveOAuthProof(executor(), identity(state, { verifiedGitHubUserId: userId + 1 })),
    ).toBe(false);
    expect(await confirmHistoricalUserLiveOAuthProof(executor(), identity(state, { exportId: randomUUID() }))).toBe(
      false,
    );
    expect(
      await inspectHistoricalUserLiveOAuthProof(executor(), identity(state, { verifiedGitHubUserId: userId + 1 })),
    ).toBe("stale");
    expect(await confirmHistoricalUserLiveOAuthProof(executor(), subject)).toBe(true);
    expect(await inspectHistoricalUserLiveOAuthProof(executor(), identity(issue()))).toBe("stale");
    await executor().query("UPDATE data_exports SET status='failed' WHERE id=$1", [exportId]);
    expect(await inspectHistoricalUserLiveOAuthProof(executor(), subject)).toBe("stale");
    expect(await revokeHistoricalUserLiveOAuthProof(executor(), subject)).toBe(false);
    await executor().query("UPDATE data_exports SET status='pending' WHERE id=$1", [exportId]);
    const expired = issue();
    const digest = createHash("sha256")
      .update("boardreadyops-original-user-oauth-state-v1")
      .update("\0")
      .update(expired)
      .digest("hex");
    await executor().query(
      "INSERT INTO historical_user_oauth_challenges(state_sha256,export_id,original_github_user_id,created_at,expires_at,consumed_at) VALUES($1,$2,$3,clock_timestamp()-INTERVAL '9 minutes',clock_timestamp()-INTERVAL '4 minutes',clock_timestamp()-INTERVAL '5 minutes')",
      [digest, exportId, userId],
    );
    expect(await confirmHistoricalUserLiveOAuthProof(executor(), identity(expired))).toBe(false);
  });

  it("denies live verification confirmation/inspection/revocation through real hold and erasure fences", async () => {
    const state = issue();
    const subject = identity(state);
    expect(await registerHistoricalUserOAuthChallenge(executor(), subject)).toBe(true);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), subject)).toBe(true);
    const localHoldId = randomUUID();
    const localErasureId = randomUUID();
    try {
      await executor().query(
        "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id) VALUES($1,$2,'test','Historical live proof hold','user',$2)",
        [localHoldId, tenant],
      );
      expect(await confirmHistoricalUserLiveOAuthProof(executor(), subject)).toBe(false);
      expect(await inspectHistoricalUserLiveOAuthProof(executor(), subject)).toBe("stale");
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [localHoldId]);
      expect(await confirmHistoricalUserLiveOAuthProof(executor(), subject)).toBe(true);
      await executor().query(
        "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run) VALUES($1,$2,'test','user',$2,'running',FALSE)",
        [localErasureId, tenant],
      );
      expect(await inspectHistoricalUserLiveOAuthProof(executor(), subject)).toBe("stale");
      expect(await revokeHistoricalUserLiveOAuthProof(executor(), subject)).toBe(false);
      await executor().query("DELETE FROM erasure_requests WHERE id=$1", [localErasureId]);
      expect(await inspectHistoricalUserLiveOAuthProof(executor(), subject)).toBe("current");
      expect(await revokeHistoricalUserLiveOAuthProof(executor(), subject)).toBe(true);
    } finally {
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [localHoldId]);
      await executor().query("DELETE FROM erasure_requests WHERE id=$1", [localErasureId]);
    }
  });

  it("persists at most one successful verified OAuth proof per consumed state across workers", async () => {
    const state = issue();
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => confirmHistoricalUserLiveOAuthProof(executor(), identity(state))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((ok) => !ok)).toHaveLength(5);
  });

  it("rejects wrong numeric USER, unknown state/export, unsuspended App and non-pending exports", async () => {
    const state = issue();
    expect(
      await registerHistoricalUserOAuthChallenge(executor(), identity(state, { verifiedGitHubUserId: userId + 1 })),
    ).toBe(false);
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity("not-a-32byte-nonce"))).toBe(false);
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(state, { exportId: randomUUID() }))).toBe(
      false,
    );
    await executor().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [installationId]);
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(false);
    await executor().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installationId]);
    await executor().query("UPDATE data_exports SET status='failed' WHERE id=$1", [exportId]);
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(false);
    await executor().query("UPDATE data_exports SET status='pending' WHERE id=$1", [exportId]);
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
    expect(
      await consumeHistoricalUserOAuthChallenge(executor(), identity(state, { verifiedGitHubUserId: userId + 1 })),
    ).toBe(false);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state, { exportId: randomUUID() }))).toBe(
      false,
    );
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
  });

  it("only one of 12 concurrent original-user callbacks consumes the same nonce across connections", async () => {
    const state = issue();
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
    const accepted = await Promise.all(
      Array.from({ length: 12 }, () => consumeHistoricalUserOAuthChallenge(executor(), identity(state))),
    );
    expect(accepted.filter(Boolean)).toHaveLength(1);
    expect(accepted.filter((ok) => !ok)).toHaveLength(11);
  });

  it("expires old DB nonces even with otherwise valid HMAC/session cookies", async () => {
    const state = issue();
    const hash = createHash("sha256")
      .update("boardreadyops-original-user-oauth-state-v1")
      .update("\0")
      .update(state)
      .digest("hex");
    await executor().query(
      "INSERT INTO historical_user_oauth_challenges(state_sha256,export_id,original_github_user_id,created_at,expires_at) VALUES($1,$2,$3,clock_timestamp()-INTERVAL '7 minutes',clock_timestamp()-INTERVAL '4 minutes')",
      [hash, exportId, userId],
    );
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(false);
    const result = await rows("SELECT consumed_at FROM historical_user_oauth_challenges WHERE state_sha256=$1", [hash]);
    expect(result).toEqual([expect.objectContaining({ consumed_at: null })]);
  });

  it("fails closed while a different transaction is writing an uncommitted legal hold", async () => {
    const state = issue();
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
    const pendingHoldId = randomUUID();
    let notifyReady: () => void = () => undefined;
    let releaseWriter: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      notifyReady = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const writer = executor().withTransaction(async (tx) => {
      await tx.query(
        "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id) VALUES($1,$2,'test','Held during original user login','user',$2)",
        [pendingHoldId, tenant],
      );
      notifyReady();
      await blocked;
    });
    await ready;
    try {
      // The writer's RowExclusive table lock conflicts with our SHARE NOWAIT.
      // An uncommitted hold must not be silently missed by a SELECT EXISTS.
      expect(await registerHistoricalUserOAuthChallenge(executor(), identity(issue()))).toBe(false);
      expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(false);
    } finally {
      releaseWriter();
      await writer;
    }
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(false);
    await executor().query("DELETE FROM legal_holds WHERE id=$1", [pendingHoldId]);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
  });

  it("fails closed while an erasure writer holds the same tenant advisory lock before commit", async () => {
    const state = issue();
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
    const pendingErasureId = randomUUID();
    let notifyReady: () => void = () => undefined;
    let releaseWriter: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      notifyReady = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const writer = executor().withTransaction(async (tx) => {
      // Trigger from migration 0117 takes tenant advisory lock on this
      // real running-erasure write, before the transaction commits.
      await tx.query(
        "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run) VALUES($1,$2,'test','user',$2,'running',FALSE)",
        [pendingErasureId, tenant],
      );
      notifyReady();
      await blocked;
    });
    await ready;
    try {
      expect(await registerHistoricalUserOAuthChallenge(executor(), identity(issue()))).toBe(false);
      expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(false);
    } finally {
      releaseWriter();
      await writer;
    }
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(false);
    await executor().query("DELETE FROM erasure_requests WHERE id=$1", [pendingErasureId]);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
  });

  it("denies nonce issue/consume during hold or real running erasure; dry-run does not block", async () => {
    const state = issue();
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
    await executor().query(
      "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id) VALUES($1,$2,'test','Historical OAuth hold','user',$3)",
      [holdId, tenant.toUpperCase(), tenant],
    );
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(issue()))).toBe(false);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(false);
    await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
    await executor().query(
      "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run) VALUES($1,$2,'test','user',$2,'running',TRUE)",
      [erasureId, tenant],
    );
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(issue()))).toBe(true);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
    const blocked = issue();
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(blocked))).toBe(true);
    await executor().query("UPDATE erasure_requests SET dry_run=FALSE WHERE id=$1", [erasureId]);
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(issue()))).toBe(false);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(blocked))).toBe(false);
    await executor().query("UPDATE erasure_requests SET status='completed',completed_at=NOW() WHERE id=$1", [
      erasureId,
    ]);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(blocked))).toBe(false);
    await executor().query("DELETE FROM erasure_requests WHERE id=$1", [erasureId]);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(blocked))).toBe(true);
  });

  it("uses REAL PostgreSQL to enforce one live HTTP start + callback against concurrent replay before GitHub", async () => {
    const secret = "server-test-historical-challenge-secret-2026-".repeat(2);
    const environment = {
      SESSION_SECRET: secret,
      GITHUB_CLIENT_ID: "Iv1.test-client",
      GITHUB_CLIENT_SECRET: "fixture-oauth-client-secret",
      BOARDREADYOPS_PUBLIC_URL: "https://boardreadyops.example/",
      BOARDREADYOPS_ENABLE_HISTORICAL_OAUTH_STEPUP: "true",
    };
    const timestamp = new Date();
    const issuedAt = new Date(timestamp.getTime() - 1000);
    const session = encodeUserSession(
      {
        userId,
        login: "renamed-original",
        installationIds: [],
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000).toISOString(),
      },
      secret,
    );
    const start = await startHistoricalStepUp(
      new Request(`https://boardreadyops.example/api/auth/github/historical-step-up?exportId=${exportId}`, {
        headers: { cookie: `brops_session=${session}` },
      }),
      environment,
    );
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toContain("https://github.com/login/oauth/authorize");
    const cookieLines = start.headers.getSetCookie();
    expect(cookieLines).toHaveLength(2);
    const cookies = cookieLines.map((line) => line.split(";")[0]).join("; ");
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    let githubCalls = 0;
    const mockGitHub = (async (input: string | URL | Request) => {
      githubCalls += 1;
      const url = String(input);
      if (url === "https://github.com/login/oauth/access_token")
        return new Response(JSON.stringify({ access_token: "test-short-token" }));
      if (url === "https://api.github.com/user") return new Response(JSON.stringify({ id: userId, login: tenant }));
      if (url.startsWith("https://api.github.com/user/installations?"))
        return new Response(JSON.stringify({ installations: [] }));
      throw new Error("unexpected GitHub destination");
    }) as typeof fetch;
    const callbackUrl = new URL("https://boardreadyops.example/api/auth/github/callback");
    callbackUrl.searchParams.set("state", state ?? "");
    callbackUrl.searchParams.set("code", "example-single-use-oauth-code");
    const request = () =>
      new Request(callbackUrl, {
        headers: { cookie: `brops_session=${session}; ${cookies}` },
      });
    const attempts = await Promise.all(
      Array.from({ length: 2 }, () => consumeHistoricalStepUp(request(), environment, { fetch: mockGitHub })),
    );
    expect(attempts.every((response) => response.status === 303)).toBe(true);
    expect(attempts.map((response) => response.headers.get("location")).sort()).toEqual(
      ["/dashboard", `/dashboard?historical_user_export=${exportId}`].sort(),
    );
    expect(attempts.every((response) => response.headers.getSetCookie().length === 2)).toBe(true);
    // One callback burns the persisted nonce BEFORE reaching the provider.
    expect(githubCalls).toBe(3);
    expect(
      (
        await consumeHistoricalStepUp(request(), environment, {
          fetch: mockGitHub,
        })
      ).headers.get("location"),
    ).toBe("/dashboard");
    expect(githubCalls).toBe(3);
    const used = await rows(
      "SELECT state_sha256,consumed_at FROM historical_user_oauth_challenges WHERE export_id=$1",
      [exportId],
    );
    expect(used.length).toBeGreaterThan(0);
    expect(used.some((row) => row.consumed_at !== null)).toBe(true);
    expect(JSON.stringify(used)).not.toContain(state);
    expect(
      await rows("SELECT id FROM historical_user_private_delivery_preflights WHERE export_id=$1", [exportId]),
    ).toEqual([]);
  });

  async function withQuotaOwner(label: string, execute: (exportId: string, userId: number) => Promise<void>) {
    const scopedTenant = `${label}-${randomUUID()}`;
    const scopedExport = randomUUID();
    const scopedInstall = randomUUID();
    const scopedUser = 9_235_788_990 + (label === "oauth-lifetime" ? 1 : 0);
    try {
      await executor().query(
        "INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at) VALUES($1,$2,$3,'User',$4,NOW())",
        [scopedInstall, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), scopedTenant, scopedUser],
      );
      await executor().query(
        "INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id) VALUES($1,$2,'github_app_uninstall','pending','user',$2,$3)",
        [scopedExport, scopedTenant, scopedUser],
      );
      await execute(scopedExport, scopedUser);
    } finally {
      await executor().query("DELETE FROM data_exports WHERE id=$1", [scopedExport]);
      await executor().query("DELETE FROM installations WHERE id=$1", [scopedInstall]);
    }
  }

  it("bounds five-minute OAuth starts per original export across consumed and unconsumed challenges", async () => {
    await withQuotaOwner("oauth-recent", async (scopedExport, scopedUser) => {
      const first = issue();
      const request = (state: string) => ({ exportId: scopedExport, verifiedGitHubUserId: scopedUser, state });
      expect(await registerHistoricalUserOAuthChallenge(executor(), request(first))).toBe(true);
      expect(await consumeHistoricalUserOAuthChallenge(executor(), request(first))).toBe(true);
      // Sequential calls avoid deliberate tenant TRY-lock contention.
      for (let i = 0; i < 23; i += 1) {
        expect(await registerHistoricalUserOAuthChallenge(executor(), request(issue()))).toBe(true);
      }
      expect(await registerHistoricalUserOAuthChallenge(executor(), request(issue()))).toBe(false);
      const count = await rows(
        "SELECT COUNT(*)::integer AS n FROM historical_user_oauth_challenges WHERE export_id=$1",
        [scopedExport],
      );
      expect(count[0]?.n).toBe(24);
      // Count includes consumed nonces; no deletion/rotation bypass exists.
      expect(await registerHistoricalUserOAuthChallenge(executor(), request(issue()))).toBe(false);
    });
  });

  it("bounds lifetime retained OAuth audit records without deleting consumed or expired evidence", async () => {
    await withQuotaOwner("oauth-lifetime", async (scopedExport, scopedUser) => {
      // Historical consumed records are fixture-only SQL, not an
      // application cleanup or bypass of original-owner entitlement.
      const seeded = await rows(
        `INSERT INTO historical_user_oauth_challenges(
           state_sha256,export_id,original_github_user_id,created_at,expires_at,consumed_at
         )
         SELECT md5($1 || ':' || g::text) || md5($1 || ':' || g::text || ':audit'),
                $2,$3,clock_timestamp()-INTERVAL '15 minutes',
                clock_timestamp()-INTERVAL '11 minutes',
                clock_timestamp()-INTERVAL '14 minutes'
           FROM generate_series(1,128) AS g
         RETURNING state_sha256`,
        [randomUUID(), scopedExport, scopedUser],
      );
      expect(seeded).toHaveLength(128);
      expect(
        await registerHistoricalUserOAuthChallenge(executor(), {
          exportId: scopedExport,
          verifiedGitHubUserId: scopedUser,
          state: issue(),
        }),
      ).toBe(false);
      const count = await rows(
        "SELECT COUNT(*)::integer AS n FROM historical_user_oauth_challenges WHERE export_id=$1",
        [scopedExport],
      );
      expect(count[0]?.n).toBe(128);
    });
  });

  it("does not consume when original pending export expires or is revoked", async () => {
    const state = issue();
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
    await executor().query("UPDATE data_exports SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [exportId]);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(false);
    expect(await registerHistoricalUserOAuthChallenge(executor(), identity(issue()))).toBe(false);
    await executor().query("UPDATE data_exports SET expires_at=NULL WHERE id=$1", [exportId]);
    expect(await consumeHistoricalUserOAuthChallenge(executor(), identity(state))).toBe(true);
  });
});
