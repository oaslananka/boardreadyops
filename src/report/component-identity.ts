/**
 * Decides whether a hardware component's identifier means anything to a vulnerability database.
 *
 * The SBOM emits `pkg:generic/<manufacturer>/<mpn>` for every BOM row that declares both fields.
 * That is a syntactically valid PURL and it is a reasonable identity for procurement, but `generic`
 * names no ecosystem, so no advisory database indexes it. Measured against the live OSV API, a
 * `pkg:generic/...` query is accepted and returns `{}` -- no error, and no signal that nothing was
 * searched.
 *
 * So a consumer feeding our SBOM to a scanner gets "no advisories found" for every component and
 * cannot tell that from "checked and clean". This module makes the difference explicit in the
 * document rather than leaving the reader to infer it.
 *
 * Same distinction #768 drew for findings -- measured versus inferred -- and the same one #786 drew
 * for firmware dependencies. Part of #785.
 */

/** PURL types that advisory databases actually index. Anything else is identity only. */
const indexedPurlTypes = new Set([
  "cargo",
  "composer",
  "cran",
  "gem",
  "golang",
  "hackage",
  "hex",
  "maven",
  "npm",
  "nuget",
  "pub",
  "pypi",
  "swift",
]);

export type ComponentIdentityAssessment = {
  /**
   * Whether a "no advisories found" answer for this identifier would mean anything.
   *
   * False for `pkg:generic`: the query returns empty because nothing was searched.
   */
  vulnerabilityIndexed: boolean;
  /**
   * How the identifier was arrived at, in CycloneDX's vocabulary.
   *
   * `manifest-analysis` because it comes from the declared manufacturer and MPN columns of a BOM
   * file, which is what CycloneDX means by the term.
   */
  technique: "manifest-analysis";
  /**
   * CycloneDX identity confidence, 0-1.
   *
   * Deliberately coarse, and not a measurement. 0.5 stands for one thing: two declared text fields
   * were present in the BOM and nothing cross-checked either of them against a registry -- there is
   * no registry for `pkg:generic` to check against. It is the same epistemic class as an
   * `unverified` vendor profile in #754: it advises, it does not assert.
   *
   * A higher number would have to be earned by validating the MPN against a distributor or
   * manufacturer catalogue, which nothing here does yet.
   */
  confidence: 0.5;
};

/**
 * The PURL type, or undefined when the string is not a PURL we can read.
 *
 * Case-insensitive on both scheme and type. The PURL spec treats the type as case-insensitive, and
 * reading leniently costs nothing: everything we emit today we also built, but an identifier that
 * arrives from a config file or a manifest should not be written off as unidentifiable over case.
 */
function purlType(purl: string): string | undefined {
  const match = /^pkg:([^/@#?]+)\//iu.exec(purl.trim());
  return match?.[1]?.toLowerCase();
}

export function assessComponentIdentity(purl: string): ComponentIdentityAssessment {
  const type = purlType(purl);
  return {
    vulnerabilityIndexed: type !== undefined && indexedPurlTypes.has(type),
    technique: "manifest-analysis",
    confidence: 0.5,
  };
}

/** Counts how many of a document's components carry an identifier a database would match. */
export function summariseIndexedIdentifiers(purls: readonly (string | undefined)[]): {
  total: number;
  indexed: number;
} {
  let indexed = 0;
  for (const purl of purls) {
    if (purl !== undefined && assessComponentIdentity(purl).vulnerabilityIndexed) indexed += 1;
  }
  return { total: purls.length, indexed };
}
