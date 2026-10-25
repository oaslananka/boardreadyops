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
      if (width < 640) {
        await expect(page.locator("header").getByText("Active", { exact: true }).last()).toBeVisible();
      }
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

test("mobile Review keeps source evidence in the first screen and decisions in an accessible disclosure", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/reviews/rev_gateway_42");
  const actions = page.locator("header details > summary");
  await expect(page.locator("header").getByText("Active", { exact: true }).last()).toBeVisible();
  await expect(actions).toBeVisible();
  await expect(actions).toContainText("Review actions & evidence");
  await expect(page.getByRole("button", { name: "Approve review" })).toBeHidden();
  const preview = page.getByRole("region", { name: "Published design preview" });
  await expect(preview).toBeVisible();
  expect((await preview.boundingBox())?.y).toBeLessThan(620);
  // The Overview is a preview, not the entire CAD workstation: show source art before
  // optional comparison and zoom chrome. Changes retains those controls on mobile.
  await expect(preview.getByRole("group", { name: "Revision comparison modes" })).toBeHidden();
  await expect(preview.getByRole("button", { name: "Zoom in" })).toBeHidden();
  // Prefer published PCB copper when both schematics and boards exist; never synthesize a layer.
  await expect(preview.getByRole("combobox", { name: "Layer / Sheet:" })).toHaveValue("F.Cu");
  const boardCanvas = preview.getByRole("region", { name: "Schematic and PCB Review Canvas" });
  expect((await boardCanvas.boundingBox())?.y).toBeLessThan(760);
  await preview.getByRole("button", { name: /Inspect findings on the board/ }).click();
  await expect(page.getByRole("group", { name: "Revision comparison modes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await actions.click();
  await expect(page.getByRole("button", { name: "Approve review" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request changes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy digest" }).first()).toBeVisible();
  await actions.click();
  await expect(page.getByRole("button", { name: "Approve review" })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(
    false,
  );
});
