import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expectedBinaryAssets } from "./prepare-binary-release-assets.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_ATTEMPTS = 3;
const RELEASE_METADATA_ASSETS = ["SHA256SUMS", "sbom.cyclonedx.json"];

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const options = parseArgs(argv);
  const result = await publishBinaryReleaseAssets({ root, ...options });
  process.stdout.write(
    `${JSON.stringify({ event: "binary_release_assets_published", releaseTag: options.releaseTag, ...result })}\n`,
  );
}

export async function publishBinaryReleaseAssets(options) {
  const root = path.resolve(options.root ?? process.cwd());
  const releaseTag = requireReleaseTag(options.releaseTag);
  const concurrency = positiveInteger(options.concurrency ?? DEFAULT_CONCURRENCY, "concurrency");
  const maxAttempts = positiveInteger(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, "maxAttempts");
  const runGh = options.runGh ?? ((args) => defaultRunGh(args, root));
  const sleep = options.sleep ?? defaultSleep;
  const assets = releaseAssetPaths(root);

  await verifyReleaseAssets(assets);
  await ensureReleaseExists({ releaseTag, runGh, maxAttempts, sleep });

  let nextIndex = 0;
  let active = 0;
  let maximumConcurrency = 0;
  let attempts = 0;

  async function worker() {
    while (nextIndex < assets.length) {
      const asset = assets[nextIndex];
      nextIndex += 1;
      active += 1;
      maximumConcurrency = Math.max(maximumConcurrency, active);
      try {
        const assetAttempts = await uploadAsset({ asset, releaseTag, runGh, maxAttempts, sleep });
        attempts += assetAttempts;
      } finally {
        active -= 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, assets.length) }, () => worker()));
  return { uploaded: assets.length, attempts, maximumConcurrency };
}

export function releaseAssetPaths(root = process.cwd()) {
  const absoluteRoot = path.resolve(root);
  return [
    ...expectedBinaryAssets().map((asset) => path.join(absoluteRoot, "dist/binary", asset)),
    ...RELEASE_METADATA_ASSETS.map((asset) => path.join(absoluteRoot, asset)),
  ];
}

async function ensureReleaseExists({ releaseTag, runGh, maxAttempts, sleep }) {
  try {
    await runGh(["release", "view", releaseTag]);
    return;
  } catch {
    await runWithRetry(`create release ${releaseTag}`, maxAttempts, sleep, async () => {
      try {
        await runGh(["release", "create", releaseTag, "--verify-tag", "--generate-notes", "--title", releaseTag]);
      } catch (createError) {
        try {
          await runGh(["release", "view", releaseTag]);
        } catch {
          throw createError;
        }
      }
    });
  }
}

async function uploadAsset({ asset, releaseTag, runGh, maxAttempts, sleep }) {
  const assetName = path.basename(asset);
  return await runWithRetry(`upload ${assetName}`, maxAttempts, sleep, () =>
    runGh(["release", "upload", releaseTag, asset, "--clobber"]),
  );
}

async function runWithRetry(label, maxAttempts, sleep, operation) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await operation();
      return attempt;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(Math.min(10_000, 1_000 * 2 ** (attempt - 1)));
      }
    }
  }
  throw new Error(`failed to ${label} after ${maxAttempts} attempts`, { cause: lastError });
}

async function verifyReleaseAssets(assets) {
  for (const asset of assets) {
    const assetStat = await stat(asset).catch(() => null);
    if (!assetStat?.isFile() || assetStat.size === 0) {
      throw new Error(`missing non-empty release asset: ${path.basename(asset)}`);
    }
  }
}

async function defaultRunGh(args, root) {
  await execFileAsync("gh", args, {
    cwd: root,
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function defaultSleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--tag") {
      options.releaseTag = readValue(argv, index);
      index += 1;
    } else if (argument.startsWith("--tag=")) {
      options.releaseTag = argument.slice("--tag=".length);
    } else if (argument === "--concurrency") {
      options.concurrency = Number(readValue(argv, index));
      index += 1;
    } else if (argument.startsWith("--concurrency=")) {
      options.concurrency = Number(argument.slice("--concurrency=".length));
    } else if (argument === "--attempts") {
      options.maxAttempts = Number(readValue(argv, index));
      index += 1;
    } else if (argument.startsWith("--attempts=")) {
      options.maxAttempts = Number(argument.slice("--attempts=".length));
    } else {
      throw new Error(`unsupported binary release publish argument: ${argument}`);
    }
  }
  return options;
}

function readValue(argv, index) {
  const value = argv[index + 1];
  if (!value) throw new Error(`missing value for ${argv[index]}`);
  return value;
}

function requireReleaseTag(value) {
  if (typeof value !== "string" || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error("release tag must use v<major>.<minor>.<patch> syntax");
  }
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16) {
    throw new Error(`${name} must be an integer from 1 through 16`);
  }
  return value;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
