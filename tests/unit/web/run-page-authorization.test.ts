import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const runPagesRoot = join(process.cwd(), "apps/web/app/runs/[runId]");

async function runPagePaths(): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name === "page.tsx") found.push(path);
    }
  }
  await walk(runPagesRoot);
  return found.sort();
}

describe("run page authorization", () => {
  it("finds every run page so a new one cannot slip past this check", async () => {
    const pages = await runPagePaths();
    expect(pages.length).toBeGreaterThanOrEqual(6);
  });

  it("passes a viewer authorizer on every run page", async () => {
    // Without one, loadRunDashboard resolves a private repository to "not found" for everyone
    // including its owner, which is exactly the regression this guards.
    const failures: string[] = [];
    for (const page of await runPagePaths()) {
      const source = await readFile(page, "utf8");
      const wired =
        source.includes("viewerAuthorization") && source.includes("authorizeRepository: viewer.authorizeRepository");
      if (!wired) failures.push(page);
    }

    expect(failures).toEqual([]);
  });

  it("reads cookies unconditionally, so a page rendering the viewer stays per-request", async () => {
    // Gating cookies() on SESSION_SECRET made a page's dynamism depend on whether that variable
    // was set during `next build`. It is not passed to the build, so the landing page was
    // prerendered signed-out and kept serving that HTML to everyone who signed in afterwards.
    const source = await readFile(join(process.cwd(), "apps/web/lib/viewer-authorization.ts"), "utf8");

    expect(source).toContain("const token = (await cookies()).get(sessionCookieName)?.value;");
    expect(source).not.toMatch(/secret\s*\?\s*\(await cookies\(\)\)/u);
  });

  it("never hardcodes an authorizer that always allows", async () => {
    for (const page of await runPagePaths()) {
      const source = await readFile(page, "utf8");
      expect(source).not.toMatch(/authorizeRepository:\s*\(\)\s*=>\s*true/u);
      expect(source).not.toMatch(/authorizeRepository:\s*async\s*\(\)\s*=>\s*true/u);
    }
  });
});
