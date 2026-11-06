import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  lookupHistoricalUserExportObject,
  releaseHistoricalUserObjectCopy,
  reserveHistoricalUserObjectBatch,
  reserveHistoricalUserObjectCopy,
} from "../../../packages/db/src/data-export-historical-object-authorization.js";

const authority = () => ({ exportId: randomUUID(), verifiedGitHubUserId: 48 });
const object = () => ({
  artifactId: randomUUID(),
  repositoryId: randomUUID(),
  runId: randomUUID(),
  storagePath: "artifacts/private-evidence.bin",
  sha256: "a".repeat(64),
  byteLength: 128,
  retentionUntil: new Date(Date.now() + 86400000).toISOString(),
});

describe("original-user artifact copy reservation boundary", () => {
  it("denies invalid single-copy object before invoking any DB query", async () => {
    const query = vi.fn();
    const db = { query } as never;
    const valid = object();
    for (const invalid of [
      null,
      { ...valid, storagePath: null },
      { ...valid, storagePath: "../escape".repeat(100) },
      { ...valid, sha256: "not-sha256" },
      { ...valid, byteLength: -1 },
      { ...valid, byteLength: 64 * 1024 * 1024 + 1 },
      { ...valid, byteLength: "128" },
      { ...valid, runId: null },
      { ...valid, retentionUntil: "not-a-date" },
    ]) {
      expect(await reserveHistoricalUserObjectCopy(db, authority(), invalid as never)).toBeNull();
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects malformed original-user identity without querying", async () => {
    const query = vi.fn();
    const db = { query } as never;
    expect(
      await reserveHistoricalUserObjectCopy(db, { ...authority(), verifiedGitHubUserId: "48" } as never, object()),
    ).toBeNull();
    expect(await lookupHistoricalUserExportObject(db, null as never, randomUUID())).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses to consider malformed or multiple release replies a settled reservation", async () => {
    const original = authority();
    const reservation = { readerId: randomUUID(), token: randomUUID() };
    for (const rows of [[], [null], [{}], [{ outcome: "released" }, { outcome: "released" }], { length: 1 }]) {
      const query = vi.fn().mockResolvedValue({ rows });
      await expect(releaseHistoricalUserObjectCopy({ query } as never, original, reservation)).rejects.toThrow(
        "Historical user object reservation cannot be settled",
      );
    }
  });

  it("requires one exact successful release acknowledgement", async () => {
    const original = authority();
    const reservation = { readerId: randomUUID(), token: randomUUID() };
    const query = vi.fn().mockResolvedValue({ rows: [{ outcome: "released" }] });
    await expect(releaseHistoricalUserObjectCopy({ query } as never, original, reservation)).resolves.toBeUndefined();
    expect(query.mock.calls[0]?.[1]).toEqual([
      original.exportId,
      `historical-user:${reservation.readerId}`,
      reservation.token,
    ]);
  });

  it("rejects invalid batch objects before a transaction starts", async () => {
    const withTransaction = vi.fn();
    const good = object();
    const db = { withTransaction } as never;
    expect(await reserveHistoricalUserObjectBatch(db, authority(), [good, null as never])).toBeNull();
    expect(
      await reserveHistoricalUserObjectBatch(db, authority(), [good, { ...good, retentionUntil: "invalid" }]),
    ).toBeNull();
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
