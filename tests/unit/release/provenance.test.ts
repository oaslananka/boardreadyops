import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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

  it("rejects an export inventory when there are no KiCad source inputs", async () => {
    const contents = "gerber-without-source";
    const root = await writeFixture({ "top.gtl": contents });
    const artifacts = [
      {
        path: "top.gtl",
        sha256: createHash("sha256").update(contents).digest("hex"),
        bytes: Buffer.byteLength(contents),
      },
    ];
    await expect(createExportProvenanceManifest({ root, artifacts })).rejects.toThrow(
      "No KiCad source inputs were found",
    );
    // Simulate a legacy/forged self-reported manifest to test the independent verifier.
    const manifest: ExportProvenanceManifest = {
      schemaVersion: 1,
      tool: { name: "boardreadyops", version: "test" },
      generatedAt: "2026-10-08T00:00:00.000Z",
      sourceFingerprint: await computeSourceFingerprint(root),
      artifacts,
    };

    const result = await verifyExportProvenance(root, manifest);
    expect(result.status).toBe("mismatch");
    expect(result.sourceFingerprintMatch).toBeUndefined();
    expect(result.reasons).toEqual([
      "No KiCad source inputs were found; source-to-export consistency cannot be established.",
    ]);
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinked KiCad input rather than hashing an incomplete source set",
    async () => {
      const root = await writeFixture({
        "board.kicad_pcb": "(kicad_pcb)",
        "top.gtl": "fabrication-bytes",
      });
      const artifacts = [
        {
          path: "top.gtl",
          sha256: createHash("sha256").update("fabrication-bytes").digest("hex"),
          bytes: Buffer.byteLength("fabrication-bytes"),
        },
      ];
      const manifest = await createExportProvenanceManifest({ root, artifacts });
      const external = await fs.mkdtemp(path.join(os.tmpdir(), "brops-symlinked-source-"));
      try {
        await fs.writeFile(path.join(external, "shadow.kicad_pcb"), "(kicad_pcb (unreviewed))");
        await fs.mkdir(path.join(root, "nested"), { recursive: true });
        await fs.symlink(path.join(external, "shadow.kicad_pcb"), path.join(root, "nested", "shadow.kicad_pcb"));
        await expect(computeSourceFingerprint(root)).rejects.toThrow("Symlinked source input rejected");
        await expect(createExportProvenanceManifest({ root, artifacts })).rejects.toThrow(
          "Symlinked source input rejected",
        );
        const verified = await verifyExportProvenance(root, manifest);
        expect(verified.status).toBe("mismatch");
        expect(verified.sourceFingerprintMatch).toBeUndefined();
        expect(verified.reasons).toContain(
          "Source fingerprint could not be computed because a KiCad source input is a symlink.",
        );
      } finally {
        await fs.rm(external, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "does not validate a partial source snapshot when additional KiCad files hide under a linked directory",
    async () => {
      const root = await writeFixture({
        "board.kicad_pcb": "(kicad_pcb)",
        "top.gtl": "fab-bytes",
      });
      const artifact = {
        path: "top.gtl",
        sha256: createHash("sha256").update("fab-bytes").digest("hex"),
        bytes: Buffer.byteLength("fab-bytes"),
      };
      const manifest = await createExportProvenanceManifest({ root, artifacts: [artifact] });
      const external = await fs.mkdtemp(path.join(os.tmpdir(), "brops-linked-design-directory-"));
      try {
        await fs.writeFile(path.join(external, "hidden.kicad_pcb"), "(kicad_pcb (unreviewed))");
        await fs.symlink(external, path.join(root, "other-designs"), "dir");
        await expect(computeSourceFingerprint(root)).rejects.toThrow("Symlinked source input rejected");
        await expect(createExportProvenanceManifest({ root, artifacts: [artifact] })).rejects.toThrow(
          "Symlinked source input rejected",
        );
        const result = await verifyExportProvenance(root, manifest);
        expect(result.status).toBe("mismatch");
        expect(result.sourceFingerprintMatch).toBeUndefined();
        expect(result.reasons).toContain(
          "Source fingerprint could not be computed because a KiCad source input is a symlink.",
        );
      } finally {
        await fs.rm(external, { recursive: true, force: true });
      }
    },
  );

  it("fails closed on unreadable KiCad inputs instead of hashing invented zero-byte content", async () => {
    const root = await writeFixture({
      "board.kicad_pcb": "(kicad_pcb)",
      "top.gtl": "fabrication-bytes",
    });
    const manifest = await createExportProvenanceManifest({
      root,
      artifacts: [
        {
          path: "top.gtl",
          sha256: createHash("sha256").update("fabrication-bytes").digest("hex"),
          bytes: Buffer.byteLength("fabrication-bytes"),
        },
      ],
    });

    const originalOpen = fs.open.bind(fs);
    const unreadable = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("board.kicad_pcb")) throw new Error("simulated EACCES");
      return originalOpen(...args);
    });
    try {
      await expect(computeSourceFingerprint(root)).rejects.toThrow("simulated EACCES");
      await expect(createExportProvenanceManifest({ root, artifacts: [] })).rejects.toThrow("simulated EACCES");
      const verified = await verifyExportProvenance(root, manifest);
      expect(verified.status).toBe("mismatch");
      expect(verified.sourceFingerprintMatch).toBeUndefined();
      expect(verified.reasons).toEqual([
        "Source fingerprint could not be computed because a source input is unreadable or missing.",
      ]);
    } finally {
      unreadable.mockRestore();
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects a KiCad source symlink swapped in after enumeration but before file open",
    async () => {
      const root = await writeFixture({
        "board.kicad_pcb": "(kicad_pcb (reviewed))",
      });
      const external = await fs.mkdtemp(path.join(os.tmpdir(), "brops-source-nofollow-"));
      await fs.writeFile(path.join(external, "shadow.kicad_pcb"), "(kicad_pcb (unreviewed))");
      const originalOpen = fs.open.bind(fs);
      let swapped = false;
      const race = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        if (!swapped && String(args[0]).endsWith("board.kicad_pcb")) {
          swapped = true;
          await fs.rm(String(args[0]));
          await fs.symlink(path.join(external, "shadow.kicad_pcb"), String(args[0]));
        }
        return originalOpen(...args);
      });
      try {
        await expect(computeSourceFingerprint(root)).rejects.toThrow();
        expect(swapped).toBe(true);
      } finally {
        race.mockRestore();
        await fs.rm(external, { recursive: true, force: true });
      }
    },
  );

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

  it("fails closed when explicit reviewed SHA comparison lacks a clean pinned export SHA", async () => {
    const root = await writeFixture({ "board.kicad_pcb": "(kicad_pcb)", "top.gtl": "gerber-contents" });
    const content = "gerber-contents";
    const sha = "1".repeat(40);
    const manifest = await createExportProvenanceManifest({
      root,
      artifacts: [
        {
          path: "top.gtl",
          sha256: createHash("sha256").update(content).digest("hex"),
          bytes: Buffer.byteLength(content),
        },
      ],
    });
    const absent = await verifyExportProvenance(root, manifest, { currentGitSha: sha });
    expect(absent.status).toBe("mismatch");
    expect(absent.gitShaMatch).toBe(false);
    expect(absent.reasons).toContain("Reviewed commit verification requested, but manifest has no valid Git SHA.");

    const dirty = await verifyExportProvenance(
      root,
      { ...manifest, git: { sha, dirty: true } },
      { currentGitSha: sha },
    );
    expect(dirty.status).toBe("mismatch");
    expect(dirty.gitShaMatch).toBe(false);
    expect(dirty.reasons).toContain(
      "Reviewed commit verification requested, but the export recorded a dirty source tree.",
    );
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
        { path: "../outside.gtl", sha256: "a".repeat(64), bytes: 10 },
        { path: "missing.gtl", sha256: "a".repeat(64), bytes: 10 },
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

  it("refuses to verify an empty or malformed artifact inventory", async () => {
    const root = await writeFixture({ "board.kicad_pcb": "(kicad_pcb)", "top.gtl": "gerber-contents" });
    const manifest = await createExportProvenanceManifest({ root, artifacts: [] });
    const empty = await verifyExportProvenance(root, manifest);
    expect(empty.status).toBe("mismatch");
    expect(empty.reasons).toContain("Provenance manifest is missing a non-empty artifact inventory.");

    const malformed = await verifyExportProvenance(root, {
      ...manifest,
      artifacts: [{ path: "top.gtl", sha256: "not-a-hash", bytes: -5 }],
    });
    expect(malformed.status).toBe("mismatch");
    expect(malformed.reasons).toContain("Provenance artifact entry has invalid path, SHA-256, or byte count.");

    const missingSource = await verifyExportProvenance(root, {
      ...manifest,
      sourceFingerprint: undefined,
    } as unknown as ExportProvenanceManifest);
    expect(missingSource.status).toBe("mismatch");
    expect(missingSource.reasons).toContain("Provenance manifest has no valid source SHA-256 fingerprint.");

    const invalid = await verifyExportProvenance(root, null as unknown as ExportProvenanceManifest);
    expect(invalid.status).toBe("unsupported");
  });

  it("rejects mismatched byte count and duplicate artifact records even with a matching hash", async () => {
    const content = "gerber-contents";
    const root = await writeFixture({ "board.kicad_pcb": "(kicad_pcb)", "top.gtl": content });
    const digest = createHash("sha256").update(content).digest("hex");
    const manifest = await createExportProvenanceManifest({
      root,
      artifacts: [{ path: "top.gtl", sha256: digest, bytes: Buffer.byteLength(content) + 1 }],
    });
    const badSize = await verifyExportProvenance(root, manifest);
    expect(badSize.status).toBe("mismatch");
    expect(badSize.artifactMismatches).toContain("top.gtl");
    expect(badSize.reasons.some((reason) => reason.includes("byte-count mismatch"))).toBe(true);

    const duplicated = await verifyExportProvenance(root, {
      ...manifest,
      artifacts: [
        { path: "top.gtl", sha256: digest, bytes: Buffer.byteLength(content) },
        { path: "./top.gtl", sha256: digest, bytes: Buffer.byteLength(content) },
      ],
    });
    expect(duplicated.status).toBe("mismatch");
    expect(duplicated.reasons.some((reason) => reason.includes("duplicated"))).toBe(true);
    const windowsAlias = await verifyExportProvenance(root, {
      ...manifest,
      artifacts: [
        { path: "top.gtl", sha256: digest, bytes: Buffer.byteLength(content) },
        { path: ".\\\\top.gtl", sha256: digest, bytes: Buffer.byteLength(content) },
      ],
    });
    expect(windowsAlias.status).toBe("mismatch");
    expect(windowsAlias.reasons.some((reason) => reason.includes("duplicated"))).toBe(true);
  });

  it("rejects artifact symlink escapes rather than trusting their declared digests", async () => {
    const root = await writeFixture({ "board.kicad_pcb": "(kicad_pcb)" });
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "brops-untrusted-gerber-"));
    try {
      const bytes = "secret external gerber";
      const externalFile = path.join(outside, "external.gtl");
      await fs.writeFile(externalFile, bytes);
      await fs.symlink(externalFile, path.join(root, "outside.gtl"));
      const manifest = await createExportProvenanceManifest({
        root,
        artifacts: [
          {
            path: "outside.gtl",
            sha256: createHash("sha256").update(bytes).digest("hex"),
            bytes: Buffer.byteLength(bytes),
          },
        ],
      });
      const result = await verifyExportProvenance(root, manifest);
      expect(result.status).toBe("mismatch");
      expect(result.artifactMismatches).toContain("outside.gtl");
      expect(result.reasons.some((reason) => reason.includes("symlink escapes"))).toBe(true);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a provenance manifest symlink that resolves outside the project", async () => {
    const root = await writeFixture({ "board.kicad_pcb": "(kicad_pcb)" });
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "brops-untrusted-manifest-"));
    try {
      const manifest = await createExportProvenanceManifest({
        root,
        artifacts: [
          {
            path: "top.gtl",
            sha256: "a".repeat(64),
            bytes: 16,
          },
        ],
      });
      const externalManifest = path.join(outside, "manifest.json");
      await fs.writeFile(externalManifest, JSON.stringify(manifest));
      await fs.symlink(externalManifest, path.join(root, "manifest.json"));
      const result = await verifyExportProvenance(root, "manifest.json");
      expect(result.status).toBe("mismatch");
      expect(result.reasons).toContain("Provenance manifest symlink escapes the project root.");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "accepts an in-root manifest through a canonicalized source-root alias",
    async () => {
      const root = await writeFixture({
        "board.kicad_pcb": "(kicad_pcb)",
        "top.gtl": "D10*X0Y0D03*M02*",
      });
      const content = "D10*X0Y0D03*M02*";
      const manifest = await createExportProvenanceManifest({
        root,
        artifacts: [
          {
            path: "top.gtl",
            sha256: createHash("sha256").update(content).digest("hex"),
            bytes: Buffer.byteLength(content),
          },
        ],
      });
      await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
      const aliasDir = await fs.mkdtemp(path.join(os.tmpdir(), "brops-verified-root-alias-"));
      try {
        const alias = path.join(aliasDir, "root-alias");
        await fs.symlink(root, alias, "dir");
        const verified = await verifyExportProvenance(alias, "manifest.json");
        expect(verified.status).toBe("verified");
        expect(verified.reasons).toEqual([]);
      } finally {
        await fs.rm(aliasDir, { recursive: true, force: true });
      }
    },
  );

  it("verifies a multi-megabyte artifact by streamed digest and exact length", async () => {
    const root = await writeFixture({ "board.kicad_pcb": "(kicad_pcb)" });
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 17, 0x41);
    await fs.writeFile(path.join(root, "large.gtl"), bytes);
    const manifest = await createExportProvenanceManifest({
      root,
      artifacts: [
        {
          path: "large.gtl",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
        },
      ],
    });
    const verified = await verifyExportProvenance(root, manifest);
    expect(verified.status).toBe("verified");
    const undersized = await verifyExportProvenance(root, {
      ...manifest,
      artifacts: [
        { path: "large.gtl", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length - 1 },
      ],
    });
    expect(undersized.status).toBe("mismatch");
    expect(undersized.artifactMismatches).toContain("large.gtl");
  });

  it("does not accept an incompatible export discriminator or a changed source snapshot", async () => {
    const root = await writeFixture({
      "board.kicad_pcb": "(kicad_pcb)",
      "top.gtl": "D10*X0Y0D03*M02*",
    });
    const content = "D10*X0Y0D03*M02*";
    const inventory = await createExportProvenanceManifest({
      root,
      artifacts: [
        {
          path: "top.gtl",
          sha256: createHash("sha256").update(content).digest("hex"),
          bytes: Buffer.byteLength(content),
        },
      ],
    });
    const otherSchema = await verifyExportProvenance(root, {
      ...inventory,
      kind: "not-a-boardreadyops-export",
    } as unknown as ExportProvenanceManifest);
    expect(otherSchema.status).toBe("unsupported");
    const sourceChanged = await verifyExportProvenance(root, {
      ...inventory,
      kind: "boardreadyops.export-provenance",
      sourceSnapshot: "changed",
    });
    expect(sourceChanged.status).toBe("mismatch");
    expect(sourceChanged.reasons.join(" ")).toMatch(/changed/);
  });

  it("rejects unsupported schema versions", async () => {
    const root = await writeFixture({});
    const manifest = { schemaVersion: 99, tool: { name: "boardreadyops" } } as unknown as ExportProvenanceManifest;
    const result = await verifyExportProvenance(root, manifest);
    expect(result.status).toBe("unsupported");
  });
});
