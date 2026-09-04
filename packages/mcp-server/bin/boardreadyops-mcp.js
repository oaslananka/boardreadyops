#!/usr/bin/env node
import { spawn } from "node:child_process";
// Plain JS bootstrap: re-execs Node with TypeScript type-stripping enabled so the rest of this
// package can ship as plain .ts source (matching this monorepo's other internal packages)
// without a separate compiled build artifact. Explicit --experimental-strip-types rather than
// relying on unflagged native TS support keeps this working on the minimum supported engine
// (Node 22.14, where stripping exists behind the flag) as well as newer runtimes.
import { fileURLToPath } from "node:url";

const entrypoint = fileURLToPath(new URL("../src/stdio.ts", import.meta.url));

const child = spawn(
  process.execPath,
  ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", entrypoint, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
child.on("error", (error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
