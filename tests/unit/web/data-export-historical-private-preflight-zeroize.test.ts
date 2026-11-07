import { createHash, randomUUID } from "node:crypto";
import { sanitizeAndExtractArchive } from "@boardreadyops/cloud-core/archive-sanitizer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyHistoricalUserPartialArchive } from "../../../apps/web/lib/data-export-historical-archive.js";
import {
  inspectVerifiedHistoricalUserPrivateArchivePreflight,
  stageVerifiedHistoricalUserPrivateArchivePreflight,
} from "../../../apps/web/lib/data-export-historical-private-preflight.js";
import { checkHistoricalUserArchivePrepublication } from "../../../packages/db/src/data-export-historical-object-authorization.js";
import {
  inspectHistoricalUserPrivateDeliveryPreflight,
  stageHistoricalUserPrivateDeliveryPreflight,
} from "../../../packages/db/src/data-export-historical-private-preflight.js";

vi.mock("@boardreadyops/cloud-core/archive-sanitizer", () => ({
  sanitizeAndExtractArchive: vi.fn(),
}));
vi.mock("../../../apps/web/lib/data-export-historical-archive.js", () => ({
  verifyHistoricalUserPartialArchive: vi.fn(),
}));
vi.mock("../../../packages/db/src/data-export-historical-object-authorization.js", () => ({
  lookupHistoricalUserExportObject: vi.fn(),
  checkHistoricalUserArchivePrepublication: vi.fn(),
}));
vi.mock("../../../packages/db/src/data-export-historical-private-preflight.js", () => ({
  stageHistoricalUserPrivateDeliveryPreflight: vi.fn(),
  inspectHistoricalUserPrivateDeliveryPreflight: vi.fn(),
}));

const extracted = vi.mocked(sanitizeAndExtractArchive);
const verify = vi.mocked(verifyHistoricalUserPartialArchive);
const prepublication = vi.mocked(checkHistoricalUserArchivePrepublication);
const stage = vi.mocked(stageHistoricalUserPrivateDeliveryPreflight);
const inspect = vi.mocked(inspectHistoricalUserPrivateDeliveryPreflight);

function fixture() {
  const exportId = randomUUID();
  const authority = { exportId, verifiedGitHubUserId: 918 };
  const archiveBytes = Buffer.from("original-caller-owned-zip-bytes");
  const core = Buffer.from(JSON.stringify({ artifacts: [], runs: [], excludedSourceClassCounts: { runSnapshots: 0 } }));
  const visual = Buffer.from("private-original-user-visual-evidence");
  const epoch = "a".repeat(64);
  const receipt = Buffer.from(
    JSON.stringify({
      exportId,
      formatVersion: 3,
      completeCustomerExport: false,
      scope: "partial-preflight-not-customer-export",
      privateVisualContentsIncluded: false,
      originalUserMutationEpochSha256: epoch,
    }),
  );
  const physical = Buffer.from("sensitive-physical-payload-copy");
  const copies = [
    { path: "metadata/historical-core.json", data: core, size: core.length },
    { path: "metadata/historical-private-visual-evidence.json", data: visual, size: visual.length },
    { path: "metadata/historical-integrity.json", data: receipt, size: receipt.length },
    { path: "objects/retained-object.bin", data: physical, size: physical.length },
  ];
  extracted.mockReturnValueOnce({
    files: copies,
    totalBytes: copies.reduce((a, file) => a + file.size, 0),
    fileCount: 4,
  });
  return {
    db: { withTransaction: vi.fn() } as never,
    authority,
    archiveBytes,
    copies,
    expectedCoreSha: createHash("sha256").update(core).digest("hex"),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  verify.mockReturnValue(true);
  prepublication.mockResolvedValue("eligible");
  stage.mockResolvedValue({ id: randomUUID() });
  inspect.mockResolvedValue("current");
});

describe("original GitHub USER private partial ZIP extracted-memory zeroization", () => {
  it("wipes all temporary extracted file copies on successful source-only staging", async () => {
    const input = fixture();
    const original = Buffer.from(input.archiveBytes);
    const result = await stageVerifiedHistoricalUserPrivateArchivePreflight({
      db: input.db,
      authority: input.authority,
      archiveBytes: input.archiveBytes,
      ttlSeconds: 120,
    });
    expect(result?.id).toBeTruthy();
    expect(prepublication).toHaveBeenCalledOnce();
    expect(stage).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: expect.objectContaining({
          coreSha256: input.expectedCoreSha,
          archiveByteLength: input.archiveBytes.length,
        }),
      }),
    );
    for (const copy of input.copies) expect(copy.data.every((byte) => byte === 0)).toBe(true);
    expect(input.archiveBytes).toEqual(original);
  });

  it("wipes all extracted buffers when a verified ZIP has a forged private receipt", async () => {
    const input = fixture();
    const receiptCopy = input.copies.find((file) => file.path === "metadata/historical-integrity.json");
    if (!receiptCopy) throw new Error("Missing historical private receipt fixture");
    receiptCopy.data.fill(0x78);
    expect(
      await stageVerifiedHistoricalUserPrivateArchivePreflight({
        db: input.db,
        authority: input.authority,
        archiveBytes: input.archiveBytes,
        ttlSeconds: 120,
      }),
    ).toBeNull();
    for (const copy of input.copies) expect(copy.data.every((byte) => byte === 0)).toBe(true);
    expect(stage).not.toHaveBeenCalled();
  });

  it("wipes temporary extracted copies after an original-user current-state inspection", async () => {
    const input = fixture();
    expect(
      await inspectVerifiedHistoricalUserPrivateArchivePreflight({
        db: input.db,
        authority: input.authority,
        archiveBytes: input.archiveBytes,
        id: randomUUID(),
      }),
    ).toBe("current");
    for (const copy of input.copies) expect(copy.data.every((byte) => byte === 0)).toBe(true);
    expect(inspect).toHaveBeenCalledOnce();
  });

  it("leaves caller ZIP untouched and never extracts it if independent signature verification refuses it", async () => {
    const input = fixture();
    verify.mockReturnValueOnce(false);
    expect(
      await stageVerifiedHistoricalUserPrivateArchivePreflight({
        db: input.db,
        authority: input.authority,
        archiveBytes: input.archiveBytes,
        ttlSeconds: 120,
      }),
    ).toBeNull();
    expect(extracted).not.toHaveBeenCalled();
    expect(input.archiveBytes.toString("utf8")).toBe("original-caller-owned-zip-bytes");
  });
});
