import { expect, type Page, test } from "@playwright/test";
import { expectDialogContract } from "../../qa/audit/dialog-contract.js";
import { demoReviewId } from "../../qa/audit/routes.js";

/**
 * Regression coverage for P1-02 (2026-09-01 UI/UX audit): approval/decision modals had no
 * focus management at all -- opening one left focus on <body>, Escape did nothing, Tab could
 * reach the page behind the modal, and closing never restored focus. Fixed by the shared
 * Dialog primitive in apps/web/components/dialog.tsx; this file is the black-box contract that
 * catches a regression in either that primitive or a modal that stops using it.
 */

async function openReviewAndWaitForHydration(page: Page) {
  await page.goto(`/reviews/${demoReviewId}`);
  await page
    .getByRole("button", { name: /Approve/i })
    .first()
    .waitFor({ state: "visible" });
  await page.waitForTimeout(1000);
}

test.describe("Dialog contract", () => {
  test("ApprovalModal satisfies the dialog contract", async ({ page }) => {
    await openReviewAndWaitForHydration(page);
    const trigger = page
      .getByRole("button", { name: "Approve review" })
      .or(page.getByRole("button", { name: "Approve" }))
      .first();

    await expectDialogContract(page, {
      open: () => trigger.click(),
      triggerLocator: trigger,
      accessibleName: /Sign-Off|Approve|Approval/i,
    });
  });

  test("DecisionModal (opened via a finding's disposition select) satisfies the dialog contract", async ({ page }) => {
    await openReviewAndWaitForHydration(page);
    const findingsTab = page.getByRole("tab").filter({ hasText: "Findings" });
    await findingsTab.click();
    await expect(findingsTab).toHaveAttribute("aria-selected", "true");

    const select = page.locator(".finding-triage-card").first().locator(".disposition-select");

    await expectDialogContract(page, {
      open: async () => {
        // A real user always focuses a <select> (mouse or keyboard) before its value changes;
        // Playwright's selectOption() can fire the change without reliably leaving that focus
        // behind first, which made this test observe a false "focus didn't restore" failure --
        // verified manually that the real interaction does focus it. Matching real usage here.
        await select.focus();
        await select.selectOption("accepted_risk");
      },
      triggerLocator: select,
      accessibleName: /Record Finding Decision/i,
    });
  });
});
