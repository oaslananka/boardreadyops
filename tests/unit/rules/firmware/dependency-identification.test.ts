import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, writeFixture } from "../helpers.js";

/**
 * A coverage statement, not a defect. It exists so the reader of a device SBOM cannot mistake
 * "not vulnerability-indexed" for "no advisories found" -- which OSV makes easy, because a
 * constructed PURL is accepted and returns empty. Part of #785.
 */

const enabled = "version: 1\nrules:\n  firmware.dependency-identification:\n    enabled: true\nfail-on: never\n";

async function run(files: Record<string, string>) {
  const root = await writeFixture({
    "board.kicad_pro": "{}",
    "board.kicad_sch": "(kicad_sch)",
    "board.kicad_pcb": "(kicad_pcb)",
    "boardreadyops.yml": enabled,
    ...files,
  });
  return await runPipeline({ path: root, rules: ["firmware.dependency-identification"], failOn: "never" });
}

describe("firmware.dependency-identification", () => {
  it("names the dependencies no advisory search covers", async () => {
    const result = await run({
      "firmware/idf_component.yml": ["dependencies:", '  idf: ">=5.0"', '  led_strip: "2.4.1"'].join("\n"),
    });

    const findings = expectRule(result, "firmware.dependency-identification", 1);
    expect(findings[0]?.message).toContain("2 of 2 firmware dependenc(ies) are not vulnerability-indexed");
    expect(findings[0]?.message).toContain("idf, led_strip");
    expect(findings[0]?.details).toMatchObject({ total: 2, searchable: 0, unidentified: 2 });
  });

  it("counts a component the curated mapping knows as searchable", async () => {
    const result = await run({
      "firmware/idf_component.yml": [
        "dependencies:",
        '  led_strip: "2.4.1"',
        "  mcuboot:",
        "    git: https://github.com/mcu-tools/mcuboot",
      ].join("\n"),
    });

    const findings = expectRule(result, "firmware.dependency-identification", 1);
    expect(findings[0]?.details).toMatchObject({ total: 2, searchable: 1, unidentified: 1 });
    expect(findings[0]?.details?.unidentifiedNames).toEqual(["led_strip"]);
  });

  it("never fails a run", async () => {
    const result = await run({
      "firmware/idf_component.yml": ["dependencies:", '  led_strip: "2.4.1"'].join("\n"),
    });

    // A coverage statement must not block a release. It reports what the SBOM will and will not
    // cover; deciding what to do about that is not this rule's business.
    for (const entry of expectRule(result, "firmware.dependency-identification", 1)) {
      expect(entry.severity).toBe("info");
    }
    expect(result.summary.failed).toBe(false);
  });

  it("stays quiet when the project has no ESP-IDF component", async () => {
    const result = await run({});
    expect(expectRule(result, "firmware.dependency-identification", 0)).toEqual([]);
  });

  it("stays quiet for a manifest that declares no dependencies", async () => {
    const result = await run({ "firmware/idf_component.yml": 'name: standalone\nversion: "0.1.0"\n' });
    expect(expectRule(result, "firmware.dependency-identification", 0)).toEqual([]);
  });

  it("reports each component manifest separately", async () => {
    const manifest = ["dependencies:", '  led_strip: "2.4.1"'].join("\n");
    const result = await run({
      "components/a/idf_component.yml": manifest,
      "components/b/idf_component.yml": manifest,
    });

    // Each manifest is its own bill of materials, and a reader needs to know which one is short.
    const findings = expectRule(result, "firmware.dependency-identification", 2);
    expect(findings.map((entry) => entry.resource.path).sort()).toEqual([
      "components/a/idf_component.yml",
      "components/b/idf_component.yml",
    ]);
  });
});
