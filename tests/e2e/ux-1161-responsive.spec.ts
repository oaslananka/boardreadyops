import { expect, test } from "@playwright/test";

/** Regression acceptance for the source-evidence-first Review presentation.
 * The local synthetic review is not a manufacturing approval or customer run.
 */
for (const width of [320, 390, 1440]) {
  for (const theme of ["dark", "light"] as const) {
    test(`review preview and investigation stay usable at ${width}px in ${theme} mode`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem("theme", selectedTheme);
      }, theme);
      await page.goto("/reviews/rev_gateway_42");
      const preview = page.getByRole("region", { name: "Published design preview" });
      await expect(preview).toBeVisible();
      await expect(preview.getByText("Explore this board revision")).toBeVisible();
      await expect(preview.getByText(/not a manufacturing approval/i)).toBeVisible();
      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasOverflow).toBe(false);

      await preview.getByRole("button", { name: /Inspect findings on the board/ }).click();
      await expect(page.getByRole("tab", { name: /Changes/ })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("region", { name: "Hardware design inspection workspace" })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
      ).toBe(false);
    });
  }
}
