import * as yaml from "js-yaml";
import type { MutationFile } from "./github-mutation-service.js";

export const repositorySetupPresetIds = ["open-source", "prototype", "production", "contract-design"] as const;
export type RepositorySetupPresetId = (typeof repositorySetupPresetIds)[number];

export const repositorySetupPresetVersion = 1;
export const repositorySetupWorkflowPath = "readiness-runner.yml";
export const repositorySetupWorkflowContractVersion = 1;
export const repositorySetupWorkflowName = "BoardReadyOps Readiness Runner";

export type RepositorySetupPreset = {
  id: RepositorySetupPresetId;
  name: string;
  description: string;
  releaseMode: "pilot" | "production" | "prototype";
  failOn: "high" | "medium";
  config: string;
};

const header = (releaseMode: RepositorySetupPreset["releaseMode"], failOn: RepositorySetupPreset["failOn"]) =>
  `version: 1\nmode: enforce\nreleaseMode: ${releaseMode}\nprojects:\n  - path: .\nfail-on: ${failOn}\n`;

const reports = `report:\n  sarif: boardreadyops.sarif.json\n  json: boardreadyops.findings.json\n  markdown: boardreadyops.report.md\n  html: boardreadyops.report.html\n`;

export const repositorySetupPresets: readonly RepositorySetupPreset[] = [
  {
    id: "open-source",
    name: "Open-source hardware",
    description: "Reproducible community releases with component traceability and release documentation.",
    releaseMode: "pilot",
    failOn: "high",
    config: `${header("pilot", "high")}rules:\n  bom.missing-mpn: true\n  bom.compliance: true\n  bom.lifecycle: true\n  bom.eol-detection: true\n  bom.unknown-lifecycle: true\n  bom.identity-conflicts: true\n  design.board-outline: true\n  design.unique-references: true\n  drc.kicad: true\n  manufacturing.fab-notes: true\n  manufacturing.layer-stackup: true\n  manufacturing.drill-coverage: true\n  release.revision-set: true\n  release.changelog-present: true\n  release.version-format: true\n  release.tag-matches-revision: true\n${reports}`,
  },
  {
    id: "prototype",
    name: "Prototype fabrication",
    description: "Low-friction first-build checks with critical supply-chain and design safeguards.",
    releaseMode: "prototype",
    failOn: "high",
    config: `${header("prototype", "high")}rules:\n  bom.missing-mpn: true\n  bom.compliance: true\n  bom.lifecycle: true\n  bom.risk-score: true\n  bom.eol-detection: true\n  bom.unknown-lifecycle: true\n  bom.single-source: false\n  design.board-outline: true\n  design.unique-references: true\n  drc.kicad: true\n  manufacturing.package-completeness: false\n  manufacturing.fab-notes: false\n  manufacturing.position-coverage: false\n  manufacturing.drill-coverage: false\n  release.revision-set: true\n  release.changelog-present: false\n  release.tag-matches-revision: false\n${reports}`,
  },
  {
    id: "production",
    name: "Production release",
    description: "Strict fabrication, supply-chain, manufacturing, and release evidence gates.",
    releaseMode: "production",
    failOn: "medium",
    config: `${header("production", "medium")}rules:\n  bom.missing-mpn: true\n  bom.compliance: true\n  bom.lifecycle: true\n  bom.risk-score: true\n  bom.eol-detection: true\n  bom.unknown-lifecycle: true\n  bom.single-source: true\n  bom.identity-conflicts: true\n  design.board-outline: true\n  design.unique-references: true\n  drc.kicad: true\n  erc.kicad: true\n  manufacturing.package-completeness: true\n  manufacturing.fab-notes: true\n  manufacturing.position-coverage: true\n  manufacturing.drill-coverage: true\n  manufacturing.tooling-holes: true\n  manufacturing.test-points: true\n  manufacturing.fiducials: true\n  manufacturing.assembly-sides: true\n  manufacturing.layer-stackup: true\n  manufacturing.pin1-markers: true\n  manufacturing.polarity-markers: true\n  manufacturing.silkscreen-over-pad: true\n  release.revision-set: true\n  release.changelog-present: true\n  release.tag-matches-revision: true\n  release.version-format: true\n${reports}`,
  },
  {
    id: "contract-design",
    name: "Contract design handoff",
    description: "Auditable client handoff with complete evidence, traceability, and signed-off release gates.",
    releaseMode: "production",
    failOn: "medium",
    config: `${header("production", "medium")}rules:\n  bom.missing-mpn: true\n  bom.compliance: true\n  bom.lifecycle: true\n  bom.eol-detection: true\n  bom.unknown-lifecycle: true\n  bom.single-source: true\n  bom.risk-score: true\n  bom.identity-conflicts: true\n  design.board-outline: true\n  design.unique-references: true\n  drc.kicad: true\n  erc.kicad: true\n  manufacturing.package-completeness: true\n  manufacturing.fab-notes: true\n  manufacturing.position-coverage: true\n  manufacturing.drill-coverage: true\n  manufacturing.tooling-holes: true\n  manufacturing.test-points: true\n  manufacturing.fiducials: true\n  manufacturing.layer-stackup: true\n  manufacturing.assembly-sides: true\n  manufacturing.pin1-markers: true\n  manufacturing.polarity-markers: true\n  manufacturing.silkscreen-over-pad: true\n  release.revision-set: true\n  release.changelog-present: true\n  release.tag-matches-revision: true\n  release.version-format: true\n${reports}`,
  },
];

