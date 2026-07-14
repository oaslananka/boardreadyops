#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { boardReadyVersion } from "../generated/version.js";
import { t } from "../i18n/t.js";
import { registerAllCommands } from "./commands.js";

export async function runCli(
  argv: string[],
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream } = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
): Promise<number> {
  const program = new Command();
  program
    .name("boardreadyops")
    .description("BoardReadyOps - CI preflight for production-ready PCBs.")
    .version(boardReadyVersion)
    .exitOverride();
  program.configureOutput({
    writeOut: (text) => streams.stdout.write(text),
    writeErr: (text) => streams.stderr.write(text),
  });

  registerAllCommands(program, streams);

  try {
    await program.parseAsync(rewriteDefaultCommand(argv), { from: "user" });
    return process.exitCode && typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    if (isCommanderDisplay(error)) {
      return 0;
    }
    streams.stderr.write(`${error instanceof Error ? error.message : t("cli.error.unexpected")}\n`);
    return 2;
  }
}

function rewriteDefaultCommand(argv: string[]): string[] {
  const commands = new Set([
    "run",
    "check",
    "plan",
    "fix",
    "doctor",
    "explain",
    "schema",
    "release",
    "policy",
    "vendor",
    "sbom",
    "generate",
    "init",
    "baseline",
    "runner",
    "help",
  ]);
  const first = argv[0];
  if (first === "--help" || first === "-h" || first === "--version" || first === "-V") {
    return argv;
  }
  if (!first || first.startsWith("-") || !commands.has(first)) {
    return ["run", ...argv];
  }
  return argv;
}

function isCommanderDisplay(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "commander.helpDisplayed" || error.code === "commander.version")
  );
}

const cliEntry = process.argv.at(1);
const cliEntryName = cliEntry ? path.basename(cliEntry) : "";
if (
  cliEntry &&
  !process.env.VITEST &&
  (cliEntryName === "boardreadyops" ||
    cliEntryName === "index.ts" ||
    cliEntryName === "index.js" ||
    cliEntryName === "index.cjs")
) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
