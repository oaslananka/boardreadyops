import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { writeFixture } from "../helpers.js";

describe("release.version-format", () => {
  it("flags board revisions outside the configured release format", async () => {
    const root = await writeFixture({
      "version.kicad_pro": "{}",
      "version.kicad_sch": '(kicad_sch (title_block (rev "release-1.2.3")))',
      "version.kicad_pcb": '(kicad_pcb (title_block (rev "release-1.2.3")))',
      "boardreadyops.yml": "version: 1\nfail-on: never\n",
    });

    const result = await runPipeline({ path: root, rules: ["release.version-format"], failOn: "never" });

    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((finding) => finding.resource.kind).sort()).toEqual(["pcb", "schematic"]);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "release.version-format",
          severity: "low",
          message: "PCB revision release-1.2.3 does not match ^[vr]?\\d+\\.\\d+(?:\\.\\d+)?$.",
          resource: { kind: "pcb", path: "version.kicad_pcb" },
          details: { revision: "release-1.2.3", pattern: "^[vr]?\\d+\\.\\d+(?:\\.\\d+)?$" },
        }),
        expect.objectContaining({
          ruleId: "release.version-format",
          severity: "low",
          message: "Schematic revision release-1.2.3 does not match ^[vr]?\\d+\\.\\d+(?:\\.\\d+)?$.",
          resource: { kind: "schematic", path: "version.kicad_sch" },
          details: { revision: "release-1.2.3", pattern: "^[vr]?\\d+\\.\\d+(?:\\.\\d+)?$" },
        }),
      ]),
    );
  });

  it("accepts revisions matching a custom configured release format", async () => {
    const root = await writeFixture({
      "version.kicad_pro": "{}",
      "version.kicad_sch": '(kicad_sch (title_block (rev "2.4.0")))',
      "version.kicad_pcb": '(kicad_pcb (title_block (rev "2.4.0")))',
      "boardreadyops.yml":
        "version: 1\nrules:\n  release.version-format:\n    pattern: '^\\d+\\.\\d+\\.\\d+$'\nfail-on: never\n",
    });

    const result = await runPipeline({ path: root, rules: ["release.version-format"], failOn: "never" });

    expect(result.findings).toEqual([]);
  });

  it("reports invalid configured release format patterns", async () => {
    const root = await writeFixture({
      "version.kicad_pro": "{}",
      "version.kicad_sch": '(kicad_sch (title_block (rev "2.4.0")))',
      "version.kicad_pcb": '(kicad_pcb (title_block (rev "2.4.0")))',
      "boardreadyops.yml": "version: 1\nrules:\n  release.version-format:\n    pattern: '['\nfail-on: never\n",
    });

    const result = await runPipeline({ path: root, rules: ["release.version-format"], failOn: "never" });

    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "release.version-format",
        resource: { kind: "project", path: expect.stringContaining("boardreadyops.yml") },
        details: { pattern: "[" },
      }),
    ]);
  });

  it("does not flag PCB or schematic files with no revision set", async () => {
    const root = await writeFixture({
      "version.kicad_pro": "{}",
      "version.kicad_sch": "(kicad_sch)",
      "version.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": "version: 1\nfail-on: never\n",
    });

    const result = await runPipeline({ path: root, rules: ["release.version-format"], failOn: "never" });

    expect(result.findings).toEqual([]);
  });
});
