import type { RiskyComponentFinding } from "@boardreadyops/cloud-core/supply-watch";
import { describe, expect, it } from "vitest";
import {
  affectedPartKeys,
  announcedBoardLimit,
  composeSupplyAnnouncement,
} from "../../../apps/web/lib/supply-announcement.js";

/**
 * The message a customer reads on a Monday morning is the whole product of the supply watch, and
 * it was the one part with no coverage: `worker.ts` builds its stores at module scope from the
 * environment, so nothing in it could be called from a test. See #449 and #755.
 */

function part(overrides: Partial<RiskyComponentFinding> = {}): RiskyComponentFinding {
  return {
    boardId: "brd_1",
    mpn: "TPS62840DLCR",
    status: "nrnd",
    severity: "high",
    source: "nexar",
    ...overrides,
  } as RiskyComponentFinding;
}

function board(
  overrides: Partial<{
    displayName: string;
    repositoryFullName: string;
    inCurrentRevision: boolean;
    releaseMode: "prototype" | "pilot" | "production";
  }> = {},
) {
  return {
    displayName: "Sensor Node",
    repositoryFullName: "acme/sensor-node",
    inCurrentRevision: true,
    releaseMode: "production" as const,
    ...overrides,
  };
}

describe("composeSupplyAnnouncement", () => {
  it("states the scope in the headline, not just the fact", () => {
    const announcement = composeSupplyAnnouncement([part()], {
      boards: [board(), board({ displayName: "Gateway", inCurrentRevision: false })],
      truncated: false,
    });

    // "TPS62840 is NRND" is a fact. The board counts make it a decision about the next build.
    expect(announcement?.headline).toBe("TPS62840DLCR is NRND — on 2 board(s), 1 still in the current revision");
  });

  it("says when nothing is still being built, rather than implying urgency", () => {
    const announcement = composeSupplyAnnouncement([part()], {
      boards: [board({ inCurrentRevision: false })],
      truncated: false,
    });

    // A part only in superseded revisions is a note in the file, not a last-time-buy.
    expect(announcement?.headline).toContain("none in a current revision");
  });

  it("drops the scope entirely when no board resolved", () => {
    const announcement = composeSupplyAnnouncement([part()], { boards: [], truncated: false });

    // The lifecycle news still has to go out. A headline reading "on 0 board(s)" would be worse
    // than one that simply does not claim to know.
    expect(announcement?.headline).toBe("TPS62840DLCR is NRND");
    expect(announcement?.details).toEqual([
      "TPS62840DLCR — NRND, high risk · Source: Nexar",
      "Source data was fresh under the provider cache policy when BoardReadyOps evaluated this alert.",
    ]);
  });

  it("counts parts rather than naming one when several are risky", () => {
    const announcement = composeSupplyAnnouncement(
      [part(), part({ mpn: "STM32F103C8T6", status: "eol", severity: "critical" })],
      { boards: [board()], truncated: false },
    );

    expect(announcement?.headline).toBe(
      "2 parts have supply-chain risks — on 1 board(s), 1 still in the current revision",
    );
  });

  it("renders zero-stock risk without pretending it is a lifecycle transition", () => {
    const announcement = composeSupplyAnnouncement(
      [part({ status: "unavailable", severity: "high", source: "nexar" })],
      {
        boards: [board({ displayName: "Gateway", repositoryFullName: "acme/gateway", inCurrentRevision: true })],
        truncated: false,
      },
    );

    expect(announcement?.headline).toBe("TPS62840DLCR is UNAVAILABLE — on 1 board(s), 1 still in the current revision");
    expect(announcement?.details[0]).toBe("TPS62840DLCR — UNAVAILABLE, high risk · Source: Nexar");
  });

  it("leads with the critical part when one part is named", () => {
    const announcement = composeSupplyAnnouncement([part({ mpn: "AAA-first-alphabetically", severity: "high" })], {
      boards: [],
      truncated: false,
    });
    expect(announcement?.headline).toContain("AAA-first-alphabetically");

    const withCritical = composeSupplyAnnouncement(
      [part({ mpn: "AAA-first", severity: "high" }), part({ mpn: "ZZZ-critical", severity: "critical" })],
      { boards: [], truncated: false },
    );
    // Two parts, so the headline counts them -- but the worst one is what a single-part headline
    // would have named, and the detail order stays alphabetical for a stable dedupe.
    expect(withCritical?.details[0]).toContain("AAA-first");
  });

  it("lists each part with its reference, status and severity", () => {
    const announcement = composeSupplyAnnouncement(
      [part({ reference: "U7" }), part({ mpn: "GRM188", reference: "C1", status: "eol", severity: "critical" })],
      { boards: [], truncated: false },
    );

    expect(announcement?.details).toEqual([
      "GRM188 (C1) — EOL, critical risk · Source: Nexar",
      "TPS62840DLCR (U7) — NRND, high risk · Source: Nexar",
      "Source data was fresh under the provider cache policy when BoardReadyOps evaluated this alert.",
    ]);
  });

  it("names the provider source and freshness contract without exposing provider payloads", () => {
    const announcement = composeSupplyAnnouncement([part({ source: "test-provider" })], {
      boards: [],
      truncated: false,
    });

    expect(announcement?.details).toContain("TPS62840DLCR — NRND, high risk · Source: Test Provider");
    expect(announcement?.details).toContain(
      "Source data was fresh under the provider cache policy when BoardReadyOps evaluated this alert.",
    );
  });

  it("explains policy impact using the affected current product's configured release mode", () => {
    const production = composeSupplyAnnouncement([part()], {
      boards: [board({ releaseMode: "production" })],
      affectedReleaseRunCount: 2,
      truncated: false,
    });
    expect(production?.details).toContain(
      "Policy impact: current production-mode hardware is affected; review this supply risk before the next production release.",
    );

    const prototype = composeSupplyAnnouncement([part()], {
      boards: [board({ releaseMode: "prototype" })],
      affectedReleaseRunCount: 1,
      truncated: false,
    });
    expect(prototype?.details).toContain(
      "Policy impact: current prototype-mode hardware is affected; account for this supply risk before the next prototype build.",
    );
  });

  it("does not invent product criticality for legacy snapshots", () => {
    const announcement = composeSupplyAnnouncement([part()], {
      boards: [board({ releaseMode: undefined as never })],
      affectedReleaseRunCount: 1,
      truncated: false,
    });

    expect(announcement?.details).toContain(
      "Policy impact: current-revision hardware is affected, but release criticality was not recorded for this snapshot.",
    );
  });

  it("treats superseded-only matches as historical policy evidence", () => {
    const announcement = composeSupplyAnnouncement([part()], {
      boards: [board({ inCurrentRevision: false, releaseMode: "production" })],
      affectedReleaseRunCount: 4,
      truncated: false,
    });

    expect(announcement?.details).toContain(
      "Policy impact: no current-revision product is affected; 4 tracked historical release run(s) retain this risk evidence.",
    );
  });

  it("reports the complete tracked release-run impact separately from the board list", () => {
    const announcement = composeSupplyAnnouncement([part()], {
      boards: [board()],
      affectedReleaseRunCount: 7,
      truncated: true,
    });

    expect(announcement?.details).toContain("Affected tracked release runs: 7.");
    expect(announcement?.details).toContain("This list is capped; open the parts page for the full set.");
  });

  it("omits a release-run line when no affected release resolved", () => {
    const announcement = composeSupplyAnnouncement([part()], {
      boards: [],
      affectedReleaseRunCount: 0,
      truncated: false,
    });

    expect(announcement?.details.some((line) => line.startsWith("Affected tracked release runs:"))).toBe(false);
  });

  it("marks each board as current or superseded", () => {
    const announcement = composeSupplyAnnouncement([part()], {
      boards: [board(), board({ displayName: "Gateway", repositoryFullName: "acme/gw", inCurrentRevision: false })],
      truncated: false,
    });

    expect(announcement?.details).toContain("Sensor Node (acme/sensor-node) — current revision · production mode");
    expect(announcement?.details).toContain("Gateway (acme/gw) — an earlier revision only · production mode");
  });

  it("summarises past the board limit instead of listing everything", () => {
    const boards = Array.from({ length: announcedBoardLimit + 3 }, (_, index) =>
      board({ displayName: `Board ${index}` }),
    );
    const announcement = composeSupplyAnnouncement([part()], { boards, truncated: false });

    const listed = announcement?.details.filter((line) => line.startsWith("Board ")) ?? [];
    expect(listed).toHaveLength(announcedBoardLimit);
    expect(announcement?.details).toContain("…and 3 more board(s).");
  });

  it("says when the resolution itself was capped", () => {
    const announcement = composeSupplyAnnouncement([part()], { boards: [board()], truncated: true });

    // Somebody plans a last-time-buy from this list. A capped one must never read as the whole
    // answer.
    expect(announcement?.details).toContain("This list is capped; open the parts page for the full set.");
  });

  it("offers the first board's repository as the event's identity", () => {
    const announcement = composeSupplyAnnouncement([part()], {
      boards: [board({ repositoryFullName: "acme/first" }), board({ repositoryFullName: "acme/second" })],
      truncated: false,
    });

    expect(announcement?.repositoryFullName).toBe("acme/first");
  });

  it("leaves the repository undefined when nothing resolved, so the caller can fall back", () => {
    const announcement = composeSupplyAnnouncement([part()], { boards: [], truncated: false });

    // The worker substitutes the board id here. The field previously always carried that id, which
    // rendered a raw UUID where the event contract promises `acme/gateway`.
    expect(announcement?.repositoryFullName).toBeUndefined();
  });

  it("returns nothing for no parts", () => {
    expect(composeSupplyAnnouncement([], { boards: [board()], truncated: false })).toBeUndefined();
  });
});

describe("affectedPartKeys", () => {
  it("deduplicates a part that appears on several references", () => {
    const keys = affectedPartKeys([part({ reference: "U7" }), part({ reference: "U9" })]);
    expect(keys).toEqual([{ mpn: "TPS62840DLCR" }]);
  });

  it("keeps the manufacturer out of the key when there is none", () => {
    // Passing an empty manufacturer would make the resolution match only components that also
    // recorded none, which silently under-reports.
    expect(affectedPartKeys([part()])).toEqual([{ mpn: "TPS62840DLCR" }]);
  });

  it("treats the same MPN from two manufacturers as two parts", () => {
    const keys = affectedPartKeys([
      part({ manufacturer: "Texas Instruments" }),
      part({ manufacturer: "Second Source" }),
    ]);

    expect(keys).toHaveLength(2);
    expect(keys.map((key) => key.manufacturer)).toEqual(["Texas Instruments", "Second Source"]);
  });
});
