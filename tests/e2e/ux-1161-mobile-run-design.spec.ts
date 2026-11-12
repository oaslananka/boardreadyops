import { expect, test } from "@playwright/test";

for (const width of [320, 390, 1440]) {
  test(`run design keeps evidence accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/runs/demo-fail/design");
    await expect(page.getByRole("heading", { name: "PCB & schematic inspection" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Run investigation" })).toBeVisible();
    const collapsedSummary = page.locator("main > details > summary");
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

// Real browser: a failed run's primary next action lands on its findings,
// not above a wall of repository metadata and filter controls.
test("blocked run goes straight to the first recorded finding on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/runs/demo-fail");
  const compactRun = page.locator("main > details > summary").first();
  await expect(compactRun).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Run investigation" })).toBeVisible();
  const action = page.getByRole("link", { name: "See what is blocking" });
  await expect(action).toBeVisible();
  await action.click();
  await expect(page).toHaveURL(/\/findings\?findingState=active&findingSort=severity#finding-results$/);
  const findings = page.locator("#finding-results");
  await expect(findings).toBeVisible();
  const bounds = await findings.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.y).toBeGreaterThanOrEqual(0);
  expect(bounds?.y).toBeLessThan(450);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(
    false,
  );
});
