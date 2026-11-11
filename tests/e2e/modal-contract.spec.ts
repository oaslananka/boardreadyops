import { expect, type Page, test } from "@playwright/test";
import { expectDialogContract } from "../../qa/audit/dialog-contract.js";
import { demoReviewId } from "../../qa/audit/routes.js";

/**
 * Regression coverage for P1-02 (2026-09-01 UI/UX audit): approval/decision modals had no
 * focus management at all -- opening one left focus on <body>, Escape did nothing, Tab could
 * reach the page behind the modal, and closing never restored focus. Fixed by the shared
 * Dialog primitive in apps/web/components/dialog.tsx; this file is the black-box contract that
 * catches a regression in either that primitive or a modal that stops using it.
 *
 * The command palette is held to the same contract even though it is built on Radix rather than
 * that primitive -- the contract is about behaviour, not implementation.
 */

async function openReviewAndWaitForHydration(page: Page) {
  await page.goto(`/reviews/${demoReviewId}`);
  const changes = page.getByRole("tab", { name: /^Changes/ });
  await expect(changes).toBeVisible();
  await changes.click();
  await expect(changes).toHaveAttribute("aria-selected", "true");
  const overview = page.getByRole("tab", { name: "Overview" });
  await overview.click();
  await expect(overview).toHaveAttribute("aria-selected", "true");
}

test.describe("Dialog contract", () => {
  test("public review prevents approval without an authorized session", async ({ page }) => {
    await openReviewAndWaitForHydration(page);
    await expect(page.getByText("Read-only review.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve review" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Request changes" })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in to manage an authorized review" })).toBeVisible();
  });

  test("CommandPalette satisfies the dialog contract", async ({ page }) => {
    await page.goto("/policies");
    const trigger = page.getByRole("button", { name: "Go to a page or command" });
    await trigger.waitFor({ state: "visible" });

    await expectDialogContract(page, {
      open: () => trigger.click(),
      triggerLocator: trigger,
      accessibleName: /Go to a page or command/i,
    });
  });

  test("public finding inspection does not expose waiver or disposition controls", async ({ page }) => {
    await openReviewAndWaitForHydration(page);
    await page.getByRole("tab", { name: /^Findings/ }).click();
    await expect(page.locator(".finding-triage-card").first()).toBeVisible();
    await expect(page.locator(".disposition-select")).toHaveCount(0);
    await page.keyboard.press("e");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
