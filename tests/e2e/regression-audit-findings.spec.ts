import { expect, test } from "@playwright/test";
import { demoReviewId } from "../../qa/audit/routes.js";
import { authenticatedStorageState } from "./fixtures/auth.js";

/**
 * Black-box regression coverage for findings from the 2026-09-01 UI/UX audit
 * (boardreadyops_uiux_prod_audit_2026-09-01.md), fixed across PRs #554-#562. Each test names
 * the finding id it guards. tests/unit/web already covers most of these at the component
 * level; this file re-verifies the same contracts against a real browser and real navigation,
 * which is the failure class component tests can't see (hydration timing, actual URL state,
 * actual localStorage).
 */

test.describe("P0 fixes", () => {
  test("P0-05: Discussion 'Mark Resolved' persists across reload", async ({ page }) => {
    // The fix made this a real PATCH to /api/v1/reviews/:id/comments -- server-authoritative,
    // which is the whole point (see the commit that fixed P0-05), but it means the mutation
    // needs DATABASE_URL to actually succeed rather than just changing local React state.
    test.skip(!process.env.DATABASE_URL, "Discussion resolve is a real API mutation; needs DATABASE_URL");
    await page.goto(`/reviews/${demoReviewId}?tab=discussion`);
    const resolveButton = page.locator("button.button-small").first();
    await resolveButton.waitFor({ state: "visible" });

    const wasResolved = (await resolveButton.textContent())?.includes("Resolved");
    await resolveButton.click();
    await page.waitForTimeout(500);

    await page.reload();
    const afterReload = page.locator("button.button-small").first();
    await afterReload.waitFor({ state: "visible" });
    const isResolvedAfterReload = (await afterReload.textContent())?.includes("Resolved");

    // Persistence, not a specific direction: whichever way the click flipped it, a reload must
    // not silently revert to the pre-click state the way the pre-fix local-only version did.
    expect(isResolvedAfterReload).toBe(!wasResolved);
  });

  test("P0-03 (fixed): every review the registry lists also resolves when opened", async ({ page }) => {
    // The listing and the detail loader now share one predicate for whether this deployment
    // serves fixtures, so a Postgres deployment can no longer list a demo review that then 404s.
    // Previously `rev_gateway_*` fell back to a fixture unconditionally while every other demo id
    // only did so outside Postgres -- the split the 2026-09-01 audit found in production.
    await page.goto("/reviews");
    const links = await page
      .locator('a[href^="/reviews/rev_"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
    expect(links.length, "expected the registry to list at least one review").toBeGreaterThan(0);

    for (const href of new Set(links)) {
      const response = await page.goto(href);
      expect(response?.status(), `${href} is listed on /reviews but does not resolve`).toBeLessThan(400);
    }
  });
});

test.describe("P1-16: policy delete confirmation (authenticated)", () => {
  test.use({ storageState: authenticatedStorageState });

  test("policy delete requires confirmation before calling the API", async ({ page }) => {
    await page.goto("/policies");
    const deleteButton = page.locator("button.button-delete").first();
    if ((await deleteButton.count()) === 0) {
      test.skip(true, "No policies seeded in this environment to exercise delete on");
      return;
    }
    await deleteButton.click();
    const dialog = page.getByRole("dialog", { name: /Delete Policy/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe("P1/P2 fixes", () => {
  test("P2-01: sidebar collapse state survives a route change", async ({ page }) => {
    await page.goto("/reviews");
    const toggle = page.locator(".product-compact-toggle");
    // The button exists in the server-rendered HTML before React hydrates its onClick handler;
    // clicking too early is a no-op, same hydration race review-lifecycle.spec.ts's
    // openReviewAndWaitForHydration() guards against.
    await toggle.waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    await toggle.click();
    await expect(page.locator("aside.product-rail")).toHaveAttribute("data-compact", "true");

    await page.goto("/setup");
    await expect(page.locator("aside.product-rail")).toHaveAttribute("data-compact", "true");
  });

  test("P2-03: no fake 'Search ⌘K' hint anywhere in the shell", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".command-hint")).toHaveCount(0);
  });

  test("P2-04: settings subnav marks the current page with aria-current", async ({ page }) => {
    await page.goto("/settings/security");
    await expect(page.locator('a.settings-nav-link[href="/settings/security"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator('a.settings-nav-link[href="/settings/billing"]')).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("P3-01: page titles don't double the BoardReadyOps suffix", async ({ page }) => {
    await page.goto("/reviews");
    await expect(page).toHaveTitle(/^(?!.*BoardReadyOps.*BoardReadyOps).*$/);
    await page.goto("/settings/billing");
    await expect(page).toHaveTitle(/^(?!.*BoardReadyOps.*BoardReadyOps).*$/);
  });
});
