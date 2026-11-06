import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  checkHistoricalUserArchivePrepublication,
  lookupHistoricalUserExportObject,
  releaseHistoricalUserObjectBatch,
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

  it("fails closed on falsy settlement rejections while still attempting every reservation", async () => {
    const reservations = Array.from({ length: 3 }, () => ({
      reservation: { readerId: randomUUID(), token: randomUUID() },
    }));
    for (const cause of [undefined, null, false, 0, ""]) {
      const query = vi
        .fn()
        .mockRejectedValueOnce(cause)
        .mockResolvedValue({ rows: [{ outcome: "released" }] });
      await expect(releaseHistoricalUserObjectBatch({ query } as never, authority(), reservations)).rejects.toThrow(
        "Historical user object batch reservations cannot be fully settled",
      );
      expect(query).toHaveBeenCalledTimes(reservations.length);
    }
  });

  it("settles every original-user reservation when all acknowledgements match", async () => {
    const reservations = Array.from({ length: 3 }, () => ({
      reservation: { readerId: randomUUID(), token: randomUUID() },
    }));
    const query = vi.fn().mockResolvedValue({ rows: [{ outcome: "released" }] });
    await expect(
      releaseHistoricalUserObjectBatch({ query } as never, authority(), reservations),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(reservations.length);
  });

  it("rejects unsafe original-user object paths at the prepublication boundary before any transaction", async () => {
    const withTransaction = vi.fn().mockResolvedValue("eligible");
    const db = { withTransaction } as never;
    const fixture = object();
    for (const storagePath of [
      "../escaped.bin",
      "/absolute.bin",
      "artifacts//file.bin",
      "artifacts/./file.bin",
      "artifacts/../file.bin",
      "C:/private.bin",
      "artifacts/private.bin:alternate-stream",
      "artifacts/zero\0byte.bin",
      "artifacts\\\\file.bin",
    ]) {
      expect(
        await checkHistoricalUserArchivePrepublication({
          db,
          authority: authority(),
          objects: [{ ...fixture, storagePath }],
        }),
      ).toBe("stale");
    }
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("refuses to disclose a private storage locator containing traversal segments", async () => {
    const fixture = object();
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: fixture.artifactId,
          run_id: fixture.runId,
          repository_id: fixture.repositoryId,
          storage_path: "../private.bin",
          sha256: fixture.sha256,
          bytes: fixture.byteLength,
          retention_until: new Date(fixture.retentionUntil),
        },
      ],
    });
    expect(await lookupHistoricalUserExportObject({ query } as never, authority(), fixture.artifactId)).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("never discloses a private object locator from ambiguous lookup rows", async () => {
    const value = object();
    const row = {
      id: value.artifactId,
      run_id: value.runId,
      repository_id: value.repositoryId,
      storage_path: value.storagePath,
      sha256: value.sha256,
      bytes: value.byteLength,
      retention_until: new Date(value.retentionUntil),
    };
    const query = vi.fn().mockResolvedValue({ rows: [row, row] });
    expect(await lookupHistoricalUserExportObject({ query } as never, authority(), value.artifactId)).toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });

  it("does not admit a caller-mutated storage path after batch validation", async () => {
    const candidate = object();
    const original = { ...candidate };
    const query = vi.fn(async (_sql: string, params: unknown[]) => {
      expect(params[3]).toBe(original.storagePath);
      expect(params[4]).toBe(original.sha256);
      return { rows: [{ outcome: "reserved" }] };
    });
    const withTransaction = vi.fn(async (callback: (tx: { query: typeof query }) => Promise<unknown>) => {
      // This happens after synchronous input validation but before awaited DB IO.
      candidate.storagePath = "../changed-during-transaction.bin";
      candidate.sha256 = "b".repeat(64);
      return callback({ query });
    });
    const admitted = await reserveHistoricalUserObjectBatch({ withTransaction } as never, authority(), [candidate]);
    expect(admitted?.[0]?.object).toEqual(original);
    expect(query).toHaveBeenCalledOnce();
  });

  it("retains the original user authority throughout asynchronous batch admission", async () => {
    const original = authority();
    const identity = { ...original };
    const query = vi.fn(async (_sql: string, params: unknown[]) => {
      expect(params[0]).toBe(identity.exportId);
      expect(params[1]).toBe(identity.verifiedGitHubUserId);
      return { rows: [{ outcome: "reserved" }] };
    });
    const withTransaction = vi.fn(async (callback: (tx: { query: typeof query }) => Promise<unknown>) => {
      original.exportId = randomUUID();
      original.verifiedGitHubUserId = 999;
      return callback({ query });
    });
    await expect(
      reserveHistoricalUserObjectBatch({ withTransaction } as never, original, [object()]),
    ).resolves.toHaveLength(1);
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
