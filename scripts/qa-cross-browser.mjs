#!/usr/bin/env node
// Cross-platform wrapper for `pnpm run qa:cross-browser`: setting QA_CROSS_BROWSER=1 inline in
// the package.json script (`QA_CROSS_BROWSER=1 playwright test ...`) works in bash but not
// PowerShell/cmd, and this repo avoids adding a dependency like cross-env for one script.
import { spawnSync } from "node:child_process";
import path from "node:path";

// Resolved to the corepack shim colocated with the running `node` binary (same convention as
// scripts/check-npm-pack.mjs's npmExecutable) rather than a bare "corepack" PATH lookup.
const corepackExecutable = path.join(
  path.dirname(process.execPath),
  process.platform === "win32" ? "corepack.cmd" : "corepack",
);

const result = spawnSync(
  corepackExecutable,
  ["pnpm", "exec", "playwright", "test", "--project=chromium", "--project=firefox", "--project=webkit"],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, QA_CROSS_BROWSER: "1" },
  },
);

process.exit(result.status ?? 1);
