import { expect, test } from "@playwright/test";
import { guardProductionSafety } from "../../qa/audit/production-guard.js";

/**
 * Read-only synthetic monitoring for a real deployed instance. Run via `pnpm qa:production-smoke`
 * with PLAYWRIGHT_BASE_URL set (playwright.production.config.ts refuses to run without it, and
 * never defaults to production). No test in this file performs a mutation -- every action here
 * is a GET/navigation-only check, and `guardProductionSafety` is called with `destructive: false`
 * at each site as a standing marker of that intent for anyone editing this file later.
 *
 * Built to be portable to Checkly or another synthetic-monitoring platform: each `test()` below
 * is a self-contained check with no shared mutable state, matching Checkly's browser-check model.
 */

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL) {
    throw new Error(
      "qa:production-smoke requires PLAYWRIGHT_BASE_URL (e.g. https://boardreadyops.com) -- refusing to default to any URL for a suite that talks to a real deployment.",
    );
  }
  guardProductionSafety(baseURL, false);
});

test("homepage responds and renders the landing shell", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByRole("link", { name: "BoardReadyOps" }).first()).toBeVisible();
});

test("sign-in entry point exists", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /sign in/i }).or(page.getByRole("button", { name: /sign in/i })),
  ).toBeVisible();
});

test("setup preview loads", async ({ page }) => {
  const response = await page.goto("/setup");
  expect(response?.status()).toBeLessThan(400);
});

test("reviews registry loads without a server error", async ({ page }) => {
  const response = await page.goto("/reviews");
  expect(response?.status()).toBeLessThan(500);
});

test("evidence page loads", async ({ page }) => {
  const response = await page.goto("/evidence");
  expect(response?.status()).toBeLessThan(500);
});

test("docs link from the shell footer/nav is reachable", async ({ page, request }) => {
  await page.goto("/");
  const docsLink = page.getByRole("link", { name: "Docs" });
  const href = await docsLink.getAttribute("href");
  expect(href, "expected a Docs link in the shell").toBeTruthy();
  if (href) {
    const response = await request.get(href);
    expect(response.status()).toBeLessThan(400);
  }
});
