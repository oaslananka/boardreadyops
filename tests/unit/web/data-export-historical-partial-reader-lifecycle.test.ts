import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyReservedHistoricalUserPrivatePartial } from "../../../apps/web/lib/data-export-historical-partial-read.js";
import { readSealedHistoricalUserPartial } from "../../../apps/web/lib/data-export-historical-partial-storage.js";
import { inspectVerifiedHistoricalUserPrivateArchivePreflight } from "../../../apps/web/lib/data-export-historical-private-preflight.js";
import {
  releaseHistoricalUserPrivatePartialRead,
  reserveHistoricalUserPrivatePartialRead,
} from "../../../packages/db/src/data-export-historical-partial-read.js";

vi.mock("../../../apps/web/lib/data-export-historical-partial-storage.js", () => ({
  readSealedHistoricalUserPartial: vi.fn(),
}));
vi.mock("../../../apps/web/lib/data-export-historical-private-preflight.js", () => ({
  inspectVerifiedHistoricalUserPrivateArchivePreflight: vi.fn(),
}));
vi.mock("../../../packages/db/src/data-export-historical-partial-read.js", () => ({
  releaseHistoricalUserPrivatePartialRead: vi.fn(),
  reserveHistoricalUserPrivatePartialRead: vi.fn(),
}));

const reserve = vi.mocked(reserveHistoricalUserPrivatePartialRead);
const release = vi.mocked(releaseHistoricalUserPrivatePartialRead);
const read = vi.mocked(readSealedHistoricalUserPartial);
const inspect = vi.mocked(inspectVerifiedHistoricalUserPrivateArchivePreflight);

const fixture = () => {
  const archiveBytes = Buffer.from("private-source-only-zip");
  return {
    archiveBytes,
    input: {
      db: { withTransaction: vi.fn(), query: vi.fn() } as never,
      archiveRoot: "/private/.private-export-archives",
      authority: { exportId: randomUUID(), verifiedGitHubUserId: 481 },
      preflightId: randomUUID(),
      sha256: "a".repeat(64),
      byteLength: archiveBytes.length,
    },
    token: randomUUID(),
  };
};

afterEach(() => {
  vi.resetAllMocks();
});

