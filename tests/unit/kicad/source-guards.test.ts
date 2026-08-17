import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("KiCad source guards", () => {
  it("keeps outline area ordering non-mutating", async () => {
    const source = await readFile("src/kicad/pcb.ts", "utf8");

    expect(source).toContain("areas.toSorted((left, right) => right - left)");
    expect(source).not.toContain("areas.sort((left, right) => right - left)");
  });
});
