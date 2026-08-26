import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function createRenovateEnvironment(storeDir, baseEnv = process.env) {
  return {
    ...baseEnv,
    pnpm_config_store_dir: storeDir,
  };
}

export function renovateCommandPlan() {
  return [
    ["corepack", ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"]],
    ["corepack", ["pnpm", "rebuild", "@prisma/engines", "esbuild", "prisma", "sharp"]],
    ["corepack", ["pnpm", "run", "notice"]],
    ["corepack", ["pnpm", "run", "build"]],
  ];
}

async function runCommand(command, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      reject(new Error(`${command} ${args.join(" ")} failed with ${detail}`));
    });
  });
}

export async function main(root = process.cwd(), options = {}) {
  const makeTemp = options.makeTemp ?? ((prefix) => mkdtemp(path.join(tmpdir(), prefix)));
  const remove = options.remove ?? ((target, removeOptions) => rm(target, removeOptions));
  const run = options.run ?? runCommand;
  await remove(path.join(root, "node_modules"), { recursive: true, force: true });
  const storeDir = await makeTemp("boardreadyops-renovate-pnpm-");
  const env = createRenovateEnvironment(storeDir, options.baseEnv ?? process.env);

  try {
    for (const [command, args] of renovateCommandPlan()) {
      await run(command, args, { cwd: root, env });
    }
  } finally {
    await remove(storeDir, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
