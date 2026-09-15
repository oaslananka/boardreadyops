import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { captureFirmwareSnapshot } from "../../../src/rules/firmware-snapshot.js";

/**
 * Puts firmware dependencies into the run result so the SBOM can carry them. Before #786 nothing
 * here read a dependency manifest, and createHbom built components only from the hardware BOM --
 * there were no firmware components in the device SBOM at all. Step 3 of #785.
 */

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "brops-fw-"));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}

describe("captureFirmwareSnapshot", () => {
  it("returns nothing for a project with no firmware manifest", async () => {
    const root = await tree({ "README.md": "# board\n" });

    // Empty rather than invented. The pipeline turns this into an absent `firmware` key so a
    // consumer can tell "no firmware here" from "firmware with no dependencies".
    expect(await captureFirmwareSnapshot(root)).toEqual({ dependencies: [], warnings: [] });
  });

  it("records each dependency with its origin and whether it can be looked up", async () => {
    const root = await tree({
      "firmware/idf_component.yml": [
        "dependencies:",
        '  idf: ">=5.0"',
        '  led_strip: "2.4.1"',
        "  mcuboot:",
        "    git: https://github.com/mcu-tools/mcuboot",
        "  mine:",
        "    path: ../components/mine",
      ].join("\n"),
    });

    const snapshot = await captureFirmwareSnapshot(root);

    expect(snapshot.dependencies).toEqual([
      {
        name: "idf",
        manifestPath: "firmware/idf_component.yml",
        origin: "framework",
        versionSpec: ">=5.0",
        pinned: false,
        searchable: false,
      },
      {
        name: "led_strip",
        manifestPath: "firmware/idf_component.yml",
        origin: "registry",
        versionSpec: "2.4.1",
        pinned: true,
        searchable: false,
      },
      {
        name: "mcuboot",
        manifestPath: "firmware/idf_component.yml",
        origin: "git",
        pinned: false,
        purl: "pkg:golang/github.com/mcu-tools/mcuboot",
        searchable: true,
        identitySource: "OSV GO-2024-2799 (CVE-2024-32883)",
      },
      {
        name: "mine",
        manifestPath: "firmware/idf_component.yml",
        origin: "local",
        pinned: false,
        searchable: false,
      },
    ]);
  });

  it("uses POSIX manifest paths so the report is stable across platforms", async () => {
    const root = await tree({ "a/b/idf_component.yml": 'dependencies:\n  led_strip: "1.0.0"\n' });

    expect((await captureFirmwareSnapshot(root)).dependencies[0]?.manifestPath).toBe("a/b/idf_component.yml");
  });

  it("collects dependencies from every manifest in a deterministic order", async () => {
    const root = await tree({
      "b/idf_component.yml": 'dependencies:\n  second: "1.0.0"\n',
      "a/idf_component.yml": 'dependencies:\n  first: "1.0.0"\n',
    });

    const snapshot = await captureFirmwareSnapshot(root);

    // A bill of materials that reorders between runs makes every diff noise.
    expect(snapshot.dependencies.map((entry) => entry.manifestPath)).toEqual([
      "a/idf_component.yml",
      "b/idf_component.yml",
    ]);
  });

  it("surfaces a malformed manifest as a warning instead of throwing", async () => {
    const root = await tree({ "idf_component.yml": "dependencies:\n  - this is: [not\n    valid" });

    const snapshot = await captureFirmwareSnapshot(root);

    expect(snapshot.dependencies).toEqual([]);
    expect(snapshot.warnings.join(" ")).toContain("not valid YAML");
  });

  it("expects almost nothing to be searchable today", async () => {
    const root = await tree({
      "idf_component.yml": ["dependencies:", '  a: "1.0.0"', '  b: "1.0.0"', '  c: "1.0.0"'].join("\n"),
    });

    // Pinned deliberately. If registry components start coming back searchable, the curated
    // mapping has begun guessing, and that is the false clean bill #785 exists to prevent.
    const snapshot = await captureFirmwareSnapshot(root);
    expect(snapshot.dependencies.every((entry) => entry.searchable === false)).toBe(true);
  });
});
