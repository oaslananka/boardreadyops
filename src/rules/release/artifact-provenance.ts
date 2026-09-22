import path from "node:path";
import { verifyExportProvenance } from "../../core/provenance.js";
import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { readTextFile } from "../../util/fs.js";
import { globFiles } from "../../util/glob.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

const gerberPatterns = [
  "**/*.gbr",
  "**/*.gtl",
  "**/*.gbl",
  "**/*.gts",
  "**/*.gbs",
  "**/*.gtp",
  "**/*.gbp",
  "**/*.drl",
  "**/*.drt",
];

const MANIFEST_CANDIDATES = [
  "build/boardreadyops-generate/manifest.json",
  "fab/provenance.json",
  "fab/manifest.json",
  "build/provenance.json",
  "gerbers/provenance.json",
  "manifest.json",
  "provenance.json",
];

export const artifactProvenanceRule = rule(
  {
    id: "release.artifact-provenance",
    title: "Exported manufacturing artifacts lack valid source provenance",
    description:
      "Checks that exported Gerber and drill artifacts match the current source revision and have an authentic export provenance manifest.",
    rationale:
      "Manufacturing outputs exported from an older commit or modified after export risk fabricating obsolete hardware.",
    defaultSeverity: "high",
    appliesTo: ["pcb"],
    configKeys: ["rules.release.artifact-provenance.enabled", "rules.release.artifact-provenance.manifest-path"],
    kicadVersions: ["9", "10", "future"],
    tags: ["fabrication", "manufacturing", "provenance", "release"],
    ...RULE_CLASSIFICATIONS.releasePresence,
  },
  async (context) => {
    if (!shouldRun(context, "release.artifact-provenance")) {
      return [];
    }

    const artifactFiles = await globFiles(context.root, gerberPatterns);
    if (artifactFiles.length === 0) {
      return [];
    }

    const config = configFor(context, "release.artifact-provenance");
    const configuredPath = typeof config["manifest-path"] === "string" ? config["manifest-path"] : undefined;

    let manifestRelPath: string | undefined;
    if (configuredPath) {
      manifestRelPath = configuredPath;
    } else {
      for (const candidate of MANIFEST_CANDIDATES) {
        const text = await readTextFile(path.resolve(context.root, candidate)).catch(() => undefined);
        if (text) {
          manifestRelPath = candidate;
          break;
        }
      }
    }

    if (!manifestRelPath) {
      return [
        finding(context, {
          ruleId: "release.artifact-provenance",
          severity: configuredSeverity(context, "release.artifact-provenance", "high"),
          message: "Exported manufacturing artifacts exist in the repository but lack an export provenance manifest.",
          path: artifactFiles[0] ? path.relative(context.root, artifactFiles[0]) : ".",
          kind: "pcb",
          details: {
            status: "missing",
            artifactCount: artifactFiles.length,
          },
          fix: {
            description:
              "Generate manufacturing outputs using boardreadyops generate or kicad-cli with provenance tracking.",
            steps: [
              "Run `boardreadyops generate` to export manufacturing files with an export provenance manifest.",
              "Commit or include `build/boardreadyops-generate/manifest.json` alongside the exported files.",
            ],
          },
        }),
      ];
    }

    const result = await verifyExportProvenance(context.root, manifestRelPath);

    if (result.status === "verified") {
      return [];
    }

    let message = "Exported manufacturing artifacts failed provenance verification.";
    if (result.sourceFingerprintMatch === false) {
      message = "Exported manufacturing artifacts are stale: source files have changed since exports were generated.";
    } else if (result.artifactMismatches && result.artifactMismatches.length > 0) {
      message = `Exported manufacturing artifacts were modified after export: ${result.artifactMismatches.join(", ")}.`;
    } else if (result.reasons.length > 0) {
      message = `Exported manufacturing artifacts failed provenance verification: ${result.reasons[0]}`;
    }

    return [
      finding(context, {
        ruleId: "release.artifact-provenance",
        severity: configuredSeverity(context, "release.artifact-provenance", "high"),
        message,
        path: manifestRelPath,
        kind: "pcb",
        details: {
          status: result.status,
          reasons: result.reasons,
          sourceFingerprintMatch: result.sourceFingerprintMatch,
          gitShaMatch: result.gitShaMatch,
          artifactMismatches: result.artifactMismatches,
          missingArtifacts: result.missingArtifacts,
        },
      }),
    ];
  },
);
