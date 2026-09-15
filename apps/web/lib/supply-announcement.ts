import type { RiskyComponentFinding } from "@boardreadyops/cloud-core/supply-watch";
import type { AffectedBoard, AffectedBoardsResult } from "@boardreadyops/db/affected-boards-store";

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

type AnnouncedBoard = Pick<AffectedBoard, "displayName" | "repositoryFullName" | "inCurrentRevision">;

export function composeSupplyAnnouncement(
  parts: readonly RiskyComponentFinding[],
  affected: { boards: readonly AnnouncedBoard[]; truncated: boolean },
): SupplyAnnouncement | undefined {
  const sorted = [...parts].sort((a, b) => a.mpn.localeCompare(b.mpn));
  const worst = sorted.find((part) => part.severity === "critical") ?? sorted[0];
  if (!worst) return undefined;

  const stillBuilt = affected.boards.filter((board) => board.inCurrentRevision).length;
  const partLines = sorted.map(
    (part) =>
      `${part.mpn}${part.reference ? ` (${part.reference})` : ""} — ${part.status.toUpperCase()}, ${part.severity} risk`,
  );

  const boardLines = affected.boards
    .slice(0, announcedBoardLimit)
    .map(
      (board) =>
        `${board.displayName} (${board.repositoryFullName}) — ${board.inCurrentRevision ? "current revision" : "an earlier revision only"}`,
    );
  if (affected.boards.length > announcedBoardLimit) {
    boardLines.push(`…and ${affected.boards.length - announcedBoardLimit} more board(s).`);
  }
  if (affected.truncated) {
    // Never let a capped list read as the whole answer. Somebody plans a last-time-buy from this.
    boardLines.push("This list is capped; open the parts page for the full set.");
  }

  return {
    headline: headline(sorted.length, worst, affected.boards.length, stillBuilt),
    details: [...partLines, ...(boardLines.length > 0 ? ["Affected boards:", ...boardLines] : [])],
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
    : `${partCount} parts are end-of-life or NRND${scope}`;
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
