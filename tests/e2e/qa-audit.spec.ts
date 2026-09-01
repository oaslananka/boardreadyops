import { existsSync } from "node:fs";
import { type Browser, expect, test } from "@playwright/test";
import {
  type AxeViolation,
  checkDomSanity,
  checkInternalLinks,
  checkPrimaryTouchTargets,
  collectConsoleIssues,
  hasHorizontalOverflow,
  runAxe,
} from "../../qa/audit/checks.js";
import { AuditReport, type RouteFinding } from "../../qa/audit/report.js";
import { errorStates, routes } from "../../qa/audit/routes.js";
import { authenticatedStorageState } from "./fixtures/auth.js";

/**
 * The `pnpm qa:audit` crawler: every route in qa/audit/routes.ts, across three viewports,
 * checked for HTTP health, console/page errors, WCAG 2 A/AA violations, DOM structure sanity,
 * horizontal overflow, and (mobile only) undersized primary touch targets.
 *
 * `qa:smoke` runs the same checks against a faster desktop-only, critical-route-only subset via
 * `--grep @smoke`. Full cross-browser/visual coverage lives in qa:cross-browser and qa:visual.
 */

const viewports = [
  { name: "mobile", width: 375, height: 812, smoke: false },
  { name: "tablet", width: 768, height: 1024, smoke: false },
  { name: "desktop", width: 1440, height: 900, smoke: true },
] as const;

const smokeRouteIds = new Set(["home", "reviews-list", "review-detail", "policies", "run-summary"]);

function axeSeverity(impact: string | null): "P0" | "P1" | "P2" {
  if (impact === "critical" || impact === "serious") return "P0";
  if (impact === "moderate") return "P1";
  return "P2";
}

const report = new AuditReport(routes.length + errorStates.length);

test.afterAll(() => {
  const text = report.finalize();
  // biome-ignore lint/suspicious/noConsole: this is the audit's actual report output, not debug noise.
  console.log(`\n${text}\n`);
});

for (const viewport of viewports) {
  test.describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    for (const route of routes) {
      const tags = smokeRouteIds.has(route.id) && viewport.smoke ? " @smoke" : "";

      test(`${route.label} [${route.id}]${tags}`, async ({ browser }) => {
        if (route.skipWithoutDb && !process.env.DATABASE_URL) {
          test.skip(true, `${route.id} requires DATABASE_URL; not configured in this run`);
          return;
        }

        const context = await newContext(browser, viewport, route.auth === "authenticated");
        const page = await context.newPage();
        const getConsoleIssues = collectConsoleIssues(page);

        let response: Awaited<ReturnType<typeof page.goto>> = null;
        try {
          response = await page.goto(route.path, { waitUntil: "networkidle", timeout: 15_000 });
        } catch (err) {
          record(route.id, route.path, viewport.name, "P0", "navigation-failed", String(err));
        }

        if (response && response.status() >= 500) {
          record(route.id, route.path, viewport.name, "P0", "http-5xx", `Status ${response.status()}`);
        }

        await page.waitForTimeout(300); // let client components settle after hydration

        for (const issue of getConsoleIssues()) {
          record(route.id, route.path, viewport.name, "P0", issue.kind, issue.text.slice(0, 200));
        }

        let axeResults: AxeViolation[] = [];
        try {
          axeResults = await runAxe(page);
        } catch (err) {
          record(route.id, route.path, viewport.name, "P1", "axe-run-failed", String(err));
        }
        for (const violation of axeResults) {
          record(
            route.id,
            route.path,
            viewport.name,
            axeSeverity(violation.impact),
            `axe:${violation.id}`,
            `${violation.help} (${violation.nodes} node${violation.nodes === 1 ? "" : "s"})`,
          );
        }

        for (const issue of await checkDomSanity(page)) {
          record(route.id, route.path, viewport.name, "P1", issue.rule, issue.detail);
        }

        if (await hasHorizontalOverflow(page)) {
          record(route.id, route.path, viewport.name, "P1", "horizontal-overflow", "document wider than viewport");
        }

        if (viewport.name === "mobile") {
          for (const issue of await checkPrimaryTouchTargets(page)) {
            record(
              route.id,
              route.path,
              viewport.name,
              "P2",
              "touch-target-undersized",
              `"${issue.selector}" is ${issue.width}x${issue.height}px (want >=44x44)`,
            );
          }
        }

        if (route.expectedLinkPrefixes && viewport.name === "desktop") {
          const origin = new URL(route.path, page.url()).origin;
          for (const result of await checkInternalLinks(page, origin)) {
            if (result.status === "error" || (typeof result.status === "number" && result.status >= 400)) {
              record(
                route.id,
                route.path,
                viewport.name,
                "P0",
                "broken-internal-link",
                `${result.href} -> ${result.status}`,
              );
            }
          }
        }

        report.markCovered(route.id);
        await context.close();

        // The suite reports findings via AuditReport rather than failing per-check, so one broken
        // route doesn't hide findings on the other 19 -- but a route that fails to load at all is
        // still a hard test failure, not just a report line.
        expect(response, `${route.path} failed to load`).not.toBeNull();
      });
    }

    for (const state of errorStates) {
      test(`${state.label} [${state.id}]`, async ({ browser }) => {
        const context = await newContext(browser, viewport, false);
        const page = await context.newPage();
        const getConsoleIssues = collectConsoleIssues(page);

        const response = await page.goto(state.path, { waitUntil: "networkidle", timeout: 15_000 });
        await page.waitForTimeout(300);

        for (const issue of getConsoleIssues()) {
          record(state.id, state.path, viewport.name, "P0", issue.kind, issue.text.slice(0, 200));
        }
        for (const issue of await checkDomSanity(page)) {
          record(state.id, state.path, viewport.name, "P1", issue.rule, issue.detail);
        }

        report.markCovered(state.id);
        await context.close();
        // Not a fixed status: a real notFound() route (the global 404) correctly returns 404
        // itself; a route rendering its own "unavailable" UI inline (e.g. a run without
        // DATABASE_URL configured) returns 200. Either is fine -- a 5xx here is the real bug.
        expect(response?.status(), `${state.path} returned a server error`).toBeLessThan(500);
      });
    }
  });
}

// Registered last so it runs after every route/viewport test above has recorded its findings.
// Individual route tests only hard-fail on a navigation error, so one broken route's console
// errors or axe violations don't hide findings on the other routes -- this gate is what turns
// "P0 findings exist" into an actual red CI run.
test.describe("audit gate", () => {
  test("no P0 findings across the full audit", () => {
    const p0 = report.summary().findings.filter((f) => f.severity === "P0");
    expect(p0, `P0 findings:\n${JSON.stringify(p0, null, 2)}`).toEqual([]);
  });
});

function record(
  routeId: string,
  path: string,
  viewport: string,
  severity: RouteFinding["severity"],
  rule: string,
  detail: string,
): void {
  report.add({ routeId, path, viewport, rule, severity, detail });
}

async function newContext(browser: Browser, viewport: { width: number; height: number }, authenticated: boolean) {
  const storageState = authenticated && existsSync(authenticatedStorageState) ? authenticatedStorageState : undefined;
  return browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    ...(storageState ? { storageState } : {}),
  });
}
