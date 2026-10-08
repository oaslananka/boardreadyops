import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const prose = new URL("../../../scripts/rule-narratives.json", import.meta.url);
const page = new URL("../../../docs/rules/manufacturing.board-edge-clearance.md", import.meta.url);

describe("board-edge clearance generated documentation", () => {
  it("keeps safe advisory and finding evidence contracts in the generated rule page", async () => {
    const narratives = JSON.parse(await readFile(prose, "utf8")) as Record<string, { fires: string; details: string }>;
    const narrative = narratives["manufacturing.board-edge-clearance"];
    expect(narrative).toBeDefined();
    const generated = await readFile(page, "utf8");
    expect(generated).toContain(narrative?.fires);
    expect(generated).toContain(narrative?.details);
    expect(generated).toContain("non-blocking advisory");
    expect(generated).toContain("geometryConfidence");
    expect(generated).toContain("blockingRationale");
    expect(generated).toContain("profileAssurance");
    expect(generated).not.toContain("{ measuredClearanceMm, minClearanceMm, confidence, layer, profileRevision }");
  });
});
