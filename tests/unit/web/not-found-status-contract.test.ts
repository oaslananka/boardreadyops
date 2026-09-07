import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A `loading.tsx` opens a Suspense boundary for its segment and every segment beneath it. Next
 * flushes the shell as soon as that boundary is reached, which commits the response to 200 — so a
 * `notFound()` thrown afterwards renders the not-found UI with an HTTP **200**, not a 404.
 *
 * Next's own streaming guide states the rule: call `notFound()` before any Suspense boundary. With
 * file-based `loading.tsx` there is no way to run the existence check earlier, so the two cannot
 * coexist on the same route.
 *
 * This bit us: adding `app/reviews/loading.tsx` and `app/repositories/[repositoryId]/loading.tsx`
 * silently turned "this review does not exist" into a 200, which breaks caching, crawlers, and
 * uptime checks that key on status. Verified by hand against a production build before writing
 * this test — the URLs answered 200, and answered 404 the moment the loading file was removed.
 */

const appDirectory = "apps/web/app";

function pageFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry.startsWith("_") || entry === "api") continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...pageFiles(full));
    } else if (entry === "page.tsx") {
      found.push(full);
    }
  }
  return found;
}

/** Every segment from the page's own directory up to `app/`, nearest first. */
function segmentsUpToApp(pageFile: string): string[] {
  const segments: string[] = [];
  let directory = path.dirname(pageFile);
  while (directory.startsWith(appDirectory)) {
    segments.push(directory);
    if (directory === appDirectory) break;
    directory = path.dirname(directory);
  }
  return segments;
}

/**
 * `/runs/[runId]` predates this rule: its loading state is a deliberate, separately tested part of
 * the run investigation flow (`tests/unit/web/run-state-pages.test.ts`), and choosing between that
 * skeleton and a correct 404 is a product decision rather than a cleanup. Listed so the trade-off
 * stays visible instead of silently passing.
 */
const knownExceptions = new Set([path.join(appDirectory, "runs", "[runId]")]);

describe("notFound() routes must not sit under a Suspense boundary", () => {
  const pages = pageFiles(appDirectory);

  it("finds the app router pages to check", () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  it("keeps every page that can 404 free of a loading.tsx in its own or an ancestor segment", () => {
    const offenders: string[] = [];

    for (const pageFile of pages) {
      if (!readFileSync(pageFile, "utf8").includes("notFound(")) continue;
      for (const segment of segmentsUpToApp(pageFile)) {
        if (knownExceptions.has(segment)) break;
        if (existsSync(path.join(segment, "loading.tsx"))) {
          offenders.push(`${pageFile} is shadowed by ${path.join(segment, "loading.tsx")}`);
        }
      }
    }

    expect(
      offenders,
      `These pages call notFound() but stream a loading fallback first, so they answer HTTP 200 instead of 404:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("still allows a loading skeleton on routes that never 404", () => {
    // The rule is about status codes, not about skeletons in general — list and settings routes
    // keep theirs.
    expect(existsSync(path.join(appDirectory, "dashboard", "loading.tsx"))).toBe(true);
    expect(existsSync(path.join(appDirectory, "work", "loading.tsx"))).toBe(true);
    expect(readFileSync(path.join(appDirectory, "dashboard", "page.tsx"), "utf8")).not.toContain("notFound(");
  });
});
