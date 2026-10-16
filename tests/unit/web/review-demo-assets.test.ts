import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const files = ["zaptrace-sample-pcb.png", "zaptrace-sample-schematic.png"];

describe("example KiCad preview assets shown before the first Review", () => {
  it.each(files)("is a small offline PNG, never a customer Review snapshot: %s", async (file) => {
    const image = await fs.readFile(path.join("apps/web/public/demo", file));
    expect(image.length).toBeGreaterThan(2_000);
    expect(image.length).toBeLessThan(180_000);
    expect(image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(image.readUInt32BE(16)).toBeGreaterThanOrEqual(900);
    expect(image.readUInt32BE(20)).toBeGreaterThanOrEqual(600);
  });
});
