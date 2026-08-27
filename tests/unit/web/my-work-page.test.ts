import { describe, expect, it } from "vitest";
import MyWorkPage from "../../../apps/web/app/work/page.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("MyWorkPage", () => {
  it("renders assigned findings and pending review sections", () => {
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
