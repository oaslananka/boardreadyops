import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as yaml from "js-yaml";
import { readPnpmLicenseReport } from "./lib/pnpm-licenses.mjs";

const OUTPUT_FILE = "NOTICE";
const HOST_NATIVE_PACKAGE_PATTERNS = Object.freeze([
  /^@biomejs\/cli-/,
  /^@esbuild\//,
  /^@oxc-parser\/binding-/,
  /^@oxc-resolver\/binding-/,
  /^@rolldown\/binding-/,
  /^lightningcss-/,
]);

export async function main(root = process.cwd(), options = {}) {
  const readReport = options.readReport ?? ((reportRoot) => readPnpmLicenseReport(reportRoot, ["--json"]));
  const report = await readReport(root);
  const excludedPackageVersions = options.excludedPackageVersions ?? readPlatformOnlyPackageVersions(root);
  const notice = renderNotice(report, excludedPackageVersions);
  const noticePath = path.join(root, OUTPUT_FILE);

  if (options.check) {
    const current = await readFile(noticePath, "utf8");
    if (current !== notice) {
      throw new Error(noticeDriftMessage(current, notice));
    }
    return;
  }

  await writeFile(noticePath, notice);
}

export function readPlatformOnlyPackageVersions(root) {
  const lockfile = yaml.load(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"));
  return platformOnlyPackageVersionsFromLockfile(lockfile);
}

export function platformOnlyPackageVersionsFromLockfile(lockfile) {
  const packages = lockfile?.packages ?? {};
  const snapshots = lockfile?.snapshots ?? {};
  const constrainedBaseKeys = new Set(
    Object.entries(packages)
      .filter(([, metadata]) => hasPlatformConstraint(metadata))
      .map(([key]) => packageBaseKey(key))
      .filter(Boolean),
  );
  const roots = importerDependencyKeys(lockfile?.importers ?? {});
  const allReachable = traverseSnapshots(roots, snapshots, constrainedBaseKeys, false);
  const portableReachable = traverseSnapshots(roots, snapshots, constrainedBaseKeys, true);

  return new Set(
    [...allReachable]
      .filter((key) => !portableReachable.has(key))
      .map(packageBaseKey)
      .filter(Boolean),
  );
}

function hasPlatformConstraint(metadata) {
  return Boolean(metadata && (metadata.os !== undefined || metadata.cpu !== undefined));
}

function importerDependencyKeys(importers) {
  const keys = [];
  for (const importer of Object.values(importers)) {
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, entry] of Object.entries(importer?.[field] ?? {})) {
        const version = typeof entry === "string" ? entry : entry?.version;
        const key = dependencySnapshotKey(name, version);
        if (key) {
          keys.push(key);
        }
      }
    }
  }
  return keys;
}

function dependencySnapshotKey(name, version) {
  if (typeof version !== "string" || version.startsWith("link:") || version.startsWith("workspace:")) {
    return null;
  }
  return `${name}@${version}`;
}

function traverseSnapshots(roots, snapshots, constrainedBaseKeys, stopAtConstrained) {
  const visited = new Set();
  const stack = [...roots];

  while (stack.length > 0) {
    const key = stack.pop();
    if (!key || visited.has(key)) {
      continue;
    }
    const baseKey = packageBaseKey(key);
    if (stopAtConstrained && baseKey && constrainedBaseKeys.has(baseKey)) {
      continue;
    }
    visited.add(key);
    const snapshot = snapshots[key];
    if (!snapshot) {
      continue;
    }
    for (const field of ["dependencies", "optionalDependencies"]) {
      for (const [name, version] of Object.entries(snapshot[field] ?? {})) {
        const dependencyKey = dependencySnapshotKey(name, version);
        if (dependencyKey) {
          stack.push(dependencyKey);
        }
      }
    }
  }

  return visited;
}

function packageBaseKey(key) {
  const parsed = splitPackageKey(key);
  return parsed ? `${parsed.name}@${parsed.version}` : null;
}

