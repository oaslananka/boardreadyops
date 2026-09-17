import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { writeTextFile } from "../../../../src/util/fs.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-paste-coverage-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("manufacturing.paste-coverage (#770)", () => {
  it("passes when top SMT components have F.Paste in Gerber package", async () => {
    await withTempDir(async (dir) => {
      const pcb = `(kicad_pcb
        (version 20240108)
        (footprint "SOIC-8"
          (layer "F.Cu")
          (property "Reference" "U1")
          (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask"))
        )
      )`;
      await writeTextFile(path.join(dir, "board.kicad_pro"), "");
      await writeTextFile(path.join(dir, "board.kicad_pcb"), pcb);
      await writeTextFile(path.join(dir, "gerbers", "board-F_Cu.gtl"), "G04 Top Copper*");
      await writeTextFile(path.join(dir, "gerbers", "board-F_Paste.gtp"), "G04 Top Solder Paste*");

      const result = await runPipeline({ path: dir, rules: ["manufacturing.paste-coverage"] });
      const pasteFindings = result.findings.filter((f) => f.ruleId === "manufacturing.paste-coverage");
      expect(pasteFindings).toHaveLength(0);
    });
  });

  it("reports finding when top SMT components exist but F.Paste is missing", async () => {
    await withTempDir(async (dir) => {
      const pcb = `(kicad_pcb
        (version 20240108)
        (footprint "SOIC-8"
          (layer "F.Cu")
          (property "Reference" "U1")
          (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask"))
        )
      )`;
      await writeTextFile(path.join(dir, "board.kicad_pro"), "");
      await writeTextFile(path.join(dir, "board.kicad_pcb"), pcb);
      await writeTextFile(path.join(dir, "gerbers", "board-F_Cu.gtl"), "G04 Top Copper*");
      // Note: no F_Paste / .gtp file created

      const result = await runPipeline({ path: dir, rules: ["manufacturing.paste-coverage"] });
      const pasteFindings = result.findings.filter((f) => f.ruleId === "manufacturing.paste-coverage");
      expect(pasteFindings).toHaveLength(1);
      expect(pasteFindings[0]?.message).toContain("top");
    });
  });

  it("does not require paste layer when side contains only through-hole components", async () => {
    await withTempDir(async (dir) => {
      const pcb = `(kicad_pcb
        (version 20240108)
        (footprint "R_Axial"
          (layer "F.Cu")
          (property "Reference" "R1")
          (pad "1" thru_hole rect (at 0 0) (size 1 1) (drill 0.8) (layers "*.Cu" "*.Mask"))
        )
      )`;
      await writeTextFile(path.join(dir, "board.kicad_pro"), "");
      await writeTextFile(path.join(dir, "board.kicad_pcb"), pcb);
      await writeTextFile(path.join(dir, "gerbers", "board-F_Cu.gtl"), "G04 Top Copper*");
      // Solderpaste file not required for through-hole only

      const result = await runPipeline({ path: dir, rules: ["manufacturing.paste-coverage"] });
      const pasteFindings = result.findings.filter((f) => f.ruleId === "manufacturing.paste-coverage");
      expect(pasteFindings).toHaveLength(0);
    });
  });
});
