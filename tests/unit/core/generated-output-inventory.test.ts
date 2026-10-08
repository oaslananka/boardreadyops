import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkFirstPartyOutputSet } from "../../../src/core/generated-output-inventory.js";
import { canonicalGeneratedPath, scanGeneratedOutputTree } from "../../../src/core/generated-output-scan.js";
import { createExportProvenanceManifest, verifyExportProvenance } from "../../../src/core/provenance.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
});

async function outputDirectory(): Promise<{ root: string; manifest: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brops-output-inventory-"));
  temporaryDirectories.push(root);
  const manifest = path.join(root, "manifest.json");
  await fs.writeFile(manifest, "{}");
  return { root, manifest };
}

describe("generated output inventory safeguards", () => {
  it("accepts canonical generated file names and rejects portable path aliases or escapes", () => {
    expect(canonicalGeneratedPath("gerbers/F_Cu.gbr")).toBe(true);
    for (const candidate of [
      "",
      ".",
      "../file.gbr",
      "gerbers/../file.gbr",
      "gerbers//file.gbr",
      "gerbers\\F_Cu.gbr",
      "/tmp/out.gbr",
      "C:\\Gerber\\file.gbr",
      "gerbers/CON.gbr",
      "gerbers/trailing.",
      "gerbers/trailing ",
      "gerbers/a:b.gbr",
      "gerbers/\u0000.gbr",
    ]) {
      expect(canonicalGeneratedPath(candidate), candidate).toBe(false);
    }
  });

  it("checks a complete nested file set and excludes the manifest itself", async () => {
    const { root, manifest } = await outputDirectory();
    await fs.mkdir(path.join(root, "gerbers", "inner"), { recursive: true });
    await fs.writeFile(path.join(root, "gerbers", "inner", "F_Cu.gbr"), "valid");
    const artifacts = [{ path: "gerbers/inner/F_Cu.gbr" }];
    expect(await checkFirstPartyOutputSet(root, manifest, artifacts)).toEqual([]);
    const scan = await scanGeneratedOutputTree(root, manifest, new Set(["gerbers", "gerbers/inner"]));
    expect([...scan.files]).toEqual(["gerbers/inner/F_Cu.gbr"]);
    expect(scan.reasons).toEqual([]);
  });

  it("rejects manifest self-reference, portable aliases and absent declared files", async () => {
    const { root, manifest } = await outputDirectory();
    const reasons = await checkFirstPartyOutputSet(root, manifest, [
      { path: "manifest.json" },
      { path: "F_Cu.gbr" },
      { path: "f_cu.gbr" },
      { path: "missing.gbr" },
    ]);
    expect(reasons.join(" ")).toContain("manifest self-reference");
    expect(reasons.join(" ")).toContain("Cross-platform generated artifact alias");
    expect(reasons.join(" ")).toContain("Declared generated artifact missing from file set");
  });

  it("rejects unexpected directories, output files and nonportable on-disk names", async () => {
    const { root, manifest } = await outputDirectory();
    await fs.mkdir(path.join(root, "extras"));
    await fs.writeFile(path.join(root, "extras", "unexpected.gbr"), "extra");
    if (process.platform !== "win32") {
      await fs.writeFile(path.join(root, "A.GBR"), "a");
      await fs.writeFile(path.join(root, "a.gbr"), "b");
      await fs.writeFile(path.join(root, "bad?.gbr"), "bad");
    }
    const reasons = await checkFirstPartyOutputSet(root, manifest, []);
    expect(reasons.join(" ")).toContain("Undeclared generated directory: extras");
    expect(reasons.join(" ")).toContain("Undeclared generated artifact: extras/unexpected.gbr");
    if (process.platform !== "win32") {
      expect(reasons.join(" ")).toContain("Cross-platform generated output filename alias");
      expect(reasons.join(" ")).toContain("Non-canonical generated output filename: bad?.gbr");
    }
  });

  it.skipIf(process.platform === "win32")("rejects symbolic links without following them", async () => {
    const { root, manifest } = await outputDirectory();
    const target = path.join(root, "target.gbr");
    await fs.writeFile(target, "target");
    await fs.symlink(target, path.join(root, "alias.gbr"));
    const reasons = await checkFirstPartyOutputSet(root, manifest, [{ path: "target.gbr" }]);
    expect(reasons).toContain("Symlink in generated output: alias.gbr");
  });

  it("fails closed on unreadable or absent output roots", async () => {
    const { root } = await outputDirectory();
    const missing = path.join(root, "absent");
    const reasons = await checkFirstPartyOutputSet(missing, path.join(missing, "manifest.json"), []);
    expect(reasons.join(" ")).toContain("Generated output enumeration failed closed");
  });

  it("does not promote an in-memory first-party manifest into exact on-disk proof", async () => {
    const { root } = await outputDirectory();
    const manifest = await createExportProvenanceManifest({
      root,
      artifacts: [{ path: "missing.gbr", sha256: "a".repeat(64), bytes: 1 }],
    });
    const result = await verifyExportProvenance(root, { ...manifest, kind: "boardreadyops.export-provenance" });
    expect(result.status).toBe("mismatch");
    expect(result.reasons).toContain("First-party output completeness requires an on-disk manifest.");

    const absentRoot = await verifyExportProvenance(path.join(root, "no-project"), "manifest.json");
    expect(absentRoot.status).toBe("missing");
    expect(absentRoot.reasons).toContain("Project root is missing or unreadable.");
  });

  it.skipIf(process.platform === "win32")("rejects non-file socket entries in generated output", async () => {
    const { root, manifest } = await outputDirectory();
    const socket = net.createServer();
    const socketPath = path.join(root, "output.sock");
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.listen(socketPath, resolve);
    });
    try {
      const reasons = await checkFirstPartyOutputSet(root, manifest, []);
      expect(reasons).toContain("Non-file entry in generated output: output.sock");
    } finally {
      await new Promise<void>((resolve) => socket.close(() => resolve()));
    }
  });

  it("fails closed at the maximum output entry and depth budgets", async () => {
    const { root, manifest } = await outputDirectory();
    const dir = path.join(root, "many");
    await fs.mkdir(dir);
    for (let i = 0; i < 4100; i++) {
      await fs.writeFile(path.join(dir, `part-${i}.gbr`), "");
    }
    const exceededEntries = await checkFirstPartyOutputSet(root, manifest, []);
    expect(exceededEntries.join(" ")).toContain("Output tree scan exceeds 4096 entries");

    const other = await outputDirectory();
    let current = other.root;
    for (let i = 0; i < 34; i++) {
      current = path.join(current, `d${i}`);
      await fs.mkdir(current);
    }
    const exceededDepth = await checkFirstPartyOutputSet(other.root, other.manifest, []);
    expect(exceededDepth.join(" ")).toContain("Output tree scan exceeds depth 32");
  });
});
