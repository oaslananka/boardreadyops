import type { DependencyAdvisoryResult } from "@boardreadyops/cloud-core/firmware-advisory-watch";

/**
 * Composes the firmware advisory notification.
 *
 * Pure, and in its own file for the reason `supply-announcement.ts` gives: `worker.ts` builds its
 * stores at module scope from the environment, so nothing inside it can be called from a test —
 * and the message somebody reads on a Monday morning is the whole product of the feature.
 *
 * The rule this file exists to enforce: the message must never imply that the components it does
 * not mention were checked. A firmware bill of materials is mostly unidentifiable today, so a
 * notification naming two CVEs out of forty components has to say that the other thirty-eight
 * were not looked at. See #755 and #804.
 */

/** How many advisories a single notification names before it starts summarising. */
export const announcedAdvisoryLimit = 8;

export type FirmwareAdvisoryAnnouncement = {
  headline: string;
  details: readonly string[];
  /** How many advisories the message is about. */
  advisoryCount: number;
};

export type AdvisoryCoverage = {
  /** Dependencies in the snapshot, identifiable or not. */
  dependencyCount: number;
  /** Dependencies carrying an identifier a database indexes, so actually queried. */
  queried: number;
};

const severityRank: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

function rankOf(severity: string | undefined): number {
  return severity === undefined ? 0 : (severityRank[severity.toUpperCase()] ?? 0);
}

/** Orders by severity, then by identifier, so the message is stable and worst-first. */
function orderedAdvisories(results: readonly DependencyAdvisoryResult[]) {
  return results
    .flatMap((result) => result.advisories.map((advisory) => ({ advisory, dependency: result.dependency })))
    .sort(
      (left, right) =>
        rankOf(right.advisory.severity) - rankOf(left.advisory.severity) ||
        (left.advisory.id < right.advisory.id ? -1 : left.advisory.id > right.advisory.id ? 1 : 0),
    );
}

export function composeFirmwareAdvisoryAnnouncement(
  results: readonly DependencyAdvisoryResult[],
  coverage: AdvisoryCoverage,
): FirmwareAdvisoryAnnouncement | undefined {
  const ordered = orderedAdvisories(results);
  if (ordered.length === 0) return undefined;

  const worst = ordered[0];
  if (!worst) return undefined;

  const lines = ordered.slice(0, announcedAdvisoryLimit).map((entry) => {
    const alias = entry.advisory.aliases.find((value) => value.startsWith("CVE-"));
    // The CVE is what a reader recognises, so it goes first when the database's own id is not one.
    const identifier = alias && alias !== entry.advisory.id ? `${alias} (${entry.advisory.id})` : entry.advisory.id;
    const severity = entry.advisory.severity ? `${entry.advisory.severity} — ` : "";
    return `${severity}${identifier} in ${entry.dependency.name} (${entry.dependency.manifestPath})`;
  });
  if (ordered.length > announcedAdvisoryLimit) {
    lines.push(`…and ${ordered.length - announcedAdvisoryLimit} more advisory/advisories.`);
  }

  const unqueried = Math.max(0, coverage.dependencyCount - coverage.queried);
  if (unqueried > 0) {
    // The most important line in the message. Without it a reader takes two named CVEs as the
    // whole picture, when most of the bill of materials was never searchable at all.
    lines.push(
      `Coverage: ${coverage.queried} of ${coverage.dependencyCount} firmware dependenc(ies) could be looked up. The other ${unqueried} carry no identifier a vulnerability database indexes, so nothing was searched for them.`,
    );
  }

  const unanswered = results.filter((result) => !result.answered).length;
  if (unanswered > 0) {
    // Distinct from the line above: these were searchable and the lookup still did not complete,
    // so "nothing else found" is not something this message can claim.
    lines.push(`${unanswered} lookup(s) did not complete, so this is not a full result for those dependencies.`);
  }

  return { headline: headline(ordered.length, worst), details: lines, advisoryCount: ordered.length };
}

/**
 * States the worst finding and the count, because that is what a reader acts on.
 *
 * "A firmware advisory was found" is a fact nobody schedules around. "CVE-2025-66409 is CRITICAL
 * in idf" is one somebody stops to read.
 */
function headline(
  count: number,
  worst: {
    advisory: { id: string; severity?: string | undefined; aliases: readonly string[] };
    dependency: { name: string };
  },
): string {
  const alias = worst.advisory.aliases.find((value) => value.startsWith("CVE-"));
  const identifier = alias ?? worst.advisory.id;
  const severity = worst.advisory.severity ? `${worst.advisory.severity} ` : "";
  return count === 1
    ? `${severity}${identifier} affects ${worst.dependency.name}`
    : `${count} firmware advisories, worst ${severity}${identifier} in ${worst.dependency.name}`;
}

/** A stable key for the advisory set, so re-reporting the same news deduplicates. */
export function advisoryDedupeKey(results: readonly DependencyAdvisoryResult[]): string {
  return orderedAdvisories(results)
    .map((entry) => `${entry.dependency.name}:${entry.advisory.id}`)
    .join("|");
}
