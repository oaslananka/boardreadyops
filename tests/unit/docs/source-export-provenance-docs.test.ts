import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const design = new URL("../../../docs/release/source-export-provenance-contract.md", import.meta.url);
const attestation = new URL("../../../docs/release/artifact-attestation.md", import.meta.url);
const navigation = new URL("../../../mkdocs.yml", import.meta.url);

function semanticText(markdown: string): string {
  return markdown.replace(/[*_`]/g, "").replace(/\s+/g, " ").toLowerCase();
}

describe("manufacturing source-to-export provenance design boundary", () => {
  it("does not present current self-reported hashes or timestamps as reviewed-commit proof", async () => {
    const contract = await readFile(design, "utf8");
    expect(semanticText(contract)).toMatch(/ga acceptance are not implemented/);
    expect(contract).toContain("sourceFingerprint");
    expect(contract).toContain("currentGitSha");
    expect(semanticText(contract)).toMatch(/source.bound verified/);
    expect(semanticText(contract)).toMatch(/byte.consistent only/);
    expect(contract).toContain("TF.CreationDate");
    expect(semanticText(contract)).toMatch(/target repository github actions job/);
    expect(contract).toContain("two-unrelated-installation");
  });

  it("marks the attestation policy as aspirational and exposes the contract in navigation", async () => {
    const published = await readFile(attestation, "utf8");
    const nav = await readFile(navigation, "utf8");
    expect(semanticText(published)).toMatch(/not copy.paste.ready release instructions/);
    expect(semanticText(published)).toMatch(/not currently enforced/);
    expect(published).toContain("source-export-provenance-contract.md");
    expect(semanticText(published)).toMatch(/does not/);
    expect(nav).toMatch(/Source-to-Export Proof[^\n]*release\/source-export-provenance-contract\.md/i);
  });
});
