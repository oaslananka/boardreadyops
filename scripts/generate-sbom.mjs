import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as yaml from "js-yaml";

const OUTPUT_FILE = "sbom.cyclonedx.json";

export async function main(root = process.cwd()) {
  const [packageJsonRaw, lockfileRaw] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, "pnpm-lock.yaml"), "utf8"),
  ]);
  const bom = createCycloneDxBom({
    packageJson: JSON.parse(packageJsonRaw),
    lockfile: yaml.load(lockfileRaw),
    timestamp: new Date().toISOString(),
    serialNumber: `urn:uuid:${randomUUID()}`,
  });

  await writeFile(path.join(root, OUTPUT_FILE), `${JSON.stringify(bom, null, 2)}\n`);
}

export function createCycloneDxBom({ packageJson, lockfile, timestamp, serialNumber }) {
  const rootComponent = packageComponent(packageJson.name, packageJson.version, "application");
  const importer = lockfile?.importers?.["."] ?? {};
  const snapshots = lockfile?.snapshots ?? {};
  const directDependencies = rootDependencyEntries(importer);
  const packageIdentities = lockfilePackageIdentities(lockfile?.packages);
  const componentIdentities = packageIdentities.length > 0 ? packageIdentities : directDependencies;
  const scopeByRef = dependencyScopeByRef(directDependencies, snapshots);
  const components = componentIdentities.map((identity) =>
    packageComponent(identity.name, identity.version, "library", scopeByRef.get(identity.ref) ?? "optional"),
  );
  const componentRefs = new Set(components.map((component) => component["bom-ref"]));

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber,
    version: 1,
    metadata: {
      timestamp,
      tools: {
        components: [
          {
            type: "application",
            name: "boardreadyops-sbom-generator",
            version: packageJson.version,
          },
        ],
      },
      component: rootComponent,
    },
    components,
    dependencies: [
      {
        ref: rootComponent["bom-ref"],
        dependsOn: directDependencies
          .map((dependency) => dependency.ref)
          .filter((dependencyRef) => componentRefs.has(dependencyRef)),
      },
    ].concat(
      componentIdentities.map((identity) => ({
        ref: identity.ref,
        dependsOn: snapshotDependencyRefs(snapshots, identity, componentRefs),
      })),
    ),
  };
}

function rootDependencyEntries(importer = {}) {
  return [
    ...dependencyEntriesFromLockEntries("required", importer.dependencies),
    ...dependencyEntriesFromLockEntries("optional", importer.devDependencies),
    ...dependencyEntriesFromLockEntries("optional", importer.optionalDependencies),
  ];
}

function dependencyEntriesFromLockEntries(scope, entries = {}) {
  return Object.entries(entries).map(([name, metadata]) =>
    dependencyIdentity(name, resolvedRawVersion(metadata), scope),
  );
}

function lockfilePackageIdentities(packages = {}) {
  return Object.keys(packages).map(packageIdentityFromLockKey).filter(Boolean);
}

function packageIdentityFromLockKey(key) {
  const versionSeparator = packageKeyVersionSeparator(key);
  if (versionSeparator <= 0) {
    return undefined;
  }

  return dependencyIdentity(key.slice(0, versionSeparator), key.slice(versionSeparator + 1));
}

function packageKeyVersionSeparator(key) {
  if (!key.startsWith("@")) {
    return key.indexOf("@");
  }

  const packageNameSeparator = key.indexOf("/");
  if (packageNameSeparator === -1) {
    return -1;
  }
  return key.indexOf("@", packageNameSeparator);
}

function dependencyScopeByRef(rootDependencies, snapshots) {
  const scopeByRef = new Map();
  const queue = rootDependencies.slice();

  for (const dependency of rootDependencies) {
    setDependencyScope(scopeByRef, dependency.ref, dependency.scope);
  }

  while (queue.length > 0) {
    const dependency = queue.shift();
    const nextScope = dependency.scope === "required" ? "required" : "optional";
    for (const child of snapshotDependencyEntriesForIdentity(snapshots, dependency, nextScope)) {
      if (setDependencyScope(scopeByRef, child.ref, child.scope)) {
        queue.push(child);
      }
    }
  }

  return scopeByRef;
}

function setDependencyScope(scopeByRef, ref, scope) {
  const currentScope = scopeByRef.get(ref);
  if (currentScope === "required" || currentScope === scope) {
    return false;
  }

  scopeByRef.set(ref, scope);
  return true;
}

function snapshotDependencyRefs(snapshots, identity, componentRefs) {
  const dependencyRefs = snapshotDependencyEntriesForIdentity(snapshots, identity, "required").map(
    (dependency) => dependency.ref,
  );
  return [...new Set(dependencyRefs)].filter((dependencyRef) => componentRefs.has(dependencyRef));
}

function snapshotDependencyEntriesForIdentity(snapshots, identity, scope) {
  return snapshotEntriesForIdentity(snapshots, identity).flatMap((snapshot) =>
    snapshotDependencyEntries(scope, snapshot),
  );
}

function snapshotEntriesForIdentity(snapshots, identity) {
  const exactSnapshot = snapshots[identity.key] ? [snapshots[identity.key]] : [];
  const peerQualifiedSnapshots = Object.entries(snapshots)
    .filter(([key]) => key !== identity.key && packageIdentityFromLockKey(key)?.ref === identity.ref)
    .map(([, snapshot]) => snapshot);

  return exactSnapshot.concat(peerQualifiedSnapshots);
}

function snapshotDependencyEntries(scope, snapshot = {}) {
  return [
    ...dependencyEntriesFromLockEntries(scope, snapshot.dependencies),
    ...dependencyEntriesFromLockEntries("optional", snapshot.optionalDependencies),
  ];
}

function dependencyIdentity(name, rawVersion, scope) {
  const version = stripPeerSuffix(rawVersion);
  return {
    name,
    version,
    key: `${name}@${rawVersion}`,
    ref: packagePurl(name, version),
    scope,
  };
}

function packageComponent(packageName, version, type, scope) {
  const parsed = parsePackageName(packageName);
  const purl = packagePurl(packageName, version);
  const component = {
    type,
    name: parsed.name,
    version,
    purl,
    "bom-ref": purl,
  };

  if (parsed.group) {
    component.group = parsed.group;
  }
  if (scope) {
    component.scope = scope;
  }

  return component;
}

function parsePackageName(packageName) {
  if (packageName.startsWith("@")) {
    const [group, name] = packageName.slice(1).split("/");
    return { group, name };
  }
  return { name: packageName };
}

function packagePurl(packageName, version) {
  if (packageName.startsWith("@")) {
    const [group, name] = packageName.slice(1).split("/");
    return `pkg:npm/%40${encodeURIComponent(group)}/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`;
}

function resolvedRawVersion(metadata) {
  if (typeof metadata === "string") {
    return metadata;
  }
  return metadata?.version ?? metadata?.specifier ?? "0.0.0";
}

function stripPeerSuffix(version) {
  return String(version).split("(")[0];
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
