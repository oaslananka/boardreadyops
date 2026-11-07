import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assessHistoricalUserHardwareOwnedRowCounts,
  historicalUserHardwareSourceNames,
} from "../../../packages/db/src/data-export-historical-hardware-owner-counts.js";
import { assessHistoricalUserSchemaCoverage } from "../../../packages/db/src/data-export-historical-schema-coverage.js";
import { assessHistoricalUserSourceScope } from "../../../packages/db/src/data-export-historical-source-scope.js";

vi.mock("../../../packages/db/src/data-export-historical-schema-coverage.js", () => ({
  assessHistoricalUserSchemaCoverage: vi.fn(),
}));
vi.mock("../../../packages/db/src/data-export-historical-hardware-owner-counts.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../packages/db/src/data-export-historical-hardware-owner-counts.js")
  >()),
  assessHistoricalUserHardwareOwnedRowCounts: vi.fn(),
}));

const catalog = vi.mocked(assessHistoricalUserSchemaCoverage);
const hardware = vi.mocked(assessHistoricalUserHardwareOwnedRowCounts);
const binding = { exportId: randomUUID(), verifiedGitHubUserId: 9_815_471 };
const rowCounts = Object.fromEntries(historicalUserHardwareSourceNames.map((key) => [key, 1]));
function fixture() {
  const query = vi.fn().mockResolvedValue({ rows: [{ id: randomUUID(), revision: "3" }] });
  const tx = { query };
  const withTransaction = vi.fn(async (work: (connection: typeof tx) => Promise<unknown>) => work(tx));
  return { db: { withTransaction } as never, tx, withTransaction, query };
}

beforeEach(() => {
  vi.resetAllMocks();
  catalog.mockImplementation(async (db) =>
    db.withTransaction(
      async () =>
        ({
          status: "known_schema_scope_unapproved",
          releaseDecision: "NO_GO",
          completeCustomerExport: false,
          customerDeliveryAllowed: false,
          tableCount: 92,
          schemaSha256: "a".repeat(64),
        }) as never,
      { consistentRead: true, statementTimeoutMs: 5000 },
    ),
  );
  hardware.mockImplementation(async (db) =>
    db.withTransaction(
      async () =>
        ({
          scope: "original-numeric-user-retained-suspended-installation-only",
          releaseDecision: "NO_GO",
          completeCustomerExport: false,
          customerDeliveryAllowed: false,
          sourceRightsVerified: false,
          thirdPartyDisclosureRightsVerified: false,
          rowCounts,
        }) as never,
      { consistentRead: true, statementTimeoutMs: 5000 },
    ),
  );
});

