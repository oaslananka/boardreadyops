import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { createExportProvenanceManifest } from "../../../../src/core/provenance.js";
import { expectRule, writeFixture } from "../helpers.js";

const enabled = "version: 1\nrules:\n  release.artifact-provenance:\n    enabled: true\nfail-on: never\n";

async function run(files: Record<string, string>) {
  const root = await writeFixture({
    "board.kicad_pro": "{}",
    "board.kicad_sch": "(kicad_sch)",
    "board.kicad_pcb": "(kicad_pcb)",
    "boardreadyops.yml": enabled,
    ...files,
  });
  return await runPipeline({ path: root, rules: ["release.artifact-provenance"], failOn: "never" });
}

describe("release.artifact-provenance", () => {
  it("flags exported Gerbers that lack a provenance manifest", async () => {
    const result = await run({
      "fab/top.gtl": "D10*X0Y0D03*M02*",
    });

    const findings = expectRule(result, "release.artifact-provenance", 1);
    expect(findings[0]?.message).toContain("lack an export provenance manifest");
    expect(findings[0]?.details).toMatchObject({ status: "missing", artifactCount: 1 });
    expect(findings[0]?.fix?.description).toContain("Generate manufacturing outputs using boardreadyops generate");
    expect(findings[0]?.fix?.steps).toHaveLength(2);
    expect(findings[0]?.fix?.steps?.[0]).toContain("Run `boardreadyops generate`");
  });

  it("passes when Gerbers have a valid provenance manifest matching source", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": enabled,
      "fab/top.gtl": "D10*X0Y0D03*M02*",
    });

    const manifest = await createExportProvenanceManifest({
      root,
      artifacts: [
        {
          path: "top.gtl",
          sha256: "3c7ba9a37495527355cb23a3971b5f963b2fd6c505845bbaa3e4a4a0a141ede1",
          bytes: 16,
        },
      ],
    });

    await fs.writeFile(path.join(root, "fab/manifest.json"), JSON.stringify(manifest, null, 2));

    const result = await runPipeline({ path: root, rules: ["release.artifact-provenance"], failOn: "never" });
    expect(expectRule(result, "release.artifact-provenance", 0)).toEqual([]);
  });

  it("flags stale Gerbers when source file was modified after export", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": enabled,
      "fab/top.gtl": "D10*X0Y0D03*M02*",
    });

    const manifest = await createExportProvenanceManifest({
      root,
      artifacts: [
        {
          path: "top.gtl",
          sha256: "3c7ba9a37495527355cb23a3971b5f963b2fd6c505845bbaa3e4a4a0a141ede1",
          bytes: 16,
        },
      ],
    });

    await fs.writeFile(path.join(root, "fab/manifest.json"), JSON.stringify(manifest, null, 2));

    await fs.writeFile(path.join(root, "board.kicad_pcb"), "(kicad_pcb (rev 2))");

    const result = await runPipeline({ path: root, rules: ["release.artifact-provenance"], failOn: "never" });
    const findings = expectRule(result, "release.artifact-provenance", 1);
    expect(findings[0]?.message).toContain("stale: source files have changed");
    expect(findings[0]?.details).toMatchObject({ status: "mismatch", sourceFingerprintMatch: false });
  });

  it("flags modified manufacturing artifacts", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": enabled,
      "fab/top.gtl": "D10*X0Y0D03*M02*",
    });

    const manifest = await createExportProvenanceManifest({
      root,
      artifacts: [
        {
          path: "top.gtl",
          sha256: "0000000000000000000000000000000000000000000000000000000000000000",
          bytes: 16,
        },
      ],
    });

    await fs.writeFile(path.join(root, "fab/manifest.json"), JSON.stringify(manifest, null, 2));

    const result = await runPipeline({ path: root, rules: ["release.artifact-provenance"], failOn: "never" });
    const findings = expectRule(result, "release.artifact-provenance", 1);
    expect(findings[0]?.message).toContain("modified after export: top.gtl");
    expect(findings[0]?.details).toMatchObject({ status: "mismatch", artifactMismatches: ["top.gtl"] });
  });

  it("uses configured manifest-path if provided", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml":
        "version: 1\nrules:\n  release.artifact-provenance:\n    enabled: true\n    manifest-path: custom/provenance.json\nfail-on: never\n",
      "fab/top.gtl": "D10*X0Y0D03*M02*",
      "custom/provenance.json": "{ invalid json",
    });

    const result = await runPipeline({ path: root, rules: ["release.artifact-provenance"], failOn: "never" });
    const findings = expectRule(result, "release.artifact-provenance", 1);
    expect(findings[0]?.message).toContain("failed provenance verification");
  });
});
