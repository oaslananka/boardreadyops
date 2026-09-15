import path from "node:path";
import type { FirmwareDependencyRecord, FirmwareSnapshot } from "../core/firmware.js";
import { resolveComponentIdentity } from "../firmware/component-identity.js";
import { parseIdfManifest } from "../firmware/idf-manifest.js";
import { readTextFile } from "../util/fs.js";
import { globFiles } from "../util/glob.js";
import { toPosixPath } from "../util/path.js";
import { compareCodePoints } from "../util/strings.js";

/**
 * Collects the firmware dependencies declared in the tree, so the run result can carry them.
 *
 * Until #786 nothing read a dependency manifest at all: every adapter in src/firmware loads a
 * BoardReadyOps pin contract, and `createHbom` built components only from
 * `result.fabrication.bom` -- there were no firmware components in the device SBOM. This is what
 * puts them there. Step 3 of #785.
 *
 * Sits alongside `captureFabricationSnapshot` for the same two reasons: the pipeline calls it once
 * after rules run rather than rules reaching for shared state, and src/rules is the only layer
 * permitted to import the src/firmware leaf.
 */
export async function captureFirmwareSnapshot(root: string): Promise<FirmwareSnapshot> {
  const manifests = (await globFiles(root, ["**/idf_component.yml"])).sort(compareCodePoints);
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
        ...(identity.cpe === undefined ? {} : { cpe: identity.cpe }),
        searchable: identity.searchable,
        ...(identity.source === undefined ? {} : { identitySource: identity.source }),
      });
    }
  }

  return { dependencies, warnings };
}