describe("single repeatable-read original USER catalog+hardware source-only observation", () => {
  it("pins both guards to precisely ONE read-only DB snapshot and yields a non-customer fingerprint", async () => {
    const f = fixture();
    const result = await assessHistoricalUserSourceScope(f.db, binding);
    expect(result).toMatchObject({
      status: "known-relational-source-scope-unapproved",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      sourceRightsVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      tableCount: 92,
      sourceClassCount: 19,
      scopeFingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(f.withTransaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      consistentRead: true,
      statementTimeoutMs: 5000,
    });
    expect(catalog).toHaveBeenCalledOnce();
    expect(hardware).toHaveBeenCalledExactlyOnceWith(expect.anything(), binding);
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.query.mock.calls[0]?.[1]).toEqual([binding.exportId, binding.verifiedGitHubUserId]);
    const sharedCatalog = catalog.mock.calls[0]?.[0];
    const sharedHardware = hardware.mock.calls[0]?.[0];
    expect(sharedCatalog).toBe(sharedHardware);
    expect(result?.scopeFingerprintSha256).toBe(
      (await assessHistoricalUserSourceScope(f.db, binding))?.scopeFingerprintSha256,
    );
  });

  it("rejects missing/invalid account identity BEFORE database access", async () => {
    const f = fixture();
    expect(await assessHistoricalUserSourceScope(f.db, { ...binding, exportId: "not-uuid" })).toBeNull();
    expect(await assessHistoricalUserSourceScope(f.db, { ...binding, verifiedGitHubUserId: 0 })).toBeNull();
    expect(f.withTransaction).not.toHaveBeenCalled();
  });

  it("rejects unknown schema before consulting private row counts", async () => {
    catalog.mockResolvedValueOnce({ status: "schema_drift" } as never);
    const f = fixture();
    expect(await assessHistoricalUserSourceScope(f.db, binding)).toBeNull();
    expect(hardware).not.toHaveBeenCalled();
  });

  it("rejects missing, duplicated or malformed original USER epoch revisions", async () => {
    const f = fixture();
    for (const rows of [
      [],
      [{ id: randomUUID(), revision: "-1" }],
      [{ id: randomUUID(), revision: "184467440737095516160000" }],
      [{ id: "other-tenant-id", revision: "3" }],
    ]) {
      f.query.mockResolvedValueOnce({ rows });
      expect(await assessHistoricalUserSourceScope(f.db, binding)).toBeNull();
    }
    f.query.mockRejectedValueOnce(new Error("Epoch inspection unavailable"));
    expect(await assessHistoricalUserSourceScope(f.db, binding)).toBeNull();
  });

  it("changes the internal source-scope fingerprint across count-preserving existing epoch mutations", async () => {
    const f = fixture();
    const installationId = randomUUID();
    f.query.mockResolvedValueOnce({ rows: [{ id: installationId, revision: "8" }] });
    const first = await assessHistoricalUserSourceScope(f.db, binding);
    f.query.mockResolvedValueOnce({ rows: [{ id: installationId, revision: "10" }] });
    const restored = await assessHistoricalUserSourceScope(f.db, binding);
    expect(restored?.scopeFingerprintSha256).not.toBe(first?.scopeFingerprintSha256);
    expect(restored?.customerDeliveryAllowed).toBe(false);
  });

  it("denies an ambiguous or unauthorized original USER source-row snapshot", async () => {
    hardware.mockResolvedValueOnce(null);
    expect(await assessHistoricalUserSourceScope(fixture().db, binding)).toBeNull();
  });

  it.each([
    ["missing class", { ...rowCounts, boards: undefined }],
    ["over limit", { ...rowCounts, boards: 101 }],
    ["not integer", { ...rowCounts, boards: 1.5 }],
    ["extra class", { ...rowCounts, extraClass: 0 }],
    ["foreign data shape", { ...rowCounts, boards: "1" }],
  ])("rejects %s when the original USER count result is malformed", async (_name, malformed) => {
    hardware.mockResolvedValueOnce({
      scope: "original-numeric-user-retained-suspended-installation-only",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      sourceRightsVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      rowCounts: malformed,
    } as never);
    expect(await assessHistoricalUserSourceScope(fixture().db, binding)).toBeNull();
  });

  it("fails closed on SQL/callback failure rather than signing a scope statement", async () => {
    const f = fixture();
    f.withTransaction.mockRejectedValueOnce(new Error("Connection aborted"));
    expect(await assessHistoricalUserSourceScope(f.db, binding)).toBeNull();
  });

  it("does not trust a guard that silently drops repeatable-read or statement timeout", async () => {
    hardware.mockImplementationOnce(async (db) =>
      db.withTransaction(async () => null as never, { statementTimeoutMs: 5000 }),
    );
    expect(await assessHistoricalUserSourceScope(fixture().db, binding)).toBeNull();
  });

  it("binds the private digest to the exact export UUID and numeric original USER", async () => {
    const f = fixture();
    const original = await assessHistoricalUserSourceScope(f.db, binding);
    const otherExport = await assessHistoricalUserSourceScope(f.db, { ...binding, exportId: randomUUID() });
    const otherUser = await assessHistoricalUserSourceScope(f.db, {
      ...binding,
      verifiedGitHubUserId: binding.verifiedGitHubUserId + 1,
    });
    expect(original?.scopeFingerprintSha256).not.toBe(otherExport?.scopeFingerprintSha256);
    expect(original?.scopeFingerprintSha256).not.toBe(otherUser?.scopeFingerprintSha256);
  });

  it("freezes original USER identity before asynchronous schema inspection", async () => {
    const f = fixture();
    const mutable = { ...binding };
    const originalUser = mutable.verifiedGitHubUserId;
    catalog.mockImplementationOnce(async (db) => {
      mutable.verifiedGitHubUserId = originalUser + 1;
      return await db.withTransaction(
        async () =>
          ({
            status: "known_schema_scope_unapproved",
            tableCount: 92,
            schemaSha256: "a".repeat(64),
          }) as never,
        { consistentRead: true, statementTimeoutMs: 5000 },
      );
    });
    const result = await assessHistoricalUserSourceScope(f.db, mutable);
    expect(result?.status).toBe("known-relational-source-scope-unapproved");
    expect(hardware).toHaveBeenCalledWith(expect.anything(), {
      exportId: binding.exportId,
      verifiedGitHubUserId: originalUser,
    });
  });

  it("does not depend on insertion order when hashing the fixed class counts", async () => {
    const f = fixture();
    const first = await assessHistoricalUserSourceScope(f.db, binding);
    const swapped = Object.fromEntries(Object.entries(rowCounts).reverse());
    hardware.mockImplementationOnce(async (db) =>
      db.withTransaction(
        async () =>
          ({
            scope: "original-numeric-user-retained-suspended-installation-only",
            releaseDecision: "NO_GO",
            completeCustomerExport: false,
            customerDeliveryAllowed: false,
            sourceRightsVerified: false,
            thirdPartyDisclosureRightsVerified: false,
            rowCounts: swapped,
          }) as never,
        { consistentRead: true, statementTimeoutMs: 5000 },
      ),
    );
    expect((await assessHistoricalUserSourceScope(f.db, binding))?.scopeFingerprintSha256).toBe(
      first?.scopeFingerprintSha256,
    );
  });
});
