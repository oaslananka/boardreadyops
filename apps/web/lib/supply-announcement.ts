import type { RiskyComponentFinding } from "@boardreadyops/cloud-core/supply-watch";
import type { AffectedBoard, AffectedBoardsResult } from "@boardreadyops/db/affected-boards-store";
import { customerStatusLabel } from "./customer-nomenclature.js";

/**
 * Composes the supply-watch notification.
 *
 * Extracted from `worker.ts` because that file creates its stores at module scope from the
 * environment, so nothing inside it can be called from a test. The message a customer reads on a
 * Monday morning is the whole product of this feature, and it was the one part with no coverage.
 * The worker keeps the I/O; everything decided here is pure.
 *
 * See #449 and #755, and #752 for why "it is in a script so it cannot be tested" is not a reason
 * to leave it untested.
 */

/** How many affected boards a single notification names before it starts summarising. */
export const announcedBoardLimit = 6;

export type SupplyAnnouncement = {
  headline: string;
  details: readonly string[];
  /** Repository identity for the event, or undefined when nothing resolved one. */
  repositoryFullName: string | undefined;
  /** Boards still carrying the part in the revision the team currently builds. */
  stillBuilt: number;
};

type AnnouncedBoard = Pick<AffectedBoard, "displayName" | "repositoryFullName" | "inCurrentRevision" | "releaseMode">;

type SupplyReleaseMode = NonNullable<AnnouncedBoard["releaseMode"]>;

const releaseModeRank: Readonly<Record<SupplyReleaseMode, number>> = {
  prototype: 0,
  pilot: 1,
  production: 2,
};

function policyImpactLine(boards: readonly AnnouncedBoard[], affectedReleaseRunCount: number): string | undefined {
  const current = boards.filter((board) => board.inCurrentRevision);
  if (current.length === 0) {
    return affectedReleaseRunCount > 0
      ? "Policy impact: no current-revision product is affected; this risk remains historical release evidence."
      : undefined;
  }

  const modes = current
    .flatMap((board) => (board.releaseMode ? [board.releaseMode] : []))
    .sort((left, right) => releaseModeRank[right] - releaseModeRank[left]);
  const mode = modes[0];
  if (!mode) {
    return "Policy impact: current-revision hardware is affected, but release criticality was not recorded for this snapshot.";
  }
  if (mode === "production") {
    return "Policy impact: current production-mode hardware is affected; review this supply risk before the next production release.";
  }
  if (mode === "pilot") {
    return "Policy impact: current pilot-mode hardware is affected; review this supply risk before the next pilot release.";
  }
  return "Policy impact: current prototype-mode hardware is affected; account for this supply risk before the next prototype build.";
}

export function composeSupplyAnnouncement(
  parts: readonly RiskyComponentFinding[],
  affected: {
    boards: readonly AnnouncedBoard[];
    affectedReleaseRunCount: number;
    truncated: boolean;
  },
): SupplyAnnouncement | undefined {
  const sorted = [...parts].sort((a, b) => a.mpn.localeCompare(b.mpn));
  const worst = sorted.find((part) => part.severity === "critical") ?? sorted[0];
  if (!worst) return undefined;

  const stillBuilt = affected.boards.filter((board) => board.inCurrentRevision).length;
  const partLines = sorted.map(
    (part) =>
      `${part.mpn}${part.reference ? ` (${part.reference})` : ""} — ${part.status.toUpperCase()}, ${part.severity} risk · Source: ${customerStatusLabel(part.source)}`,
  );

  const boardLines = affected.boards.slice(0, announcedBoardLimit).map((board) => {
    const revision = board.inCurrentRevision ? "current revision" : "an earlier revision only";
    const mode = board.releaseMode ? ` · ${board.releaseMode} mode` : "";
    return `${board.displayName} (${board.repositoryFullName}) — ${revision}${mode}`;
  });
  if (affected.boards.length > announcedBoardLimit) {
    boardLines.push(`…and ${affected.boards.length - announcedBoardLimit} more board(s).`);
  }
  if (affected.truncated) {
    // Never let a capped list read as the whole answer. Somebody plans a last-time-buy from this.
    boardLines.push("This list is capped; open the parts page for the full set.");
  }

  const releaseLines =
    affected.affectedReleaseRunCount > 0 ? [`Affected tracked release runs: ${affected.affectedReleaseRunCount}.`] : [];
  const policyImpact = policyImpactLine(affected.boards, affected.affectedReleaseRunCount);

  return {
    headline: headline(sorted.length, worst, affected.boards.length, stillBuilt),
    details: [
      ...partLines,
      "Source data was fresh under the provider cache policy when BoardReadyOps evaluated this alert.",
      ...releaseLines,
      ...(policyImpact ? [policyImpact] : []),
      ...(boardLines.length > 0 ? ["Affected boards:", ...boardLines] : []),
    ],
    repositoryFullName: affected.boards[0]?.repositoryFullName,
    stillBuilt,
  };
}

/**
 * States the scope in the headline, because that is the part a reader acts on.
 *
 * "TPS62840 is NRND" is a fact. "TPS62840 is NRND — on 7 boards, 3 still in the current revision"
 * is a decision about the next build. The distinction between a part still being placed and one
 * only in a superseded revision is the difference between a last-time-buy and a note in the file.
 */
function headline(partCount: number, worst: RiskyComponentFinding, boardCount: number, stillBuilt: number): string {
  const scope =
    boardCount === 0
      ? ""
      : stillBuilt > 0
        ? ` — on ${boardCount} board(s), ${stillBuilt} still in the current revision`
        : ` — on ${boardCount} board(s), none in a current revision`;
  return partCount === 1
    ? `${worst.mpn} is ${worst.status.toUpperCase()}${scope}`
    : `${partCount} parts have supply-chain risks${scope}`;
}

/** Deduplicates the part keys a resolution should be asked for. */
export function affectedPartKeys(
  parts: readonly RiskyComponentFinding[],
): { mpn: string; manufacturer?: string | undefined }[] {
  const byIdentity = new Map(parts.map((part) => [`${part.mpn}|${part.manufacturer ?? ""}`, part]));
  return [...byIdentity.values()].map((part) => ({
    mpn: part.mpn,
    ...(part.manufacturer ? { manufacturer: part.manufacturer } : {}),
  }));
}

export type { AffectedBoardsResult };
