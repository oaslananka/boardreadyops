import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePcb } from "../../../src/kicad/pcb.js";
import { writeTextFile } from "../../../src/util/fs.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-mounttype-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("PCB Footprint Mount Type Detection (#784)", () => {
  it("detects surface-mount footprint from pad types", async () => {
    await withTempDir(async (dir) => {
      const boardPath = path.join(dir, "smd-board.kicad_pcb");
      const pcbContent = `(kicad_pcb
        (version 20240108)
        (generator kicad)
        (footprint "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm"
          (layer "F.Cu")
          (property "Reference" "U1")
          (pad "1" smd rect (at -2.47 -1.905) (size 1.55 0.6) (layers "F.Cu" "F.Paste" "F.Mask"))
          (pad "2" smd rect (at -2.47 -0.635) (size 1.55 0.6) (layers "F.Cu" "F.Paste" "F.Mask"))
        )
      )`;
      await writeTextFile(boardPath, pcbContent);
      const parsed = await parsePcb(boardPath);

      expect(parsed.footprints).toHaveLength(1);
      const u1 = parsed.footprints[0];
      expect(u1?.reference).toBe("U1");
      expect(u1?.mountType).toBe("surface-mount");
    });
  });

  it("detects through-hole footprint from pad types", async () => {
    await withTempDir(async (dir) => {
      const boardPath = path.join(dir, "tth-board.kicad_pcb");
      const pcbContent = `(kicad_pcb
        (version 20240108)
        (generator kicad)
        (footprint "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal"
          (layer "F.Cu")
          (property "Reference" "R1")
          (pad "1" thru_hole rect (at 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask"))
          (pad "2" thru_hole oval (at 7.62 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask"))
        )
      )`;
      await writeTextFile(boardPath, pcbContent);
      const parsed = await parsePcb(boardPath);

      expect(parsed.footprints).toHaveLength(1);
      const r1 = parsed.footprints[0];
      expect(r1?.reference).toBe("R1");
      expect(r1?.mountType).toBe("through-hole");
    });
  });

  it("detects mixed mount-type footprint when both SMD and through-hole pads exist", async () => {
    await withTempDir(async (dir) => {
      const boardPath = path.join(dir, "mixed-board.kicad_pcb");
      const pcbContent = `(kicad_pcb
        (version 20240108)
        (generator kicad)
        (footprint "Connector_USB:USB_Micro-B_Molex_47346-0001"
          (layer "F.Cu")
          (property "Reference" "J1")
          (pad "1" smd rect (at -1.3 2.8) (size 0.4 1.35) (layers "F.Cu" "F.Paste" "F.Mask"))
          (pad "SH1" thru_hole oval (at -3.1 0) (size 1.8 1.9) (drill 1.2) (layers "*.Cu" "*.Mask"))
        )
      )`;
      await writeTextFile(boardPath, pcbContent);
      const parsed = await parsePcb(boardPath);

      expect(parsed.footprints).toHaveLength(1);
      const j1 = parsed.footprints[0];
      expect(j1?.reference).toBe("J1");
      expect(j1?.mountType).toBe("mixed");
    });
  });

  it("falls back to footprint attr smd or through_hole when pad type is absent/ambiguous", async () => {
    await withTempDir(async (dir) => {
      const boardPath = path.join(dir, "attr-board.kicad_pcb");
      const pcbContent = `(kicad_pcb
        (version 20240108)
        (generator kicad)
        (footprint "Custom:SMD_NoPadsYet"
          (layer "F.Cu")
          (property "Reference" "D1")
          (attr smd)
        )
        (footprint "Custom:THT_NoPadsYet"
          (layer "F.Cu")
          (property "Reference" "D2")
          (attr through_hole)
        )
      )`;
      await writeTextFile(boardPath, pcbContent);
      const parsed = await parsePcb(boardPath);

      expect(parsed.footprints).toHaveLength(2);
      const d1 = parsed.footprints.find((f) => f.reference === "D1");
      const d2 = parsed.footprints.find((f) => f.reference === "D2");

      expect(d1?.mountType).toBe("surface-mount");
      expect(d2?.mountType).toBe("through-hole");
    });
  });

  it("returns unknown when neither pad type evidence nor attr smd/through_hole exists", async () => {
    await withTempDir(async (dir) => {
      const boardPath = path.join(dir, "unknown-board.kicad_pcb");
      const pcbContent = `(kicad_pcb
        (version 20240108)
        (generator kicad)
        (footprint "Mechanical:MountingHole"
          (layer "F.Cu")
          (property "Reference" "H1")
        )
      )`;
      await writeTextFile(boardPath, pcbContent);
      const parsed = await parsePcb(boardPath);

      expect(parsed.footprints).toHaveLength(1);
      const h1 = parsed.footprints[0];
      expect(h1?.reference).toBe("H1");
      expect(h1?.mountType).toBe("unknown");
    });
  });
});
