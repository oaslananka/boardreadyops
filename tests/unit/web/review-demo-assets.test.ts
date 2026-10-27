import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const files = ["royalblue54l-pcb.webp", "royalblue54l-schematic.webp"];

describe("KiCad example visuals (not customer evidence)", () => {
  it.each(files)("provides an offline source-based WebP preview: %s", async (file) => {
    const image = await fs.readFile(path.join("apps/web/public/demo", file));
    expect(image.length).toBeGreaterThan(10_000);
    expect(image.length).toBeLessThan(180_000);
    expect(image.toString("ascii", 0, 4)).toBe("RIFF");
    expect(image.toString("ascii", 8, 12)).toBe("WEBP");
  });
});
