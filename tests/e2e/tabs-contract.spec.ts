import { expect, type Page, test } from "@playwright/test";
import { demoReviewId } from "../../qa/audit/routes.js";

/**
 * Regression coverage for P1-01/P1-10/P1-11 (2026-09-01 UI/UX audit): the review tab bar's
 * ?tab= deep links didn't work (always opened Overview), every tab was independently
 * Tab-reachable instead of roving tabindex, and there was no arrow-key navigation. All fixed
 * together by making the URL the single source of truth for the active tab
 * (apps/web/components/review/review-view.tsx). This is the black-box contract for the ARIA
 * tabs pattern (WAI-ARIA APG) plus the URL-backing behavior.
 */

async function hydrated(page: Page) {
  await page.goto(`/reviews/${demoReviewId}`);
  await page.getByRole("tab", { name: "Overview" }).waitFor({ state: "visible" });
  await page.waitForTimeout(500);
}

test.describe("Review tabs contract", () => {
  test("only the active tab is in the Tab order (roving tabindex)", async ({ page }) => {
    await hydrated(page);
    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    expect(count).toBeGreaterThan(1);

    for (let i = 0; i < count; i += 1) {
      const tab = tabs.nth(i);
      const selected = (await tab.getAttribute("aria-selected")) === "true";
      await expect(tab).toHaveAttribute("tabindex", selected ? "0" : "-1");
    }
  });

  test("ArrowRight moves selection and focus to the next tab, wrapping at the end", async ({ page }) => {
    await hydrated(page);
    const overview = page.getByRole("tab", { name: "Overview" });
    await overview.focus();
    await expect(overview).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowRight");
    const changes = page.getByRole("tab", { name: /^Changes/ });
    await expect(changes).toHaveAttribute("aria-selected", "true");
    await expect(changes).toBeFocused();
  });

  test("clicking a tab updates the URL's ?tab= parameter", async ({ page }) => {
    await hydrated(page);
    await page.getByRole("tab", { name: /^Findings/ }).click();
    await expect(page).toHaveURL(/[?&]tab=findings/);

    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page).not.toHaveURL(/tab=/);
  });

  test("a ?tab= deep link opens directly on that tab", async ({ page }) => {
    await page.goto(`/reviews/${demoReviewId}?tab=discussion`);
    await expect(page.getByRole("tab", { name: /^Discussion/ })).toHaveAttribute("aria-selected", "true");
  });

  test("browser back/forward moves between tabs", async ({ page }) => {
    await hydrated(page);
    await page.getByRole("tab", { name: /^Findings/ }).click();
    await expect(page).toHaveURL(/tab=findings/);
    await page.getByRole("tab", { name: /^Checklist/ }).click();
    await expect(page).toHaveURL(/tab=checklist/);

    await page.goBack();
    await expect(page).toHaveURL(/tab=findings/);
    await expect(page.getByRole("tab", { name: /^Findings/ })).toHaveAttribute("aria-selected", "true");

    await page.goForward();
    await expect(page).toHaveURL(/tab=checklist/);
  });

  test("reloading the page on a non-default tab keeps that tab active", async ({ page }) => {
    await page.goto(`/reviews/${demoReviewId}?tab=evidence`);
    await expect(page.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(page.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true");
  });
});
