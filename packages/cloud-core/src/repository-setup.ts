import { isMap, isSeq, parseDocument } from "yaml";
import type { MutationFile } from "./github-mutation-service.js";
import { defaultReadinessWorkflowTemplate } from "./readiness-workflow-template.js";

export { defaultReadinessWorkflowTemplate } from "./readiness-workflow-template.js";

export const repositorySetupPresetIds = ["open-source", "prototype", "production", "contract-design"] as const;
export type RepositorySetupPresetId = (typeof repositorySetupPresetIds)[number];

export const selectableRepositorySetupPresetIds = ["open-source", "prototype", "production"] as const;
export type SelectableRepositorySetupPresetId = (typeof selectableRepositorySetupPresetIds)[number];

export const repositorySetupPresetVersion = 1;
export const repositorySetupWorkflowPath = "readiness-runner.yml";
export const repositorySetupWorkflowContractVersion = 1;
export const repositorySetupWorkflowName = "BoardReadyOps Readiness Runner";
export const repositorySetupBranchName = "boardreadyops/setup";

export type RepositorySetupPreset = {
  id: RepositorySetupPresetId;
  name: string;
  description: string;
  releaseMode: "pilot" | "production" | "prototype";
  failOn: "high" | "medium";
  changes: readonly string[];
  config: string;
};

const header = (releaseMode: RepositorySetupPreset["releaseMode"], failOn: RepositorySetupPreset["failOn"]) =>
  `version: 1\nmode: enforce\nreleaseMode: ${releaseMode}\nprojects:\n  - path: .\nfail-on: ${failOn}\n`;

const reports = `report:\n  sarif: boardreadyops.sarif.json\n  json: boardreadyops.findings.json\n  markdown: boardreadyops.report.md\n  html: boardreadyops.report.html\n`;

const repositorySetupPresetCatalog: readonly RepositorySetupPreset[] = [
  {
    id: "open-source",
    name: "Open-source hardware",
    description: "Reproducible community releases with component traceability and release documentation.",
    releaseMode: "pilot",
    failOn: "high",
    changes: [
      "Pilot release mode with a high-severity failure threshold.",
      "Keeps component traceability and release-document checks on without production assembly gates.",
    ],
    config: `${header("pilot", "high")}rules:\n  bom.missing-mpn: true\n  bom.compliance: true\n  bom.lifecycle: true\n  bom.eol-detection: true\n  bom.unknown-lifecycle: true\n  bom.identity-conflicts: true\n  design.board-outline: true\n  design.unique-references: true\n  drc.kicad: true\n  manufacturing.fab-notes: true\n  manufacturing.layer-stackup: true\n  manufacturing.drill-coverage: true\n  release.revision-set: true\n  release.changelog-present: true\n  release.version-format: true\n  release.tag-matches-revision: true\n${reports}`,
  },
  {
    id: "prototype",
    name: "Prototype fabrication",
    description: "Low-friction first-build checks with critical supply-chain and design safeguards.",
    releaseMode: "prototype",
    failOn: "high",
    changes: [
      "Prototype release mode with a high-severity failure threshold.",
      "Relaxes package completeness, fab notes, placement/drill coverage, changelog, and tag-matching checks.",
    ],
    config: `${header("prototype", "high")}rules:\n  bom.missing-mpn: true\n  bom.compliance: true\n  bom.lifecycle: true\n  bom.risk-score: true\n  bom.eol-detection: true\n  bom.unknown-lifecycle: true\n  bom.single-source: false\n  design.board-outline: true\n  design.unique-references: true\n  drc.kicad: true\n  manufacturing.package-completeness: false\n  manufacturing.fab-notes: false\n  manufacturing.position-coverage: false\n  manufacturing.drill-coverage: false\n  release.revision-set: true\n  release.changelog-present: false\n  release.tag-matches-revision: false\n${reports}`,
  },
  {
    id: "production",
    name: "Production release",
    description: "Strict fabrication, supply-chain, manufacturing, and release evidence gates.",
    releaseMode: "production",
    failOn: "medium",
    changes: [
      "Production release mode with the stricter medium-severity failure threshold.",
      "Enables ERC, single-source BOM risk, full manufacturing package checks, and release evidence gates.",
    ],
    config: `${header("production", "medium")}rules:\n  bom.missing-mpn: true\n  bom.compliance: true\n  bom.lifecycle: true\n  bom.risk-score: true\n  bom.eol-detection: true\n  bom.unknown-lifecycle: true\n  bom.single-source: true\n  bom.identity-conflicts: true\n  design.board-outline: true\n  design.unique-references: true\n  drc.kicad: true\n  erc.kicad: true\n  manufacturing.package-completeness: true\n  manufacturing.fab-notes: true\n  manufacturing.position-coverage: true\n  manufacturing.drill-coverage: true\n  manufacturing.tooling-holes: true\n  manufacturing.test-points: true\n  manufacturing.fiducials: true\n  manufacturing.assembly-sides: true\n  manufacturing.layer-stackup: true\n  manufacturing.pin1-markers: true\n  manufacturing.polarity-markers: true\n  manufacturing.silkscreen-over-pad: true\n  release.revision-set: true\n  release.changelog-present: true\n  release.tag-matches-revision: true\n  release.version-format: true\n${reports}`,
  },
  {
    id: "contract-design",
    name: "Contract design handoff",
    description: "Auditable client handoff with complete evidence, traceability, and signed-off release gates.",
    releaseMode: "production",
    failOn: "medium",
    changes: [
      "Legacy historical preset retained so existing setup revisions remain readable.",
      "Generated policy is semantically identical to Production release, so it is no longer selectable.",
    ],
    config: `${header("production", "medium")}rules:\n  bom.missing-mpn: true\n  bom.compliance: true\n  bom.lifecycle: true\n  bom.eol-detection: true\n  bom.unknown-lifecycle: true\n  bom.single-source: true\n  bom.risk-score: true\n  bom.identity-conflicts: true\n  design.board-outline: true\n  design.unique-references: true\n  drc.kicad: true\n  erc.kicad: true\n  manufacturing.package-completeness: true\n  manufacturing.fab-notes: true\n  manufacturing.position-coverage: true\n  manufacturing.drill-coverage: true\n  manufacturing.tooling-holes: true\n  manufacturing.test-points: true\n  manufacturing.fiducials: true\n  manufacturing.layer-stackup: true\n  manufacturing.assembly-sides: true\n  manufacturing.pin1-markers: true\n  manufacturing.polarity-markers: true\n  manufacturing.silkscreen-over-pad: true\n  release.revision-set: true\n  release.changelog-present: true\n  release.tag-matches-revision: true\n  release.version-format: true\n${reports}`,
  },
];

