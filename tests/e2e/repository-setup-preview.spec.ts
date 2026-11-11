import { expect, test } from "@playwright/test";

/**
 * An unconnected visitor must have one useful first step. Preset/YAML controls
 * are only meaningful after an authorized GitHub repository has been chosen.
 * Connected repository variants are tested in the setup component, page, and
 * PostgreSQL installation-scope contract suites.
 */
test("@smoke signed-out setup offers one action and hides premature policy or YAML controls", async ({ page }) => {
  await page.goto("/setup?preset=open-source");
  await expect(page.getByRole("heading", { name: "First, connect your GitHub account" })).toBeVisible();
  const signIn = page.getByLabel("Choose your GitHub repository").getByRole("link", { name: "Sign in with GitHub" });
  await expect(signIn).toHaveCount(1);
  await expect(signIn).toHaveAttribute("href", "/api/auth/github/login");
  await expect(page.locator("#policy-preset")).toHaveCount(0);
  await expect(page.locator("#automated-setup")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Validate readiness" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy YAML" })).toHaveCount(0);

  await page.goto("/setup?preset=production");
  await expect(page.getByRole("heading", { name: "First, connect your GitHub account" })).toBeVisible();
  await expect(page.locator("#policy-preset")).toHaveCount(0);
});

test("@smoke an unsupported legacy preset cannot bypass the repository selection gate", async ({ page }) => {
  await page.goto("/setup?preset=contract-design");
  await expect(page.getByRole("heading", { name: "First, connect your GitHub account" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Preview Contract design handoff" })).toHaveCount(0);
  await expect(
    page.getByLabel("Choose your GitHub repository").getByRole("link", { name: "Sign in with GitHub" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open setup pull request" })).toHaveCount(0);
  await expect(page.locator("#policy-preset")).toHaveCount(0);
  await expect(page.getByText("Setup is already verified")).toHaveCount(0);
});
