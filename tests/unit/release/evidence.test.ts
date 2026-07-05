import fs from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import evidenceSchema from "../../../schemas/evidence.schema.json" with { type: "json" };
import { runPipeline } from "../../../src/core/pipeline.js";
import { verifyReleaseEvidenceBundle, writeReleaseEvidenceBundle } from "../../../src/release/evidence.js";
import { writeFixture } from "../rules/helpers.js";

describe("release evidence bundles", () => {
  it("writes a deterministic manifest with reports, copied artifacts, gaps, and checksums", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": '(kicad_sch (global_label "PRESENT"))',
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "fab/board.GTL": "gerber-top",
      "fab/board.drl": "drill",
      "fab/bom.csv": "Designator,MPN\nU1,ABC\n",
      "fab/cpl.csv": "Designator,Mid X,Mid Y\nU1,1,2\n",
      "boardreadyops.yml": "version: 1\nfail-on: never\n",
    });
    const result = await runPipeline({ path: root, failOn: "never", rules: ["manifest.project-discovery"] });

    await fs.mkdir(path.join(root, "outputs"), { recursive: true });
    await fs.writeFile(path.join(root, "outputs", "schematic.pdf"), "generated-schematic", "utf8");

    const written = await writeReleaseEvidenceBundle(root, result, {
      outputDir: "bundle",
      generatedAt: "2026-06-20T00:00:00.000Z",
      gitSha: "abc123",
      gitDirty: false,
      includeGenerated: "outputs",
      provenance: { source: "github://release/1" },
    });

    expect(written.manifest).toMatchObject({
      schemaVersion: 2,
      tool: { name: "boardreadyops" },
      generatedAt: "2026-06-20T00:00:00.000Z",
      git: { sha: "abc123", dirty: false },
      decision: { status: "pass", reasons: [] },
      layout: { reports: "reports", artifacts: "artifacts", generated: "generated" },
      provenance: { source: "github://release/1" },
      verification: { algorithm: "sha256", artifactCount: 7 },
    });
    expect(written.manifest.artifacts.map((artifact) => artifact.path)).toEqual([
      "artifacts/fab/board.drl",
      "artifacts/fab/board.GTL",
      "artifacts/fab/bom.csv",
      "artifacts/fab/cpl.csv",
      "generated/schematic.pdf",
      "reports/boardreadyops-report.json",
      "reports/boardreadyops-report.md",
    ]);
    expect(written.manifest.artifacts.find((artifact) => artifact.path === "generated/schematic.pdf")).toMatchObject({
      kind: "generated",
      sourcePath: "outputs/schematic.pdf",
    });
    expect(written.manifest.artifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.sha256))).toBe(true);
    expect(written.manifest.gaps).toEqual([]);
    await expect(fs.readFile(path.join(root, "bundle", "manifest.json"), "utf8")).resolves.toContain(
      '"schemaVersion": 2',
    );
    const rawManifest = await fs.readFile(path.join(root, "bundle", "manifest.json"), "utf8");
    const ajv = new Ajv2020({ allErrors: true });
    const validate = ajv.compile(evidenceSchema);
    expect(validate(JSON.parse(rawManifest)), JSON.stringify(validate.errors)).toBe(true);
    await expect(verifyReleaseEvidenceBundle(path.join(root, "bundle"))).resolves.toMatchObject({
      ok: true,
      checked: 7,
    });
  });

  it("reports explicit gaps and detects checksum drift", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "boardreadyops.yml": "version: 1\nfail-on: never\n",
    });
    const result = await runPipeline({ path: root, failOn: "never", rules: ["manifest.project-discovery"] });
    const written = await writeReleaseEvidenceBundle(root, result, {
      outputDir: "bundle",
      generatedAt: "2026-06-20T00:00:00.000Z",
    });

    expect(written.manifest.gaps.map((gap) => gap.kind)).toContain("missing-project-file");
    expect(written.manifest.gaps.map((gap) => gap.kind)).toContain("missing-artifact");
    expect(written.manifest.decision.status).toBe("pass");
    expect(written.manifest.decision.reasons.join(" ")).toContain("evidence gap");

    await fs.writeFile(path.join(root, "bundle", "reports", "boardreadyops-report.md"), "tampered", "utf8");
    const verification = await verifyReleaseEvidenceBundle(path.join(root, "bundle"));
    expect(verification.ok).toBe(false);
    expect(verification.errors.join("\n")).toContain("checksum or size mismatch");
  });
});
