import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createAndUploadReport } from "@codecov/bundle-analyzer";

const CONFIG_URL = new URL("../codecov-bundle.json", import.meta.url);

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
  const report = await createAndUploadReport(
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
