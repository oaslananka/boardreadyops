import * as yaml from "js-yaml";

/**
 * Reads the dependency list out of an ESP-IDF `idf_component.yml`.
 *
 * The firmware adapters in this directory do not do this. Every one of them -- zephyr, esp-idf,
 * platformio, stm32cubemx, arduino -- calls `loadYamlPinContract`, which reads a BoardReadyOps
 * pin-contract file. The ecosystem name is a label on the adapter, not a parser for that
 * ecosystem, and nothing in this repository has ever read a dependency manifest. See #785.
 *
 * ESP-IDF first because it is one documented format with one file, and Espressif publishes its
 * own SBOM tool for it, so there is prior art to check against.
 *
 * What this deliberately does not do is guess a package identifier. `pkg:generic/...`,
 * `pkg:github/...` and `pkg:git/...` are all accepted by OSV and all return an empty result --
 * no error, no signal that nothing was searched. A dependency whose identifier is unknown is
 * recorded as unknown here, and identity is resolved separately against a curated mapping.
 */

/**
 * Where a dependency comes from, which is the only thing the manifest reliably states.
 *
 * Not exported: only `IdfDependency` names it. Publishing a type for a caller that does not
 * exist is the pattern #752 was written to stop.
 */
type IdfDependencySource =
  /** The ESP Component Registry, namespaced `espressif/led_strip` or bare `led_strip`. */
  | { kind: "registry"; namespace: string; name: string; registryUrl?: string | undefined }
  /** A git remote, optionally a subdirectory of it. */
  | { kind: "git"; url: string; path?: string | undefined }
  /** First-party source in the tree. Not a third-party dependency and not advisory-tracked. */
  | { kind: "local"; path: string }
  /** The framework itself, which is a different kind of thing from a component. */
  | { kind: "framework" };

export type IdfDependency = {
  /** The manifest key, verbatim, so a report can quote what the file said. */
  declaredName: string;
  source: IdfDependencySource;
  /**
   * The version expression as written. Kept as text on purpose: `^2.4.1` and `2.4.1` are
   * different claims, and collapsing a range to a version would invent precision the manifest
   * does not have. Undefined when the manifest states none.
   */
  versionSpec?: string | undefined;
  /** True when the version expression pins one version rather than allowing a range. */
  pinned: boolean;
};

export type IdfManifest = {
  /** The component's own name, when the manifest declares one. */
  name?: string | undefined;
  version?: string | undefined;
  dependencies: readonly IdfDependency[];
  warnings: readonly string[];
};

const defaultNamespace = "espressif";

/** A spec that names exactly one version, as opposed to a range or a wildcard. */
function isPinned(spec: string | undefined): boolean {
  if (!spec) return false;
  const trimmed = spec.trim();
  if (!trimmed || trimmed === "*") return false;
  // `^`, `~`, `>`, `<`, `>=`, `<=`, `!=`, a comma-separated set, or a bare `x` placeholder all
  // describe more than one acceptable version.
  if (/[\^~><!*,|]/u.test(trimmed)) return false;
  if (/(^|\.)x($|\.)/iu.test(trimmed)) return false;
  return /^=?\s*\d+(\.\d+)*([.-][0-9A-Za-z.-]+)?$/u.test(trimmed);
}

function registrySource(key: string, registryUrl: string | undefined): IdfDependencySource {
  const slash = key.indexOf("/");
  // A bare key is in the default namespace; the docs are explicit that it is `espressif`.
  const namespace = slash === -1 ? defaultNamespace : key.slice(0, slash);
  const name = slash === -1 ? key : key.slice(slash + 1);
  return registryUrl === undefined
    ? { kind: "registry", namespace, name }
    : { kind: "registry", namespace, name, registryUrl };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function dependencyFrom(key: string, value: unknown, warnings: string[]): IdfDependency | undefined {
  if (key === "idf") {
    const spec = typeof value === "string" ? value : stringField((value as Record<string, unknown>)?.version);
    return { declaredName: key, source: { kind: "framework" }, versionSpec: spec, pinned: isPinned(spec) };
  }

  // The short form is `name: "<version spec>"`.
  if (typeof value === "string") {
    return { declaredName: key, source: registrySource(key, undefined), versionSpec: value, pinned: isPinned(value) };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    warnings.push(`Dependency "${key}" is neither a version string nor a table; skipped.`);
    return undefined;
  }

  const table = value as Record<string, unknown>;
  const versionSpec = stringField(table.version);
  const git = stringField(table.git);
  const path = stringField(table.path);
  const overridePath = stringField(table.override_path);

  if (git) {
    const subPath = path;
    return {
      declaredName: key,
      source: subPath === undefined ? { kind: "git", url: git } : { kind: "git", url: git, path: subPath },
      versionSpec,
      pinned: isPinned(versionSpec),
    };
  }

  // `override_path` replaces a registry component with local source, so what is actually built is
  // local -- recording it as a registry dependency would attribute advisories to code that is not
  // in the build.
  if (overridePath) {
    warnings.push(`Dependency "${key}" is overridden by local source at "${overridePath}".`);
    return { declaredName: key, source: { kind: "local", path: overridePath }, versionSpec, pinned: false };
  }

  if (path) {
    return { declaredName: key, source: { kind: "local", path }, versionSpec, pinned: false };
  }

  return {
    declaredName: key,
    source: registrySource(key, stringField(table.registry_url)),
    versionSpec,
    pinned: isPinned(versionSpec),
  };
}

export function parseIdfManifest(content: string, path?: string): IdfManifest {
  const warnings: string[] = [];
  let document: unknown;
  try {
    document = yaml.load(content);
  } catch (error) {
    return {
      dependencies: [],
      warnings: [
        `${path ?? "idf_component.yml"} is not valid YAML: ${error instanceof Error ? error.message : "unknown"}`,
      ],
    };
  }

  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    return { dependencies: [], warnings: [`${path ?? "idf_component.yml"} does not contain a mapping.`] };
  }

  const root = document as Record<string, unknown>;
  const raw = root.dependencies;
  if (raw === undefined) {
    // A manifest with no dependencies is normal and is not a problem to report.
    return {
      ...(stringField(root.name) ? { name: stringField(root.name) } : {}),
      ...(stringField(root.version) ? { version: stringField(root.version) } : {}),
      dependencies: [],
      warnings,
    };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      dependencies: [],
      warnings: [`${path ?? "idf_component.yml"} has a "dependencies" key that is not a mapping.`],
    };
  }

  const dependencies: IdfDependency[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    // `rules` is a conditional block, not a dependency.
    if (key === "rules") continue;
    const dependency = dependencyFrom(key, value, warnings);
    if (dependency) dependencies.push(dependency);
  }

  return {
    ...(stringField(root.name) ? { name: stringField(root.name) } : {}),
    ...(stringField(root.version) ? { version: stringField(root.version) } : {}),
    dependencies: dependencies.sort((a, b) => a.declaredName.localeCompare(b.declaredName)),
    warnings,
  };
}
