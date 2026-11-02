import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

describe("web Docker dependency layer", () => {
  it("pins GitHub CLI and verifies the release archive before enabling Sigstore verification", async () => {
    const dockerfile = await readFile("apps/web/Dockerfile", "utf8");
    expect(dockerfile).toContain("ARG GH_VERSION=2.103.3");
    expect(dockerfile).toContain(`gh_""$GH_VERSION""_linux_""$gh_arch"".tar.gz`);
    expect(dockerfile).toContain("4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d");
    expect(dockerfile).toContain("ee32df2323c8847f5fac6cb6b4b69ca75828e9329a8f22f677021f7b3306ce63");
    expect(dockerfile).toContain("sha256sum --check --strict");
    expect(dockerfile).toContain('gh --version | grep -F "gh version $GH_VERSION"');
    expect(dockerfile).toContain("ca-certificates openssl curl");
  });

  it("copies every pnpm patch before installing dependencies", async () => {
    const workspace = load(await readFile("pnpm-workspace.yaml", "utf8")) as {
      patchedDependencies?: Record<string, string>;
    };
    const dockerfile = await readFile("apps/web/Dockerfile", "utf8");
    const installAt = dockerfile.indexOf("RUN corepack pnpm run deps:install-web");
    expect(installAt).toBeGreaterThan(0);
    for (const patch of Object.values(workspace.patchedDependencies ?? {})) {
      expect(patch.startsWith("patches/")).toBe(true);
      expect(existsSync(patch)).toBe(true);
    }
    if (Object.keys(workspace.patchedDependencies ?? {}).length > 0) {
      const copyAt = dockerfile.indexOf("COPY patches patches");
      expect(copyAt).toBeGreaterThan(0);
      expect(copyAt).toBeLessThan(installAt);
      const dockerIgnoreRules = (await readFile(".dockerignore", "utf8"))
        .split("\n")
        .map((rule) => rule.trim().replace(/^\.?\/+|\/+$/gu, ""))
        .filter((rule) => rule !== "" && !rule.startsWith("#") && !rule.startsWith("!"));
      expect(dockerIgnoreRules.some((rule) => rule === "patches" || rule.startsWith("patches/"))).toBe(false);
    }
  });
});
