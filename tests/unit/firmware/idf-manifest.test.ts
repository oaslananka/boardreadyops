import { describe, expect, it } from "vitest";
import { parseIdfManifest } from "../../../src/firmware/idf-manifest.js";

/**
 * Nothing in this repository read a dependency manifest before this. The adapters named after
 * Zephyr, ESP-IDF and PlatformIO all load a BoardReadyOps pin contract; the ecosystem is a label.
 * See #785.
 */

const manifest = (body: string) => parseIdfManifest(body, "idf_component.yml");

describe("parseIdfManifest", () => {
  it("reads the short form as a registry dependency in the default namespace", () => {
    const result = manifest(["dependencies:", '  led_strip: ">=2.0"'].join("\n"));

    // The docs are explicit that a bare name is in the `espressif` namespace.
    expect(result.dependencies).toEqual([
      {
        declaredName: "led_strip",
        source: { kind: "registry", namespace: "espressif", name: "led_strip" },
        versionSpec: ">=2.0",
        pinned: false,
      },
    ]);
  });

  it("keeps an explicit namespace", () => {
    const result = manifest(["dependencies:", '  someone/thing: "1.0.0"'].join("\n"));
    expect(result.dependencies[0]?.source).toEqual({ kind: "registry", namespace: "someone", name: "thing" });
  });

  it("separates a pinned version from a range", () => {
    const result = manifest(
      [
        "dependencies:",
        '  exact: "2.4.1"',
        '  caret: "^2.4.1"',
        '  tilde: "~1.0.0"',
        '  atleast: ">=2.0"',
        '  wildcard: "*"',
        '  placeholder: "1.x"',
      ].join("\n"),
    );

    const pinned = Object.fromEntries(result.dependencies.map((d) => [d.declaredName, d.pinned]));
    // `^2.4.1` and `2.4.1` are different claims. Treating a range as a version would invent
    // precision the manifest does not have, and the version is what a lookup keys on.
    expect(pinned).toEqual({
      exact: true,
      caret: false,
      tilde: false,
      atleast: false,
      wildcard: false,
      placeholder: false,
    });
  });

  it("reads a git dependency and its subdirectory", () => {
    const result = manifest(
      [
        "dependencies:",
        "  thing:",
        "    git: https://github.com/user/repo.git",
        "    path: components/thing",
        '    version: "v1.2.3"',
      ].join("\n"),
    );

    expect(result.dependencies[0]).toEqual({
      declaredName: "thing",
      source: { kind: "git", url: "https://github.com/user/repo.git", path: "components/thing" },
      versionSpec: "v1.2.3",
      pinned: false,
    });
  });

  it("treats a branch name as unpinned", () => {
    const result = manifest(
      ["dependencies:", "  thing:", "    git: https://example.invalid/repo", "    version: main"].join("\n"),
    );

    // A branch moves. Recording it as pinned would attach an advisory answer to something that
    // changes under the build.
    expect(result.dependencies[0]?.pinned).toBe(false);
  });

  it("reads a local path dependency", () => {
    const result = manifest(["dependencies:", "  mine:", "    path: ../components/mine"].join("\n"));
    expect(result.dependencies[0]?.source).toEqual({ kind: "local", path: "../components/mine" });
  });

  it("records an overridden registry component as local, and says so", () => {
    const result = manifest(
      ["dependencies:", "  led_strip:", '    version: "^2.4.1"', "    override_path: ../local/led_strip"].join("\n"),
    );

    // What is built is the local source. Calling it a registry dependency would attribute
    // advisories to code that is not in the build.
    expect(result.dependencies[0]?.source).toEqual({ kind: "local", path: "../local/led_strip" });
    expect(result.warnings.join(" ")).toContain("overridden by local source");
  });

  it("treats the idf requirement as the framework rather than a component", () => {
    const result = manifest(["dependencies:", '  idf: ">=5.0"'].join("\n"));

    expect(result.dependencies[0]).toEqual({
      declaredName: "idf",
      source: { kind: "framework" },
      versionSpec: ">=5.0",
      pinned: false,
    });
  });

  it("reads the framework in table form too", () => {
    const result = manifest(["dependencies:", "  idf:", '    version: ">=4.4"'].join("\n"));
    expect(result.dependencies[0]?.source).toEqual({ kind: "framework" });
    expect(result.dependencies[0]?.versionSpec).toBe(">=4.4");
  });

  it("skips the conditional rules block", () => {
    const result = manifest(
      ["dependencies:", '  led_strip: "2.0.0"', "  rules:", '    - if: "target in [esp32]"'].join("\n"),
    );

    // `rules` is a condition, not a dependency, and listing it would put a phantom component in
    // the bill of materials.
    expect(result.dependencies.map((d) => d.declaredName)).toEqual(["led_strip"]);
  });

  it("reads the component's own name and version", () => {
    const result = manifest(["name: my_component", 'version: "1.4.0"', "dependencies:", '  idf: ">=5.0"'].join("\n"));
    expect(result.name).toBe("my_component");
    expect(result.version).toBe("1.4.0");
  });

  it("accepts a manifest with no dependencies without complaining", () => {
    const result = manifest(["name: standalone", 'version: "0.1.0"'].join("\n"));
    expect(result.dependencies).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("reports malformed YAML instead of throwing", () => {
    const result = manifest("dependencies:\n  - this is: [not\n    valid");
    expect(result.dependencies).toEqual([]);
    expect(result.warnings.join(" ")).toContain("not valid YAML");
  });

  it("reports a dependencies key that is not a mapping", () => {
    const result = manifest(["dependencies:", "  - led_strip"].join("\n"));
    expect(result.warnings.join(" ")).toContain('"dependencies" key that is not a mapping');
  });

  it("skips a dependency whose value is neither a string nor a table", () => {
    const result = manifest(["dependencies:", "  weird: 42"].join("\n"));
    expect(result.dependencies).toEqual([]);
    expect(result.warnings.join(" ")).toContain("neither a version string nor a table");
  });

  it("orders dependencies by name so a bill of materials is stable", () => {
    const result = manifest(["dependencies:", '  zeta: "1.0.0"', '  alpha: "1.0.0"'].join("\n"));
    expect(result.dependencies.map((d) => d.declaredName)).toEqual(["alpha", "zeta"]);
  });
});