export const repositorySetupPresets: readonly RepositorySetupPreset[] = repositorySetupPresetCatalog.filter(
  (preset) => preset.id !== "contract-design",
);

const presetById = new Map(repositorySetupPresetCatalog.map((preset) => [preset.id, preset]));
const selectablePresetIds = new Set<string>(selectableRepositorySetupPresetIds);

export function repositorySetupPreset(id: string): RepositorySetupPreset | undefined {
  return presetById.get(id as RepositorySetupPresetId);
}

export function isRepositorySetupPresetId(value: unknown): value is RepositorySetupPresetId {
  return typeof value === "string" && presetById.has(value as RepositorySetupPresetId);
}

export function isSelectableRepositorySetupPresetId(value: unknown): value is SelectableRepositorySetupPresetId {
  return typeof value === "string" && selectablePresetIds.has(value);
}

const defaultRepositorySetupCloudOrigin = "https://boardreadyops.com";

function normalizedRepositorySetupCloudOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("repository setup cloud origin must be an HTTPS origin");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("repository setup cloud origin must be an HTTPS origin");
  }
  return parsed.origin;
}

export interface GenerateSetupFilesInput {
  presetId: RepositorySetupPresetId;
  workflowContent?: string;
  cloudOrigin?: string;
}

export interface SetupPrPlan {
  preset: RepositorySetupPreset;
  branchName: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  files: MutationFile[];
}

