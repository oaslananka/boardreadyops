import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "@playwright/test";
import { errorStates, routes } from "../../qa/audit/routes.js";

/**
 * Fails the build when `apps/web/app` gains a new `page.tsx` that `qa/audit/routes.ts` doesn't
 * know about yet -- the mechanism section 7 of the QA setup asks for: "Route exists but has no
 * smoke/audit coverage" as a CI error, not a silent gap. See docs/qa-agent.md "Adding a route".
 */

const appDir = join(process.cwd(), "apps/web/app");

function findPageDirs(dir: string, base = dir): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_") || entry.name === "api") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findPageDirs(full, base));
    } else if (entry.name === "page.tsx") {
      found.push(relative(base, dir).split("\\").join("/"));
    }
  }
  return found;
}

/** `/reviews/[id]` -> `/reviews/:id`, `""` (root) -> `/` -- normalized so it's comparable to a real path. */
function toRoutePattern(dirRelativePath: string): string {
  const path = dirRelativePath === "" ? "/" : `/${dirRelativePath}`;
  return path.replace(/\[([^\]]+)\]/g, ":$1");
}

/** Reverses the same substitution the routes.ts fixture paths made, so both sides compare as patterns. */
function actualPathToPattern(actualPath: string): string {
  return actualPath
    .replace(/\/rev_[a-z0-9_]+/, "/:id")
    .replace(/\/demo-1/, "/:runId")
    .replace(/\/repo-does-not-exist/, "/:repositoryId");
}

test("every apps/web/app page.tsx has a qa/audit/routes.ts entry", () => {
  const discovered = findPageDirs(appDir).map(toRoutePattern).sort();
  const covered = [...routes.map((r) => r.path), ...errorStates.map((s) => s.path)].map(actualPathToPattern).sort();

  const missing = discovered.filter((pattern) => !covered.includes(pattern));

  expect(missing, `Add these routes to qa/audit/routes.ts: ${missing.join(", ")}`).toEqual([]);
});
