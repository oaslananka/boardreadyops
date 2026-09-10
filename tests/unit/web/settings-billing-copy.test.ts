import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const billingSurfaces = [
  "apps/web/app/settings/billing/page.tsx",
  "apps/web/app/settings/settings-nav.tsx",
  "tests/e2e/multicad-regression-audit.spec.ts",
] as const;

describe("billing UI copy", () => {
  it("uses Billing & Plans consistently across navigation, title, heading, and E2E contract", async () => {
    const content = (await Promise.all(billingSurfaces.map((path) => readFile(path, "utf8")))).join("\n");

    expect(content).toContain("Billing & Plans");
    expect(content).not.toMatch(
      /Billing & Seats|Billing & Subscriptions|Subscription & Billing|Workspace Subscription & Plans/u,
    );
  });
});
