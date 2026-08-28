import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Marketplace free-only listing surface", () => {
  it("does not advertise an external Stripe paid checkout on the public billing settings page", async () => {
    const page = await readFile("apps/web/app/settings/billing/page.tsx", "utf8");

    expect(page).toContain("Community");
    expect(page).not.toContain("Manage via Stripe Checkout");
    expect(page).not.toContain("Open Customer Portal");
    expect(page).not.toContain("$24 / contributor");
    expect(page).not.toContain("$55 / contributor");
  });
});
