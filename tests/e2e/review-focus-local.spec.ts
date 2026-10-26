import { expect, test } from "@playwright/test";

const REVIEW_PATH = "/reviews/rev_gateway_42";

async function openInteractiveChanges(page: import("@playwright/test").Page) {
  await page.goto(REVIEW_PATH);
  const changes = page.getByRole("tab", { name: /^Changes/ });
  await expect(changes).toBeVisible();
  await expect(async () => {
    await changes.click();
    await expect(changes).toHaveAttribute("aria-selected", "true", { timeout: 750 });
  }).toPass({ timeout: 10_000 });
  await expect(page.getByRole("region", { name: "Schematic and PCB Review Canvas" })).toBeVisible();
}

test.describe("PCB-first review canvas focus", () => {
  test("desktop: focus can be entered and exited without losing Changes context", async ({ page }) => {
    await page.setViewportSize({ width: 1760, height: 980 });
    await openInteractiveChanges(page);

    const focus = page.getByRole("button", { name: "Focus PCB / schematic" });
    await expect(focus).toHaveAttribute("aria-pressed", "false");
    await focus.click();
    const restore = page.getByRole("button", { name: "Show findings and inspector" });
    await expect(restore).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("tab", { name: /^Changes/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("region", { name: "Schematic and PCB Review Canvas" })).toBeVisible();

    await restore.click();
    await expect(page.getByRole("button", { name: "Focus PCB / schematic" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("tab", { name: /^Changes/ })).toHaveAttribute("aria-selected", "true");
  });

  test("demo summary images do not masquerade as KiCad source-verified movement", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openInteractiveChanges(page);
    await expect(page.getByRole("region", { name: "Source-verified PCB object movement" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Schematic and PCB Review Canvas" })).toBeVisible();
    await expect(
      page.getByText("Published review snapshots are component/layer summaries", { exact: false }),
    ).toBeVisible();
  });

  test("390px mobile: canvas remains reachable when focus mode is toggled", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openInteractiveChanges(page);

    await page.getByRole("button", { name: "Focus PCB / schematic" }).click();
    await expect(page.getByRole("button", { name: "Show findings and inspector" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const bounds = await page.getByRole("region", { name: "Schematic and PCB Review Canvas" }).boundingBox();
    expect(bounds).not.toBeNull();
    if (bounds) {
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
    }
    await page.getByRole("button", { name: "Show findings and inspector" }).click();
    await expect(page.getByRole("button", { name: "Focus PCB / schematic" })).toHaveAttribute("aria-pressed", "false");
  });
});