export function generateSetupPrPlan(input: GenerateSetupFilesInput): SetupPrPlan {
  const defaultPreset = repositorySetupPresets[0];
  if (!defaultPreset) {
    throw new Error("No default repository setup preset available");
  }
  const preset = repositorySetupPreset(input.presetId) ?? defaultPreset;
  const cloudOriginExpression = "$" + "{{ vars.BOARDREADYOPS_CLOUD_ORIGIN }}";
  const workflowContent =
    input.workflowContent ??
    defaultReadinessWorkflowTemplate.replaceAll(
      cloudOriginExpression,
      normalizedRepositorySetupCloudOrigin(input.cloudOrigin ?? defaultRepositorySetupCloudOrigin),
    );

  const branchName = repositorySetupBranchName;
  const commitMessage = `chore(boardreadyops): initialize release readiness (${preset.name})`;
  const prTitle = `chore(boardreadyops): initialize BoardReadyOps release readiness (${preset.name})`;

  const prBody = [
    `# Initialize BoardReadyOps Release Readiness`,
    ``,
    `This pull request initializes **BoardReadyOps** using the **${preset.name}** preset.`,
    ``,
    `### Preset details`,
    `- **Preset:** ${preset.name}`,
    `- **Release Mode:** \`${preset.releaseMode}\``,
    `- **Description:** ${preset.description}`,
    `- **Gate threshold:** fail on \`${preset.failOn}\` severity findings`,
    ``,
    `### Included files`,
    `1. \`boardreadyops.yml\`: Defines project scope, rule policies, report exports, and gate thresholds.`,
    `2. \`.github/workflows/readiness-runner.yml\`: Target-repository runner workflow that executes automated checks when hardware PRs are opened.`,
    ``,
    `### Workflow security & permissions`,
    `- \`id-token: write\`: Generates short-lived GitHub Actions OIDC tokens to authenticate results with BoardReadyOps cloud without storing API keys or secrets in repository settings.`,
    `- \`contents: read\`: Clones PR commits at the exact target commit SHA.`,
    `- \`persist-credentials: false\`: Prevents token exposure to child processes or external dependencies.`,
    ``,
    `### Rollback & Removal`,
    `To remove or disable BoardReadyOps, close this pull request or delete \`boardreadyops.yml\` and \`.github/workflows/readiness-runner.yml\` from the default branch.`,
    ``,
    `---`,
    `*Generated automatically by BoardReadyOps zero-touch repository setup.*`,
  ].join("\n");

  return {
    preset,
    branchName,
    commitMessage,
    prTitle,
    prBody,
    files: [
      { path: "boardreadyops.yml", content: preset.config },
      { path: `.github/workflows/${repositorySetupWorkflowPath}`, content: workflowContent },
    ],
  };
}

export interface GenerateWaiverPrPlanInput {
  ruleId: string;
  reason: string;
  owner?: string;
  currentConfigContent?: string;
}

export interface WaiverPrPlan {
  hasChanges: boolean;
  branchName: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  files: MutationFile[];
}

export function generateWaiverPrPlan(input: GenerateWaiverPrPlanInput): WaiverPrPlan {
  const branchName = `boardreadyops/waiver-${input.ruleId.replace(/[^a-zA-Z0-9._-]/gu, "-")}`;
  const commitMessage = `chore(boardreadyops): add waiver for ${input.ruleId}`;
  const prTitle = `chore(boardreadyops): add waiver for ${input.ruleId}`;

  if (!input.currentConfigContent?.trim()) {
    throw new Error("current boardreadyops.yml content is required for a waiver PR");
  }

  const document = parseDocument(input.currentConfigContent);
  if (document.errors.length > 0) {
    throw new Error("current boardreadyops.yml must contain valid YAML");
  }
  if (!isMap(document.contents)) {
    throw new Error("current boardreadyops.yml must contain a YAML mapping");
  }

  const existingWaivers = document.get("waivers", true);
  if (existingWaivers !== undefined && !isSeq(existingWaivers)) {
    throw new Error("current boardreadyops.yml waivers must be an array");
  }

  const owner = input.owner || "maintainer";
  const duplicate =
    isSeq(existingWaivers) &&
    existingWaivers.items.some(
      (waiver) =>
        isMap(waiver) &&
        waiver.get("rule") === input.ruleId &&
        waiver.get("owner") === owner &&
        waiver.get("reason") === input.reason,
    );
  if (!duplicate) {
    const waiver = { rule: input.ruleId, owner, reason: input.reason };
    if (isSeq(existingWaivers)) existingWaivers.add(waiver);
    else document.set("waivers", [waiver]);
  }

  const newConfigContent = document.toString({ lineWidth: 0 });

  const prBody = [
    `# BoardReadyOps Policy Waiver Request`,
    ``,
    `This pull request proposes adding a policy waiver for rule \`${input.ruleId}\`.`,
    ``,
    `### Waiver details`,
    `- **Rule:** \`${input.ruleId}\``,
    `- **Reason:** ${input.reason}`,
    `- **Owner:** ${input.owner || "maintainer"}`,
    ``,
    `Reviewers can merge this pull request to durable-store this waiver in the repository configuration.`,
    ``,
    `---`,
    `*Generated automatically by BoardReadyOps.*`,
  ].join("\n");

  return {
    hasChanges: !duplicate,
    branchName,
    commitMessage,
    prTitle,
    prBody,
    files: [{ path: "boardreadyops.yml", content: newConfigContent }],
  };
}
