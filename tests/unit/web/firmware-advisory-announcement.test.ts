import { describe, expect, it } from "vitest";
import {
  advisoryDedupeKey,
  announcedAdvisoryLimit,
  composeFirmwareAdvisoryAnnouncement,
} from "../../../apps/web/lib/firmware-advisory-announcement.js";
import type { DependencyAdvisoryResult } from "../../../packages/cloud-core/src/firmware-advisory-watch.js";

/**
 * The message a customer reads is the whole product of this feature, and the rule it has to obey
 * is that it never implies the components it does not mention were checked. A firmware bill of
 * materials is mostly unidentifiable today, so naming two CVEs out of forty without saying what
 * happened to the other thirty-eight is the false clean bill in a different font. See #804.
 */

function result(
  name: string,
  advisories: DependencyAdvisoryResult["advisories"],
  answered = true,
): DependencyAdvisoryResult {
  return { dependency: { name, manifestPath: "fw/idf_component.yml" }, advisories, answered };
}

const criticalIdf = {
  id: "CVE-2025-66409",
  aliases: [],
  severity: "CRITICAL",
  source: "nvd" as const,
  url: "https://nvd.nist.gov/vuln/detail/CVE-2025-66409",
};

const mcuboot = {
  id: "GO-2024-2799",
  aliases: ["CVE-2024-32883"],
  severity: undefined,
  source: "osv" as const,
  url: "https://osv.dev/vulnerability/GO-2024-2799",
};

describe("composeFirmwareAdvisoryAnnouncement", () => {
  it("says nothing when nothing was found", () => {
    expect(composeFirmwareAdvisoryAnnouncement([], { dependencyCount: 40, queried: 1 })).toBeUndefined();
    expect(
      composeFirmwareAdvisoryAnnouncement([result("idf", [])], { dependencyCount: 40, queried: 1 }),
    ).toBeUndefined();
  });

  it("always states how much of the bill of materials could be looked up", () => {
    const announcement = composeFirmwareAdvisoryAnnouncement([result("idf", [criticalIdf])], {
      dependencyCount: 40,
      queried: 1,
    });

    // The most important line. Without it, one named CVE reads as the whole picture.
    expect(announcement?.details.join(" ")).toContain("1 of 40 firmware dependenc(ies) could be looked up");
    expect(announcement?.details.join(" ")).toContain("The other 39 carry no identifier");
  });

  it("omits the coverage line only when everything was looked up", () => {
    const announcement = composeFirmwareAdvisoryAnnouncement([result("idf", [criticalIdf])], {
      dependencyCount: 1,
      queried: 1,
    });

    expect(announcement?.details.join(" ")).not.toContain("could be looked up");
  });

  it("leads with the worst severity and names the dependency", () => {
    const announcement = composeFirmwareAdvisoryAnnouncement(
      [
        result("led_strip", [{ ...mcuboot, id: "GHSA-low", aliases: [], severity: "LOW" }]),
        result("idf", [criticalIdf]),
      ],
      { dependencyCount: 2, queried: 2 },
    );

    // "A firmware advisory was found" is a fact nobody schedules around. This is one somebody
    // stops to read.
    expect(announcement?.headline).toBe("2 firmware advisories, worst CRITICAL CVE-2025-66409 in idf");
    expect(announcement?.details[0]).toContain("CRITICAL — CVE-2025-66409 in idf");
  });

  it("uses the CVE rather than the database's own id, and keeps both", () => {
    const announcement = composeFirmwareAdvisoryAnnouncement([result("mcuboot", [mcuboot])], {
      dependencyCount: 1,
      queried: 1,
    });

    // OSV carries this as GO-2024-2799; the CVE is what a reader recognises.
    expect(announcement?.headline).toBe("CVE-2024-32883 affects mcuboot");
    expect(announcement?.details[0]).toContain("CVE-2024-32883 (GO-2024-2799)");
  });

  it("does not duplicate the identifier when the id is already the CVE", () => {
    const announcement = composeFirmwareAdvisoryAnnouncement(
      [result("idf", [{ ...criticalIdf, aliases: ["CVE-2025-66409"] }])],
      { dependencyCount: 1, queried: 1 },
    );

    expect(announcement?.details[0]).toContain("CVE-2025-66409 in idf");
    expect(announcement?.details[0]).not.toContain("(CVE-2025-66409)");
  });

  it("states that a lookup did not complete, separately from the coverage gap", () => {
    const announcement = composeFirmwareAdvisoryAnnouncement(
      [result("idf", [criticalIdf]), result("mcuboot", [], false)],
      { dependencyCount: 2, queried: 2 },
    );

    // Distinct claims: these two were searchable, and one lookup still failed. "Nothing else
    // found" is not something the message can say.
    expect(announcement?.details.join(" ")).toContain("1 lookup(s) did not complete");
  });

  it("summarises rather than listing every advisory", () => {
    const many = Array.from({ length: announcedAdvisoryLimit + 3 }, (_, index) =>
      result(`dep-${index}`, [{ ...criticalIdf, id: `CVE-2025-${1000 + index}`, severity: "HIGH" }]),
    );

    const announcement = composeFirmwareAdvisoryAnnouncement(many, {
      dependencyCount: many.length,
      queried: many.length,
    });

    expect(announcement?.advisoryCount).toBe(announcedAdvisoryLimit + 3);
    expect(announcement?.details.join(" ")).toContain("and 3 more advisory/advisories");
  });

  it("handles an advisory with no severity at all", () => {
    const announcement = composeFirmwareAdvisoryAnnouncement(
      [result("mcuboot", [{ ...mcuboot, severity: undefined }])],
      { dependencyCount: 1, queried: 1 },
    );

    // OSV often states none. The line must still read, without an empty separator.
    expect(announcement?.headline).toBe("CVE-2024-32883 affects mcuboot");
    expect(announcement?.details[0]).not.toContain("undefined");
  });
});

describe("advisoryDedupeKey", () => {
  it("is stable regardless of the order results arrive in", () => {
    const a = result("idf", [criticalIdf]);
    const b = result("mcuboot", [mcuboot]);

    // The same advisory set is one piece of news however many passes find it.
    expect(advisoryDedupeKey([a, b])).toBe(advisoryDedupeKey([b, a]));
  });

  it("changes when a new advisory appears", () => {
    const before = advisoryDedupeKey([result("idf", [criticalIdf])]);
    const after = advisoryDedupeKey([result("idf", [criticalIdf]), result("mcuboot", [mcuboot])]);

    // A new CVE has to be a new message rather than a suppressed duplicate.
    expect(after).not.toBe(before);
  });

  it("is empty for no advisories", () => {
    expect(advisoryDedupeKey([result("idf", [])])).toBe("");
  });
});
