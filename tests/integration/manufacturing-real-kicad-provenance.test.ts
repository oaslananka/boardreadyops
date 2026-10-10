import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyExportProvenance } from "../../src/core/provenance.js";
import { detectKicadCli } from "../../src/kicad/cli.js";
import { createKicadCliRunner, runGenerate } from "../../src/release/generate.js";

const safeBasicFixture = path.resolve("tests/fixtures/projects/safe-basic");

// Real KiCad generates the actual Gerber/Excellon bytes; unlike unit-test runners,
// this test cannot pass by writing invented fixture outputs. The verified status
// below proves self-reported BYTE consistency only, not GitHub OIDC provenance.
describe("real KiCad manufacturing output inventory (no trusted attestation)", () => {
  it("binds actual export bytes to source fingerprint and rejects tampering, missing output, stale input and added artwork", async (context) => {
    const cli = await detectKicadCli();
    const supported = /^10\.0\./u.test(cli.version ?? "");
    if (!process.env.CI) {
      context.skip(!cli.found || !supported, "KiCad CLI 10.0.x required for real manufacturing export");
    }
    expect(cli.found).toBe(true);
    expect(cli.version).toMatch(/^10\.0\./u);
    if (!cli.path) throw new Error("KiCad CLI executable path is unavailable");

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-real-export-"));
    try {
      await fs.cp(safeBasicFixture, root, { recursive: true });
      // Generated output must not falsely dirty the source checkout.
      await fs.writeFile(path.join(root, ".gitignore"), "build/\n");
      // This local commit is a test source identity only; not a trusted runner attestation.
      execFileSync("git", ["init", "--quiet"], { cwd: root });
      execFileSync("git", ["add", "--", "."], { cwd: root });
      execFileSync(
        "git",
        ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"],
        { cwd: root },
      );
      const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
      const outputDir = path.join(root, "build", "boardreadyops-generate");
      const boardFile = path.join(root, "safe-basic.kicad_pcb");
      const result = await runGenerate(
        { schemaVersion: 1, steps: [{ kind: "gerbers" }, { kind: "drill" }] },
        { outputDir, boardFile, gitRoot: root, kicadVersion: cli.version, runner: createKicadCliRunner(cli.path) },
      );
      expect(result.failures).toBe(0);
      expect(result.steps.map((step) => step.kind)).toEqual(["gerbers", "drill"]);
      const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8")) as {
        kind: string;
        git?: { sha?: string; dirty?: boolean };
        sourceSnapshot?: string;
        sourceFingerprint?: string;
        kicadVersion?: string;
        artifacts: Array<{ path: string; sha256: string; bytes: number }>;
      };
      expect(manifest.kind).toBe("boardreadyops.export-provenance");
      expect(manifest.git?.sha).toBe(sha);
      expect(manifest.git?.dirty).toBe(false);
      expect(manifest.sourceSnapshot).toBe("stable");
      expect(manifest.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(manifest.kicadVersion).toBe(cli.version);
      expect(manifest.artifacts.some((artifact) => artifact.path.endsWith(".drl"))).toBe(true);
      expect(manifest.artifacts.some((artifact) => artifact.path.endsWith(".gtl"))).toBe(true);
      expect(manifest.artifacts.length).toBeGreaterThan(2);
      for (const artifact of manifest.artifacts) {
        const bytes = await fs.readFile(path.join(outputDir, artifact.path));
        expect(bytes.byteLength).toBe(artifact.bytes);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
      }
      const manifestRelative = path.relative(root, result.manifestPath);
      const checked = await verifyExportProvenance(root, manifestRelative, { currentGitSha: sha });
      expect(checked.status, checked.reasons.join(" | ")).toBe("verified"); // byte consistency only; no verified workflow identity
      expect(checked.gitShaMatch).toBe(true);
      expect(checked.sourceFingerprintMatch).toBe(true);

      const wrongCommit = await verifyExportProvenance(root, manifestRelative, { currentGitSha: "f".repeat(40) });
      expect(wrongCommit.status).toBe("mismatch");
      expect(wrongCommit.gitShaMatch).toBe(false);

      const artwork = manifest.artifacts.find((artifact) => artifact.path.endsWith(".gtl"));
      const drill = manifest.artifacts.find((artifact) => artifact.path.endsWith(".drl"));
      if (!artwork || !drill) throw new Error("KiCad did not generate Gerber and Excellon outputs");
      const gerberPath = path.join(outputDir, artwork.path);
      const genuine = await fs.readFile(gerberPath);
      await fs.appendFile(gerberPath, "\nG04 TAMPERED*\n");
      const tampered = await verifyExportProvenance(root, manifestRelative);
      expect(tampered.status).toBe("mismatch");
      expect(tampered.artifactMismatches).toContain(artwork.path);
      await fs.writeFile(gerberPath, genuine);

      const drillPath = path.join(outputDir, drill.path);
      const genuineDrill = await fs.readFile(drillPath);
      await fs.rm(drillPath);
      const missing = await verifyExportProvenance(root, manifestRelative);
      expect(missing.status).toBe("mismatch");
      expect(missing.missingArtifacts).toContain(drill.path);
      await fs.writeFile(drillPath, genuineDrill);

      await fs.writeFile(path.join(outputDir, "gerbers", "unlisted.gbr"), "unreviewed artwork");
      const additional = await verifyExportProvenance(root, manifestRelative);
      expect(additional.status).toBe("mismatch");
      expect(additional.reasons).toContain("Undeclared generated artifact: gerbers/unlisted.gbr");
      await fs.rm(path.join(outputDir, "gerbers", "unlisted.gbr"));

      await fs.appendFile(boardFile, "\n(kicad_source_mutated)\n");
      const staleSource = await verifyExportProvenance(root, manifestRelative, { currentGitSha: sha });
      expect(staleSource.status).toBe("mismatch");
      expect(staleSource.sourceFingerprintMatch).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
