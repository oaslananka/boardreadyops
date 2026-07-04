import path from "node:path";
import { pathToFileURL } from "node:url";
import { readPnpmLicenseReport } from "./lib/pnpm-licenses.mjs";

export const allowedLicenses = Object.freeze([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "MPL-2.0",
  "CC0-1.0",
]);

export async function main(root = process.cwd(), options = {}) {
  const rootPackageName = options.packageName ?? "boardreadyops";
  const scopeArgs = options.includeAll ? [] : ["--filter", rootPackageName, options.includeDev ? "--dev" : "--prod"];
  const report = await readPnpmLicenseReport(root, [...scopeArgs, "--json"]);
  const violations = findLicensePolicyViolations(report);

  if (violations.length > 0) {
    throw new Error(formatLicensePolicyViolations(violations));
  }
}

export function findLicensePolicyViolations(report, allowed = allowedLicenses) {
  const allowedSet = new Set(allowed);
  return Object.entries(report)
    .filter(([license]) => !isAllowedLicenseExpression(license, allowedSet))
    .map(([license, packages]) => ({
      license,
      packages: packages.flatMap((item) => packageVersions(item)).sort(compareText),
    }))
    .sort((left, right) => compareText(left.license, right.license));
}

export function isAllowedLicenseExpression(expression, allowedSet = new Set(allowedLicenses)) {
  if (!expression || expression === "Unknown") {
    return false;
  }

  const normalized = expression.replace(/[()]/g, "");
  return normalized
    .split(/\s+OR\s+/)
    .some((choice) => choice.split(/\s+AND\s+/).every((license) => allowedSet.has(license.trim())));
}

export function formatLicensePolicyViolations(violations) {
  return [
    "Disallowed dependency licenses found in distributed dependency scope:",
    ...violations.map((violation) => `- ${violation.license}: ${violation.packages.join(", ")}`),
    "",
    `Allowed licenses: ${allowedLicenses.join(", ")}`,
  ].join("\n");
}

function packageVersions(item) {
  return (item.versions ?? []).map((version) => `${item.name}@${version}`);
}

function compareText(left, right) {
  return left.localeCompare(right, "en", { numeric: true });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main(process.cwd(), {
    includeAll: process.argv.includes("--all"),
    includeDev: process.argv.includes("--dev"),
    packageName: process.argv.find((arg) => arg.startsWith("--package="))?.slice("--package=".length),
  });
}
