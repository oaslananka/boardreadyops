/**
 * Revision and changelog text-processing helpers for the fix subsystem.
 *
 * Extracted from fixes.ts to keep the fix-plan module focused on
 * orchestration rather than text processing.
 */

/**
 * Extract the revision string from a KiCad PCB or schematic file.
 */
export function revisionFromText(text: string): string | undefined {
  return /\(rev\s+"([^"]*)"/.exec(text)?.[1] ?? /\(revision\s+"([^"]*)"/.exec(text)?.[1];
}

/**
 * Coerce an arbitrary revision string to a valid semver string.
 */
export function coerceSemver(revision: string | undefined): string {
  if (!revision) {
    return "0.1.0";
  }
  const parts = [...revision.matchAll(/\d+/g)].map((match) => match[0] ?? "").filter(Boolean);
  if (parts.length === 0) {
    return "0.1.0";
  }
  const [major = "0", minor = "0", patch = "0"] = parts;
  return `${Number(major)}.${Number(minor)}.${Number(patch)}`;
}

/**
 * Set the revision in a KiCad PCB or schematic file.
 */
export function setRevision(text: string, revision: string, rootForm: "kicad_pcb" | "kicad_sch"): string {
  if (/\(rev\s+"[^"]*"/.test(text)) {
    return text.replace(/(\(rev\s+")[^"]*(")/, `$1${revision}$2`);
  }
  if (/\(revision\s+"[^"]*"/.test(text)) {
    return text.replace(/(\(revision\s+")[^"]*(")/, `$1${revision}$2`);
  }
  if (/\(title_block\b/.test(text)) {
    return text.replace(/\(title_block\b/, `(title_block (rev "${revision}")`);
  }
  return text.replace(new RegExp(String.raw`\(${rootForm}\b`), `(${rootForm}\n  (title_block (rev "${revision}"))`);
}

/**
 * Check whether a changelog text already contains an entry for the given revision.
 */
export function changelogHasRevision(text: string, revision: string): boolean {
  const escaped = revision.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(String.raw`^##\s+\[?v?${escaped}\]?\b`, "m").test(text);
}

/**
 * Create a new changelog from scratch for the given revision list.
 */
export function createChangelog(revisions: string[]): string {
  return `# Changelog

${revisions.map(changelogEntry).join("\n")}`;
}

/**
 * Append changelog entries for revisions not yet present.
 */
export function appendChangelogEntries(text: string, revisions: string[]): string {
  const trimmed = text.trimEnd();
  return `${trimmed}\n\n${revisions.map(changelogEntry).join("\n")}`;
}

function changelogEntry(revision: string): string {
  return `## ${revision}

- Hardware release notes scaffolded by boardreadyops fix.
`;
}

/**
 * Compile a regex pattern string safely, returning undefined for invalid input.
 */
export function compilePattern(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

/**
 * Extract a rules config object from a raw value.
 */
export function ruleObjectConfig(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
