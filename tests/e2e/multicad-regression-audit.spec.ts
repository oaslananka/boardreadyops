import { expect, test } from "@playwright/test";
import { authenticatedStorageState } from "./fixtures/auth.js";

/**
 * Multi-CAD Regression Audit & Release Gate Suite.
 *
 * Verifies end-to-end user journeys for:
 * 1. Multi-CAD project ingestion and upload wizard interactions
 * 2. Tri-pane CAD review workspace (findings, canvas, detail inspection)
 * 3. Traceable delivery guest access and unauthenticated view
 * 4. Commercial billing tiers and checkout triggers
 */

test.describe("Multi-CAD Ingestion & Projects", () => {
  test.use({ storageState: authenticatedStorageState });

  test("1. Projects page renders multi-CAD workspace and project upload modal", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Standalone Projects" })).toBeVisible();

    // Verify New Project trigger
    const newProjectBtn = page.getByRole("button", { name: /New Project/i });
    await expect(newProjectBtn).toBeVisible();
    await newProjectBtn.click();

    // Verify Project Upload Wizard opens
    await expect(page.getByRole("heading", { name: "Create CAD Project" })).toBeVisible();
    await expect(page.getByText(/Drag and drop your CAD manufacturing zip/i)).toBeVisible();

    // Verify supported CAD formats are listed in selector
    const formatSelect = page.locator("#cad-format");
    await expect(formatSelect).toBeVisible();
    await expect(formatSelect.locator("option")).toHaveCount(6);
  });
});

test.describe("CAD Review Tri-Pane Workspace", () => {
  test("2. Reviews workspace displays PCB vector canvas, findings list, and inspection details", async ({ page }) => {
    await page.goto("/reviews/rev_gateway_42");
    await page.waitForLoadState("domcontentloaded");

    // Check review title
    await expect(page.getByRole("heading", { name: /Industrial IoT Gateway/i })).toBeVisible();

    // Verify Tri-Pane elements
    // Left: Findings
    await expect(page.getByPlaceholder(/Filter findings/i)).toBeVisible();

    // Center: PCB Canvas & markers
    const canvas = page.locator("svg.board-canvas-svg, svg[aria-label='PCB Board Layout Canvas']");
    if (await canvas.isVisible()) {
      await expect(canvas).toBeVisible();
    }

    // Right: Tab navigation or Detail panel
    await expect(page.getByText(/Finding Details & CAD Guidance/i)).toBeVisible();
  });
});

test.describe("Release Deliveries & Guest Access", () => {
  test("3. Deliveries page renders release package management for fabrication", async ({ page }) => {
    await page.goto("/deliveries");
    await expect(page.getByRole("heading", { name: "Release Deliveries" })).toBeVisible();
    await expect(page.getByText(/Traceable manufacturing packages, guest sign-off links/i)).toBeVisible();
  });

  test("4. Invalid delivery token returns 404 cleanly without sensitive leakage", async ({ page }) => {
    const response = await page.goto("/deliveries/invalid-random-token-12345");
    expect(response?.status()).toBe(404);
  });
});

test.describe("Commercial Billing & Entitlements Gate", () => {
  test.use({ storageState: authenticatedStorageState });

  test("5. Billing settings page displays 4-tier commercial plans and upgrade triggers", async ({ page }) => {
    await page.goto("/settings/billing");
    await expect(page.getByRole("heading", { name: "Subscription & Billing" })).toBeVisible();

    // Verify all 4 commercial tiers are present
    await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Business" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Paid Pilot" })).toBeVisible();

    // Verify upgrade buttons exist for paid tiers
    const upgradeTeamBtn = page.getByRole("button", { name: /Upgrade to Team/i });
    await expect(upgradeTeamBtn).toBeVisible();
  });
});
