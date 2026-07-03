import { spawnSync } from "node:child_process";

export const requiredFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "NOTICE",
  "SECURITY.md",
  "action.yml",
  "dist/cli/index.cjs",
  "dist/action/index.cjs",
];

export function checkPack(root = process.cwd()) {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`npm pack failed:\n${result.stderr || result.stdout}`.trim());
  }
  const files = new Set(JSON.parse(result.stdout)?.[0]?.files?.map((file) => file.path) ?? []);
  const missing = requiredFiles.filter((file) => !files.has(file));
  if (missing.length > 0) {
    throw new Error(`npm pack is missing required files: ${missing.join(", ")}`);
  }
  return [...files].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    checkPack();
    process.stdout.write(`ok: npm pack includes ${requiredFiles.length} required files\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
