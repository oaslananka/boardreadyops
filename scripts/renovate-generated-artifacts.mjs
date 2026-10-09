import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ALLOWED = Object.freeze(["NOTICE", "dist/action/index.cjs", "dist/cli/index.cjs"]);
const MAX_BYTES = Object.freeze({
  NOTICE: 8 * 1024 * 1024,
  "dist/action/index.cjs": 32 * 1024 * 1024,
  "dist/cli/index.cjs": 32 * 1024 * 1024,
});
const SHA_RE = /^[a-f0-9]{40}$/u;
const BRANCH_RE = /^renovate\/[a-zA-Z0-9._/-]{1,220}$/u;

export function authorizeRenovatePullRequest(event, livePr, repository) {
  const pr = event?.pull_request;
  if (
    event?.repository?.full_name !== repository ||
    typeof repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) ||
    !pr ||
    !livePr ||
    pr.user?.login !== "renovate[bot]" ||
    livePr.user?.login !== "renovate[bot]" ||
    pr.base?.ref !== "main" ||
    livePr.base?.ref !== "main" ||
    pr.head?.repo?.full_name !== repository ||
    livePr.head?.repo?.full_name !== repository ||
    !SHA_RE.test(pr.head?.sha ?? "") ||
    livePr.head?.sha !== pr.head.sha ||
    !BRANCH_RE.test(pr.head?.ref ?? "") ||
    pr.head.ref.includes("..") ||
    livePr.head?.ref !== pr.head.ref ||
    livePr.state !== "open" ||
    !Number.isSafeInteger(pr.number) ||
    pr.number <= 0 ||
    livePr.number !== pr.number
  )
    return null;
  return { sha: pr.head.sha, branch: pr.head.ref, number: pr.number };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function readOrdinaryFile(root, name, maxBytes) {
  // macOS /var -> /private/var and some Windows working directories are aliases.
  // Canonicalize the trusted root before checking that artifact realpaths stay inside.
  const rootResolved = await realpath(path.resolve(root));
  let current = path.resolve(root);
  for (const segment of name.split("/")) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Symlink prohibited: ${name}`);
  }
  const real = await realpath(current);
  if (!real.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error(`Path outside output: ${name}`);
  }
  const stat = await lstat(current);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error(`Invalid artifact size: ${name}`);
  return readFile(current);
}

export async function exportGeneratedFiles(root, outputDir, sourceSha) {
  if (!SHA_RE.test(sourceSha)) throw new Error("Invalid source SHA");
  const files = {};
  for (const name of ALLOWED) {
    const data = await readOrdinaryFile(root, name, MAX_BYTES[name]);
    files[name] = { sha256: sha256(data), bytes: data.length };
    const dest = path.join(outputDir, name);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, data, { flag: "wx" });
  }
  await writeFile(
    path.join(outputDir, "manifest.json"),
    `${JSON.stringify({ schemaVersion: 1, sourceSha, files }, null, 2)}\n`,
    { flag: "wx" },
  );
}

export async function verifyAndApplyGeneratedFiles(outputDir, targetDir, sourceSha) {
  if (!SHA_RE.test(sourceSha)) throw new Error("Invalid source SHA");
  const raw = await readOrdinaryFile(outputDir, "manifest.json", 8192);
  const manifest = JSON.parse(raw.toString("utf8"));
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.sourceSha !== sourceSha ||
    !manifest.files ||
    typeof manifest.files !== "object" ||
    JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify([...ALLOWED].sort())
  )
    throw new Error("Generated manifest identity or file list does not match approved PR");
  const validated = [];
  for (const name of ALLOWED) {
    const data = await readOrdinaryFile(outputDir, name, MAX_BYTES[name]);
    const expected = manifest.files[name];
    if (!expected || expected.bytes !== data.length || expected.sha256 !== sha256(data))
      throw new Error(`Artifact hash mismatch: ${name}`);
    await readOrdinaryFile(targetDir, name, MAX_BYTES[name]);
    validated.push({ name, data });
  }
  for (const { name, data } of validated) {
    await writeFile(path.join(targetDir, name), data, { flag: "w" });
  }
}

async function cli() {
  const command = process.argv[2];
  if (command === "create") {
    await exportGeneratedFiles(process.cwd(), requiredEnv("OUTPUT_DIRECTORY"), requiredEnv("SOURCE_SHA"));
  } else if (command === "apply") {
    await verifyAndApplyGeneratedFiles(
      requiredEnv("OUTPUT_DIRECTORY"),
      requiredEnv("TARGET_DIRECTORY"),
      requiredEnv("SOURCE_SHA"),
    );
  } else if (command === "authorize") {
    const event = JSON.parse(await readFile(requiredEnv("GITHUB_EVENT_PATH"), "utf8"));
    const current = JSON.parse(await readFile(path.join(requiredEnv("RUNNER_TEMP"), "renovate-pr.json"), "utf8"));
    const approved = authorizeRenovatePullRequest(event, current, requiredEnv("GITHUB_REPOSITORY"));
    const lines = approved
      ? ["approved=true", `branch=${approved.branch}`, `sha=${approved.sha}`, `number=${approved.number}`]
      : ["approved=false"];
    await writeFile(requiredEnv("GITHUB_OUTPUT"), `${lines.join("\n")}\n`, { flag: "a" });
  } else {
    throw new Error("Usage: renovate-generated-artifacts.mjs create|authorize|apply");
  }
}

function requiredEnv(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing environment ${key}`);
  return v;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await cli();
}
