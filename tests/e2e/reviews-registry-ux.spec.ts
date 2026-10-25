import { expect, test } from "@playwright/test";

test("review queue offers fast pending decisions and shareable deep filters", async ({ page }) => {
  await page.goto("/reviews");

  const filters = page.getByRole("region", { name: "Review filters" });
  await expect(filters.getByRole("heading", { name: "Your review queue" })).toBeVisible();
  const advanced = filters.locator("details");
  await expect(advanced).not.toHaveAttribute("open");
  await expect(filters.getByRole("link", { name: /Show 1 reviews awaiting a decision/ })).toBeVisible();

  await filters.getByRole("link", { name: /awaiting a decision/ }).click();
  await expect(page).toHaveURL(/decision=pending/);
  await expect(page.getByRole("heading", { name: "Your review queue" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Upgrade PMIC to MP2617/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Switch to nRF52840/ })).toHaveCount(0);

  const refined = page.getByRole("region", { name: "Review filters" });
  await expect(refined.locator("details")).not.toHaveAttribute("open");
  await expect(refined.getByText("Filters active")).toBeVisible();
  await refined.getByRole("link", { name: "Clear filters" }).click();
  await expect(page.getByRole("link", { name: /Switch to nRF52840/ })).toBeVisible();
});

test("review cards and search stay usable at 320px without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/reviews");
  const filters = page.getByRole("region", { name: "Review filters" });
  await expect(filters.getByRole("searchbox", { name: "Search reviews" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Upgrade PMIC to MP2617/ })).toBeVisible();

  await filters.getByRole("searchbox", { name: "Search reviews" }).fill("#42");
  await filters.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=%2342/);
  await expect(page.getByRole("link", { name: /Upgrade PMIC to MP2617/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Switch to nRF52840/ })).toHaveCount(0);

  const size = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(size.document).toBeLessThanOrEqual(size.viewport);
  await filters.locator("summary").click();
  await expect(filters.getByLabel("Repository")).toBeVisible();
});
