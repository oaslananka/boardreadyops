import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as yaml from "js-yaml";
import { createCycloneDxBom } from "./generate-sbom.mjs";

// Each step validates the complete lockfile, never selectively drops CVEs.
function mapPackages(components) {
  const resolved = {};
  for (const component of components) {
    const purl = component.purl;
    if (typeof purl !== "string" || !purl.startsWith("pkg:npm/") || !component.version) {
      throw new Error("Unrecognized dependency identity");
    }
    if (Object.hasOwn(resolved, purl)) throw new Error("Duplicate dependency identity");
    resolved[purl] = {
      package_url: purl,
      relationship: "indirect",
      scope: component.scope === "required" ? "runtime" : "development",
      dependencies: [],
    };
  }
  return resolved;
}

function linkDependencyGraph(resolved, dependencies, rootRef) {
  for (const node of dependencies) {
    const children = node.dependsOn ?? [];
    for (const child of children) {
      if (!resolved[child]) throw new Error("Dependency graph child is missing");
    }
    if (node.ref === rootRef) {
      for (const child of children) resolved[child].relationship = "direct";
    } else if (resolved[node.ref]) {
      resolved[node.ref].dependencies = [...new Set(children)];
    } else {
      throw new Error("Dependency graph parent is missing");
    }
  }
}

export function snapshotFromResolvedBom(bom, { sha, ref, scanned, runId }) {
  if (!/^[0-9a-f]{40}$/u.test(sha) || !/^refs\/heads\/[A-Za-z0-9/_-]+$/u.test(ref)) {
    throw new Error("Dependency submission requires a commit SHA and branch ref");
  }
  const resolved = mapPackages(bom.components ?? []);
  linkDependencyGraph(resolved, bom.dependencies ?? [], bom.metadata?.component?.["bom-ref"]);
  if (Object.keys(resolved).length < 100) throw new Error("Incomplete dependency snapshot");
  return {
    version: 0,
    sha,
    ref,
    job: { id: String(runId), correlator: "security / dependency-graph / pnpm-lock.yaml" },
    detector: {
      name: "boardreadyops-pnpm-lock",
      version: "1.0.0",
      url: "https://github.com/oaslananka/boardreadyops",
    },
    scanned,
    manifests: {
      "pnpm-lock.yaml": {
        name: "pnpm-lock.yaml",
        file: { source_location: "pnpm-lock.yaml" },
        resolved,
      },
    },
  };
}

export async function buildSnapshot({ cwd = process.cwd(), sha, ref, runId, scanned = new Date().toISOString() }) {
  const [packageRaw, lockRaw] = await Promise.all([
    readFile(path.join(cwd, "package.json"), "utf8"),
    readFile(path.join(cwd, "pnpm-lock.yaml"), "utf8"),
  ]);
  const bom = createCycloneDxBom({
    packageJson: JSON.parse(packageRaw),
    lockfile: yaml.load(lockRaw),
    timestamp: scanned,
    serialNumber: "urn:uuid:00000000-0000-4000-8000-000000000001",
  });
  return snapshotFromResolvedBom(bom, { sha, ref, scanned, runId });
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  const sha = process.env.GITHUB_SHA;
  const ref = process.env.GITHUB_REF;
  const runId = process.env.GITHUB_RUN_ID;
  if (!repository || !token || !sha || !ref || !runId || !/^[\w.-]+\/[\w.-]+$/u.test(repository)) {
    throw new Error("Refusing graph submission outside a trusted GitHub Actions environment");
  }
  const payload = await buildSnapshot({ sha, ref, runId });
  const response = await fetch(`https://api.github.com/repos/${repository}/dependency-graph/snapshots`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45000),
  });
  if (response.status !== 201) throw new Error(`Dependency graph submission HTTP ${response.status}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) await main();
