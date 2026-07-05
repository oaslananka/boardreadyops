import type { Finding, FixSuggestion } from "../core/findings.js";
import type { RunResult } from "../core/result.js";
import { listRules } from "../core/rule-registry.js";
import { reportCoordinate, reportCoordinateWithUnits, reportFindingContext } from "./finding-context.js";

export function formatSarif(result: RunResult): string {
  const rules = new Map<string, Finding>();
  for (const finding of result.findings) {
    if (!rules.has(finding.ruleId)) {
      rules.set(finding.ruleId, finding);
    }
  }
  const ruleTagsByRuleId = buildRuleTagsIndex();
  const sarif = {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "BoardReadyOps",
            informationUri: "https://github.com/oaslananka/boardreadyops",
            version: result.tool.version,
            rules: [...rules.values()].map((finding) => ({
              id: finding.ruleId,
              name: finding.ruleId,
              shortDescription: { text: finding.ruleId },
              fullDescription: { text: finding.message },
              ...(finding.fix ? { help: sarifHelp(finding.fix) } : {}),
              helpUri: finding.references?.[0] ?? "https://github.com/oaslananka/boardreadyops/tree/main/docs/rules",
              defaultConfiguration: {
                level: sarifLevel(finding.severity),
              },
              ...(ruleTagsByRuleId.has(finding.ruleId)
                ? { properties: { tags: ruleTagsByRuleId.get(finding.ruleId) } }
                : {}),
            })),
          },
        },
        results: result.findings.map((finding) => {
          const context = reportFindingContext(finding);
          return {
            ruleId: finding.ruleId,
            level: sarifLevel(finding.severity),
            message: { text: finding.message },
            locations: [sarifLocation(finding)],
            partialFingerprints: {
              primaryLocationLineHash: finding.fingerprint,
            },
            properties: {
              stableId: context.stableId,
              fingerprint: context.fingerprint,
              reportLocation: context.location,
              help: context.help,
              severity: finding.severity,
              project: finding.project,
              resourceKind: finding.resource.kind,
              ...(finding.details ? { details: finding.details } : {}),
              ...(finding.fix ? { fix: finding.fix } : {}),
              ...(finding.confidence ? { confidence: finding.confidence } : {}),
            },
          };
        }),
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

function sarifLocation(finding: Finding) {
  const boardCoordinates = finding.location?.boardCoordinates;
  const logicalLocation = boardCoordinates
    ? {
        logicalLocations: [
          {
            name: `${boardCoordinates.layer ?? "board"} @ (${reportCoordinate(boardCoordinates.x)}${
              boardCoordinates.units
            }, ${reportCoordinate(boardCoordinates.y)}${boardCoordinates.units})`,
            kind: "member",
            fullyQualifiedName: `pcb:${boardCoordinates.layer ?? "board"}:${reportCoordinateWithUnits(
              boardCoordinates.x,
              boardCoordinates.units,
            )},${reportCoordinateWithUnits(boardCoordinates.y, boardCoordinates.units)}`,
          },
        ],
      }
    : {};

  return {
    physicalLocation: {
      artifactLocation: {
        uri: finding.resource.path,
      },
      region: finding.location?.region ?? {
        startLine: sarifPositiveInteger(finding.location?.line),
        startColumn: sarifPositiveInteger(finding.location?.column),
      },
    },
    ...logicalLocation,
  };
}

function buildRuleTagsIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const rule of listRules()) {
    if (rule.meta.tags.length > 0) {
      index.set(rule.meta.id, rule.meta.tags);
    }
  }
  return index;
}

function sarifLevel(severity: Finding["severity"]): "error" | "warning" | "note" | "none" {
  if (severity === "critical" || severity === "high") {
    return "error";
  }
  if (severity === "medium" || severity === "low") {
    return "warning";
  }
  return "note";
}

function sarifHelp(fix: FixSuggestion) {
  const steps = fix.steps?.map((step, index) => `${index + 1}. ${step}`) ?? [];
  const body = [fix.description, ...steps].join("\n");
  return {
    text: body,
    markdown: body,
  };
}

function sarifPositiveInteger(value: number | undefined): number {
  if (value === undefined || value < 1) {
    return 1;
  }
  return value;
}
