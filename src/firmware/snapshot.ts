import path from "node:path";
import { readTextFile } from "../util/fs.js";
import { globFiles } from "../util/glob.js";
import { toPosixPath } from "../util/path.js";
import { resolveComponentIdentity } from "./component-identity.js";
import { parseIdfManifest } from "./idf-manifest.js";

/**
 * Collects the firmware dependencies declared in the tree, so the run result can carry them.
 *
 * Until #786 nothing here read a dependency manifest at all: every adapter in this directory loads
 * a BoardReadyOps pin contract, and `createHbom` built components only from `result.fabrication.bom`
 * -- there were no firmware components in the device SBOM. This is what puts them there. Step 3
 * of #785.
 *
 * Mirrors `captureFabricationSnapshot`: the pipeline calls it once after rules run and attaches the
 * result, rather than rules reaching for shared state.
 */

/**
 * Where a dependency comes from, flattened to a string for the report contract.
 *
 * Not exported: only `FirmwareDependencyRecord` names it, and publishing a type for a caller that
 * does not exist is the pattern #752 was written to stop.
 */
type FirmwareDependencyOrigin = "registry" | "git" | "local" | "framework";

export interface FirmwareDependencyRecord {
  /** The manifest key, verbatim, so a report can quote what the file said. */
  name: string;
  /** Manifest path relative to the run root, in POSIX form. */
  manifestPath: string;
  origin: FirmwareDependencyOrigin;
  /** The version expression as written; a range is not collapsed to a version. */
  versionSpec?: string | undefined;
  pinned: boolean;
  /** A PURL a vulnerability database indexes, when one is known. Usually absent. */
  purl?: string | undefined;
  /**
   * Whether a "no advisories found" answer about this dependency would mean anything.
   *
   * False is the common and honest case: no identifier is known, so nothing can be searched.
   */
  searchable: boolean;
  /** Where the identifier came from -- an advisory id, a tool, a document. */
  identitySource?: string | undefined;
}

export interface FirmwareSnapshot {
  dependencies: FirmwareDependencyRecord[];
  /** Manifest-level problems worth surfacing, such as a file that is not valid YAML. */
  warnings: string[];
}

export async function captureFirmwareSnapshot(root: string): Promise<FirmwareSnapshot> {
  const manifests = (await globFiles(root, ["**/idf_component.yml"])).sort();
  const dependencies: FirmwareDependencyRecord[] = [];
  const warnings: string[] = [];

  for (const file of manifests) {
    const manifestPath = toPosixPath(path.relative(root, file));
    const text = await readTextFile(file).catch(() => undefined);
    if (text === undefined) continue;

    const manifest = parseIdfManifest(text, manifestPath);
    warnings.push(...manifest.warnings);

    for (const dependency of manifest.dependencies) {
      const identity = resolveComponentIdentity(dependency);
      dependencies.push({
        name: dependency.declaredName,
        manifestPath,
        origin: dependency.source.kind,
        ...(dependency.versionSpec === undefined ? {} : { versionSpec: dependency.versionSpec }),
        pinned: dependency.pinned,
        ...(identity.purl === undefined ? {} : { purl: identity.purl }),
        searchable: identity.searchable,
        ...(identity.source === undefined ? {} : { identitySource: identity.source }),
      });
    }
  }

  return { dependencies, warnings };
}
