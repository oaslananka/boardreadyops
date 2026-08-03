import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { t } from "../../i18n/t.js";
import { pathExists, writeTextFile } from "../../util/fs.js";

type Profile = "basic" | "ci" | "manufacturing" | "strict";

export interface InitCommandOptions {
  output?: string;
  profile?: Profile;
  workflow?: "github";
  force?: boolean;
  interactive?: boolean;
}

const yamlHeader = `version: 1
mode: `;

function yamlFooter(failOn: string, reports: string): string {
  return `fail-on: ${failOn}
report:
${reports}`;
}

function profileYaml(mode: string, rules: string, failOn: string, reports: string): string {
  return `${yamlHeader}${mode}
projects:
  - path: .
rules:
${rules}${yamlFooter(failOn, reports)}`;
}

const profiles: Record<Profile, string> = {
  basic: profileYaml(
    "warn",
    `  drc.kicad:
    enabled: true
  erc.kicad:
    enabled: true
  bom.missing-mpn:
    enabled: true
    severity: high
    ignore-refs: ["TP*", "FID*"]
`,
    "never",
    `  json: build/boardreadyops.findings.json
  markdown: build/boardreadyops.report.md`,
  ),

  ci: profileYaml(
    "enforce",
    `  drc.kicad:       { enabled: true }
  erc.kicad:       { enabled: true }
  pinmap.verify:   { enabled: true }
  bom.missing-mpn:
    enabled: true
    severity: high
  manufacturing.outputs-present:
    enabled: true
    required:
      - gerber
      - drill
`,
    "high",
    `  sarif: boardreadyops.sarif.json
  json: boardreadyops.findings.json
  markdown: boardreadyops.report.md
  html: boardreadyops.report.html`,
  ),

  manufacturing: profileYaml(
    "enforce",
    `  manufacturing.outputs-present:
    enabled: true
    required:
      - gerber
      - drill
      - paste
      - silkscreen
      - soldermask
      - assembly
  manufacturing.jobset-outputs:
    enabled: true
  manufacturing.layer-stackup:
    enabled: true
  manufacturing.fab-notes:
    enabled: true
  manufacturing.drill-coverage:
    enabled: true
  manufacturing.panel-sanity:
    enabled: true
`,
    "high",
    `  json: build/boardreadyops.findings.json
  markdown: build/boardreadyops.report.md`,
  ),

  strict: profileYaml(
    "enforce",
    `  drc.kicad:
    enabled: true
  erc.kicad:
    enabled: true
  bom.missing-mpn:
    enabled: true
    severity: high
  bom.footprint-mismatch:
    enabled: true
  bom.single-source:
    enabled: true
  bom.eol-detection:
    enabled: true
  bom.lifecycle:
    enabled: true
  pinmap.verify:
    enabled: true
  pinmap.collision:
    enabled: true
  pinmap.net-label:
    enabled: true
  manufacturing.outputs-present:
    enabled: true
    required:
      - gerber
      - drill
  manufacturing.layer-stackup:
    enabled: true
  design.board-outline:
    enabled: true
  design.copper-balance:
    enabled: true
  release.changelog-present:
    enabled: true
  release.revision-set:
    enabled: true
  release.version-format:
    enabled: true
  release.tag-matches-revision:
    enabled: true
`,
    "medium",
    `  sarif: boardreadyops.sarif.json
  json: build/boardreadyops.findings.json
  markdown: boardreadyops.report.md
  html: build/boardreadyops.report.html
  junit: build/boardreadyops.junit.xml`,
  ),
};

const githubWorkflowYml = `name: boardreadyops
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
  pull-requests: write
  security-events: write
jobs:
  boardreadyops:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
      - uses: oaslananka/boardreadyops@v1
        with:
          config: boardreadyops.yml
          mode: enforce
          fail-on: high
          sarif: boardreadyops.sarif.json
          json: boardreadyops.findings.json
          markdown: boardreadyops.report.md
          upload-sarif: "true"
          upload-artifacts: "true"
          comment-pr: "true"
`;

export async function initCommand(
  cwd: string,
  options: InitCommandOptions,
  streams: { stdout: NodeJS.WritableStream },
): Promise<number> {
  const outputDir = options.output ? path.resolve(cwd, options.output) : cwd;

  let profile: Profile = options.profile ?? "basic";
  let workflow = options.workflow;
  let mode: string | undefined;
  let failOn: string | undefined;

  if (options.interactive) {
    const wizardResult = await runInteractiveWizard(streams);
    mode = wizardResult.mode;
    failOn = wizardResult.failOn;
    profile = wizardResult.profile;
    workflow = wizardResult.workflow;
  }

  const baseConfig = profiles[profile];
  if (!baseConfig) {
    streams.stdout.write(`${t("cli.init.invalidProfile", { profile })}\n`);
    return 2;
  }

  let configContent = baseConfig;
  if (mode && failOn) {
    configContent = baseConfig
      .replace(/^mode:\s+\S+/m, `mode: ${mode}`)
      .replace(/^fail-on:\s+\S+/m, `fail-on: ${failOn}`);
  }

  const configFile = path.resolve(outputDir, "boardreadyops.yml");
  const configExists = await pathExists(configFile);

  if (configExists && !options.force) {
    streams.stdout.write(`${t("cli.init.exists")}\n`);
    return 0;
  }

  if (!configExists || options.force) {
    await writeTextFile(configFile, configContent);
    streams.stdout.write(`✨ ${t("cli.init.created")}: ${configFile}\n`);
  }

  if (workflow === "github") {
    const workflowDir = path.resolve(outputDir, ".github/workflows");
    await mkdir(workflowDir, { recursive: true });
    const workflowFile = path.resolve(workflowDir, "boardreadyops.yml");
    if (!(await pathExists(workflowFile)) || options.force) {
      await writeFile(workflowFile, githubWorkflowYml, "utf-8");
      streams.stdout.write(`✨ ${t("cli.init.workflowCreated")}: ${workflowFile}\n`);
    } else {
      streams.stdout.write(`✨ ${t("cli.init.workflowExists")}: ${workflowFile}\n`);
    }
  }

  return 0;
}

async function runInteractiveWizard(streams: { stdout: NodeJS.WritableStream }): Promise<{
  mode: string;
  failOn: string;
  profile: Profile;
  workflow: "github" | undefined;
}> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: streams.stdout as NodeJS.WritableStream & { fd: 1 },
  });

  const askQuestion = (query: string, defaultValue: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(`${query} [\x1b[36m${defaultValue}\x1b[0m]: `, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
  };

  try {
    streams.stdout.write("\n✨ \x1b[35mWelcome to the BoardReadyOps Config Wizard!\x1b[0m ✨\n\n");

    const modeAns = await askQuestion("Select mode (warn / enforce)", "warn");
    const mode = modeAns === "enforce" ? "enforce" : "warn";

    const failOn = await askQuestion("Fail-on level (never / critical / high / medium / low)", "high");

    const profileAns = await askQuestion("Choose base rule profile (basic / ci / manufacturing / strict)", "basic");
    const profile = (["basic", "ci", "manufacturing", "strict"].includes(profileAns) ? profileAns : "basic") as Profile;

    let workflow: "github" | undefined;
    const workflowAns = await askQuestion("Generate GitHub Actions workflow? (y / n)", "y");
    if (workflowAns.toLowerCase().startsWith("y")) {
      workflow = "github";
    }
    streams.stdout.write("\n");
    return { mode, failOn, profile, workflow };
  } finally {
    rl.close();
  }
}
