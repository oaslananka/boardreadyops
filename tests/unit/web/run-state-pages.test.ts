import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RunError from "../../../apps/web/app/runs/[runId]/error.js";
import LoadingRun from "../../../apps/web/app/runs/[runId]/loading.js";
import RunNotFound from "../../../apps/web/app/runs/[runId]/not-found.js";

describe("run route state pages", () => {
  it("renders loading inside the shared premium state surface", () => {
    const loadingMarkup = renderToStaticMarkup(createElement(LoadingRun));

    expect(loadingMarkup).toContain("Loading run investigation");
    expect(loadingMarkup).toContain('aria-busy="true"');
    expect(loadingMarkup).toContain("run-state-surface");
  });

  it("renders not-found inside the shared premium state surface", () => {
    const notFoundMarkup = renderToStaticMarkup(createElement(RunNotFound));

    expect(notFoundMarkup).toContain("Run not found or no longer available");
    expect(notFoundMarkup).toContain("Return home");
    expect(notFoundMarkup).toContain("run-state-surface");
  });

  it("keeps error privacy copy, support digest, and retry action", () => {
    const reset = vi.fn();
    const errorMarkup = renderToStaticMarkup(
      createElement(RunError, { error: Object.assign(new Error("internal"), { digest: "support-ref" }), reset }),
    );

    expect(errorMarkup).toContain("Run investigation could not be loaded");
    expect(errorMarkup).toContain("without exposing database or tenant details");
    expect(errorMarkup).toContain("support-ref");
    expect(errorMarkup).toContain("Retry");
    expect(errorMarkup).toContain("run-state-surface");
    expect(errorMarkup).not.toContain("internal");
  });
});
