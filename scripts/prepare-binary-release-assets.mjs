import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BINARY_TARGETS } from "./build-binary.mjs";

const DEFAULT_BINARY_DIR = "dist/binary";
const DEFAULT_CHECKSUMS_FILE = "SHA256SUMS";

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const options = parseArgs(argv);
  await prepareBinaryReleaseAssets(root, options);
}

export function expectedBinaryAssets(targets = BINARY_TARGETS) {
  return targets.map((target) => target.asset);
}

export async function prepareBinaryReleaseAssets(root = process.cwd(), options = {}) {
  const directory = path.resolve(root, options.directory ?? DEFAULT_BINARY_DIR);
  const checksumsPath = path.resolve(root, options.output ?? DEFAULT_CHECKSUMS_FILE);
  const assets = expectedBinaryAssets();

  await verifyExpectedAssets(directory, assets);
  const content = await checksumContent(directory, assets);

  if (options.check) {
    await assertChecksumFile(checksumsPath, content);
  } else {
    await writeFile(checksumsPath, content);
  }

  return { assets, checksumsPath, content };
}

async function verifyExpectedAssets(directory, assets) {
  for (const asset of assets) {
    const filePath = path.join(directory, asset);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile() || fileStat.size === 0) {
      throw new Error(`Missing non-empty binary release asset: ${asset}`);
    }
  }
}

async function checksumContent(directory, assets) {
  const lines = [];
  for (const asset of assets) {
    const hash = await checksumFile(path.join(directory, asset));
    lines.push(`${hash}  ${asset}`);
  }
  return `${lines.join("\n")}\n`;
}

async function checksumFile(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function assertChecksumFile(checksumsPath, expectedContent) {
  const actualContent = await readFile(checksumsPath, "utf8");
  if (normalizeNewlines(actualContent) !== expectedContent) {
    throw new Error(`${path.basename(checksumsPath)} is stale for binary release assets`);
  }
}

function normalizeNewlines(content) {
  return content.replaceAll("\r\n", "\n");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--check") {
      options.check = true;
    } else if (argument === "--directory") {
      options.directory = readValue(argv, index);
      index += 1;
    } else if (argument.startsWith("--directory=")) {
      options.directory = argument.slice("--directory=".length);
    } else if (argument === "--output") {
      options.output = readValue(argv, index);
      index += 1;
    } else if (argument.startsWith("--output=")) {
      options.output = argument.slice("--output=".length);
    } else {
      throw new Error(`Unsupported binary release asset argument: ${argument}`);
    }
  }
  return options;
}

function readValue(argv, index) {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${argv[index]}`);
  }
  return value;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
