import { type Command, InvalidArgumentError } from "commander";
import {
  type BaselineCliOptions,
  captureBaselineCommand,
  clearBaselineCommand,
  diffBaselineCommand,
  pruneBaselineCommand,
  showBaselineCommand,
} from "./commands/baseline.js";
import { checkCommand } from "./commands/check.js";
import { type DoctorCommandOptions, doctorCommand } from "./commands/doctor.js";
import { explainCommand } from "./commands/explain.js";
import { type FixCliOptions, fixCommand } from "./commands/fix.js";
import { type GenerateCliOptions, generateCommand } from "./commands/generate.js";
import { type InitCommandOptions, initCommand } from "./commands/init.js";
import { type PlanCliOptions, planCommand } from "./commands/plan.js";
import { type PolicyCommandOptions, policyCommand } from "./commands/policy.js";
import {
  type ReleaseDiffOptions,
  type ReleaseHandoffOptions,
  type ReleasePackOptions,
  type ReleasePrepareOptions,
  type ReleaseSignOptions,
  type ReleaseVerifyOptions,
  releaseDiffCommand,
  releaseHandoffCommand,
  releasePackCommand,
  releasePrepareCommand,
  releaseSignCommand,
  releaseVerifyCommand,
} from "./commands/release.js";
import { addCommonOptions, type CommonCliOptions, runCommand } from "./commands/run.js";
import {
  type RunnerActivateCliOptions,
  type RunnerIssueEnrollmentCliOptions,
  type RunnerOutputFormat,
  type RunnerWorkCliOptions,
  runnerActivateCommand,
  runnerIssueEnrollmentCommand,
  runnerOnceCommand,
  runnerServeCommand,
} from "./commands/runner.js";
import { type SbomCliOptions, sbomCommand } from "./commands/sbom.js";
import { schemaCommand } from "./commands/schema.js";
import { vendorExplainCommand, vendorListCommand } from "./commands/vendor.js";

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function addBaselineOptions(command: Command): Command {
  return command.option("--config <path>", "boardreadyops.yml location");
}

