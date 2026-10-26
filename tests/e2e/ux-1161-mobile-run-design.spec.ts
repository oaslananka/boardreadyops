import { expect, test } from "@playwright/test";

for (const width of [320, 390, 1440]) {
  test(`run design keeps evidence accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/runs/demo-fail/design");
    await expect(page.getByRole("heading", { name: "PCB & schematic inspection" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Run investigation" })).toBeVisible();
    const collapsedSummary = page.locator("main details > summary");
    if (width < 1024) {
      await expect(collapsedSummary).toBeVisible();
      const heading = await page.getByRole("heading", { name: "PCB & schematic inspection" }).boundingBox();
      expect(heading?.y).toBeLessThan(900);
      await collapsedSummary.click();
      await expect(page.getByRole("button", { name: "Re-run readiness" })).toBeVisible();
      await collapsedSummary.click();
    } else {
      await expect(collapsedSummary).toBeHidden();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(
      false,
    );
  });
}
