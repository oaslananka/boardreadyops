import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prepareVerifiedHistoricalUserCompositePreflight } from "../../../packages/db/src/data-export-historical-inventory.js";
import { stageHistoricalUserPrivateDeliveryPreflight } from "../../../packages/db/src/data-export-historical-private-preflight.js";

vi.mock("../../../packages/db/src/data-export-historical-inventory.js", () => ({
  prepareVerifiedHistoricalUserCompositePreflight: vi.fn(),
}));

const fingerprint = () => ({
  archiveSha256: "a".repeat(64),
  archiveByteLength: 1024,
  coreSha256: "b".repeat(64),
  visualSha256: "c".repeat(64),
  mutationEpochSha256: "d".repeat(64),
});

function buildFixture(rowsForInsert: (id: unknown) => unknown) {
  const f = fingerprint();
  vi.mocked(prepareVerifiedHistoricalUserCompositePreflight).mockResolvedValue({
    core: { sha256: f.coreSha256 },
    visual: { sha256: f.visualSha256 },
    mutationEpochSha256: f.mutationEpochSha256,
  } as never);
  let rollback = false;
  const query = vi.fn(async (sql: string, args?: unknown[]) => {
    if (sql.startsWith("LOCK TABLE")) return { rows: [] };
    if (sql.includes("SELECT e.tenant_id")) return { rows: [{ tenant_id: "original-user" }] };
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("AS active_hold")) return { rows: [{ active_hold: false, active_erasure: false }] };
    if (sql.includes("INSERT INTO public.historical_user_private_delivery_preflights"))
      return { rows: rowsForInsert(args?.[0]) };
    throw new Error("Unexpected SQL in private preflight insert test");
  });
  const withTransaction = vi.fn(async (fn: (tx: { query: typeof query }) => Promise<unknown>) => {
    try {
      return await fn({ query });
    } catch (error) {
      rollback = true;
      throw error;
    }
  });
  return {
    input: {
      db: { withTransaction } as never,
      authority: { exportId: randomUUID(), verifiedGitHubUserId: 411 },
      fingerprint: f,
      ttlSeconds: 60,
    },
    query,
    wasRolledBack: () => rollback,
  };
}

describe("original USER private preflight INSERT acknowledgement", () => {
  it("rolls back an ambiguous two-row INSERT result, even when its first id matches", async () => {
    const fixture = buildFixture((id) => [{ id }, { id: randomUUID() }]);
    await expect(stageHistoricalUserPrivateDeliveryPreflight(fixture.input)).rejects.toThrow(
      "Historical private preflight insertion was not acknowledged",
    );
    expect(fixture.wasRolledBack()).toBe(true);
  });

  it("rolls back a malformed nonmatching INSERT result", async () => {
    const fixture = buildFixture(() => [null]);
    await expect(stageHistoricalUserPrivateDeliveryPreflight(fixture.input)).rejects.toThrow(
      "Historical private preflight insertion was not acknowledged",
    );
    expect(fixture.wasRolledBack()).toBe(true);
  });

  it("treats the normal zero-row conflict result as no preflight without transaction failure", async () => {
    const fixture = buildFixture(() => []);
    await expect(stageHistoricalUserPrivateDeliveryPreflight(fixture.input)).resolves.toBeNull();
    expect(fixture.wasRolledBack()).toBe(false);
  });

  it("accepts one exact preflight INSERT result", async () => {
    const fixture = buildFixture((id) => [{ id }]);
    const created = await stageHistoricalUserPrivateDeliveryPreflight(fixture.input);
    expect(created?.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(fixture.wasRolledBack()).toBe(false);
  });
});
