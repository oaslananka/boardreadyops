import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareVerifiedHistoricalUserCompositePreflight } from "../../../packages/db/src/data-export-historical-inventory.js";
import {
  inspectHistoricalUserPrivateDeliveryPreflight,
  revokeHistoricalUserPrivateDeliveryPreflight,
  stageHistoricalUserPrivateDeliveryPreflight,
} from "../../../packages/db/src/data-export-historical-private-preflight.js";

vi.mock("../../../packages/db/src/data-export-historical-inventory.js", () => ({
  prepareVerifiedHistoricalUserCompositePreflight: vi.fn(),
}));

const source = vi.mocked(prepareVerifiedHistoricalUserCompositePreflight);
const fingerprint = () => ({
  archiveSha256: "a".repeat(64),
  archiveByteLength: 2048,
  coreSha256: "b".repeat(64),
  visualSha256: "c".repeat(64),
  mutationEpochSha256: "d".repeat(64),
});
const authority = () => ({ exportId: randomUUID(), verifiedGitHubUserId: 411 });

function db(afterOwnerLookup?: () => void) {
  const query = vi.fn(async (sql: string, args?: unknown[]) => {
    if (sql.startsWith("LOCK TABLE")) return { rows: [] };
    if (sql.includes("SELECT e.tenant_id")) {
      afterOwnerLookup?.();
      return { rows: [{ tenant_id: "original-user" }] };
    }
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("AS active_hold")) return { rows: [{ active_hold: false, active_erasure: false }] };
    if (sql.includes("INSERT INTO public.historical_user_private_delivery_preflights")) {
      return { rows: [{ id: args?.[0] }] };
    }
    if (sql.includes("SELECT 1 FROM public.historical_user_private_delivery_preflights")) {
      return { rows: [{ "?column?": 1 }] };
    }
    throw new Error("Unexpected source-only SQL");
  });
  const withTransaction = vi.fn(async (work: (tx: { query: typeof query }) => Promise<unknown>) => work({ query }));
  return { query, withTransaction };
}

beforeEach(() => vi.resetAllMocks());

describe("original numeric USER source-only private preflight binding across awaited DB reads", () => {
  it("stages using only the pre-snapshot USER/export and DB when caller redirects all three", async () => {
    const originalDb = db();
    const otherDb = db();
    const original = authority();
    const f = fingerprint();
    const input = { db: originalDb as never, authority: { ...original }, fingerprint: f, ttlSeconds: 60 };
    source.mockImplementationOnce(async () => {
      input.db = otherDb as never;
      input.authority.exportId = randomUUID();
      input.authority.verifiedGitHubUserId++;
      input.ttlSeconds = 600;
      return {
        core: { sha256: f.coreSha256 },
        visual: { sha256: f.visualSha256 },
        mutationEpochSha256: f.mutationEpochSha256,
      } as never;
    });
    const staged = await stageHistoricalUserPrivateDeliveryPreflight(input);
    expect(staged?.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(originalDb.withTransaction).toHaveBeenCalledTimes(1);
    expect(otherDb.withTransaction).not.toHaveBeenCalled();
    const insert = originalDb.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO"));
    expect(insert?.[1]).toEqual([
      staged?.id,
      original.exportId,
      original.verifiedGitHubUserId,
      f.archiveSha256,
      f.archiveByteLength,
      f.coreSha256,
      f.visualSha256,
      f.mutationEpochSha256,
      60,
    ]);
  });

  it("inspects the same USER/DB before and after composite snapshot sampling", async () => {
    const originalDb = db();
    const otherDb = db();
    const original = authority();
    const f = fingerprint();
    const id = randomUUID();
    const input = { db: originalDb as never, authority: { ...original }, id, fingerprint: { ...f } };
    source.mockImplementationOnce(async () => {
      input.db = otherDb as never;
      input.authority.verifiedGitHubUserId++;
      input.authority.exportId = randomUUID();
      input.id = randomUUID();
      return {
        core: { sha256: f.coreSha256 },
        visual: { sha256: f.visualSha256 },
        mutationEpochSha256: f.mutationEpochSha256,
      } as never;
    });
    expect(await inspectHistoricalUserPrivateDeliveryPreflight(input)).toBe("current");
    expect(originalDb.withTransaction).toHaveBeenCalledTimes(1);
    expect(otherDb.withTransaction).not.toHaveBeenCalled();
    const read = originalDb.query.mock.calls.find(([sql]) =>
      sql.includes("SELECT 1 FROM public.historical_user_private_delivery_preflights"),
    );
    expect(read?.[1]).toEqual([
      id,
      original.exportId,
      original.verifiedGitHubUserId,
      f.archiveSha256,
      f.archiveByteLength,
      f.coreSha256,
      f.visualSha256,
      f.mutationEpochSha256,
    ]);
  });

  it("cannot swap the fingerprint or owner during the locked SQL admission before INSERT", async () => {
    const original = authority();
    const f = fingerprint();
    let input: {
      db: ReturnType<typeof db>;
      authority: ReturnType<typeof authority>;
      fingerprint: ReturnType<typeof fingerprint>;
      ttlSeconds: number;
    };
    const originalDb = db(() => {
      input.authority.exportId = randomUUID();
      input.authority.verifiedGitHubUserId++;
      input.fingerprint.coreSha256 = "f".repeat(64);
      input.fingerprint.archiveSha256 = "e".repeat(64);
    });
    input = { db: originalDb, authority: { ...original }, fingerprint: { ...f }, ttlSeconds: 60 };
    source.mockResolvedValue({
      core: { sha256: f.coreSha256 },
      visual: { sha256: f.visualSha256 },
      mutationEpochSha256: f.mutationEpochSha256,
    } as never);
    const staged = await stageHistoricalUserPrivateDeliveryPreflight(input as never);
    expect(staged?.id).toMatch(/^[0-9a-f-]{36}$/u);
    const owner = originalDb.query.mock.calls.find(([sql]) => sql.includes("SELECT e.tenant_id"));
    const insert = originalDb.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO"));
    expect(owner?.[1]).toEqual([original.exportId, original.verifiedGitHubUserId]);
    expect(insert?.[1]).toEqual([
      staged?.id,
      original.exportId,
      original.verifiedGitHubUserId,
      f.archiveSha256,
      f.archiveByteLength,
      f.coreSha256,
      f.visualSha256,
      f.mutationEpochSha256,
      60,
    ]);
  });

  it("does not acknowledge a different preflight ID substituted during awaited revocation", async () => {
    const original = authority();
    const id = randomUUID();
    const input = { db: undefined as never, authority: { ...original }, id };
    const query = vi.fn(async (_sql: string, _args: unknown[]) => {
      input.id = randomUUID();
      input.authority.verifiedGitHubUserId++;
      return { rows: [{ id: input.id }] };
    });
    input.db = { query } as never;
    expect(await revokeHistoricalUserPrivateDeliveryPreflight(input)).toBe("stale");
    expect(query.mock.calls[0]?.[1]).toEqual([id, original.exportId, original.verifiedGitHubUserId]);
  });
});
