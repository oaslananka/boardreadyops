import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  verifyHistoricalUserMetadataOnlyArchive,
  verifyHistoricalUserPartialArchive,
} from "../../../apps/web/lib/data-export-historical-archive.js";
import { createZipBuffer } from "../../../src/util/zip.js";

const { extractedBuffers } = vi.hoisted(() => ({ extractedBuffers: [] as Buffer[] }));

vi.mock("@boardreadyops/cloud-core/archive-sanitizer", async (importOriginal) => {
  const original = await importOriginal<typeof import("@boardreadyops/cloud-core/archive-sanitizer")>();
  return {
    ...original,
    sanitizeAndExtractArchive: (...args: Parameters<typeof original.sanitizeAndExtractArchive>) => {
      const extracted = original.sanitizeAndExtractArchive(...args);
      extractedBuffers.push(...extracted.files.map((file) => file.data));
      return extracted;
    },
  };
});

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

function invalidPrivateArchive(metadataOnly: boolean) {
  const id = randomUUID();
  const privatePayload = Buffer.from("sensitive-original-user-payload");
  const archive = createZipBuffer([
    { name: "metadata/historical-core.json", data: Buffer.from("{not-valid-json") },
    { name: "metadata/historical-private-visual-evidence.json", data: privatePayload },
    {
      name: metadataOnly ? "metadata/historical-metadata-only-integrity.json" : "metadata/historical-integrity.json",
      data: Buffer.from(JSON.stringify({ exportId: id, completeCustomerExport: false })),
    },
  ]);
  return { archive, digest: sha256(archive), id };
}

beforeEach(() => {
  extractedBuffers.length = 0;
});

describe("historical original-user ZIP verifier temporary extracted bytes", () => {
  it("zeroizes all extracted source and metadata copies on a rejected physical partial ZIP", () => {
    const { archive, digest, id } = invalidPrivateArchive(false);
    const original = Buffer.from(archive);
    expect(verifyHistoricalUserPartialArchive(archive, digest, id)).toBe(false);
    expect(extractedBuffers).toHaveLength(3);
    for (const data of extractedBuffers) expect(data.every((byte) => byte === 0)).toBe(true);
    expect(archive).toEqual(original);
  });

  it("zeroizes all extracted metadata-only ZIP copies after a forged original-user snapshot", () => {
    const { archive, digest, id } = invalidPrivateArchive(true);
    const original = Buffer.from(archive);
    expect(verifyHistoricalUserMetadataOnlyArchive(archive, digest, id)).toBe(false);
    expect(extractedBuffers).toHaveLength(3);
    for (const data of extractedBuffers) expect(data.every((byte) => byte === 0)).toBe(true);
    expect(archive).toEqual(original);
  });

  it("never extracts or mutates an archive that fails external SHA verification", () => {
    const { archive, id } = invalidPrivateArchive(false);
    expect(verifyHistoricalUserPartialArchive(archive, "a".repeat(64), id)).toBe(false);
    expect(verifyHistoricalUserMetadataOnlyArchive(archive, "a".repeat(64), id)).toBe(false);
    expect(extractedBuffers).toHaveLength(0);
  });
});
