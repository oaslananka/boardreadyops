import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("run dashboard page", () => {
  it("renders bounded lifecycle transition evidence with an empty state", () => {
    const page = readFileSync("apps/web/app/runs/[runId]/page.tsx", "utf8");

    expect(page).toContain("Lifecycle transitions");
    expect(page).toContain("No versioned lifecycle transition has been recorded for this run.");
    expect(page).toContain("transition.reasonCode");
    expect(page).toContain("transition.executionAttemptId");
    expect(page).toContain("transition.fromVersion");
    expect(page).toContain("transition.toVersion");
    expect(page).toContain("formatRunDate(transition.occurredAt)");
  });
});
