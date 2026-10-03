import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCompressedSize, normalizeOptions, normalizePath, Output } from "@codecov/bundler-plugin-core";
import { glob } from "tinyglobby";

const CONFIG_URL = new URL("../codecov-bundle.json", import.meta.url);
const PLUGIN_NAME = "boardreadyops-bundle-analyzer";
const PLUGIN_VERSION = "1.0.0";

export function buildCodecovBundleOptions({ uploadToken, dryRun = false, config = {} } = {}) {
  const { ignorePatterns = [], normalizeAssetsPattern, ...coreConfig } = config;
  const coreOptions = {
    ...coreConfig,
    apiUrl: "https://api.codecov.io",
    bundleName: "boardreadyops-web",
    dryRun,
    enableBundleAnalysis: true,
  };

  if (uploadToken) {
    coreOptions.uploadToken = uploadToken;
  }

  return {
    coreOptions,
    bundleAnalyzerOptions: {
      ignorePatterns,
      ...(normalizeAssetsPattern ? { normalizeAssetsPattern } : {}),
    },
  };
}

function globIgnorePatterns(patterns) {
  return patterns.flatMap((pattern) => (pattern.includes("/") ? [pattern] : [pattern, `**/${pattern}`]));
}

export async function collectBundleAssets(
  buildDirectoryPaths,
  { ignorePatterns = [], normalizeAssetsPattern = "" } = {},
) {
  const assets = [];
  for (const buildDirectoryPath of buildDirectoryPaths) {
    const absoluteDirectory = path.resolve(buildDirectoryPath);
    const files = await glob("**/*", {
      cwd: absoluteDirectory,
      absolute: true,
      dot: true,
      onlyFiles: true,
      ignore: globIgnorePatterns(ignorePatterns),
    });

    for (const file of files.sort((a, b) => a.localeCompare(b))) {
      const relative = path.relative(absoluteDirectory, file).split(path.sep).join("/");
      const code = await readFile(file);
      assets.push({
        name: relative,
        size: code.byteLength,
        gzipSize: await getCompressedSize({ fileName: relative, code }),
        normalized: normalizePath(relative, normalizeAssetsPattern, "bundle-analyzer"),
      });
    }
  }
  return assets;
}

export async function createAndUploadBundleReport(buildDirectoryPaths, coreOptions, bundleAnalyzerOptions = {}) {
  const normalized = normalizeOptions(coreOptions);
  if (!normalized.success) {
    throw new Error(`Invalid Codecov bundle options: ${normalized.errors.join(" ")}`);
  }

  const output = new Output(normalized.options, { metaFramework: "bundle-analyzer" });
  output.start();
  output.setPlugin(PLUGIN_NAME, PLUGIN_VERSION);
  output.assets = await collectBundleAssets(buildDirectoryPaths, bundleAnalyzerOptions);
  output.chunks = [];
  output.modules = [];
  output.end();

  if (!coreOptions.dryRun) {
    await output.write(true);
  }
  return output.bundleStatsToJson();
}

function writeStdout(value) {
  process.stdout.write(`${value}\n`);
}

export async function runCodecovBundleAnalysis({ env = process.env, stdout = writeStdout } = {}) {
  const config = JSON.parse(await readFile(CONFIG_URL, "utf8"));
  const options = buildCodecovBundleOptions({
    uploadToken: env.CODECOV_TOKEN,
    dryRun: env.CODECOV_BUNDLE_DRY_RUN === "true",
    config,
  });
  const report = await createAndUploadBundleReport(
    ["apps/web/.next/static"],
    options.coreOptions,
    options.bundleAnalyzerOptions,
  );

  if (options.coreOptions.dryRun) {
    stdout(report);
  }

  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runCodecovBundleAnalysis();
}
