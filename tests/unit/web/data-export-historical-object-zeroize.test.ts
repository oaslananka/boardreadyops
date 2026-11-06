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
  const query = vi.fn(async (sql: string) => {
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
  const read = () =>
    readVerifiedHistoricalUserLocalObject({
      db: { query } as never,
      authority,
      artifactId,
      storageRoot: "/private-test-root",
      storageDriver: "local",
    });
  return { read, query, privateBytes };
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

  it("preserves caller-owned private bytes only after verified and settled read", async () => {
    const fixture = testFixture();
    const result = await fixture.read();
    expect(result?.bytes).toBe(fixture.privateBytes);
    expect(result?.bytes.toString("utf8")).toBe("original-user-sensitive-physical-evidence");
    expect(fixture.query).toHaveBeenCalledTimes(5);
  });
});
