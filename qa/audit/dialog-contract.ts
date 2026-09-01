import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Reusable WAI-ARIA dialog contract, per docs/qa-agent.md section "Modal contract". Every
 * BoardReadyOps modal (ApprovalModal, DecisionModal, the Policies delete confirmation, and any
 * future one built on apps/web/components/dialog.tsx) is expected to satisfy this.
 *
 * `open` must leave the dialog visible and return nothing; the assertions below take it from
 * there. `triggerLocator` is only used to verify focus returns to it on close.
 */
export async function expectDialogContract(
  page: Page,
  options: {
    open: () => Promise<void>;
    triggerLocator: Locator;
    /** Regex or string matched against the dialog's accessible name (aria-labelledby target). */
    accessibleName: string | RegExp;
  },
): Promise<Locator> {
  await options.open();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAccessibleName(options.accessibleName);

  // 1. Initial focus moves into the dialog, not left on <body> or the trigger.
  await expect(dialog.locator(":focus")).toHaveCount(1);

  // 2. Tab from the last focusable element wraps back to the first (focus trap), not out of
  // the dialog and onto whatever the app renders behind it.
  const focusableSelector =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusable = dialog.locator(focusableSelector);
  const focusableCount = await focusable.count();
  if (focusableCount > 1) {
    await focusable.last().focus();
    await page.keyboard.press("Tab");
    await expect(focusable.first()).toBeFocused();
  }

  // 3. Escape closes it and returns focus to the trigger.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(options.triggerLocator).toBeFocused();

  return dialog;
}
