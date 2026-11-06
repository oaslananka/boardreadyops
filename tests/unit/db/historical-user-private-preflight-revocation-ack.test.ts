import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { revokeHistoricalUserPrivateDeliveryPreflight } from "../../../packages/db/src/data-export-historical-private-preflight.js";

const authority = () => ({ exportId: randomUUID(), verifiedGitHubUserId: 42 });

describe("historical original-user preflight revocation acknowledgement", () => {
  it("does not report success from unrelated, missing or forged DB return rows", async () => {
    const id = randomUUID();
    for (const returnedRows of [[{ id: randomUUID() }], [{}], [null], [], [{ id }, { id }], { length: 1 }]) {
      const query = vi.fn().mockResolvedValue({ rows: returnedRows });
      expect(
        await revokeHistoricalUserPrivateDeliveryPreflight({ db: { query } as never, authority: authority(), id }),
      ).toBe("stale");
    }
  });

  it("accepts only a single acknowledgement for the exact revoked preflight", async () => {
    const id = randomUUID();
    const query = vi.fn().mockResolvedValue({ rows: [{ id }] });
    const original = authority();
    expect(
      await revokeHistoricalUserPrivateDeliveryPreflight({ db: { query } as never, authority: original, id }),
    ).toBe("revoked");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([id, original.exportId, original.verifiedGitHubUserId]);
  });
});
