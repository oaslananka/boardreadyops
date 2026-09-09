import path from "node:path";
import { loadConfig } from "../../core/config.js";
import { createFinding, type Finding, summarizeFindings } from "../../core/findings.js";
import { createLogger } from "../../core/logger.js";
import { canonicalRoot, runPipeline } from "../../core/pipeline.js";
import type { RunResult } from "../../core/result.js";
import { boardReadyVersion } from "../../generated/version.js";
import { normalizePathInput, normalizeRelative } from "../../util/path.js";
import { type CommonCliOptions, pipelineInputFromCli } from "./run.js";

type PlanFormat = "json";

export interface PlanCliOptions extends CommonCliOptions {
  format?: PlanFormat;
}

interface AgentPlan {
  schemaVersion: 1;
  tool: {
    name: "boardreadyops";
    version: string;
  };
  generatedAt: string;
  status: "passed" | "failed";
  exitCode: number;
  summary: RunResult["summary"];
  projectRoot: string;
  nextActions: AgentPlanAction[];
  releaseActions: AgentPlanAction[];
}

interface AgentPlanAction {
  id: string;
  ruleId: string;
  severity: Finding["severity"];
  title: string;
  resource: Finding["resource"];
  location?: Finding["location"];
  evidence: {
    message: string;
    details?: Record<string, unknown>;
    references?: string[];
    confidence?: Finding["confidence"];
  };
  whyItMatters: string;
  fixStrategy: {
    description: string;
    steps: string[];
  };
  safeAutoFixPossible: boolean;
  commandsToVerify: string[];
}

export async function planCommand(
  pathInput: string | undefined,
  options: PlanCliOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  const root = await canonicalRoot(path.resolve(normalizePathInput(pathInput ?? ".")));
  const loaded = await loadConfig(root, options.config);
  if (loaded.errors.length > 0) {
    const findings = loaded.errors.map((error) =>
      createFinding({
        ruleId: "config.invalid",
        severity: "high",
        message: `Configuration is invalid: ${error}`,
        resource: {
          path: loaded.path ? normalizeRelative(root, loaded.path) : "boardreadyops.yml",
          kind: "manifest",
        },
        location: { line: 1, column: 1 },
        confidence: "definite",
        fix: {
          description: "Fix the BoardReadyOps configuration before asking an agent to change board data.",
          steps: [
            "Open the reported configuration file.",
            "Fix the schema or validation error.",
            "Run boardreadyops plan --format json again.",
          ],
        },
      }),
    );
    const summary = summarizeFindings(findings, options.failOn ?? "high");
    const exitCode = summary.failed ? 1 : 0;
    streams.stdout.write(
      `${JSON.stringify(toAgentPlan(root, diagnosticResult(findings, exitCode), exitCode), null, 2)}\n`,
    );
    return exitCode;
  }

  const logger = createLogger({
    level: options.verbose ? "debug" : "silent",
    format: "json",
    stream: streams.stderr,
    projectRoot: root,
  });
  const result = await runPipeline(
    pipelineInputFromCli(
      root,
      {
        ...options,
        annotations: false,
        format: "json",
      },
      false,
    ),
    logger,
  );
  const exitCode = result.summary.failed ? 1 : 0;
  streams.stdout.write(`${JSON.stringify(toAgentPlan(root, result, exitCode), null, 2)}\n`);
  return exitCode;
}

function diagnosticResult(findings: Finding[], exitCode: number): RunResult {
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: boardReadyVersion },
    summary: summarizeFindings(findings, "low"),
    projects: [],
    findings,
    fabrication: { bom: [], outputs: [] },
    generatedAt: new Date().toISOString(),
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
  };
}

function toAgentPlan(root: string, result: RunResult, exitCode: number): AgentPlan {
  const nextActions = result.findings.map((finding) => findingToAction(root, finding));
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: boardReadyVersion },
    generatedAt: new Date().toISOString(),
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    summary: result.summary,
    projectRoot: root,
    nextActions,
    releaseActions: releaseActions(root, nextActions),
  };
}

function findingToAction(root: string, finding: Finding): AgentPlanAction {
  const fixSteps = finding.fix?.steps?.length
    ? finding.fix.steps
    : [
        "Open the referenced file or generated report.",
        "Apply the smallest change that satisfies the rule without weakening the release gate.",
        "Re-run the rule-specific verification command.",
      ];
  return {
    id: finding.fingerprint,
    ruleId: finding.ruleId,
    severity: finding.severity,
    title: finding.message,
    resource: finding.resource,
    ...(finding.location ? { location: finding.location } : {}),
    evidence: {
      message: finding.message,
      ...(finding.details ? { details: finding.details } : {}),
      ...(finding.references ? { references: finding.references } : {}),
      ...(finding.confidence ? { confidence: finding.confidence } : {}),
    },
    whyItMatters: finding.message,
    fixStrategy: {
      description: finding.fix?.description ?? "Resolve the finding while preserving manufacturing evidence integrity.",
      steps: fixSteps,
    },
    safeAutoFixPossible: finding.fix?.automated === true,
    commandsToVerify: [
      `boardreadyops check --rule ${shellToken(finding.ruleId)} --format json ${shellToken(root)}`,
      `boardreadyops release prepare --skip-generate ${shellToken(root)}`,
    ],
  };
}

function releaseActions(root: string, actions: AgentPlanAction[]): AgentPlanAction[] {
  if (actions.length > 0) {
    return [];
  }
  return [
    {
      id: "release.prepare-evidence",
      ruleId: "release.prepare-evidence",
      severity: "info",
      title: "Prepare a signed release evidence bundle.",
      resource: { path: ".", kind: "manifest" },
      evidence: {
        message: "No blocking findings were produced by the current plan run.",
        confidence: "high",
      },
      whyItMatters:
        "Fabrication decisions should be backed by reproducible DRC, ERC, BOM, output, and policy evidence.",
      fixStrategy: {
        description: "Generate, pack, sign, and verify the release evidence bundle before fabrication handoff.",
        steps: [
          "Run boardreadyops generate if manufacturing outputs are not already current.",
          "Run boardreadyops release prepare to assemble the evidence bundle.",
          "Run boardreadyops release sign when a release signing key is configured.",
          "Run boardreadyops release verify before handing off to fabrication.",
        ],
      },
      safeAutoFixPossible: false,
      commandsToVerify: [
        `boardreadyops generate ${shellToken(root)}`,
        `boardreadyops release prepare ${shellToken(root)}`,
        "boardreadyops release verify build/boardreadyops-release",
      ],
    },
  ];
}

function shellToken(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}
