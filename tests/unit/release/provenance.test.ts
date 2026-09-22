import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeSourceFingerprint,
  createExportProvenanceManifest,
  type ExportProvenanceManifest,
  verifyExportProvenance,
} from "../../../src/core/provenance.js";
import { writeFixture } from "../rules/helpers.js";

describe("release/provenance", () => {
  it("computes a deterministic source fingerprint independent of file ordering", async () => {
    const root = await writeFixture({
      "board.kicad_pcb": "(kicad_pcb)",
      "board.kicad_sch": "(kicad_sch)",
      "unreadable.kicad_pcb": "(kicad_pcb)",
    });

    const fp1 = await computeSourceFingerprint(root);
    const fp2 = await computeSourceFingerprint(root, ["**/*.kicad_pcb", "**/*.kicad_sch"]);

    expect(fp1).toEqual(fp2);
    expect(fp1).toHaveLength(64);

    const emptyRoot = await writeFixture({});
    const emptyFp = await computeSourceFingerprint(emptyRoot);
    expect(emptyFp).toHaveLength(64);
  });

  it("verifies matching export provenance manifest and artifacts", async () => {
    const root = await writeFixture({
      "board.kicad_pcb": "(kicad_pcb)",
      "top.gtl": "D10*X0Y0D03*M02*",
    });

    const artifactContent = "D10*X0Y0D03*M02*";
    const artifactSha = "3c7ba9a37495527355cb23a3971b5f963b2fd6c505845bbaa3e4a4a0a141ede1";

    const manifest = await createExportProvenanceManifest({
      root,
      artifacts: [{ path: "top.gtl", sha256: artifactSha, bytes: artifactContent.length }],
      git: { sha: "1111222233334444555566667777888899990000", dirty: false },
      generatedAt: "2026-09-21T00:00:00.000Z",
    });

    expect(manifest.generatedAt).toBe("2026-09-21T00:00:00.000Z");

    const simpleManifest = await createExportProvenanceManifest({
      root,
      artifacts: [{ path: "top.gtl", sha256: artifactSha, bytes: artifactContent.length }],
    });
    expect(simpleManifest.git).toBeUndefined();
    expect(simpleManifest.generatedAt).toBeDefined();

    await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));

    const result = await verifyExportProvenance(root, "manifest.json", {
      currentGitSha: "1111222233334444555566667777888899990000",
    });
    expect(result.status).toBe("verified");
    expect(result.sourceFingerprintMatch).toBe(true);
    expect(result.gitShaMatch).toBe(true);
    expect(result.reasons).toEqual([]);

    const directResult = await verifyExportProvenance(root, manifest);
    expect(directResult.status).toBe("verified");
  });

  it("detects git SHA mismatch", async () => {
    const root = await writeFixture({
      "board.kicad_pcb": "(kicad_pcb)",
      "top.gtl": "D10*X0Y0D03*M02*",
    });

    const manifest = await createExportProvenanceManifest({
      root,
      artifacts: [
        { path: "top.gtl", sha256: "3c7ba9a37495527355cb23a3971b5f963b2fd6c505845bbaa3e4a4a0a141ede1", bytes: 16 },
      ],
      git: { sha: "1111222233334444555566667777888899990000" },
    });

    const result = await verifyExportProvenance(root, manifest, {
      currentGitSha: "9999999999999999999999999999999999999999",
    });
    expect(result.status).toBe("mismatch");
    expect(result.gitShaMatch).toBe(false);
  });

  it("detects stale manufacturing artifacts when source file changes", async () => {
    const root = await writeFixture({
      "board.kicad_pcb": "(kicad_pcb)",
      "top.gtl": "D10*X0Y0D03*M02*",
    });

    const artifactContent = "D10*X0Y0D03*M02*";
    const artifactSha = "3c7ba9a37495527355cb23a3971b5f963b2fd6c505845bbaa3e4a4a0a141ede1";

    const manifest = await createExportProvenanceManifest({
      root,
      artifacts: [{ path: "top.gtl", sha256: artifactSha, bytes: artifactContent.length }],
    });

    await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));

    await fs.writeFile(path.join(root, "board.kicad_pcb"), "(kicad_pcb (rev 2))");

    const result = await verifyExportProvenance(root, "manifest.json");
    expect(result.status).toBe("mismatch");
    expect(result.sourceFingerprintMatch).toBe(false);
    expect(result.reasons[0]).toContain("Source fingerprint mismatch");
  });

  it("detects artifact modification after export", async () => {
    const root = await writeFixture({
      "board.kicad_pcb": "(kicad_pcb)",
      "top.gtl": "D10*X0Y0D03*M02*",
    });

    const manifest = await createExportProvenanceManifest({
      root,
      artifacts: [
        { path: "top.gtl", sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 10 },
      ],
    });

    await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));

    const result = await verifyExportProvenance(root, "manifest.json");
    expect(result.status).toBe("mismatch");
    expect(result.artifactMismatches).toContain("top.gtl");
  });

  it("rejects path traversal, malformed JSON, missing files, and escaped artifact paths", async () => {
    const root = await writeFixture({
      "board.kicad_pcb": "(kicad_pcb)",
      "malformed.json": "{ invalid json",
    });

    const manifest = await createExportProvenanceManifest({
      root,
      artifacts: [
        { path: "../outside.gtl", sha256: "1234", bytes: 10 },
        { path: "missing.gtl", sha256: "1234", bytes: 10 },
      ],
    });

    const result = await verifyExportProvenance(root, manifest);
    expect(result.status).toBe("mismatch");
    expect(result.artifactMismatches).toContain("../outside.gtl");
    expect(result.missingArtifacts).toContain("missing.gtl");

    const traversalRes = await verifyExportProvenance(root, "../outside/manifest.json");
    expect(traversalRes.status).toBe("mismatch");

    const missingRes = await verifyExportProvenance(root, "nonexistent.json");
    expect(missingRes.status).toBe("missing");

    const malformedRes = await verifyExportProvenance(root, "malformed.json");
    expect(malformedRes.status).toBe("missing");
    expect(malformedRes.reasons[0]).toContain("unreadable or malformed");
  });

  it("rejects unsupported schema versions", async () => {
    const root = await writeFixture({});
    const manifest = { schemaVersion: 99, tool: { name: "boardreadyops" } } as unknown as ExportProvenanceManifest;
    const result = await verifyExportProvenance(root, manifest);
    expect(result.status).toBe("unsupported");
  });
});
