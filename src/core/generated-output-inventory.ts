import path from "node:path";
import { canonicalGeneratedPath, scanGeneratedOutputTree } from "./generated-output-scan.js";

// A local, untrusted exact-file-set comparison, not an authenticated generation attestation.
type DeclaredInventory = {
  files: Set<string>;
  aliases: Set<string>;
  directories: Set<string>;
  reasons: string[];
};

function indexDeclaredArtifact(inventory: DeclaredInventory, name: string, manifestName: string): void {
  if (!canonicalGeneratedPath(name) || name === manifestName) {
    inventory.reasons.push(`Non-canonical generated artifact path or manifest self-reference: ${name}`);
    return;
  }
  const alias = name.normalize("NFC").toLowerCase();
  if (inventory.aliases.has(alias)) {
    inventory.reasons.push(`Cross-platform generated artifact alias: ${name}`);
    return;
  }
  inventory.files.add(name);
  inventory.aliases.add(alias);
  const parts = name.split("/");
  for (let i = 1; i < parts.length; i++) inventory.directories.add(parts.slice(0, i).join("/"));
}

function indexDeclaredOutput(manifestPath: string, artifacts: readonly { path: string }[]): DeclaredInventory {
  const inventory: DeclaredInventory = {
    files: new Set(),
    aliases: new Set(),
    directories: new Set(),
    reasons: [],
  };
  for (const artifact of artifacts) indexDeclaredArtifact(inventory, artifact.path, path.basename(manifestPath));
  return inventory;
}

function compareExactFileSets(declared: DeclaredInventory, actual: ReadonlySet<string>): void {
  for (const file of [...actual].sort((a, b) => a.localeCompare(b))) {
    if (!declared.files.has(file)) declared.reasons.push(`Undeclared generated artifact: ${file}`);
  }
  for (const file of [...declared.files].sort((a, b) => a.localeCompare(b))) {
    if (!actual.has(file)) declared.reasons.push(`Declared generated artifact missing from file set: ${file}`);
  }
}

export async function checkFirstPartyOutputSet(
  directory: string,
  manifestPath: string,
  artifacts: readonly { path: string }[],
): Promise<string[]> {
  const declared = indexDeclaredOutput(manifestPath, artifacts);
  try {
    const scanned = await scanGeneratedOutputTree(directory, manifestPath, declared.directories);
    declared.reasons.push(...scanned.reasons);
    compareExactFileSets(declared, scanned.files);
  } catch (error) {
    declared.reasons.push(
      `Generated output enumeration failed closed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return declared.reasons;
}
