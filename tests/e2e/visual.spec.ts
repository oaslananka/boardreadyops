import { expect, test } from "@playwright/test";
import { routeById, visualRoutes } from "../../qa/audit/routes.js";

/**
 * Native Playwright screenshot baselines -- no external visual-diff SaaS required. Update
 * baselines deliberately with `pnpm qa:visual:update` after a real, reviewed UI change; never
 * as a way to make a failing run pass without looking at the diff. See docs/qa-agent.md.
 */

test.use({ viewport: { width: 1440, height: 900 } });

for (const routeId of visualRoutes) {
  const route = routeById(routeId);

  test(`visual: ${route.label}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addStyleTag({
      content: `*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }`,
    });

    await page.goto(route.path, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot(`${route.id}.png`, {
      fullPage: true,
      // Timestamps, digests, and other non-deterministic text vary run to run; screenshot
      // stability shouldn't depend on freezing the system clock or every fixture's exact bytes.
      mask: [page.locator("time"), page.locator("[data-qa-mask]"), page.locator(".comment-time")],
      maxDiffPixelRatio: 0.01,
    });
  });
}