describe("historical private ZIP reservation/read/settlement lifecycle", () => {
  it("never performs disk IO without a committed original-USER reader reservation", async () => {
    const { input } = fixture();
    reserve.mockResolvedValueOnce(null);
    expect(await verifyReservedHistoricalUserPrivatePartial(input)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("returns only a non-customer receipt after verified IO, byte zeroization and durable release", async () => {
    const { archiveBytes, input, token } = fixture();
    const order: string[] = [];
    reserve.mockImplementationOnce(async () => {
      order.push("reserve");
      return { token };
    });
    read.mockImplementationOnce(async () => {
      order.push("disk-read");
      return archiveBytes;
    });
    inspect.mockImplementationOnce(async ({ archiveBytes: inspected }) => {
      expect(inspected).toBe(archiveBytes);
      order.push("revalidated");
      return "current";
    });
    release.mockImplementationOnce(async (_, binding) => {
      order.push("release");
      expect(binding.token).toBe(token);
      expect(archiveBytes.every((byte) => byte === 0)).toBe(true);
      return true;
    });
    expect(await verifyReservedHistoricalUserPrivatePartial(input)).toEqual({
      sha256: input.sha256,
      byteLength: input.byteLength,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
    });
    expect(order).toEqual(["reserve", "disk-read", "revalidated", "release"]);
  });

  it("pins original numeric USER, export and private root across an asynchronous reservation", async () => {
    const { archiveBytes, input, token } = fixture();
    const originalDb = input.db;
    const expected = {
      exportId: input.authority.exportId,
      verifiedGitHubUserId: input.authority.verifiedGitHubUserId,
      preflightId: input.preflightId,
      sha256: input.sha256,
      byteLength: input.byteLength,
      archiveRoot: input.archiveRoot,
    };
    reserve.mockImplementationOnce(async (_db, binding) => {
      expect(binding).toEqual({
        exportId: expected.exportId,
        verifiedGitHubUserId: expected.verifiedGitHubUserId,
        preflightId: expected.preflightId,
        sha256: expected.sha256,
        byteLength: expected.byteLength,
      });
      input.authority.exportId = randomUUID();
      input.authority.verifiedGitHubUserId += 1;
      input.preflightId = randomUUID();
      input.sha256 = "b".repeat(64);
      input.byteLength++;
      input.archiveRoot = "/another-tenant-private-root";
      input.db = { withTransaction: vi.fn(), query: vi.fn().mockRejectedValue(new Error("Swapped database")) } as never;
      return { token };
    });
    read.mockResolvedValueOnce(archiveBytes);
    inspect.mockResolvedValueOnce("current");
    release.mockResolvedValueOnce(true);
    const receipt = await verifyReservedHistoricalUserPrivatePartial(input);
    expect(receipt).toEqual({
      sha256: expected.sha256,
      byteLength: expected.byteLength,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
    });
    expect(read).toHaveBeenCalledWith({
      archiveRoot: expected.archiveRoot,
      exportId: expected.exportId,
      sha256: expected.sha256,
      byteLength: expected.byteLength,
    });
    expect(inspect).toHaveBeenCalledWith({
      db: originalDb,
      authority: {
        exportId: expected.exportId,
        verifiedGitHubUserId: expected.verifiedGitHubUserId,
      },
      id: expected.preflightId,
      archiveBytes,
    });
    expect(release).toHaveBeenCalledWith(originalDb, {
      exportId: expected.exportId,
      verifiedGitHubUserId: expected.verifiedGitHubUserId,
      preflightId: expected.preflightId,
      sha256: expected.sha256,
      byteLength: expected.byteLength,
      token,
    });
    expect(archiveBytes.every((byte) => byte === 0)).toBe(true);
  });

  it("rejects reservation provider exceptions before any ZIP IO or preflight", async () => {
    const { input } = fixture();
    reserve.mockRejectedValueOnce(new Error("Original-user reservation backend unavailable"));
    expect(await verifyReservedHistoricalUserPrivatePartial(input)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("settles its reservation when the private ZIP cannot be read", async () => {
    const { input, token } = fixture();
    reserve.mockResolvedValueOnce({ token });
    read.mockResolvedValueOnce(null);
    release.mockResolvedValueOnce(true);
    expect(await verifyReservedHistoricalUserPrivatePartial(input)).toBeNull();
    expect(inspect).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("zeroizes read bytes and releases when the current original-USER preflight becomes stale", async () => {
    const { archiveBytes, input, token } = fixture();
    reserve.mockResolvedValueOnce({ token });
    read.mockResolvedValueOnce(archiveBytes);
    inspect.mockResolvedValueOnce("stale");
    release.mockResolvedValueOnce(true);
    expect(await verifyReservedHistoricalUserPrivatePartial(input)).toBeNull();
    expect(archiveBytes.every((byte) => byte === 0)).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("zeroizes read bytes and attempts durable release after a thrown preflight provider error", async () => {
    const { archiveBytes, input, token } = fixture();
    reserve.mockResolvedValueOnce({ token });
    read.mockResolvedValueOnce(archiveBytes);
    inspect.mockRejectedValueOnce(new Error("original USER entitlement unavailable"));
    release.mockResolvedValueOnce(true);
    expect(await verifyReservedHistoricalUserPrivatePartial(input)).toBeNull();
    expect(archiveBytes.every((byte) => byte === 0)).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("never returns any receipt if reader release fails, even after successful verification", async () => {
    const { archiveBytes, input, token } = fixture();
    reserve.mockResolvedValueOnce({ token });
    read.mockResolvedValueOnce(archiveBytes);
    inspect.mockResolvedValueOnce("current");
    release.mockResolvedValueOnce(false);
    expect(await verifyReservedHistoricalUserPrivatePartial(input)).toBeNull();
    expect(archiveBytes.every((byte) => byte === 0)).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns no receipt if durable release THROWS after complete private verification", async () => {
    const { archiveBytes, input, token } = fixture();
    reserve.mockResolvedValueOnce({ token });
    read.mockResolvedValueOnce(archiveBytes);
    inspect.mockResolvedValueOnce("current");
    release.mockRejectedValueOnce(new Error("Provider settlement failed with private diagnostic details"));
    expect(await verifyReservedHistoricalUserPrivatePartial(input)).toBeNull();
    expect(archiveBytes.every((byte) => byte === 0)).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("attempts durable settlement even if private filesystem IO throws", async () => {
    const { input, token } = fixture();
    reserve.mockResolvedValueOnce({ token });
    read.mockRejectedValueOnce(new Error("private archive IO failed"));
    release.mockResolvedValueOnce(false);
    expect(await verifyReservedHistoricalUserPrivatePartial(input)).toBeNull();
    expect(inspect).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
