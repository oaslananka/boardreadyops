import type { IdfDependency } from "./idf-manifest.js";

/**
 * Resolves whether a firmware dependency has an identifier a vulnerability database will match.
 *
 * This is a curated mapping, not a derivation, and the difference is the whole point. Measured
 * against the live OSV API:
 *
 *   pkg:generic/espressif/led_strip@2.4.1        -> {}        (accepted, matched nothing)
 *   pkg:github/espressif/esp-idf@v5.2            -> 0 vulns
 *   pkg:git/github.com/mcu-tools/mcuboot@v2.0.0  -> 0 vulns
 *   pkg:npm/lodash@4.17.15                       -> 6 vulns   (control: the query shape is right)
 *
 * So a constructed PURL is accepted and returns empty, with no error and no signal that nothing
 * was searched. An implementation that derived identifiers and reported "no advisories found"
 * would issue a clean bill for components it never looked up -- and somebody files that with a
 * regulator.
 *
 * Worse, the identifier a database indexes a component under is not guessable. MCUboot is a C
 * bootloader; CVE-2024-32883 affects it; OSV carries it only as
 * `pkg:golang/github.com/mcu-tools/mcuboot`, under the Go ecosystem, because that is who filed
 * the advisory. No derivation from a manifest produces that.
 *
 * Hence: `unidentified` is the default and the common case, and every mapping carries where it
 * came from. Same discipline as the vendor profiles in #754 -- an unverified entry advises, it
 * never asserts a clean bill. See #785.
 */

/**
 * How a mapping entry came to exist, which decides how much it can carry.
 *
 * Not exported yet: only `ComponentIdentity` and the mapping table name it. Export it when a
 * consumer needs to branch on the value.
 */
type IdentityEvidence =
  /** A person confirmed this component is indexed under this identifier on `verifiedAt`. */
  | "verified"
  /** Recorded from a published advisory or SBOM tool, not independently confirmed. */
  | "reported"
  /** No identifier is known. The component is not vulnerability-indexed as far as we can tell. */
  | "unidentified";

export type ComponentIdentity = {
  /** A PURL whose type a vulnerability database indexes, or undefined when none is known. */
  purl?: string | undefined;
  evidence: IdentityEvidence;
  /** Where the mapping came from: an advisory id, a tool, a document. */
  source?: string | undefined;
  /** ISO date a person last confirmed it. */
  verifiedAt?: string | undefined;
  /**
   * Whether a "no advisories found" result for this component means anything.
   *
   * False for an unidentified component: the query returns empty because nothing was searched,
   * not because the component is clean. A report must never present the two the same way.
   */
  searchable: boolean;
};

type MappingEntry = {
  /** Matches a registry dependency as `namespace/name`, or a git URL, case-insensitively. */
  match: string;
  purl: string;
  evidence: Exclude<IdentityEvidence, "unidentified">;
  source: string;
  verifiedAt?: string | undefined;
};

/**
 * The seed. Deliberately tiny.
 *
 * One entry, because one is what could be confirmed by querying OSV rather than by assuming.
 * A long table of plausible mappings would be worse than a short table of real ones: every wrong
 * entry produces a confident empty result for a component that is actually unsearchable.
 *
 * Growing this is data work with a person attached, not a code change.
 */
const mappings: readonly MappingEntry[] = [
  {
    match: "https://github.com/mcu-tools/mcuboot",
    purl: "pkg:golang/github.com/mcu-tools/mcuboot",
    evidence: "reported",
    // Confirmed present by querying the OSV API for this advisory; the alias is the CVE.
    source: "OSV GO-2024-2799 (CVE-2024-32883)",
  },
];

function normalise(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.git$/u, "")
    .replace(/\/+$/u, "");
}

function candidateKeys(dependency: IdfDependency): string[] {
  const source = dependency.source;
  if (source.kind === "registry") return [`${source.namespace}/${source.name}`];
  if (source.kind === "git") return [source.url];
  return [];
}

/**
 * The identifier for one dependency.
 *
 * Local and framework dependencies are never looked up. Local source is first-party code, not a
 * third-party component with advisories; and the framework is a different kind of thing from a
 * component, tracked by CPE rather than PURL, which this does not yet cover.
 */
export function resolveComponentIdentity(dependency: IdfDependency): ComponentIdentity {
  if (dependency.source.kind === "local" || dependency.source.kind === "framework") {
    return { evidence: "unidentified", searchable: false };
  }

  const keys = candidateKeys(dependency).map(normalise);
  const entry = mappings.find((mapping) => keys.includes(normalise(mapping.match)));
  if (!entry) return { evidence: "unidentified", searchable: false };

  const versioned =
    dependency.pinned && dependency.versionSpec ? `${entry.purl}@${dependency.versionSpec.trim()}` : entry.purl;
  return {
    purl: versioned,
    evidence: entry.evidence,
    source: entry.source,
    ...(entry.verifiedAt ? { verifiedAt: entry.verifiedAt } : {}),
    // A known identifier is searchable even where the version is a range: the query then asks
    // about the package rather than one release, which is a weaker but real answer.
    searchable: true,
  };
}

export type IdentitySummary = {
  total: number;
  searchable: number;
  unidentified: number;
  /** Declared names with no known identifier, so a report can list what was not looked up. */
  unidentifiedNames: readonly string[];
};

/**
 * Counts what could and could not be looked up.
 *
 * `unidentified` being the large number is the expected and honest outcome today. A summary that
 * showed everything searchable would mean the mapping had started guessing.
 */
export function summariseIdentities(dependencies: readonly IdfDependency[]): IdentitySummary {
  const unidentifiedNames: string[] = [];
  let searchable = 0;

  for (const dependency of dependencies) {
    if (resolveComponentIdentity(dependency).searchable) searchable += 1;
    else unidentifiedNames.push(dependency.declaredName);
  }

  return {
    total: dependencies.length,
    searchable,
    unidentified: unidentifiedNames.length,
    unidentifiedNames: unidentifiedNames.sort((a, b) => a.localeCompare(b)),
  };
}
