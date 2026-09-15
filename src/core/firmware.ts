/**
 * The firmware dependency contract carried on `RunResult`.
 *
 * Lives in core rather than in src/firmware because src/firmware is a leaf layer that only
 * src/rules may import -- see scripts/verify-structure.mjs. `FabricationSnapshot` is placed the
 * same way: the type in core, the capture in src/rules/fabrication-snapshot.ts. Part of #785.
 */

/**
 * Where a dependency comes from, flattened to a string for the report contract.
 *
 * Not exported: only `FirmwareDependencyRecord` names it, and publishing a type for a caller that
 * does not exist is the pattern #752 was written to stop.
 */
type FirmwareDependencyOrigin = "registry" | "git" | "local" | "framework";

export interface FirmwareDependencyRecord {
  /** The manifest key, verbatim, so a report can quote what the file said. */
  name: string;
  /** Manifest path relative to the run root, in POSIX form. */
  manifestPath: string;
  origin: FirmwareDependencyOrigin;
  /** The version expression as written; a range is not collapsed to a version. */
  versionSpec?: string | undefined;
  pinned: boolean;
  /** A PURL a vulnerability database indexes, when one is known. Usually absent. */
  purl?: string | undefined;
  /**
   * A version-exact CPE 2.3 name NVD indexes, when one can be stated.
   *
   * Only ever emitted for a framework the manifest pinned: with the version left open NVD returns
   * 31 CVEs against 2 for 5.2.1 and 0 for 6.1, so a wildcard would over-report six to fifteen
   * times. See #785.
   */
  cpe?: string | undefined;
  /**
   * Whether a "no advisories found" answer about this dependency would mean anything.
   *
   * False is the common and honest case: no identifier is known, so nothing can be searched.
   */
  searchable: boolean;
  /** Where the identifier came from -- an advisory id, a tool, a document. */
  identitySource?: string | undefined;
}

export interface FirmwareSnapshot {
  dependencies: FirmwareDependencyRecord[];
  /** Manifest-level problems worth surfacing, such as a file that is not valid YAML. */
  warnings: string[];
}
