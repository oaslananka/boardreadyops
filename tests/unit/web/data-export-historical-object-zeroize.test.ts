import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readVerifiedHistoricalUserLocalObject } from "../../../apps/web/lib/data-export-historical-object.js";
import { readVerifiedLocalExportObject } from "../../../apps/web/lib/data-export-local-object.js";

vi.mock("../../../apps/web/lib/data-export-local-object.js", () => ({
  readVerifiedLocalExportObject: vi.fn(),
}));

function testFixture({
  afterRevoked = false,
  afterThrows = false,
  releaseRefused = false,
  releaseThrows = false,
} = {}) {
  const authority = { exportId: randomUUID(), verifiedGitHubUserId: 911 };
  const artifactId = randomUUID();
  const privateBytes = Buffer.from("original-user-sensitive-physical-evidence");
  const row = {
    id: artifactId,
    repository_id: randomUUID(),
    run_id: randomUUID(),
    storage_path: "artifacts/original-evidence.bin",
    sha256: "a".repeat(64),
    bytes: privateBytes.length,
    retention_until: new Date(Date.now() + 86400000),
  };
  let lookups = 0;
  const query = vi.fn(async (sql: string, _args?: unknown[]) => {
    if (sql.includes("SELECT a.id")) {
      lookups++;
      if (afterThrows && lookups === 3) throw new Error("Final PostgreSQL lookup failed");
      return { rows: afterRevoked && lookups === 3 ? [] : [row] };
    }
    if (sql.includes("boardreadyops_begin_historical_user_artifact_copy")) return { rows: [{ outcome: "reserved" }] };
    if (sql.includes("boardreadyops_finish_export_object_copy")) {
      if (releaseThrows) throw new Error("PostgreSQL reservation settlement failed");
      return { rows: [{ outcome: releaseRefused ? "busy" : "released" }] };
    }
    throw new Error("Unexpected SQL in private object fixture");
  });
  vi.mocked(readVerifiedLocalExportObject).mockResolvedValue(privateBytes);
  const input = {
    db: { query } as never,
    authority,
    artifactId,
    storageRoot: "/private-test-root",
    storageDriver: "local",
  };
  const read = () => readVerifiedHistoricalUserLocalObject(input);
  return { read, query, privateBytes, input, authority, artifactId };
}

describe("original USER physical object transient memory", () => {
  it("zeroes private bytes on final original-user authority recheck failure", async () => {
    const fixture = testFixture({ afterRevoked: true });
    expect(await fixture.read()).toBeNull();
    expect(fixture.privateBytes.every((byte) => byte === 0)).toBe(true);
    expect(fixture.query).toHaveBeenCalledTimes(5);
  });

  it("zeroes private bytes if durable reservation settlement cannot be proven", async () => {
    const fixture = testFixture({ releaseRefused: true });
    await expect(fixture.read()).rejects.toThrow("Historical user object reservation cannot be settled");
    expect(fixture.privateBytes.every((byte) => byte === 0)).toBe(true);
  });

  it("zeroes bytes when the final scope recheck throws", async () => {
    const fixture = testFixture({ afterThrows: true });
    await expect(fixture.read()).rejects.toThrow("Final PostgreSQL lookup failed");
    expect(fixture.privateBytes.every((byte) => byte === 0)).toBe(true);
  });

  it("zeroes bytes when the durable release itself throws", async () => {
    const fixture = testFixture({ releaseThrows: true });
    await expect(fixture.read()).rejects.toThrow("PostgreSQL reservation settlement failed");
    expect(fixture.privateBytes.every((byte) => byte === 0)).toBe(true);
  });

  it("never rebinds original numeric USER, export, artifact or storage root while the physical read is in flight", async () => {
    const fixture = testFixture();
    const originalExport = fixture.authority.exportId;
    const originalUser = fixture.authority.verifiedGitHubUserId;
    const originalArtifact = fixture.artifactId;
    const originalDb = fixture.input.db;
    vi.mocked(readVerifiedLocalExportObject).mockImplementationOnce(async (params) => {
      expect(params.storageRoot).toBe("/private-test-root");
      expect(params.object.artifactId).toBe(originalArtifact);
      fixture.authority.exportId = randomUUID();
      fixture.authority.verifiedGitHubUserId = originalUser + 1;
      fixture.input.artifactId = randomUUID();
      fixture.input.storageRoot = "/forged-tenant-root";
      fixture.input.db = { query: vi.fn().mockRejectedValue(new Error("Caller-swapped DB connection")) } as never;
      return fixture.privateBytes;
    });
    const result = await fixture.read();
    expect(result?.exportId).toBe(originalExport);
    expect(result?.artifactId).toBe(originalArtifact);
    expect(result?.bytes).toBe(fixture.privateBytes);
    expect(originalDb).not.toBe(fixture.input.db);
    const originalUserQueries = fixture.query.mock.calls.filter(([sql]) => sql.includes("SELECT a.id"));
    expect(originalUserQueries).toHaveLength(3);
    for (const [_sql, args] of originalUserQueries) {
      expect(args).toEqual([originalExport, originalUser, originalArtifact]);
    }
    const settlement = fixture.query.mock.calls.find(([sql]) =>
      sql.includes("boardreadyops_finish_export_object_copy"),
    );
    expect(settlement?.[1]?.[0]).toBe(originalExport);
  });

  it("pins the local storage root and account before the FIRST asynchronous object lookup", async () => {
    const fixture = testFixture();
    const originalExport = fixture.authority.exportId;
    const originalUser = fixture.authority.verifiedGitHubUserId;
    const originalArtifact = fixture.artifactId;
    const originalQuery = fixture.query.getMockImplementation();
    expect(originalQuery).toBeDefined();
    fixture.query.mockImplementationOnce(async (sql, args) => {
      fixture.authority.exportId = randomUUID();
      fixture.authority.verifiedGitHubUserId = originalUser + 2;
      fixture.input.artifactId = randomUUID();
      fixture.input.storageRoot = "/swapped-root";
      if (!originalQuery) throw new Error("Test fixture DB query unavailable");
      return await originalQuery(sql, args);
    });
    await fixture.read();
    expect(readVerifiedLocalExportObject).toHaveBeenCalledWith(
      expect.objectContaining({ storageRoot: "/private-test-root" }),
    );
    for (const [sql, args] of fixture.query.mock.calls.filter(([sql]) => sql.includes("SELECT a.id"))) {
      expect(sql).toContain("SELECT a.id");
      expect(args).toEqual([originalExport, originalUser, originalArtifact]);
    }
  });

  it("preserves caller-owned private bytes only after verified and settled read", async () => {
    const fixture = testFixture();
    const result = await fixture.read();
    expect(result?.bytes).toBe(fixture.privateBytes);
    expect(result?.bytes.toString("utf8")).toBe("original-user-sensitive-physical-evidence");
    expect(fixture.query).toHaveBeenCalledTimes(5);
  });
});
