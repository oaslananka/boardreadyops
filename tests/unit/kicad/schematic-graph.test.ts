import { describe, expect, it } from "vitest";
import { buildSchematicNetGraph } from "../../../src/kicad/schematic-graph.js";
import { HostileInputError } from "../../../src/util/errors.js";

describe("buildSchematicNetGraph hostile input guard", () => {
  it("rejects a sheet hierarchy with an absurd number of distinct sheets", async () => {
    const rootFiles = Array.from({ length: 5001 }, (_, index) => `/nonexistent/sheet-${index}.kicad_sch`);
    await expect(buildSchematicNetGraph(rootFiles)).rejects.toThrow(HostileInputError);
  });
});
