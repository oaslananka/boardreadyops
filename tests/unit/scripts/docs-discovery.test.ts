import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateDocsDiscovery } from "../../../scripts/docs-discovery.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-docs-discovery-"));
  temporaryRoots.push(root);
  const docsDir = path.join(root, "docs");
  const siteDir = path.join(root, "site");
  await mkdir(path.join(docsDir, "rules"), { recursive: true });
  await mkdir(path.join(docsDir, "reference", "plugin-sdk"), { recursive: true });
  await mkdir(path.join(docsDir, "superpowers", "plans"), { recursive: true });
  await mkdir(siteDir, { recursive: true });

  await writeFile(
    path.join(root, "mkdocs.yml"),
    [
      "site_name: BoardReadyOps",
      "site_url: https://docs.boardreadyops.com/",
      "docs_dir: docs",
      "nav:",
      "  - Home: index.md",
      "  - Start:",
      "      - Quickstart: quickstart.md",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(docsDir, "index.md"),
    "# BoardReadyOps\n\nBoardReadyOps is a release-readiness gate for KiCad hardware repositories.\n",
  );
  await writeFile(path.join(docsDir, "quickstart.md"), "# Quickstart\n\nInstall and run BoardReadyOps.\n");
  await writeFile(path.join(docsDir, "rules", "example.md"), "# Example rule\n\nRule details.\n");
  await writeFile(path.join(docsDir, "reference", "plugin-sdk", "README.md"), "# Plugin SDK\n\nPublic plugin API.\n");
  await writeFile(
    path.join(docsDir, "superpowers", "plans", "internal.md"),
    "# Internal plan\n\nThis must not be published as a discovery mirror.\n",
  );

  return { root, docsDir, siteDir };
}

describe("documentation discovery generator", () => {
  it("writes only approved public Markdown mirrors and machine-readable discovery files", async () => {
    const { root, siteDir } = await createFixture();

    const result = await generateDocsDiscovery({ repositoryRoot: root, siteDir });

    expect(result.markdownPaths).toEqual([
      "index.md",
      "quickstart.md",
      "reference/plugin-sdk/README.md",
      "rules/example.md",
    ]);
    await expect(readFile(path.join(siteDir, "index.md"), "utf8")).resolves.toContain("release-readiness gate");
    await expect(readFile(path.join(siteDir, "quickstart.md"), "utf8")).resolves.toContain("# Quickstart");
    await expect(readFile(path.join(siteDir, "rules", "example.md"), "utf8")).resolves.toContain("# Example rule");
    await expect(readFile(path.join(siteDir, "reference", "plugin-sdk", "README.md"), "utf8")).resolves.toContain(
      "# Plugin SDK",
    );
    await expect(readFile(path.join(siteDir, "superpowers", "plans", "internal.md"), "utf8")).rejects.toThrow();

    const robots = await readFile(path.join(siteDir, "robots.txt"), "utf8");
    expect(robots).toContain("User-agent: *\nAllow: /");
    expect(robots).toContain("Sitemap: https://docs.boardreadyops.com/sitemap.xml");

    const llms = await readFile(path.join(siteDir, "llms.txt"), "utf8");
    expect(llms).toContain("# BoardReadyOps Documentation");
    expect(llms).toContain("https://docs.boardreadyops.com/index.md");
    expect(llms).toContain("https://docs.boardreadyops.com/quickstart.md");
    expect(llms).not.toContain("superpowers");

    const full = await readFile(path.join(siteDir, "llms-full.txt"), "utf8");
    expect(full).toContain("release-readiness gate");
    expect(full).toContain("Install and run BoardReadyOps");
    expect(full).not.toContain("Internal plan");

    const agents = await readFile(path.join(siteDir, "AGENTS.md"), "utf8");
    expect(agents).toContain("public documentation guide");
    expect(agents).toContain("https://docs.boardreadyops.com/llms.txt");
    expect(agents).not.toMatch(/REPOLAR_OPS|exec-agent|sudo|DATABASE_URL|GITHUB_WEBHOOK_SECRET/);

    const sitemap = await readFile(path.join(siteDir, "sitemap.md"), "utf8");
    expect(sitemap).toContain("[Quickstart](https://docs.boardreadyops.com/quickstart.md)");
    expect(sitemap).toContain("[Example rule](https://docs.boardreadyops.com/rules/example.md)");
    expect(sitemap).toContain(
      "[Plugin SDK](https://docs.boardreadyops.com/reference/plugin-sdk/README.md) — [HTML](https://docs.boardreadyops.com/reference/plugin-sdk/)",
    );
    expect(sitemap).not.toContain("internal.md");
  });

  it("rejects navigation paths that escape the documentation directory", async () => {
    const { root, siteDir } = await createFixture();
    await writeFile(
      path.join(root, "mkdocs.yml"),
      [
        "site_name: BoardReadyOps",
        "site_url: https://docs.boardreadyops.com/",
        "docs_dir: docs",
        "nav:",
        "  - Unsafe: ../secret.md",
        "",
      ].join("\n"),
    );

    await expect(generateDocsDiscovery({ repositoryRoot: root, siteDir })).rejects.toThrow(/outside docs_dir/i);
  });
});
