import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const fontRoot = "apps/web/app/fonts";
const assets = [
  {
    name: "inter-latin-variable-normal.woff2",
    sha256: "3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62",
    license: "INTER-OFL.txt",
  },
  {
    name: "jetbrains-mono-latin-variable-normal.woff2",
    sha256: "18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e",
    license: "JETBRAINS-MONO-OFL.txt",
  },
  {
    name: "instrument-serif-latin-400-normal.woff2",
    sha256: "5eb09b5ac0e28b67c2f041c8ba6d244604ca0c0980d65912ab2d47fed84ddc31",
    license: "INSTRUMENT-SERIF-OFL.txt",
  },
] as const;

describe("deterministic local fonts (#1157)", () => {
  it("does not fetch Google Fonts from the Next.js root layout at build time", async () => {
    const layout = await readFile("apps/web/app/layout.tsx", "utf8");
    expect(layout).toContain('import localFont from "next/font/local"');
    expect(layout).not.toContain('from "next/font/google"');
    for (const item of assets) expect(layout).toContain(`./fonts/${item.name}`);
    expect(layout).toContain('variable: "--font-ui-loaded"');
    expect(layout).toContain('variable: "--font-mono-loaded"');
    expect(layout).toContain('variable: "--font-display-loaded"');
    expect(layout.match(/display: "swap"/gu)).toHaveLength(3);
    expect(layout).toContain('weight: "100 900"');
    expect(layout).toContain('weight: "100 800"');
    expect(layout).toContain('weight: "400"');
  });

  it.each(assets)("pins an unchanged, licensed WOFF2 asset: $name", async ({ name, sha256, license }) => {
    const bytes = await readFile(`${fontRoot}/${name}`);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    const licenseText = await readFile(`${fontRoot}/licenses/${license}`, "utf8");
    expect(licenseText).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });
});
