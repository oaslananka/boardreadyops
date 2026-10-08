import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const design = new URL("../../../docs/release/source-export-provenance-contract.md", import.meta.url);
const attestation = new URL("../../../docs/release/artifact-attestation.md", import.meta.url);
const navigation = new URL("../../../mkdocs.yml", import.meta.url);

describe("manufacturing source-to-export provenance design boundary", () => {
  it("does not present current self-reported hashes or timestamps as reviewed-commit proof", async () => {
    const contract = await readFile(design, "utf8");
    expect(contract).toContain("NOT implemented or GA-accepted");
    expect(contract).toContain("sourceFingerprint");
    expect(contract).toContain("currentGitSha");
    expect(contract).toContain("source-bound verified");
    expect(contract).toContain("Byte-consistent only");
    expect(contract).toContain("TF.CreationDate");
    expect(contract).toContain("target repository GitHub Actions job");
    expect(contract).toContain("two-unrelated-installation");
  });

  it("marks the attestation policy as aspirational and exposes the contract in navigation", async () => {
    const published = await readFile(attestation, "utf8");
    const nav = await readFile(navigation, "utf8");
    expect(published).toContain("not copy-paste-ready release instructions");
    expect(published).toContain("not currently enforced");
    expect(published).toContain("source-export-provenance-contract.md");
    expect(published).toContain("does **not**");
    expect(nav).toContain("Source-to-Export Proof (Design): release/source-export-provenance-contract.md");
  });
});
