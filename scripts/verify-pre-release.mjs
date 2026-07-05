import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const preReleaseSteps = [
  { name: "lint", command: "pnpm", args: ["run", "lint"] },
  { name: "typecheck", command: "pnpm", args: ["run", "typecheck"] },
  { name: "build", command: "pnpm", args: ["run", "build"] },
  { name: "dist", command: "pnpm", args: ["run", "verify:dist"] },
  { name: "version", command: "pnpm", args: ["run", "verify:version"], env: { ALLOW_MAJOR_RELEASE: "true" } },
  { name: "marketplace", command: "pnpm", args: ["run", "verify:marketplace"] },
  { name: "unit tests", command: "pnpm", args: ["run", "test:unit"] },
  { name: "property tests", command: "pnpm", args: ["run", "test:property"] },
  { name: "snapshot tests", command: "pnpm", args: ["run", "test:snapshot"] },
  { name: "action tests", command: "pnpm", args: ["run", "test:action"] },
  { name: "accessibility tests", command: "pnpm", args: ["run", "test:a11y"] },
  { name: "coverage", command: "pnpm", args: ["run", "coverage"] },
  { name: "docs", command: "pnpm", args: ["run", "docs"] },
  { name: "security", command: "pnpm", args: ["run", "security"] },
];

export const requiredPackageFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "NOTICE",
  "SECURITY.md",
  "action.yml",
  "dist/cli/index.cjs",
  "dist/action/index.cjs",
];

export async function verifyPackageContents(root = process.cwd(), options = {}) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "boardreadyops-pack-"));
  const outputFile = path.join(tempRoot, "npm-pack.json");
  try {
    const pack = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    await writeFile(outputFile, pack.stdout || "", "utf8");
    if (pack.status !== 0) {
      throw new Error(`npm pack dry-run failed:\n${pack.stdout}\n${pack.stderr}`.trim());
    }
    const payload = JSON.parse(await readFile(outputFile, "utf8"));
    const files = new Set(payload?.[0]?.files?.map((entry) => entry.path) ?? []);
    const missing = requiredPackageFiles.filter((file) => !files.has(file));
    if (missing.length > 0) {
      throw new Error(`npm package is missing required files: ${missing.join(", ")}`);
    }
    if (options.writeSummary !== false) {
      process.stdout.write(`ok: npm package contains ${requiredPackageFiles.length} required files\n`);
    }
    return { files: [...files].sort(), required: [...requiredPackageFiles] };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function runPreReleaseGate(options = {}) {
  if (options.listOnly) {
    for (const step of preReleaseSteps) {
      process.stdout.write(`${step.name}: ${step.command} ${step.args.join(" ")}\n`);
    }
    process.stdout.write(`package contents: npm pack --dry-run --json\n`);
    return;
  }

  for (const step of preReleaseSteps) {
    process.stdout.write(`\n==> ${step.name}: ${step.command} ${step.args.join(" ")}\n`);
    const result = spawnSync(step.command, step.args, {
      env: step.env ? { ...process.env, ...step.env } : process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) {
      throw new Error(`pre-release step failed: ${step.name}`);
    }
  }

  process.stdout.write("\n==> package contents: npm pack --dry-run --json\n");
  await verifyPackageContents(process.cwd());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPreReleaseGate({ listOnly: process.argv.includes("--list") }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
