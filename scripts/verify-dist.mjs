import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const before = await distHash().catch(() => "");
const build = spawnSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit", shell: false });
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}
const after = await distHash();
if (!after) {
  throw new Error("dist bundles were not produced");
}
if (before && before !== after) {
  throw new Error("dist changed after rebuild; commit regenerated bundles");
}
const git = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }); // NOSONAR -- git is fixed; CI/developer PATH is trusted.
if (git.status === 0) {
  const status = spawnSync("git", ["status", "--porcelain", "--", "dist"], { encoding: "utf8" }); // NOSONAR -- git is fixed; CI/developer PATH is trusted.
  if (status.stdout.trim() !== "") {
    throw new Error(`dist is not clean:\n${status.stdout}`);
  }
}

async function distHash() {
  const files = ["dist/action/index.cjs", "dist/cli/index.cjs"];
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}
