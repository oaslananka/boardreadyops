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

  it("links run-design baselines only after the authorized run lookup", async () => {
    const source = await readFile(join(runPagesRoot, "design", "page.tsx"), "utf8");
    const authorizedRunLookup = source.indexOf("authorizeRepository: viewer.authorizeRepository");
    const firstBaselineLookup = source.indexOf("loadRunDesignBaseSnapshots(runId, result.run.repositoryId)");
    expect(authorizedRunLookup).toBeGreaterThan(0);
    expect(firstBaselineLookup).toBeGreaterThan(authorizedRunLookup);
    expect(source).toContain('if (result.state === "not-found") notFound()');
  });

  it("uses a single authorized filtered-page renderer for Findings and Artifacts", async () => {
    for (const route of ["findings", "artifacts"]) {
      const source = await readFile(join(runPagesRoot, route, "page.tsx"), "utf8");
      expect(source).toContain("renderFilteredRunPage");
      expect(source).not.toContain("await loadRunDashboard(");
    }
    const shared = await readFile(join(runPagesRoot, "filtered-run-page.tsx"), "utf8");
    expect(shared).toContain("viewerAuthorization()");
    expect(shared).toContain("authorizeRepository: viewer.authorizeRepository");
    expect(shared).toContain("filtersFromSearchParameters(query)");
    expect(shared).toContain("const signedIn = Boolean(viewer.session)");
    expect(shared).toContain('if (result.state === "not-found") notFound()');
  });

  it("passes a viewer authorizer on every run page", async () => {
    // Without one, loadRunDashboard resolves a private repository to "not found" for everyone
    // including its owner, which is exactly the regression this guards.
    const failures: string[] = [];
    for (const page of await runPagePaths()) {
      const source = await readFile(page, "utf8");
      const authorizationSource = source.includes("renderFilteredRunPage")
        ? await readFile(join(runPagesRoot, "filtered-run-page.tsx"), "utf8")
        : source;
      const wired =
        authorizationSource.includes("viewerAuthorization") &&
        authorizationSource.includes("authorizeRepository: viewer.authorizeRepository");
      if (!wired) failures.push(page);
    }

    expect(failures).toEqual([]);
  });

  it("passes actual session state to every Run frame and the finding action view", async () => {
    const failures: string[] = [];
    for (const page of await runPagePaths()) {
      const source = await readFile(page, "utf8");
      const frameSource = source.includes("renderFilteredRunPage")
        ? await readFile(join(runPagesRoot, "filtered-run-page.tsx"), "utf8")
        : source;
      const wired =
        /<RunPageFrame\b[^>]*signedIn=\{Boolean\(viewer.session\)\}/su.test(frameSource) ||
        (frameSource.includes("const signedIn = Boolean(viewer.session)") &&
          /<RunPageFrame\b[^>]*signedIn=\{signedIn\}/su.test(frameSource));
      if (!wired) failures.push(page);
    }
    expect(failures).toEqual([]);
    const findings = await readFile(join(runPagesRoot, "filtered-run-page.tsx"), "utf8");
    expect(findings).toContain("const signedIn = Boolean(viewer.session)");
    expect(findings).toMatch(/<FindingsView\b[^>]*signedIn=\{signedIn\}/su);
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
    for (const page of [...(await runPagePaths()), join(runPagesRoot, "filtered-run-page.tsx")]) {
      const source = await readFile(page, "utf8");
      expect(source).not.toMatch(/authorizeRepository:\s*\(\)\s*=>\s*true/u);
      expect(source).not.toMatch(/authorizeRepository:\s*async\s*\(\)\s*=>\s*true/u);
    }
  });
});