function splitPackageKey(key) {
  if (typeof key !== "string") {
    return null;
  }
  const delimiter = key.startsWith("@") ? key.indexOf("@", key.indexOf("/") + 1) : key.indexOf("@");
  if (delimiter <= 0) {
    return null;
  }
  const name = key.slice(0, delimiter);
  const version = key.slice(delimiter + 1).split("(", 1)[0];
  return version ? { name, version } : null;
}

function noticeDriftMessage(current, expected) {
  const currentEntries = packageEntries(current);
  const expectedEntries = packageEntries(expected);
  const expectedSet = new Set(expectedEntries);
  const currentSet = new Set(currentEntries);
  const changes = [
    ...currentEntries.filter((entry) => !expectedSet.has(entry)).map((entry) => `- removed: ${entry}`),
    ...expectedEntries.filter((entry) => !currentSet.has(entry)).map((entry) => `- added: ${entry}`),
  ];
  const details = changes.length > 0 ? `\nChanged package entries:\n${changes.join("\n")}` : "";
  return `NOTICE is out of date. Run \`corepack pnpm run notice\`.${details}`;
}

function packageEntries(notice) {
  return notice
    .split("\n")
    .filter((line) => line.startsWith("- `"))
    .map((line) => line.slice(2));
}

export function renderNotice(report, excludedPackageVersions = new Set()) {
  const sections = licenseSections(report, excludedPackageVersions);
  const lines = [
    "# BoardReadyOps Third-Party Notices",
    "",
    "BoardReadyOps itself is licensed under MIT; see `LICENSE`.",
    "",
    "Generated from `pnpm licenses list --json`.",
    "Do not edit this file by hand; run `corepack pnpm run notice`.",
    "",
    "## KiCad Container Image",
    "",
    "Container image redistributes KiCad under GPL terms.",
    "The image preserves the KiCad package license text at `/usr/share/doc/boardreadyops/LICENSE-KICAD` and the package notices under `/usr/share/doc/kicad/`.",
    "",
    "## npm Dependency Notices",
    "",
  ];

  if (sections.length === 0) {
    lines.push("No npm dependency license notices were reported by pnpm.", "");
    return finalizeNotice(lines);
  }

  for (const section of sections) {
    lines.push(`## ${section.license}`, "");
    for (const item of section.packages) {
      lines.push(`- ${packageVersions(item)}`);
      if (item.description) {
        lines.push(`  - Description: ${item.description.trim()}`);
      }
      if (item.homepage) {
        lines.push(`  - Homepage: ${item.homepage.trim()}`);
      }
    }
    lines.push("");
  }

  return finalizeNotice(lines);
}

function finalizeNotice(lines) {
  return `${lines.join("\n").trimEnd()}\n`;
}
function licenseSections(report, excludedPackageVersions) {
  return Object.entries(report)
    .map(([license, packages]) => ({
      license,
      packages: packages
        .filter((item) => !isHostNativePackage(item.name))
        .map((item) => ({
          ...item,
          versions: [...(item.versions ?? [])]
            .filter((version) => !excludedPackageVersions.has(`${item.name}@${version}`))
            .sort(compareText),
        }))
        .filter((item) => item.versions.length > 0)
        .sort(
          (left, right) =>
            compareText(left.name, right.name) || compareText(left.versions[0] ?? "", right.versions[0] ?? ""),
        ),
    }))
    .filter((section) => section.packages.length > 0)
    .sort((left, right) => compareText(left.license, right.license));
}

function isHostNativePackage(name) {
  return HOST_NATIVE_PACKAGE_PATTERNS.some((pattern) => pattern.test(name));
}

function packageVersions(item) {
  return (item.versions ?? []).map((version) => `\`${item.name}@${version}\``).join(", ");
}

function compareText(left, right) {
  return left.localeCompare(right, "en", { numeric: true });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main(process.cwd(), { check: process.argv.includes("--check") });
}
