import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const files = ["zaptrace-sample-pcb.svg", "zaptrace-sample-schematic.svg"];

describe("sample-only KiCad design views shipped with empty Review UX", () => {
  it.each(files)(
    "uses offline native SVG, never customer Review data or active/external resources: %s",
    async (file) => {
      const svg = await fs.readFile(path.join("apps/web/public/demo", file), "utf8");
      expect(svg.length).toBeGreaterThan(10_000);
      expect(Buffer.byteLength(svg)).toBeLessThan(512 * 1024);
      expect(svg).toMatch(/<svg\b/u);
      expect(svg).toMatch(/\bviewBox="/u);
      expect(svg).not.toMatch(/<!DOCTYPE|<!ENTITY|<script|<foreignObject|<iframe|\sonload=|@import/iu);
      expect(svg).not.toMatch(/\b(?:xlink:)?href=["'](?:https?:|file:|\/\/)/iu);
      expect(svg).not.toMatch(/url\(\s*["']?(?:https?:|file:|\/\/)/iu);
    },
  );
});
