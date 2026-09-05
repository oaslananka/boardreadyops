import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MyWorkPage from "../../../apps/web/app/work/page.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("MyWorkPage", () => {
  it("renders assigned findings, awaiting-review, and changes-requested sections", () => {
    const markup = renderToStaticMarkup(createElement(MyWorkPage));
    expect(markup).toContain("Assigned Findings");
    expect(markup).toContain("Awaiting Your Review");

    const assigned = DEMO_REVIEWS.flatMap((r) =>
      r.findings.filter((f) => f.assignees.length > 0 && f.disposition === "open"),
    );
    expect(assigned.length).toBeGreaterThan(0);
    expect(markup).toContain(assigned[0]?.message);
  });
});
