import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it, vi } from "vitest";
import packageManifest from "../../package.json" with { type: "json" };
import doctorSchema from "../../schemas/doctor.schema.json" with { type: "json" };
import findingsSchema from "../../schemas/findings.schema.json" with { type: "json" };
import { supportsDoctorNodeVersion } from "../../src/cli/commands/doctor.js";
import { runCli } from "../../src/cli/index.js";
import { runPipeline } from "../../src/core/pipeline.js";
import { detectKicadCli } from "../../src/kicad/cli.js";
import * as kicadPaths from "../../src/kicad/paths.js";

const fixtureRoot = path.resolve("tests/fixtures/projects");

describe("CLI integration", () => {
  it("prints root help and version", async () => {
    const help = captureStreams();
    expect(await runCli(["--help"], help)).toBe(0);
    expect(help.stdoutText()).toContain("BoardReadyOps - CI preflight for production-ready PCBs.");
    expect(help.stdoutText()).toContain("Usage: boardreadyops");

    const version = captureStreams();
    expect(await runCli(["--version"], version)).toBe(0);
    expect(version.stdoutText().trim()).toBe(packageManifest.version);
  });

  it("runs the default command and writes reports", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-cli-"));
    await fs.cp(path.join(fixtureRoot, "safe-basic"), temp, {
      recursive: true,
    });
    const streams = memoryStreams();
    const code = await runCli(
      ["run", temp, "--json", "out.json", "--sarif", "out.sarif.json", "--markdown", "out.md", "--no-annotations"],
      streams,
    );
    expect(code).toBe(0);
    expect(await fs.stat(path.join(temp, "out.json"))).toBeTruthy();
    expect(await fs.stat(path.join(temp, "out.sarif.json"))).toBeTruthy();
    expect(await fs.stat(path.join(temp, "out.md"))).toBeTruthy();
  });

  it("writes CycloneDX HBOM through the sbom command", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-hbom-"));
    await fs.cp(path.join(fixtureRoot, "safe-basic"), temp, {
      recursive: true,
    });
    const streams = captureStreams();

    const code = await runCli(["sbom", temp, "--output", "build/hbom.json"], streams);

    expect(code).toBe(0);
    expect(streams.stdoutText()).toBe("");
    const hbom = JSON.parse(await fs.readFile(path.join(temp, "build/hbom.json"), "utf8"));
    expect(hbom).toMatchObject({
      bomFormat: "CycloneDX",
      specVersion: "1.7",
      metadata: { component: { type: "device", name: "safe-basic" } },
      components: [
        {
          type: "device",
          name: "RC0603FR-0710KL",
          manufacturer: { name: "Yageo" },
        },
      ],
    });
  });

  it("writes CycloneDX HBOM to stdout when sbom output is '-'", async () => {
    const streams = captureStreams();

    const code = await runCli(["sbom", path.join(fixtureRoot, "safe-basic"), "--output", "-"], streams);

    expect(code).toBe(0);
    expect(JSON.parse(streams.stdoutText())).toMatchObject({
      bomFormat: "CycloneDX",
      components: [{ name: "RC0603FR-0710KL" }],
    });
  });

  it("rejects unsupported future SBOM formats", async () => {
    const streams = captureStreams();

    const code = await runCli(["sbom", path.join(fixtureRoot, "safe-basic"), "--format", "spdx"], streams);

    expect(code).toBe(2);
    expect(streams.stderrText()).toContain("SBOM format spdx is not supported yet.");
  });

  it("writes configured JUnit reports", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-junit-"));
    await fs.cp(path.join(fixtureRoot, "safe-basic"), temp, {
      recursive: true,
    });
    await fs.writeFile(
      path.join(temp, "boardreadyops.yml"),
      "version: 1\nreport:\n  junit: build/boardreadyops.junit.xml\n",
      "utf8",
    );

    expect(
      await runCli(
        ["run", temp, "--rule", "bom.missing-mpn", "--no-annotations", "--fail-on", "never"],
        memoryStreams(),
      ),
    ).toBe(0);

    const xml = await fs.readFile(path.join(temp, "build/boardreadyops.junit.xml"), "utf8");
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<testsuite");
    expect(xml).toContain("</testsuite>");
  });

  it("returns exit code 1 at the fail-on threshold", async () => {
    const code = await runCli(["run", path.join(fixtureRoot, "bom-missing-mpn"), "--no-annotations"], memoryStreams());
    expect(code).toBe(1);
  });

  it("routes the policy command instead of treating it as a run path", async () => {
    const streams = captureStreams();
    const code = await runCli(
      ["policy", path.join(fixtureRoot, "safe-basic"), "--simulate", "--no-annotations"],
      streams,
    );

    expect(code, streams.stderrText()).toBe(0);
    expect(streams.stderrText()).not.toContain("too many arguments");
    expect(streams.stdoutText()).toContain("No policy configured");
  });

  it("emits stable JSON diagnostics for check --format json", async () => {
    const streams = captureStreams();
    const code = await runCli(
      [
        "check",
        "pinmap.verify",
        path.join(fixtureRoot, "pinmap-mismatch"),
        "--format",
        "json",
        "--no-annotations",
        "--fail-on",
        "never",
      ],
      streams,
    );

    expect(code, streams.stderrText()).toBe(0);
    const report = JSON.parse(streams.stdoutText());
    expect(report).toMatchObject({ schemaVersion: 1, status: "passed", exitCode: 0 });
    expect(report.findings).toHaveLength(1);
    validateFindingsReport(report);
  });

  it("keeps --format json parseable for nonzero diagnostics and preflight errors", async () => {
    const failed = captureStreams();
    expect(
      await runCli(
        ["check", path.join(fixtureRoot, "bom-missing-mpn"), "--format", "json", "--no-annotations"],
        failed,
      ),
    ).toBe(1);
    const failedReport = JSON.parse(failed.stdoutText());
    expect(failedReport).toMatchObject({ status: "failed", exitCode: 1, summary: { failed: true } });
    validateFindingsReport(failedReport);

    const badConfig = captureStreams();
    expect(
      await runCli(
        ["check", path.join(fixtureRoot, "malformed-config"), "--format", "json", "--no-annotations"],
        badConfig,
      ),
    ).toBe(2);
    const badConfigReport = JSON.parse(badConfig.stdoutText());
    expect(badConfigReport).toMatchObject({ status: "failed", exitCode: 2 });
    expect(badConfigReport.findings[0]).toMatchObject({ ruleId: "config.invalid", severity: "high" });
    validateFindingsReport(badConfigReport);

    const missingKicad = captureStreams();
    expect(
      await runCli(
        [
          "check",
          path.join(fixtureRoot, "safe-basic"),
          "--format",
          "json",
          "--require-kicad",
          "--kicad-cli",
          path.join(os.tmpdir(), "missing-kicad-cli"),
          "--no-annotations",
        ],
        missingKicad,
      ),
    ).toBe(3);
    const missingKicadReport = JSON.parse(missingKicad.stdoutText());
    expect(missingKicadReport.findings[0]).toMatchObject({
      ruleId: "environment.kicad-missing",
      severity: "high",
    });
    validateFindingsReport(missingKicadReport);

    const invalidFormat = captureStreams();
    expect(await runCli(["check", path.join(fixtureRoot, "safe-basic"), "--format", "yaml"], invalidFormat)).toBe(2);
    expect(invalidFormat.stdoutText()).toBe("");
    expect(invalidFormat.stderrText()).toContain("Output format must be text or json.");
  });

  it("uses a selected gate fail-on threshold from config", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-cli-gate-"));
    await fs.cp(path.join(fixtureRoot, "bom-missing-mpn"), temp, {
      recursive: true,
    });
    await fs.appendFile(
      path.join(temp, "boardreadyops.yml"),
      `
gates:
  release:
    fail-on: critical
`,
      "utf8",
    );

    expect(await runCli(["run", temp, "--gate", "release", "--no-annotations"], memoryStreams())).toBe(0);
  });

  it("prints schemas and doctor diagnostics", async () => {
    const agentPlan = captureStreams();
    expect(await runCli(["schema", "agent-plan"], agentPlan)).toBe(0);
    expect(agentPlan.stdoutText()).toContain("BoardReadyOps agent remediation plan");
    const schema = captureStreams();
    expect(await runCli(["schema", "config"], schema)).toBe(0);
    expect(schema.stdoutText()).toContain("https://github.com/oaslananka/boardreadyops/schemas/config-v1.json");
    const findings = captureStreams();
    expect(await runCli(["schema", "findings"], findings)).toBe(0);
    expect(findings.stdoutText()).toContain("BoardReadyOps findings report");
    const pinmap = captureStreams();
    expect(await runCli(["schema", "pinmap"], pinmap)).toBe(0);
    expect(pinmap.stdoutText()).toContain("BoardReadyOps pinmap");
    const hbom = captureStreams();
    expect(await runCli(["schema", "hbom"], hbom)).toBe(0);
    expect(hbom.stdoutText()).toContain("BoardReadyOps CycloneDX hardware SBOM");
    const doctorSchema = captureStreams();
    expect(await runCli(["schema", "doctor"], doctorSchema)).toBe(0);
    expect(doctorSchema.stdoutText()).toContain("BoardReadyOps doctor report");
    const doctor = captureStreams();
    expect(await runCli(["doctor"], doctor)).toBe(0);
    expect(doctor.stdoutText()).toContain("Node:");
  });

  it("honors BOARDREADY_LOCALE for CLI status and doctor text output", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-i18n-cli-"));
    const previousCwd = process.cwd();
    const previousLocale = process.env.BOARDREADY_LOCALE;
    process.chdir(temp);
    process.env.BOARDREADY_LOCALE = "__PSEUDO__";
    try {
      const init = captureStreams();
      expect(await runCli(["init"], init)).toBe(0);
      expect(init.stdoutText()).toContain("[[created boardreadyops.yml]]");

      const doctor = captureStreams();
      expect(await runCli(["doctor", "--check", "runtime"], doctor)).toBe(0);
      expect(doctor.stdoutText()).toContain("[[BoardReadyOps Doctor");
      expect(doctor.stdoutText()).toContain("[[Runtime]]");
    } finally {
      process.chdir(previousCwd);
      restoreEnv("BOARDREADY_LOCALE", previousLocale);
    }
  });

  it("prints a JSON doctor report for one selected check", async () => {
    const doctor = captureStreams();
    expect(await runCli(["doctor", "--check", "runtime", "--format", "json"], doctor)).toBe(0);

    const report = JSON.parse(doctor.stdoutText());
    expect(report.tool).toMatchObject({ name: "boardreadyops" });
    expect(report.checks.map((check: { name: string }) => check.name)).toEqual(["runtime"]);
  });

  it("validates an explicit repository config path with doctor", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-doctor-config-"));
    await fs.mkdir(path.join(temp, "ci"), { recursive: true });
    await fs.writeFile(path.join(temp, "ci", "boardreadyops.yml"), "version: 1\nmode: warn\nfail-on: high\n", "utf8");
    const previousCwd = process.cwd();
    process.chdir(temp);
    try {
      const doctor = captureStreams();
      expect(
        await runCli(
          ["doctor", "--check", "repository", "--format", "json", "--config", "ci/boardreadyops.yml"],
          doctor,
        ),
      ).toBe(0);
      const report = JSON.parse(doctor.stdoutText());
      expect(report.checks[0]?.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: "pass", message: "boardreadyops.yml found and valid." }),
        ]),
      );
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("rejects unsupported doctor options and Node engine majors", async () => {
    const invalidCheck = captureStreams();
    expect(await runCli(["doctor", "--check", "typo"], invalidCheck)).toBe(2);
    expect(invalidCheck.stderrText()).toContain("Unknown doctor check: typo");

    const invalidFormat = captureStreams();
    expect(await runCli(["doctor", "--format", "jsno"], invalidFormat)).toBe(2);
    expect(invalidFormat.stderrText()).toContain("Unknown doctor format: jsno");

    expect(supportsDoctorNodeVersion("22.0.0")).toBe(true);
    expect(supportsDoctorNodeVersion("24.0.0")).toBe(true);
    expect(supportsDoctorNodeVersion("25.0.0")).toBe(false);
    expect(supportsDoctorNodeVersion("26.0.0")).toBe(false);
  });

  it("runs every doctor check by default", async () => {
    const doctor = captureStreams();
    expect(await runCli(["doctor", "--format", "json"], doctor)).toBe(0);

    const report = JSON.parse(doctor.stdoutText());
    expect(report.checks.map((check: { name: string }) => check.name)).toEqual([
      "runtime",
      "kicad",
      "adapters",
      "repository",
      "suppressions",
      "action",
    ]);
    const validate = new Ajv2020({ allErrors: true }).compile(doctorSchema);
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
  });

  it("diagnoses repository, adapter, KiCad, and workflow gaps", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-doctor-"));
    await fs.cp(path.join(fixtureRoot, "safe-basic"), temp, {
      recursive: true,
    });
    const previousCwd = process.cwd();
    const previousPath = process.env.PATH;
    const previousNexarClientId = process.env.NEXAR_CLIENT_ID;
    const previousNexarClientSecret = process.env.NEXAR_CLIENT_SECRET;
    const candidates = vi.spyOn(kicadPaths, "defaultKicadCliCandidates").mockReturnValue(["kicad-cli"]);
    process.chdir(temp);
    process.env.PATH = "";
    delete process.env.NEXAR_CLIENT_ID;
    delete process.env.NEXAR_CLIENT_SECRET;
    try {
      const doctor = captureStreams();
      expect(await runCli(["doctor", "--format", "json"], doctor)).toBe(0);

      const report = JSON.parse(doctor.stdoutText());
      expect(report.recommendations).toContain("Generate Gerber outputs from KiCad before CI.");
      expect(doctorItem(report, "kicad", "kicad-cli not found.")).toMatchObject({
        severity: "warn",
      });
      expect(doctorItem(report, "adapters", "Nexar credentials not present.")).toMatchObject({
        severity: "warn",
      });
      expect(doctorItem(report, "repository", "No Gerber outputs found.")).toMatchObject({
        severity: "fail",
        recommendation: "Generate Gerber outputs from KiCad before CI.",
      });
      expect(doctorItem(report, "action", "No .github/workflows/boardreadyops.yml workflow found.")).toMatchObject({
        severity: "warn",
      });
    } finally {
      candidates.mockRestore();
      process.chdir(previousCwd);
      restoreEnv("PATH", previousPath);
      restoreEnv("NEXAR_CLIENT_ID", previousNexarClientId);
      restoreEnv("NEXAR_CLIENT_SECRET", previousNexarClientSecret);
    }
  });

  it("reads YAML workflow structure for action diagnostics", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-doctor-action-"));
    const sha = "d".repeat(40);
    await fs.mkdir(path.join(temp, ".github", "workflows"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(temp, ".github", "workflows", "boardreadyops.yaml"),
      `name: boardreadyops
permissions:
  contents: read
jobs:
  doctor:
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@${sha}
      - uses: oaslananka/boardreadyops@${sha}
`,
      "utf8",
    );

    const previousCwd = process.cwd();
    process.chdir(temp);
    try {
      const doctor = captureStreams();
      expect(await runCli(["doctor", "--check", "action", "--format", "json"], doctor)).toBe(0);

      const report = JSON.parse(doctor.stdoutText());
      expect(doctorItem(report, "action", ".github/workflows/boardreadyops.yaml found.")).toMatchObject({
        severity: "pass",
      });
      expect(doctorItem(report, "action", "actions/checkout is SHA-pinned.")).toMatchObject({ severity: "pass" });
      expect(doctorItem(report, "action", "permissions: pull-requests or issues write configured.")).toMatchObject({
        severity: "pass",
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("does not trust workflow comments and keeps unreadable workflow paths diagnostic", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-doctor-action-"));
    await fs.mkdir(path.join(temp, ".github", "workflows"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(temp, ".github", "workflows", "boardreadyops.yml"),
      `# permissions: pull-requests: write
# uses: actions/checkout@${"d".repeat(40)}
permissions:
  contents: read
jobs:
  unrelated:
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@${"d".repeat(40)}
  doctor:
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v6
      - uses: oaslananka/boardreadyops@${"d".repeat(40)}
`,
      "utf8",
    );

    const previousCwd = process.cwd();
    process.chdir(temp);
    try {
      const comments = captureStreams();
      expect(await runCli(["doctor", "--check", "action", "--format", "json"], comments)).toBe(0);
      const commentsReport = JSON.parse(comments.stdoutText());
      expect(doctorItem(commentsReport, "action", "actions/checkout is not SHA-pinned.")).toMatchObject({
        severity: "warn",
      });
      expect(
        doctorItem(commentsReport, "action", "permissions: pull-requests or issues write missing for PR comments."),
      ).toMatchObject({ severity: "warn" });

      await fs.rm(path.join(temp, ".github", "workflows", "boardreadyops.yml"));
      await fs.mkdir(path.join(temp, ".github", "workflows", "boardreadyops.yml"));
      const unreadable = captureStreams();
      expect(await runCli(["doctor", "--check", "action", "--format", "json"], unreadable)).toBe(0);
      const unreadableReport = JSON.parse(unreadable.stdoutText());
      expect(
        doctorItem(unreadableReport, "action", "Unable to read or parse .github/workflows/boardreadyops.yml workflow."),
      ).toMatchObject({ severity: "warn" });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("reports discovered suppression and baseline files", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-doctor-suppressions-"));
    await fs.writeFile(path.join(temp, ".boardreadyops-suppressions.yml"), "version: 1\n", "utf8");
    await fs.writeFile(path.join(temp, ".boardreadyops-baseline.json"), "{}\n", "utf8");

    const previousCwd = process.cwd();
    process.chdir(temp);
    try {
      const doctor = captureStreams();
      expect(await runCli(["doctor", "--check", "suppressions", "--format", "json"], doctor)).toBe(0);
      const report = JSON.parse(doctor.stdoutText());
      expect(
        doctorItem(report, "suppressions", ".boardreadyops-suppressions.yml suppressions file found."),
      ).toMatchObject({ severity: "info" });
      expect(doctorItem(report, "suppressions", ".boardreadyops-baseline.json baseline found.")).toMatchObject({
        severity: "info",
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("explains manufacturing output detection", async () => {
    const explain = captureStreams();

    expect(
      await runCli(
        ["explain", "manufacturing.outputs-present", path.join(fixtureRoot, "manufacturing-missing-outputs")],
        explain,
      ),
    ).toBe(0);
    expect(explain.stdoutText()).toContain("manufacturing.outputs-present");
    expect(explain.stdoutText()).toContain("Searched patterns");
    expect(explain.stdoutText()).toContain("Found");
    expect(explain.stdoutText()).toContain("Missing");
  });

  it("reports rules that cannot be explained", async () => {
    const unknownRule = captureStreams();
    expect(await runCli(["explain", "unknown.rule", path.join(fixtureRoot, "safe-basic")], unknownRule)).toBe(2);
    expect(unknownRule.stderrText()).toContain("Unknown rule: unknown.rule");

    const unsupportedRule = captureStreams();
    expect(await runCli(["explain", "bom.missing-mpn", path.join(fixtureRoot, "safe-basic")], unsupportedRule)).toBe(2);
    expect(unsupportedRule.stderrText()).toContain("Rule bom.missing-mpn does not support explanation.");
  });

  it("supports check, init, and stdout report targets", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-cli-more-"));
    await fs.cp(path.join(fixtureRoot, "pinmap-mismatch"), temp, {
      recursive: true,
    });
    const check = captureStreams();
    expect(
      await runCli(["check", "pinmap.verify", temp, "--json", "-", "--no-annotations", "--fail-on", "never"], check),
    ).toBe(0);
    expect(JSON.parse(check.stdoutText()).summary.total).toBe(1);

    const checkPath = captureStreams();
    expect(await runCli(["check", temp, "--json", "-", "--no-annotations", "--fail-on", "never"], checkPath)).toBe(0);
    expect(JSON.parse(checkPath.stdoutText()).summary.total).toBeGreaterThan(0);

    const initDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-init-"));
    const previous = process.cwd();
    process.chdir(initDir);
    try {
      const init = captureStreams();
      expect(await runCli(["init"], init)).toBe(0);
      const config = await fs.readFile(path.join(initDir, "boardreadyops.yml"), "utf8");
      expect(config).toContain("version: 1");
      expect(config).toContain("json: build/boardreadyops.findings.json");
      expect(config).toContain("markdown: build/boardreadyops.report.md");
    } finally {
      process.chdir(previous);
    }
  });

  it("keeps the committed findings-v1 contract fixture schema-valid", async () => {
    const fixture = JSON.parse(
      await fs.readFile(path.join("tests", "fixtures", "contract", "findings-v1.json"), "utf8"),
    );
    validateFindingsReport(fixture);
  });

  it("filters run and check to one project with explicit concurrency", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-cli-multi-project-"));
    await writeProject(root, "hardware/main", "main");
    await writeProject(root, "hardware/prototype", "prototype");

    const run = captureStreams();
    expect(
      await runCli(
        [
          "run",
          root,
          "--project",
          "hardware/main",
          "--rule",
          "release.revision-set",
          "--concurrency",
          "1",
          "--json",
          "-",
          "--no-annotations",
          "--fail-on",
          "never",
        ],
        run,
      ),
    ).toBe(0);
    expect(JSON.parse(run.stdoutText()).findings.map((finding: { project?: string }) => finding.project)).toEqual([
      "hardware/main/main.kicad_pro",
    ]);

    const check = captureStreams();
    expect(
      await runCli(
        [
          "check",
          "release.revision-set",
          root,
          "--project",
          "hardware/prototype",
          "--json",
          "-",
          "--no-annotations",
          "--fail-on",
          "never",
        ],
        check,
      ),
    ).toBe(0);
    expect(JSON.parse(check.stdoutText()).findings.map((finding: { project?: string }) => finding.project)).toEqual([
      "hardware/prototype/prototype.kicad_pro",
    ]);
  });

  it("captures, shows, diffs, prunes, and clears a baseline from the CLI", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-baseline-cli-"));
    await fs.writeFile(path.join(temp, "sample.kicad_pro"), "{}");
    await fs.writeFile(
      path.join(temp, "boardreadyops.yml"),
      `version: 1
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
  release.changelog-present:
    enabled: false
  release.revision-set:
    enabled: false
`,
    );

    const capture = captureStreams();
    expect(await runCli(["baseline", "capture", temp], capture)).toBe(0);
    expect(capture.stdoutText()).toContain(".boardreadyops-baseline.json");

    const show = captureStreams();
    expect(await runCli(["baseline", "show", temp], show)).toBe(0);
    expect(JSON.parse(show.stdoutText()).findings).toHaveLength(3);

    const diff = captureStreams();
    expect(await runCli(["baseline", "diff", temp], diff)).toBe(0);
    expect(diff.stdoutText()).toContain("Added: 0");
    expect(diff.stdoutText()).toContain("Removed: 0");
    expect(diff.stdoutText()).toContain("Unchanged: 3");

    await fs.writeFile(path.join(temp, "sample.kicad_sch"), "(kicad_sch)");
    const prune = captureStreams();
    expect(await runCli(["baseline", "prune", temp], prune)).toBe(0);
    expect(
      JSON.parse(await fs.readFile(path.join(temp, ".boardreadyops-baseline.json"), "utf8")).findings,
    ).toHaveLength(2);

    const clear = captureStreams();
    expect(await runCli(["baseline", "clear", temp], clear)).toBe(0);
    await expect(fs.stat(path.join(temp, ".boardreadyops-baseline.json"))).rejects.toThrow();
  });

  it("uses explicit config paths for baseline subcommands", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-baseline-config-"));
    await fs.mkdir(path.join(temp, "ci"), { recursive: true });
    await fs.writeFile(path.join(temp, "sample.kicad_pro"), "{}");
    await fs.writeFile(
      path.join(temp, "ci", "boardreadyops.yml"),
      `version: 1
baseline:
  file: audit/current.json
  mode: new-only
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
  release.changelog-present:
    enabled: false
  release.revision-set:
    enabled: false
`,
    );
    await fs.mkdir(path.join(temp, "audit"), { recursive: true });
    await fs.writeFile(path.join(temp, "audit", "current.json"), "null\n", "utf8");

    const capture = captureStreams();
    expect(await runCli(["baseline", "capture", temp, "--config", "ci/boardreadyops.yml"], capture)).toBe(0);
    expect(capture.stdoutText()).toContain("audit/current.json");
    await expect(fs.stat(path.join(temp, "audit", "current.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(temp, ".boardreadyops-baseline.json"))).rejects.toThrow();

    const show = captureStreams();
    expect(await runCli(["baseline", "show", temp, "--config", "ci/boardreadyops.yml"], show)).toBe(0);
    expect(JSON.parse(show.stdoutText()).findings).toHaveLength(3);
  });

  it("keeps suppressed and baselined findings visible without failing the run", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-suppressed-baseline-"));
    await fs.writeFile(path.join(temp, "sample.kicad_pro"), "{}");
    const initial = await runPipeline({ path: temp, failOn: "never" });
    const projectShapeFindings = initial.findings.filter((finding) => finding.ruleId === "manifest.project-discovery");
    expect(projectShapeFindings).toHaveLength(2);
    const [suppressed, baselined] = projectShapeFindings;
    if (!suppressed || !baselined) {
      throw new Error("expected two project-shape findings");
    }
    await fs.writeFile(
      path.join(temp, "boardreadyops.yml"),
      `version: 1
suppressions:
  - rule: ${suppressed.ruleId}
    fingerprint: ${suppressed.fingerprint}
    reason: project is still being created
baseline:
  file: .boardreadyops-baseline.json
  mode: new-only
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
  release.changelog-present:
    enabled: false
  release.revision-set:
    enabled: false
`,
    );
    await fs.writeFile(
      path.join(temp, ".boardreadyops-baseline.json"),
      JSON.stringify(
        {
          version: 1,
          capturedAt: "2026-05-21T10:00:00.000Z",
          capturedBy: "boardreadyops/1.0.2",
          findings: [
            {
              fingerprint: baselined.fingerprint,
              ruleId: baselined.ruleId,
              message: baselined.message,
              suppressedUntil: null,
            },
          ],
        },
        null,
        2,
      ),
    );

    const streams = captureStreams();
    expect(
      await runCli(["run", temp, "--rule", "manifest.project-discovery", "--json", "-", "--no-annotations"], streams),
    ).toBe(0);
    const result = JSON.parse(streams.stdoutText());
    expect(result.summary.total).toBe(2);
    expect(result.summary.failed).toBe(false);
    expect(result.findings.map((finding: { suppressed?: boolean }) => finding.suppressed)).toEqual([true, true]);
  });

  it("maps bad configuration and missing required KiCad to dedicated exit codes", async () => {
    const badConfig = captureStreams();
    expect(await runCli(["run", path.join(fixtureRoot, "malformed-config"), "--no-annotations"], badConfig)).toBe(2);
    expect(badConfig.stderrText()).toContain("Configuration error:");

    const missingKicad = captureStreams();
    expect(
      await runCli(
        [
          "run",
          path.join(fixtureRoot, "safe-basic"),
          "--require-kicad",
          "--kicad-cli",
          path.join(os.tmpdir(), "missing-kicad-cli"),
          "--no-annotations",
        ],
        missingKicad,
      ),
    ).toBe(3);
    expect(missingKicad.stderrText()).toContain("Environment error:");
  });

  it("localizes CLI configuration and environment errors", async () => {
    const previousLocale = process.env.BOARDREADY_LOCALE;
    process.env.BOARDREADY_LOCALE = "__PSEUDO__";
    try {
      const badConfig = captureStreams();
      expect(await runCli(["run", path.join(fixtureRoot, "malformed-config"), "--no-annotations"], badConfig)).toBe(2);
      expect(badConfig.stderrText()).toContain("[[Configuration error:");

      const missingKicad = captureStreams();
      expect(
        await runCli(
          [
            "run",
            path.join(fixtureRoot, "safe-basic"),
            "--require-kicad",
            "--kicad-cli",
            path.join(os.tmpdir(), "missing-kicad-cli"),
            "--no-annotations",
          ],
          missingKicad,
        ),
      ).toBe(3);
      expect(missingKicad.stderrText()).toContain("[[Environment error:");
    } finally {
      restoreEnv("BOARDREADY_LOCALE", previousLocale);
    }
  });

  it("runs every KiCad 10 extension fixture through the expected rule", async () => {
    const fixtures: Array<[string, string]> = [
      ["copper-balance-low", "design.copper-balance"],
      ["board-outline-open", "design.board-outline"],
      ["bom-variant-inconsistency", "bom.variant-consistency"],
      ["jobset-missing-output", "manufacturing.jobset-outputs"],
      ["release-bad-version-format", "release.version-format"],
      ["bom-lifecycle", "bom.lifecycle"],
      ["layer-stackup-mismatch", "manufacturing.layer-stackup"],
      ["pinmap-net-label-mismatch", "pinmap.net-label"],
    ];
    for (const [fixture, ruleId] of fixtures) {
      const result = await runPipeline({
        path: path.join(fixtureRoot, fixture),
        rules: [ruleId],
        failOn: "never",
      });
      expect(
        result.findings.some((finding) => finding.ruleId === ruleId),
        fixture,
      ).toBe(true);
    }
  });

  it("runs KiCad-backed DRC/ERC against a supported KiCad installation", async (context) => {
    const kicad = await detectKicadCli();
    const supportedKicad = /^(9|10)\./;
    if (!process.env.CI) {
      context.skip(!kicad.found, "kicad-cli is not installed in this environment");
      context.skip(
        !supportedKicad.test(kicad.version ?? ""),
        "kicad-cli 9.x or 10.x is not installed in this environment",
      );
    }
    expect(kicad.found).toBe(true);
    expect(kicad.version).toMatch(supportedKicad);
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-real-kicad-"));
    await fs.rm(temp, { recursive: true, force: true });
    await fs.cp(path.join(fixtureRoot, "safe-basic"), temp, {
      recursive: true,
    });
    await fs.rm(path.join(temp, "boardreadyops.yml"), { force: true });
    const result = await runPipeline({
      path: temp,
      kicadCli: kicad.path,
      rules: ["drc.kicad", "erc.kicad"],
      failOn: "never",
    });
    expect(result.findings.some((finding) => finding.ruleId.startsWith("drc."))).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId.startsWith("erc."))).toBe(true);
  }, 120_000);
});

function memoryStreams() {
  return {
    stdout: {
      write() {
        return true;
      },
    },
    stderr: {
      write() {
        return true;
      },
    },
  } as unknown as {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
  };
}

function captureStreams() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: {
      write(value: string) {
        stdout += value;
        return true;
      },
    },
    stderr: {
      write(value: string) {
        stderr += value;
        return true;
      },
    },
    stdoutText() {
      return stdout;
    },
    stderrText() {
      return stderr;
    },
  } as unknown as {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    stdoutText(): string;
    stderrText(): string;
  };
}

async function writeProject(root: string, directory: string, name: string): Promise<void> {
  const projectRoot = path.join(root, directory);
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, `${name}.kicad_pro`), "{}", "utf8");
  await fs.writeFile(path.join(projectRoot, `${name}.kicad_sch`), "(kicad_sch)", "utf8");
  await fs.writeFile(path.join(projectRoot, `${name}.kicad_pcb`), '(kicad_pcb (title_block (rev "")))', "utf8");
}

function doctorItem(
  report: {
    checks: Array<{ name: string; items: Array<{ message: string }> }>;
  },
  checkName: string,
  message: string,
) {
  return report.checks.find((check) => check.name === checkName)?.items.find((item) => item.message === message);
}

function validateFindingsReport(report: unknown): void {
  const validate = new Ajv2020({ allErrors: true }).compile(findingsSchema);
  expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
