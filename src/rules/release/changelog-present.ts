import path from "node:path";
import { parsePcb } from "../../kicad/pcb.js";
import { pathExists, readTextFile } from "../../util/fs.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

export const changelogPresentRule = rule(
  {
    id: "release.changelog-present",
    title: "Changelog entry is missing",
    description: "Checks CHANGELOG.md for an entry matching the board revision.",
    rationale: "Released hardware needs revision notes that reviewers and manufacturers can trace.",
    defaultSeverity: "medium",
    appliesTo: ["manifest"],
    configKeys: ["rules.release.changelog-present.enabled"],
    kicadVersions: ["9", "10", "future"],
    tags: ["changelog", "release", "traceability"],
    category: "release",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  async (context) => {
    if (!shouldRun(context, "release.changelog-present")) {
      return [];
    }
    const revisions = new Set<string>();
    for (const project of context.projects) {
      for (const board of project.boardFiles) {
        const revision = (await parsePcb(path.resolve(context.root, board))).revision;
        if (revision) {
          revisions.add(revision);
        }
      }
    }
    const changelog = path.resolve(context.root, "CHANGELOG.md");
    if (!(await pathExists(changelog))) {
      return [
        finding(context, {
          ruleId: "release.changelog-present",
          severity: configuredSeverity(context, "release.changelog-present", "medium"),
          message: "CHANGELOG.md is missing.",
          path: ".",
          kind: "manifest",
        }),
      ];
    }
    const text = await readTextFile(changelog);
    const missing = [...revisions].filter((revision) => !changelogHasRevision(text, revision));
    if (revisions.size === 0 || missing.length > 0) {
      return [
        finding(context, {
          ruleId: "release.changelog-present",
          severity: configuredSeverity(context, "release.changelog-present", "medium"),
          message:
            revisions.size === 0
              ? "CHANGELOG.md cannot be matched because no board revision is set."
              : `CHANGELOG.md does not contain release entry ${missing.join(", ")}.`,
          path: changelog,
          kind: "manifest",
          details: { missingRevisions: revisions.size === 0 ? [] : missing },
        }),
      ];
    }
    return [];
  },
);

function changelogHasRevision(text: string, revision: string): boolean {
  const escaped = revision.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^##\\s+\\[?v?${escaped}\\]?\\b`, "m").test(text);
}
