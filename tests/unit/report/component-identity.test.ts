import { describe, expect, it } from "vitest";
import { assessComponentIdentity, summariseIndexedIdentifiers } from "../../../src/report/component-identity.js";

/**
 * The SBOM has always emitted `pkg:generic/<manufacturer>/<mpn>`. That is a valid PURL and a
 * reasonable procurement identity, but `generic` names no ecosystem, so OSV accepts the query and
 * returns `{}` -- no error, no signal that nothing was searched. See #785.
 */

describe("assessComponentIdentity", () => {
  it("says a generic PURL is not vulnerability-indexed", () => {
    const assessment = assessComponentIdentity("pkg:generic/Yageo/RC0603FR-0710KL");

    // This is the whole point. A consumer who scans this and sees nothing must be able to tell
    // "nothing was searched" from "searched and clean".
    expect(assessment.vulnerabilityIndexed).toBe(false);
  });

  it("says an ecosystem PURL is", () => {
    for (const purl of ["pkg:npm/lodash@4.17.15", "pkg:golang/github.com/mcu-tools/mcuboot", "pkg:pypi/requests"]) {
      expect(assessComponentIdentity(purl).vulnerabilityIndexed, purl).toBe(true);
    }
  });

  it("does not credit the PURL types OSV accepts and never matches", () => {
    // Measured: all three are accepted by the OSV API and all three return empty.
    for (const purl of ["pkg:github/espressif/esp-idf@v5.2", "pkg:git/github.com/x/y", "pkg:generic/x/y"]) {
      expect(assessComponentIdentity(purl).vulnerabilityIndexed, purl).toBe(false);
    }
  });

  it("reads the type case-insensitively and tolerates a version or qualifier", () => {
    expect(assessComponentIdentity("PKG:NPM/lodash@4.17.15").vulnerabilityIndexed).toBe(true);
    expect(assessComponentIdentity("pkg:maven/org.x/y@1.0?type=jar").vulnerabilityIndexed).toBe(true);
  });

  it("treats an unreadable identifier as not indexed", () => {
    for (const value of ["", "  ", "RC0603FR-0710KL", "pkg:", "pkg:npm", "https://example.invalid/part"]) {
      expect(assessComponentIdentity(value).vulnerabilityIndexed, JSON.stringify(value)).toBe(false);
    }
  });

  it("reports the derivation as manifest analysis at a deliberately coarse confidence", () => {
    const assessment = assessComponentIdentity("pkg:generic/Yageo/RC0603FR-0710KL");

    // The number stands for "two declared BOM fields were present and nothing cross-checked
    // either". Raising it would have to be earned by validating the MPN against a catalogue.
    expect(assessment.technique).toBe("manifest-analysis");
    expect(assessment.confidence).toBe(0.5);
  });
});

describe("summariseIndexedIdentifiers", () => {
  it("counts how many identifiers a database would match", () => {
    expect(
      summariseIndexedIdentifiers([
        { purl: "pkg:generic/Yageo/RC0603FR-0710KL" },
        { purl: "pkg:generic/Murata/CAP-100N" },
        { purl: "pkg:npm/lodash@4.17.15" },
        {},
      ]),
    ).toEqual({ total: 4, indexed: 1 });
  });

  it("counts a component with no identifier at all in the total", () => {
    // It is still a component in the bill of materials, and still one nothing was searched for.
    expect(summariseIndexedIdentifiers([{}, {}])).toEqual({ total: 2, indexed: 0 });
  });

  it("expects zero indexed for a hardware-only bill of materials", () => {
    // Pinning this deliberately: every hardware PURL we emit is pkg:generic, so the honest count
    // today is zero. If this starts passing with a non-zero number, something began asserting an
    // ecosystem for a discrete part -- which is the false clean bill #785 exists to prevent.
    expect(summariseIndexedIdentifiers([{ purl: "pkg:generic/a/b" }, { purl: "pkg:generic/c/d" }]).indexed).toBe(0);
  });

  it("counts a version-exact CPE as identifiable", () => {
    // NVD returns 2 CVEs for esp-idf 5.2.1. That is a real, answerable question.
    expect(summariseIndexedIdentifiers([{ cpe: "cpe:2.3:a:espressif:esp-idf:5.2.1:*:*:*:*:*:*:*" }])).toEqual({
      total: 1,
      indexed: 1,
    });
  });

  it("does not count a CPE whose version is a wildcard", () => {
    // Querying NVD with the version open returns 31 CVEs against 2 for 5.2.1 and 0 for 6.1. A
    // wildcard is not a weaker answer, it is a wrong one -- so it does not count as searchable.
    for (const cpe of [
      "cpe:2.3:a:espressif:esp-idf:*:*:*:*:*:*:*:*",
      "cpe:2.3:a:espressif:esp-idf:-:*:*:*:*:*:*:*",
      "cpe:2.3:a:espressif:esp-idf",
      "not-a-cpe",
    ]) {
      expect(summariseIndexedIdentifiers([{ cpe }]).indexed, cpe).toBe(0);
    }
  });

  it("counts a component carrying both identifiers once", () => {
    // The question is whether anything could be searched, not how many ways.
    expect(
      summariseIndexedIdentifiers([
        { purl: "pkg:npm/lodash@4.17.15", cpe: "cpe:2.3:a:espressif:esp-idf:5.2.1:*:*:*:*:*:*:*" },
      ]),
    ).toEqual({ total: 1, indexed: 1 });
  });

  it("returns zeroes for an empty document", () => {
    expect(summariseIndexedIdentifiers([])).toEqual({ total: 0, indexed: 0 });
  });
});
