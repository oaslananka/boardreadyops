import { describe, expect, it } from "vitest";
import { resolveComponentIdentity, summariseIdentities } from "../../../src/firmware/component-identity.js";
import { parseIdfManifest } from "../../../src/firmware/idf-manifest.js";

/**
 * The point of this module is what it refuses to claim.
 *
 * Measured against the live OSV API: `pkg:generic/...`, `pkg:github/...` and `pkg:git/...` are all
 * accepted and all return empty, with no error and no signal that nothing was searched. So an
 * implementation that derived identifiers would report "no advisories found" for components it
 * never looked up. See #785.
 */

function dependencies(body: string) {
  return parseIdfManifest(body, "idf_component.yml").dependencies;
}

function first(body: string) {
  const [dependency] = dependencies(body);
  if (!dependency) throw new Error("fixture produced no dependency");
  return resolveComponentIdentity(dependency);
}

describe("resolveComponentIdentity", () => {
  it("refuses to invent an identifier for a registry component", () => {
    const identity = first(["dependencies:", '  led_strip: "2.4.1"'].join("\n"));

    // `pkg:generic/espressif/led_strip@2.4.1` is a valid PURL that OSV answers with `{}`. Emitting
    // it would turn "we cannot look this up" into "we looked and it is clean".
    expect(identity).toEqual({ evidence: "unidentified", searchable: false });
  });

  it("refuses to invent one for a git dependency it does not know", () => {
    const identity = first(
      ["dependencies:", "  thing:", "    git: https://github.com/someone/unknown-thing"].join("\n"),
    );

    expect(identity.purl).toBeUndefined();
    expect(identity.searchable).toBe(false);
  });

  it("never looks up local source", () => {
    const identity = first(["dependencies:", "  mine:", "    path: ../components/mine"].join("\n"));

    // First-party code in the tree is not a third-party component with advisories.
    expect(identity).toEqual({ evidence: "unidentified", searchable: false });
  });

  it("never looks up the framework", () => {
    const identity = first(["dependencies:", '  idf: ">=5.0"'].join("\n"));

    // The framework is tracked by CPE rather than PURL, which this does not cover yet. Saying so
    // is better than mapping it to something that matches nothing.
    expect(identity).toEqual({ evidence: "unidentified", searchable: false });
  });

  it("resolves a component the curated mapping actually knows", () => {
    const identity = first(
      ["dependencies:", "  mcuboot:", "    git: https://github.com/mcu-tools/mcuboot", "    version: v2.0.0"].join(
        "\n",
      ),
    );

    // MCUboot is the proof that indexed embedded components exist and that the identifier is not
    // guessable: it is a C bootloader carried in OSV under the Go ecosystem.
    expect(identity.purl).toBe("pkg:golang/github.com/mcu-tools/mcuboot");
    expect(identity.searchable).toBe(true);
    expect(identity.evidence).toBe("reported");
    expect(identity.source).toContain("CVE-2024-32883");
  });

  it("matches a git URL regardless of a .git suffix or trailing slash", () => {
    for (const url of [
      "https://github.com/mcu-tools/mcuboot.git",
      "https://github.com/mcu-tools/mcuboot/",
      "HTTPS://GitHub.com/MCU-Tools/MCUboot",
    ]) {
      const identity = first(["dependencies:", "  mcuboot:", `    git: ${url}`].join("\n"));
      expect(identity.searchable, url).toBe(true);
    }
  });

  it("appends the version only when the manifest pinned one", () => {
    const pinned = first(
      ["dependencies:", "  mcuboot:", "    git: https://github.com/mcu-tools/mcuboot", '    version: "2.0.0"'].join(
        "\n",
      ),
    );
    expect(pinned.purl).toBe("pkg:golang/github.com/mcu-tools/mcuboot@2.0.0");

    const ranged = first(
      ["dependencies:", "  mcuboot:", "    git: https://github.com/mcu-tools/mcuboot", '    version: "^2.0.0"'].join(
        "\n",
      ),
    );
    // A range is not a version. Pinning the PURL to `^2.0.0` would ask the database a question it
    // cannot answer; without it the query asks about the package, which is weaker and true.
    expect(ranged.purl).toBe("pkg:golang/github.com/mcu-tools/mcuboot");
    expect(ranged.searchable).toBe(true);
  });
});

describe("summariseIdentities", () => {
  it("reports how much of the bill of materials could not be looked up", () => {
    const summary = summariseIdentities(
      dependencies(
        [
          "dependencies:",
          '  idf: ">=5.0"',
          '  led_strip: "2.4.1"',
          "  mcuboot:",
          "    git: https://github.com/mcu-tools/mcuboot",
          "  mine:",
          "    path: ../mine",
        ].join("\n"),
      ),
    );

    expect(summary).toEqual({
      total: 4,
      searchable: 1,
      unidentified: 3,
      unidentifiedNames: ["idf", "led_strip", "mine"],
    });
  });

  it("names the unidentified components so a report can list what was not checked", () => {
    const summary = summariseIdentities(dependencies(["dependencies:", '  zeta: "1.0"', '  alpha: "1.0"'].join("\n")));

    // A reader has to be able to tell "eleven of twelve were not vulnerability-indexed" from
    // "twelve of twelve had no advisories".
    expect(summary.unidentifiedNames).toEqual(["alpha", "zeta"]);
  });

  it("returns zeroes for an empty dependency list", () => {
    expect(summariseIdentities([])).toEqual({
      total: 0,
      searchable: 0,
      unidentified: 0,
      unidentifiedNames: [],
    });
  });

  it("expects unidentified to be the common case today", () => {
    const summary = summariseIdentities(
      dependencies(["dependencies:", '  a: "1.0"', '  b: "1.0"', '  c: "1.0"', '  d: "1.0"', '  e: "1.0"'].join("\n")),
    );

    // Pinning this deliberately: if a future change makes everything searchable, the mapping has
    // started guessing, and that is the failure this module exists to prevent.
    expect(summary.searchable).toBe(0);
    expect(summary.unidentified).toBe(5);
  });
});
