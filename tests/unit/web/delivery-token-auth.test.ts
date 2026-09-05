import { createHash } from "node:crypto";
import type { SqlQueryExecutor } from "@boardreadyops/db";
import { describe, expect, it } from "vitest";
import { verifyDeliveryToken } from "../../../apps/web/lib/delivery-auth.js";

class MockDeliveryDb implements SqlQueryExecutor {
  deliveries: Record<string, unknown>[] = [];

  async query(sql: string, params: readonly unknown[] = []): Promise<{ rows: unknown[] }> {
    const s = sql.toLowerCase();
    if (s.includes("from deliveries") && s.includes("access_token_hash = $1")) {
      const hash = params[0] as string;
      const match = this.deliveries.find((d) => d.access_token_hash === hash);
      return { rows: match ? [match] : [] };
    }
    return { rows: [] };
  }
}

describe("verifyDeliveryToken", () => {
  it("authenticates valid unexpired delivery token", async () => {
    const db = new MockDeliveryDb();
    const rawToken = "secret_guest_token_12345678901234567890";
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    db.deliveries.push({
      id: "del_valid",
      revision_id: "rev_100",
      access_token_hash: tokenHash,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      signed_archive_url: "https://storage.example.com/bundle.zip",
      recipient_notes: "Review package for JLCPCB",
      created_at: new Date().toISOString(),
    });

    const result = await verifyDeliveryToken(rawToken, db);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.delivery?.id).toBe("del_valid");
    expect(result.delivery?.recipientNotes).toBe("Review package for JLCPCB");
  });

  it("returns 410 Gone for expired delivery token", async () => {
    const db = new MockDeliveryDb();
    const rawToken = "expired_token_12345";
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    db.deliveries.push({
      id: "del_expired",
      revision_id: "rev_200",
      access_token_hash: tokenHash,
      expires_at: new Date(Date.now() - 3600 * 1000).toISOString(),
      signed_archive_url: "https://storage.example.com/expired.zip",
      recipient_notes: null,
      created_at: new Date().toISOString(),
    });

    const result = await verifyDeliveryToken(rawToken, db);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(410);
    expect(result.error).toBe("Delivery token has expired");
  });

  it("returns 404 for unknown token", async () => {
    const db = new MockDeliveryDb();
    const result = await verifyDeliveryToken("non_existent_token", db);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("returns 400 for empty or whitespace token", async () => {
    const db = new MockDeliveryDb();
    const result = await verifyDeliveryToken("   ", db);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });
});
