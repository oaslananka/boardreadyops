import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, platformOnlyPackageVersionsFromLockfile, renderNotice } from "../../../scripts/build-notice.mjs";
import { findLicensePolicyViolations } from "../../../scripts/check-licenses.mjs";
import { pnpmLicenseCommandLine } from "../../../scripts/lib/pnpm-licenses.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("license compliance scripts", () => {
  it("renders a deterministic NOTICE from pnpm license output", () => {
    const notice = renderNotice({
      "MIT OR Apache-2.0": [
        {
          name: "dual",
          versions: ["2.0.0", "1.0.0"],
          license: "MIT OR Apache-2.0",
          homepage: "https://example.test/dual",
          description: "Dual licensed package",
        },
      ],
      "Apache-2.0": [
        {
          name: "@scope/tool",
          versions: ["3.0.0"],
          license: "Apache-2.0",
          homepage: "https://example.test/tool",
          description: "Tooling",
        },
        {
          name: "@esbuild/win32-x64",
          versions: ["0.28.0"],
          license: "Apache-2.0",
          homepage: "https://github.com/evanw/esbuild",
          description: "Host-native optional package",
        },
      ],
    });

    expect(notice).toContain("# BoardReadyOps Third-Party Notices");
    expect(notice).toContain("Generated from `pnpm licenses list --json`.");
    expect(notice).toContain("## Apache-2.0");
    expect(notice).toContain("- `@scope/tool@3.0.0`");
    expect(notice).not.toContain("@esbuild/win32-x64");
    expect(notice).toContain("## MIT OR Apache-2.0");
    expect(notice).toContain("- `dual@1.0.0`, `dual@2.0.0`");
    expect(notice).toContain("Container image redistributes KiCad under GPL terms.");
    expect(notice).toMatch(/[^\n]\n$/);
  });

  it("rejects a stale NOTICE without rewriting it and reports changed package entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-notice-check-"));
    temporaryRoots.push(root);

    const staleNotice = renderNotice({
      MIT: [{ name: "sharp", versions: ["0.34.5"], license: "MIT" }],
    });
    await writeFile(path.join(root, "NOTICE"), staleNotice);

    await expect(
      main(root, {
        check: true,
        excludedPackageVersions: new Set(),
        readReport: async () => ({
          MIT: [{ name: "sharp", versions: ["0.35.3"], license: "MIT" }],
        }),
      }),
    ).rejects.toThrow(
      [
        "NOTICE is out of date. Run `corepack pnpm run notice`.",
        "Changed package entries:",
        "- removed: `sharp@0.34.5`",
        "- added: `sharp@0.35.3`",
      ].join("\n"),
    );
    expect(await readFile(path.join(root, "NOTICE"), "utf8")).toBe(staleNotice);
  });

  it("filters packages reachable only through platform-constrained roots", () => {
    const excluded = platformOnlyPackageVersionsFromLockfile({
      importers: {
        ".": {
          devDependencies: {
            "@platform/root": { version: "1.0.0" },
            portable: { version: "1.0.0" },
          },
        },
      },
      packages: {
        "@platform/root@1.0.0": { os: ["linux"] },
        "transitive-only@1.0.0": {},
        "shared@1.0.0": {},
        "portable@1.0.0": {},
      },
      snapshots: {
        "@platform/root@1.0.0": { dependencies: { "transitive-only": "1.0.0", shared: "1.0.0" } },
        "transitive-only@1.0.0": {},
        "shared@1.0.0": {},
        "portable@1.0.0": { dependencies: { shared: "1.0.0" } },
      },
    });

    expect([...excluded].sort()).toEqual(["@platform/root@1.0.0", "transitive-only@1.0.0"]);
    const notice = renderNotice(
      {
        MIT: [
          { name: "@platform/root", versions: ["1.0.0"], license: "MIT" },
          { name: "transitive-only", versions: ["1.0.0"], license: "MIT" },
          { name: "shared", versions: ["1.0.0"], license: "MIT" },
          { name: "portable", versions: ["1.0.0"], license: "MIT" },
        ],
      },
      excluded,
    );
    expect(notice).not.toContain("@platform/root@1.0.0");
    expect(notice).not.toContain("transitive-only@1.0.0");
    expect(notice).toContain("shared@1.0.0");
    expect(notice).toContain("portable@1.0.0");
  });
  it("allows only the approved license policy for distributed dependencies", () => {
    expect(
      findLicensePolicyViolations({
        "(Apache-2.0 AND BSD-3-Clause)": [{ name: "combined", versions: ["1.0.0"] }],
        "(MIT OR GPL-2.0)": [{ name: "dual-choice", versions: ["1.0.0"] }],
        "GPL-3.0-or-later": [{ name: "copyleft-runtime", versions: ["1.0.0"] }],
        Unknown: [{ name: "mystery", versions: ["0.0.1"] }],
      }),
    ).toEqual([
      {
        license: "GPL-3.0-or-later",
        packages: ["copyleft-runtime@1.0.0"],
      },
      {
        license: "Unknown",
        packages: ["mystery@0.0.1"],
      },
    ]);
  });

  it("uses the pnpm command shim that the host platform can execute", () => {
    expect(pnpmLicenseCommandLine(["--prod", "--json"], "win32")).toMatchObject({
      command: expect.stringMatching(/cmd(?:\.exe)?$/i),
      args: ["/d", "/s", "/c", "corepack", "pnpm", "licenses", "list", "--prod", "--json"],
    });
    expect(pnpmLicenseCommandLine(["--prod", "--json"], "linux")).toEqual({
      command: "corepack",
      args: ["pnpm", "licenses", "list", "--prod", "--json"],
    });
  });
});
