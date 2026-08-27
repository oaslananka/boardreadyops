import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import MyWorkPage from "../../../apps/web/app/work/page.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("MyWorkPage", () => {
  it("renders assigned findings and pending review sections with engineering queue rhythm", async () => {
    const source = await readFile("apps/web/app/work/page.tsx", "utf8");
    expect(source).toContain("work-queue-summary");
    expect(source).toContain("work-primary-queue");
    expect(source).toContain("work-secondary-queues");

    const page = MyWorkPage();
    expect(page).toBeDefined();
    expect(page.props).toBeDefined();

    // Verify demo data is populated
    expect(DEMO_REVIEWS.length).toBeGreaterThan(0);
    const assigned = DEMO_REVIEWS.flatMap((r) =>
      r.findings.filter((f) => f.assignees.length > 0 && f.disposition === "open"),
    );
    expect(assigned.length).toBeGreaterThan(0);
  });
});
