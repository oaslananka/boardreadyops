import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

describe("web Docker dependency layer", () => {
  it("pins GitHub CLI and verifies the release archive before enabling Sigstore verification", async () => {
    const dockerfile = await readFile("apps/web/Dockerfile", "utf8");
    expect(dockerfile).toContain("ARG GH_VERSION=2.103.3");
    expect(dockerfile).toContain(`archive="gh_\${GH_VERSION}_\${gh_arch}.deb"`);
    // SHA256 values verified against the official GitHub CLI PGP-signed Debian index.
    expect(dockerfile).toContain("e3bafef96328d1a67de3a968bdfe1cc2ffd58cf6aba8b5e201356897ed06bb3d");
    expect(dockerfile).toContain("cac3ff84b60b68e64cca69f31f303210c26320361cc3286b773655d4226b7b06");
    expect(dockerfile).toContain("https://cli.github.com/packages/pool/main/g/gh/$archive");
    expect(dockerfile).toContain("--retry 2 --retry-all-errors");
    expect(dockerfile).toContain("sha256sum --check --strict");
    expect(dockerfile).toContain('dpkg-deb -x "/tmp/$archive" /tmp/gh-cli');
    expect(dockerfile).toContain("/tmp/gh-cli/usr/bin/gh /usr/local/bin/gh");
    expect(dockerfile).not.toContain("api.github.com/repos/cli/cli/releases");
    expect(dockerfile).not.toContain("github.com/cli/cli/releases/download");
    expect(dockerfile).toContain('gh --version | grep -F "gh version $GH_VERSION"');
    expect(dockerfile).toContain("ca-certificates curl openssl");
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
