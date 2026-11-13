import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

describe("web Docker dependency layer", () => {
  it("builds GitHub CLI from a verified release module with patched security dependency", async () => {
    const dockerfile = await readFile("apps/web/Dockerfile", "utf8");
    const dollar = "$";
    expect(dockerfile).toMatch(/FROM golang@sha256:[a-f0-9]{64} AS gh-builder/u);
    expect(dockerfile).toMatch(/ARG GH_VERSION=\d+\.\d+\.\d+/u);
    expect(dockerfile).toContain(`go mod edit -require="github.com/cli/cli/v2@v${dollar}{GH_VERSION}"`);
    expect(dockerfile).toContain("go mod edit -require=golang.org/x/net@v0.62.0");
    expect(dockerfile).toContain("GOTOOLCHAIN=local go install -mod=mod github.com/cli/cli/v2/cmd/gh");
    expect(dockerfile).toContain("go version -m /out/gh > /tmp/gh-build-info");
    expect(dockerfile).toContain("grep -E 'mod[[:space:]]+github.com/cli/cli/v2");
    expect(dockerfile).toContain("grep -E 'dep[[:space:]]+golang.org/x/net");
    expect(dockerfile).toContain("COPY --from=gh-builder /out/gh /usr/local/bin/gh");
    expect(dockerfile).toContain(`gh --version | grep -F "gh version ${dollar}{GH_VERSION}"`);
    expect(dockerfile).not.toContain("apt-get");
    expect(dockerfile).not.toContain("curl --insecure");
    const runner = dockerfile.split(/FROM node@sha256:[a-f0-9]{64} AS runner/u)[1] ?? "";
    expect(runner).toContain("/usr/local/lib/node_modules/npm");
    expect(runner).toContain("/usr/local/lib/node_modules/corepack");
    expect(runner).toContain("USER node");
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