export function registerAllCommands(
  program: Command,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): void {
  addCommonOptions(program.command("run").argument("[path]", "directory to scan")).action(
    async (pathInput: string | undefined, options: CommonCliOptions) => {
      process.exitCode = await runCommand(pathInput, options, streams);
    },
  );

  addCommonOptions(program.command("check").argument("[rule-or-path]").argument("[path]", "directory to scan")).action(
    async (ruleOrPath: string | undefined, pathInput: string | undefined, options: CommonCliOptions) => {
      process.exitCode = await checkCommand(ruleOrPath, pathInput, options, streams);
    },
  );

  addCommonOptions(program.command("plan").argument("[path]", "directory to scan"))
    .description("emit an agent-ready JSON remediation plan")
    .action(async (pathInput: string | undefined, options: PlanCliOptions) => {
      process.exitCode = await planCommand(pathInput, options, streams);
    });

  program
    .command("fix")
    .argument("[path]", "directory to fix")
    .option("--config <path>", "boardreadyops.yml location")
    .option("--rule <id>", "restrict to rule", collectOption, [])
    .option("--dry-run", "print planned diffs without writing files")
    .option("--interactive", "prompt before applying planned diffs")
    .option("--commit", "commit applied fixes with git")
    .option("--allow-dirty", "allow fixes when the git workspace is dirty")
    .option("--drc-report <path>", "KiCad DRC JSON report with suggested fixes")
    .action(async (pathInput: string | undefined, options: FixCliOptions) => {
      process.exitCode = await fixCommand(pathInput, options, streams);
    });

  program
    .command("doctor")
    .option("--format <format>", "text or json", "text")
    .option("--check <name>", "run one doctor check")
    .action(async (options: DoctorCommandOptions) => {
      process.exitCode = await doctorCommand(options, streams);
    });

  program
    .command("explain")
    .argument("<rule-id>", "rule identifier")
    .argument("[path]", "directory to inspect")
    .action(async (ruleId: string, pathInput: string | undefined) => {
      process.exitCode = await explainCommand(ruleId, pathInput, streams);
    });

  program
    .command("schema")
    .argument("[name]", "agent-plan, config, doctor, findings, generate, hbom, or pinmap", "config")
    .action((name: string | undefined) => {
      process.exitCode = schemaCommand(name, streams);
    });

  function registerHandoffCommand(cmd: ReturnType<Command["command"]>): void {
    cmd
      .option("--profile <id>", "vendor profile id (e.g. jlcpcb, pcbway, oshpark)", "jlcpcb")
      .option("--service <service>", "override vendor service: fabrication, assembly, or fabrication+assembly")
      .option("--output <path>", "handoff package output directory", "build/boardreadyops-handoff")
      .option("--format <format>", "text or json", "text")
      .option("--no-zip", "skip creating a zip archive of the handoff package")
      .action(async (pathInput: string | undefined, options: ReleaseHandoffOptions) => {
        process.exitCode = await releaseHandoffCommand(pathInput, options, streams);
      });
  }

  const release = program.command("release").description("create and verify hardware release evidence bundles");
  addCommonOptions(release.command("pack").argument("[path]", "directory to scan"))
    .option("--output <path>", "release evidence bundle output directory", "build/boardreadyops-release")
    .option("--include-generated <path>", "directory of generated outputs to include in the bundle")
    .option("--provenance-source <uri>", "source URI for provenance metadata")
    .option("--provenance-attestation <uri>", "attestation URI for provenance metadata")
    .action(async (pathInput: string | undefined, options: ReleasePackOptions) => {
      process.exitCode = await releasePackCommand(pathInput, options, streams);
    });
  addCommonOptions(release.command("prepare").argument("[path]", "directory to scan"))
    .option("--output <path>", "release output directory", "build/boardreadyops-release")
    .option("--skip-generate", "skip the artifact generation stage")
    .action(async (pathInput: string | undefined, options: ReleasePrepareOptions) => {
      process.exitCode = await releasePrepareCommand(pathInput, options, streams);
    });
  registerHandoffCommand(release.command("handoff").argument("[path]", "directory to scan"));
  addCommonOptions(
    release
      .command("diff")
      .argument("<previous>", "previous release report JSON or evidence bundle directory")
      .argument("[path]", "directory to scan"),
  )
    .option("--output <path>", "write the release diff JSON to a file")
    .option("--html <path>", "write an HTML release diff dashboard to a file")
    .action(async (previous: string, pathInput: string | undefined, options: ReleaseDiffOptions) => {
      process.exitCode = await releaseDiffCommand(previous, pathInput, options, streams);
    });
  release
    .command("sign")
    .argument("[bundle]", "release evidence bundle directory")
    .option("--key <path>", "Ed25519 private key PEM used to sign the manifest")
    .action(async (bundleInput: string | undefined, options: ReleaseSignOptions) => {
      process.exitCode = await releaseSignCommand(bundleInput, options, streams);
    });
  release
    .command("verify")
    .argument("[bundle]", "release evidence bundle directory")
    .option("--format <format>", "text or json", "text")
    .option("--public-key <path>", "Ed25519 public key PEM to require and verify a signed manifest")
    .action(async (bundleInput: string | undefined, options: ReleaseVerifyOptions) => {
      process.exitCode = await releaseVerifyCommand(bundleInput, options, streams);
    });

  const handoff = program.command("handoff").description("create vendor-specific manufacturer handoff packages");
  registerHandoffCommand(
    handoff
      .command("create")
      .argument("[path]", "directory to scan for manufacturing outputs")
      .description("create a vendor-specific manufacturer handoff package and zip archive"),
  );

  addCommonOptions(program.command("policy").argument("[path]", "directory to scan"))
    .description("evaluate the configured release policy")
    .option("--simulate", "evaluate and report the policy without affecting the exit code")
    .action(async (pathInput: string | undefined, options: PolicyCommandOptions) => {
      process.exitCode = await policyCommand(pathInput, options, streams);
    });

  const vendor = program.command("vendor").description("inspect manufacturing vendor profiles");
  vendor
    .command("list")
    .option("--format <format>", "text or json", "text")
    .action((options: { format?: "text" | "json" }) => {
      process.exitCode = vendorListCommand(options, streams);
    });
  vendor
    .command("explain")
    .argument("<profile>", "vendor profile id")
    .option("--format <format>", "text or json", "text")
    .action((profile: string, options: { format?: "text" | "json" }) => {
      process.exitCode = vendorExplainCommand(profile, options, streams);
    });

  program
    .command("sbom")
    .argument("[path]", "directory to scan")
    .option("--config <path>", "boardreadyops.yml location")
    .option("--project <path>", "specific .kicad_pro")
    .option("--bom <path>", "BOM source path or auto")
    .option("--variant <name>", "KiCad variant name")
    .option("--output <path>", "CycloneDX HBOM output path, or - for stdout", "build/hbom.json")
    .option("--format <format>", "SBOM format: cyclonedx. spdx is reserved for a future release.", "cyclonedx")
    .action(async (pathInput: string | undefined, options: SbomCliOptions) => {
      process.exitCode = await sbomCommand(pathInput, options, streams);
    });

  program
    .command("generate")
    .description("generate first-party KiCad manufacturing outputs (Gerbers, drill, BOM, positions, PDFs)")
    .argument("[path]", "directory to scan")
    .option("--config <path>", "boardreadyops.yml location")
    .option("--project <path>", "specific .kicad_pro")
    .option("--variant <name>", "KiCad variant name")
    .option("--recipe <path>", "generation recipe JSON path")
    .option("--output <path>", "output directory for generated artifacts", "build/boardreadyops-generate")
    .option("--kicad-cli <path>", "explicit kicad-cli executable path")
    .option("--format <format>", "text or json", "text")
    .action(async (pathInput: string | undefined, options: GenerateCliOptions) => {
      process.exitCode = await generateCommand(pathInput, options, streams);
    });

  program
    .command("init")
    .option("-i, --interactive", "prompt for configuration details")
    .option("--profile <profile>", "configuration profile: basic, ci, manufacturing, strict", "basic")
    .option("--workflow <type>", "generate GitHub Actions workflow (github)")
    .option("--output <path>", "output directory for generated files")
    .option("--force", "overwrite existing files")
    .action(async (options: InitCommandOptions) => {
      process.exitCode = await initCommand(process.cwd(), options, streams);
    });

  const runner = program.command("runner").description("operate a customer-controlled self-hosted worker");
  runner
    .command("issue-enrollment")
    .description("issue a one-time runner enrollment token from a control-plane database")
    .requiredOption("--database-url-file <path>", "root-readable file containing the PostgreSQL URL")
    .requiredOption("--installation-id <uuid>", "tenant installation UUID")
    .requiredOption("--name <name>", "unique runner registration name")
    .requiredOption("--token-output <path>", "new root-only file for the one-time enrollment token")
    .option("--scope <scope>", "installation, organization, or repository", runnerEnrollmentScope, "installation")
    .option("--repository <owner/name>", "allowed repository for repository scope", collectOption, [])
    .option("--ttl-seconds <seconds>", "token lifetime up to one hour", runnerTtlSeconds)
    .option("--format <format>", "text or json", runnerOutputFormat, "text")
    .action(async (options: RunnerIssueEnrollmentCliOptions) => {
      process.exitCode = await runnerIssueEnrollmentCommand(options, streams);
    });
  runner
    .command("activate")
    .description("activate a runner identity using a one-time enrollment token file")
    .requiredOption("--url <url>", "BoardReadyOps control-plane origin")
    .requiredOption("--enrollment-token-file <path>", "root-readable file containing the one-time token")
    .option("--identity-dir <path>", "directory for the runner identity and Ed25519 keypair")
    .option("--capability <value>", "runner capability selector", collectOption, [])
    .option("--label <value>", "runner claim label", collectOption, [])
    .option("--format <format>", "text or json", runnerOutputFormat, "text")
    .action(async (options: RunnerActivateCliOptions) => {
      process.exitCode = await runnerActivateCommand(options, streams);
    });
  const addRunnerWorkOptions = (command: Command): Command =>
    command
      .option("--identity <path>", "runner identity JSON file")
      .option("--workspace-root <path>", "private root for ephemeral source workspaces")
      .option("--repository-mirror-root <path>", "customer-controlled bare repository mirror root")
      .option("--heartbeat-seconds <seconds>", "lease heartbeat interval", runnerSeconds, 30)
      .option("--poll-seconds <seconds>", "empty-queue and failure retry interval", runnerSeconds, 15)
      .option("--no-require-kicad", "allow execution without kicad-cli")
      .option("--keep-workspace", "retain the checked-out workspace after completion")
      .option("--format <format>", "text or json", runnerOutputFormat, "text");
  addRunnerWorkOptions(runner.command("once").description("claim and process at most one runner job")).action(
    async (options: RunnerWorkCliOptions) => {
      process.exitCode = await runnerOnceCommand(options, streams);
    },
  );
  addRunnerWorkOptions(runner.command("serve").description("poll continuously and process runner jobs")).action(
    async (options: RunnerWorkCliOptions) => {
      process.exitCode = await runnerServeCommand(options, streams);
    },
  );

  const baseline = program.command("baseline").description("capture and maintain finding baselines");
  addBaselineOptions(baseline.command("capture").argument("[path]", "directory to scan")).action(
    async (pathInput: string | undefined, options: BaselineCliOptions) => {
      process.exitCode = await captureBaselineCommand(pathInput, options, streams);
    },
  );
  addBaselineOptions(baseline.command("diff").argument("[path]", "directory to scan")).action(
    async (pathInput: string | undefined, options: BaselineCliOptions) => {
      process.exitCode = await diffBaselineCommand(pathInput, options, streams);
    },
  );
  addBaselineOptions(baseline.command("clear").argument("[path]", "directory to scan")).action(
    async (pathInput: string | undefined, options: BaselineCliOptions) => {
      process.exitCode = await clearBaselineCommand(pathInput, options, streams);
    },
  );
  addBaselineOptions(baseline.command("show").argument("[path]", "directory to scan")).action(
    async (pathInput: string | undefined, options: BaselineCliOptions) => {
      process.exitCode = await showBaselineCommand(pathInput, options, streams);
    },
  );
  addBaselineOptions(baseline.command("prune").argument("[path]", "directory to scan")).action(
    async (pathInput: string | undefined, options: BaselineCliOptions) => {
      process.exitCode = await pruneBaselineCommand(pathInput, options, streams);
    },
  );
}

function runnerSeconds(value: string): number {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new InvalidArgumentError("Runner interval must be a positive integer.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 300) {
    throw new InvalidArgumentError("Runner interval must not exceed 300 seconds.");
  }
  return parsed;
}

function runnerOutputFormat(value: string): RunnerOutputFormat {
  if (value !== "text" && value !== "json") {
    throw new InvalidArgumentError("Runner format must be text or json.");
  }
  return value;
}

function runnerTtlSeconds(value: string): number {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new InvalidArgumentError("Runner token TTL must be a positive integer.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 3600) {
    throw new InvalidArgumentError("Runner token TTL must not exceed 3600 seconds.");
  }
  return parsed;
}

function runnerEnrollmentScope(value: string): "installation" | "organization" | "repository" {
  if (value !== "installation" && value !== "organization" && value !== "repository") {
    throw new InvalidArgumentError("Runner enrollment scope must be installation, organization, or repository.");
  }
  return value;
}
