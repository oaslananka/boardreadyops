import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunStateIndicators } from "../../../apps/web/components/run-state-indicators.js";

describe("RunStateIndicators", () => {
  it("distinguishes execution from a failing engineering decision", () => {
    const html = renderToStaticMarkup(createElement(RunStateIndicators, { status: "completed", decision: "fail" }));
    expect(html).toContain("Execution: Completed");
    expect(html).toContain("Decision: Fail");
  });

  it("does not invent a decision for a queued or running job", () => {
    for (const status of ["queued", "running"]) {
      const html = renderToStaticMarkup(createElement(RunStateIndicators, { status, decision: undefined }));
      expect(html).toContain(`Execution: ${status === "queued" ? "Queued" : "Running"}`);
      expect(html).not.toContain("Decision:");
    }
  });
});