const presetById = new Map(repositorySetupPresets.map((preset) => [preset.id, preset]));

export function repositorySetupPreset(id: string): RepositorySetupPreset | undefined {
  return presetById.get(id as RepositorySetupPresetId);
}

export function isRepositorySetupPresetId(value: unknown): value is RepositorySetupPresetId {
  return typeof value === "string" && presetById.has(value as RepositorySetupPresetId);
}

export const defaultReadinessWorkflowTemplate = `name: BoardReadyOps Readiness Runner

on:
  workflow_dispatch:
    inputs:
      run_id:
        required: true
        type: string
      execution_attempt_id:
        required: true
        type: string
      target:
        required: true
        type: string
      head_sha:
        required: true
        type: string
      result_url:
        required: true
        type: string
      safe_mode:
        required: false
        type: string
        default: "false"
      safe_mode_reasons:
        required: false
        type: string
        default: ""
      setup_probe_id:
        required: false
        type: string
        default: ""
      setup_result_url:
        required: false
        type: string
        default: ""

permissions:
  contents: read

concurrency:
  group: boardreadyops-cloud-\${{ inputs.run_id }}
  cancel-in-progress: false

jobs:
  readiness:
    if: \${{ inputs.setup_probe_id == '' }}
    permissions:
      actions: read
      checks: read
      contents: read
      id-token: write
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Validate dispatch binding
        id: validate
        env:
          RUN_ID: \${{ inputs.run_id }}
          EXECUTION_ATTEMPT_ID: \${{ inputs.execution_attempt_id }}
          TARGET: \${{ inputs.target }}
          HEAD_SHA: \${{ inputs.head_sha }}
          RESULT_URL: \${{ inputs.result_url }}
          SAFE_MODE: \${{ inputs.safe_mode }}
        run: |
          if ! [[ "$RUN_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
            echo "run_id must be a lowercase UUID" >&2
            exit 1
          fi
          if [ "$TARGET" != "$GITHUB_REPOSITORY" ]; then
            echo "target must match the repository that owns this workflow" >&2
            exit 1
          fi

      - name: Check out exact target commit
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0
        with:
          ref: \${{ inputs.head_sha }}
          persist-credentials: false

      - name: Run BoardReadyOps
        id: readiness
        continue-on-error: true
        env:
          GITHUB_TOKEN: \${{ github.token }}
          BOARDREADYOPS_PR_HEAD_SHA: \${{ inputs.head_sha }}
          BOARDREADYOPS_CLOUD_RUN_ID: \${{ inputs.run_id }}
        uses: oaslananka/boardreadyops@ce925376bd71daf7e07f31fb1bb19a8bde30b172 # v1.24.1
        with:
          project: \${{ vars.BOARDREADYOPS_PROJECT || '' }}
          config: \${{ vars.BOARDREADYOPS_CONFIG || 'boardreadyops.yml' }}
          safe-mode: \${{ inputs.safe_mode }}
          mode: enforce
          require-kicad: "false"
          fail-on: high
          sarif: boardreadyops.sarif.json
          json: boardreadyops.findings.json
          markdown: boardreadyops.report.md

      - name: Publish OIDC-authenticated cloud result
        if: always() && steps.validate.outcome == 'success'
        uses: actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd # v8.0.0
        env:
          RUN_ID: \${{ inputs.run_id }}
          EXECUTION_ATTEMPT_ID: \${{ inputs.execution_attempt_id }}
          RESULT_URL: \${{ inputs.result_url }}
          READINESS_OUTCOME: \${{ steps.readiness.outcome }}
        with:
          script: |
            const fs = require("node:fs");
            let resultPayload = { status: process.env.READINESS_OUTCOME === "success" ? "passed" : "failed", findings: [] };
            try {
              if (fs.existsSync("boardreadyops.findings.json")) {
                const parsed = JSON.parse(fs.readFileSync("boardreadyops.findings.json", "utf8"));
                resultPayload.findings = parsed.findings || [];
              }
            } catch {}
            const token = await core.getIDToken();
            await fetch(process.env.RESULT_URL, {
              method: "POST",
              headers: { "content-type": "application/json", authorization: \`Bearer \${token}\` },
              body: JSON.stringify(resultPayload),
            });
`;

export interface GenerateSetupFilesInput {
  presetId: RepositorySetupPresetId;
  workflowContent?: string;
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
  const workflowContent = input.workflowContent ?? defaultReadinessWorkflowTemplate;

  const branchName = "boardreadyops/setup";
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

  let parsed: Record<string, unknown> = {};
  if (input.currentConfigContent) {
    try {
      const loaded = yaml.load(input.currentConfigContent);
      if (typeof loaded === "object" && loaded !== null && !Array.isArray(loaded)) {
        parsed = loaded as Record<string, unknown>;
      }
    } catch {}
  }

  const waivers = Array.isArray(parsed.waivers) ? [...parsed.waivers] : [];
  waivers.push({
    rule: input.ruleId,
    owner: input.owner || "maintainer",
    reason: input.reason,
  });
  parsed.waivers = waivers;

  const newConfigContent = yaml.dump(parsed, { indent: 2, lineWidth: -1 });

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
    branchName,
    commitMessage,
    prTitle,
    prBody,
    files: [{ path: "boardreadyops.yml", content: newConfigContent }],
  };
}
