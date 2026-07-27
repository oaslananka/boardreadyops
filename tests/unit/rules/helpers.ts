import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import type { Finding } from "../../../src/core/findings.js";
import { runPipeline } from "../../../src/core/pipeline.js";
import type { RunResult } from "../../../src/core/result.js";

const fixtureRoot = path.resolve("tests/fixtures/projects");
type RunPipelineInput = NonNullable<Parameters<typeof runPipeline>[0]>;

export async function runFixture(fixture: string, options: Omit<RunPipelineInput, "path"> = {}): Promise<RunResult> {
  const temp = await copyFixture(fixture);
  const outcome = await runPipeline({ ...options, path: temp, failOn: options.failOn ?? "never" }).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    await fs.rm(temp, { recursive: true, force: true });
  } catch (error) {
    if (outcome.ok) throw error;
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

export function expectRule(result: RunResult, ruleId: string, count?: number): Finding[] {
  const findings = result.findings.filter((finding) => finding.ruleId === ruleId);
  if (count === undefined) {
    expect(
      findings.length,
      `expected ${ruleId} in ${result.findings.map((finding) => finding.ruleId).join(", ")}`,
    ).toBeGreaterThan(0);
  } else {
    expect(findings).toHaveLength(count);
  }
  for (const finding of findings) {
    expect(finding.fix?.description).toBeTruthy();
  }
  return findings;
}

export async function copyFixture(fixture: string, removeConfig = false): Promise<string> {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `boardreadyops-${fixture}-`));
  await fs.rm(temp, { recursive: true, force: true });
  await fs.cp(path.join(fixtureRoot, fixture), temp, { recursive: true });
  if (removeConfig) {
    await fs.rm(path.join(temp, "boardreadyops.yml"), { force: true });
  }
  return temp;
}

export async function writeFixture(files: Record<string, string>): Promise<string> {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-rule-"));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(temp, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return temp;
}

export async function fakeKicadCli(dir: string): Promise<string> {
  const script = path.join(dir, process.platform === "win32" ? "kicad-cli.cmd" : "kicad-cli");
  const js = path.join(dir, "fake-kicad.mjs");
  await fs.writeFile(
    js,
    `import fs from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "version" || args[0] === "--version") {
  console.log("10.0.0");
  process.exit(0);
}
const output = args[args.indexOf("--output") + 1];
const isDrc = args.includes("drc");
const payload = isDrc
  ? { violations: [{ rule: "track_too_close", severity: "error", message: "clearance", file: args.at(-1), line: 12, column: 3 }] }
  : { diagnostics: [{ rule: "unconnected_pin", severity: "warning", message: "pin", file: args.at(-1), line: 7, column: 1 }] };
fs.writeFileSync(output, JSON.stringify(payload));
process.exit(1);
`,
    "utf8",
  );
  if (process.platform === "win32") {
    await fs.writeFile(script, `@echo off\r\n"${process.execPath}" "${js}" %*\r\n`, "utf8");
  } else {
    await fs.writeFile(script, `#!/bin/sh\n"${process.execPath}" "${js}" "$@"\n`, "utf8");
    await fs.chmod(script, 0o755);
  }
  return script;
}

export async function emptyFailingKicadCli(dir: string): Promise<string> {
  const script = path.join(dir, process.platform === "win32" ? "empty-kicad-cli.cmd" : "empty-kicad-cli");
  const js = path.join(dir, "empty-kicad.mjs");
  await fs.writeFile(
    js,
    `import fs from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "version" || args[0] === "--version") {
  console.log("10.0.0");
  process.exit(0);
}
const output = args[args.indexOf("--output") + 1];
fs.writeFileSync(output, "{}");
process.exit(1);
`,
    "utf8",
  );
  if (process.platform === "win32") {
    await fs.writeFile(script, `@echo off\r\n"${process.execPath}" "${js}" %*\r\n`, "utf8");
  } else {
    await fs.writeFile(script, `#!/bin/sh\n"${process.execPath}" "${js}" "$@"\n`, "utf8");
    await fs.chmod(script, 0o755);
  }
  return script;
}

/**
 * Creates a kicad-cli that returns DRC diagnostics with no ruleId or severity.
 */
export async function rulelessKicadCli(dir: string): Promise<string> {
  const script = path.join(dir, process.platform === "win32" ? "ruleless-kicad.cmd" : "ruleless-kicad");
  const js = path.join(dir, "ruleless-kicad.mjs");
  await fs.writeFile(
    js,
    `import fs from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "version" || args[0] === "--version") {
  console.log("10.0.0");
  process.exit(0);
}
const output = args[args.indexOf("--output") + 1];
fs.writeFileSync(output, JSON.stringify({ violations: [{ message: "No rule", file: args.at(-1), line: 1, column: 1 }] }));
process.exit(1);
`,
    "utf8",
  );
  if (process.platform === "win32") {
    await fs.writeFile(script, `@echo off\r\n"${process.execPath}" "${js}" %*\r\n`, "utf8");
  } else {
    await fs.writeFile(script, `#!/bin/sh\n"${process.execPath}" "${js}" "$@"\n`, "utf8");
    await fs.chmod(script, 0o755);
  }
  return script;
}

export async function pinmapCollisionFixture(): Promise<string> {
  return writeFixture({
    "pin.kicad_pro": "{}",
    "pin.kicad_pcb": '(kicad_pcb (title_block (rev "1.0.0")))',
    "pin.kicad_sch": '(kicad_sch (label "N1") (pin "1" (net "N1") (ref "U1")) (pin "2" (net "N2") (ref "U1")))',
    "pins.yml":
      "version: 1\npins:\n  - designator: U1\n    pin: '1'\n    net: N1\n  - designator: U1\n    pin: '1'\n    net: N1\n",
    "fab/README.md": "Fabrication notes.",
    "boardreadyops.yml":
      "version: 1\nprojects:\n  - path: .\n    pinmap: pins.yml\nrules:\n  drc.kicad:\n    enabled: false\n  erc.kicad:\n    enabled: false\n  release.changelog-present:\n    enabled: false\nfail-on: never\n",
  });
}
