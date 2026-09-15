import path from "node:path";
import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { summariseIdentities } from "../../firmware/component-identity.js";
import { parseIdfManifest } from "../../firmware/idf-manifest.js";
import { readTextFile } from "../../util/fs.js";
import { globFiles } from "../../util/glob.js";
import { finding, rule, shouldRun } from "../helpers.js";

/**
 * States how much of the firmware bill of materials can be looked up at all.
 *
 * This is a coverage statement, not a defect, which is why it is informational and can never fail
 * a run. What it prevents is the reader of a device SBOM assuming that everything listed was
 * checked and everything checked was clean.
 *
 * The distinction is not theoretical. Measured against the live OSV API, `pkg:generic/...`,
 * `pkg:github/...` and `pkg:git/...` are all accepted and all return empty -- no error, no signal
 * that nothing was searched. So "no advisories found" and "not vulnerability-indexed" look
 * identical unless something says otherwise. This is the something.
 *
 * Same distinction #768 drew for findings -- measured versus inferred -- applied to a bill of
 * materials. Part of #785.
 */
export const dependencyIdentificationRule = rule(
  {
    id: "firmware.dependency-identification",
    title: "Firmware dependencies that cannot be vulnerability-checked",
    description: "Reports how many ESP-IDF dependencies have an identifier a vulnerability database indexes.",
    rationale:
      "A component listed in an SBOM with no advisories found, when it was never identifiable enough to look up, is a false clean bill.",
    defaultSeverity: "info",
    appliesTo: ["project"],
    configKeys: ["rules.firmware.dependency-identification.enabled"],
    kicadVersions: ["9", "10", "future"],
    tags: ["firmware", "sbom", "supply-chain"],
    ...RULE_CLASSIFICATIONS.sourcingAbsenceSignal,
  },
  async (context) => {
    if (!shouldRun(context, "firmware.dependency-identification")) {
      return [];
    }

    const manifests = await globFiles(context.root, ["**/idf_component.yml"]);
    if (manifests.length === 0) {
      // No ESP-IDF component in the tree. Saying nothing is right: this rule reports on what is
      // there rather than asking for firmware the project does not have.
      return [];
    }

    const output = [];
    for (const file of manifests) {
      const relative = path.relative(context.root, file);
      const text = await readTextFile(file).catch(() => undefined);
      if (text === undefined) continue;

      const manifest = parseIdfManifest(text, relative);
      if (manifest.dependencies.length === 0) continue;

      const summary = summariseIdentities(manifest.dependencies);
      output.push(
        finding(context, {
          ruleId: "firmware.dependency-identification",
          severity: "info",
          message:
            summary.unidentified === 0
              ? `All ${summary.total} firmware dependenc(ies) have an identifier a vulnerability database indexes.`
              : `${summary.unidentified} of ${summary.total} firmware dependenc(ies) are not vulnerability-indexed, so no advisory search covers them: ${summary.unidentifiedNames.join(", ")}.`,
          path: relative,
          kind: "manifest",
          details: {
            total: summary.total,
            searchable: summary.searchable,
            unidentified: summary.unidentified,
            unidentifiedNames: summary.unidentifiedNames,
          },
        }),
      );
    }
    return output;
  },
);
