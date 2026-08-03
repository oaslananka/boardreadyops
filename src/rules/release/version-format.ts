import path from "node:path";
import { readDesignFile } from "../../kicad/parsers/project-files.js";
import { parsePcb } from "../../kicad/pcb.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

export const versionFormatRule = rule(
  {
    id: "release.version-format",
    title: "Board revision does not match release version format",
    description: "Checks schematic and PCB revisions against the configured release version pattern.",
    rationale: "Consistent version formats keep hardware revisions searchable and automatable.",
    defaultSeverity: "low",
    appliesTo: ["pcb", "schematic"],
    configKeys: ["rules.release.version-format.pattern"],
    kicadVersions: ["9", "10", "future"],
    tags: ["release", "revision", "versioning"],
  },
  async (context) => {
    if (!shouldRun(context, "release.version-format")) {
      return [];
    }
    const rawPattern = configFor(context, "release.version-format").pattern;
    const pattern = typeof rawPattern === "string" ? rawPattern : "^[vr]?\\d+\\.\\d+(?:\\.\\d+)?$";
    const regex = compilePattern(pattern);
    if (!regex) {
      return [
        finding(context, {
          ruleId: "release.version-format",
          severity: configuredSeverity(context, "release.version-format", "low"),
          message: `Release version format pattern ${pattern} is not a valid regular expression.`,
          path: "boardreadyops.yml",
          kind: "project",
          details: { pattern },
        }),
      ];
    }
    const output = [];
    for (const project of context.projects) {
      for (const board of project.boardFiles) {
        const revision = (await parsePcb(path.resolve(context.root, board))).revision;
        if (revision && !regex.test(revision)) {
          output.push(
            finding(context, {
              ruleId: "release.version-format",
              severity: configuredSeverity(context, "release.version-format", "low"),
              message: `PCB revision ${revision} does not match ${pattern}.`,
              path: board,
              kind: "pcb",
              details: { revision, pattern },
            }),
          );
        }
      }
      for (const schematic of project.schematicFiles) {
        const text = (await readDesignFile(path.resolve(context.root, schematic))) ?? "";
        const revision = /\(rev\s+"([^"]+)"/.exec(text)?.[1];
        if (revision && !regex.test(revision)) {
          output.push(
            finding(context, {
              ruleId: "release.version-format",
              severity: configuredSeverity(context, "release.version-format", "low"),
              message: `Schematic revision ${revision} does not match ${pattern}.`,
              path: schematic,
              kind: "schematic",
              details: { revision, pattern },
            }),
          );
        }
      }
    }
    return output;
  },
);

function compilePattern(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}
