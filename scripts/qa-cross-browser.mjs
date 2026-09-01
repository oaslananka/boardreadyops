#!/usr/bin/env node
// Cross-platform wrapper for `pnpm run qa:cross-browser`: setting QA_CROSS_BROWSER=1 inline in
// the package.json script (`QA_CROSS_BROWSER=1 playwright test ...`) works in bash but not
// PowerShell/cmd, and this repo avoids adding a dependency like cross-env for one script.
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "corepack",
  ["pnpm", "exec", "playwright", "test", "--project=chromium", "--project=firefox", "--project=webkit"],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, QA_CROSS_BROWSER: "1" },
  },
);

process.exit(result.status ?? 1);
