import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunReviewPath, RunReviewQueue } from "../../../apps/web/components/run-review-queue.js";
import type { RunListingEntry } from "../../../apps/web/lib/run-listing.js";
import { nextRunReviewAction } from "../../../apps/web/lib/run-review-action.js";

function run(id: string, overrides: Partial<RunListingEntry> = {}): RunListingEntry {
  return {
    id,
    repositoryId: "repo-1",
    repository: "owner/hardware",
    status: "completed",
    decision: "pass",
    commitSha: "a".repeat(40),
    ref: "refs/heads/main",
    pullRequestNumber: 3,
    startedAt: "2026-11-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("recorded Run review journey", () => {
  it("sends unfinished checks to live run status rather than the findings or release path", () => {
    expect(nextRunReviewAction(run("queued", { status: "queued", decision: undefined }))).toMatchObject({
      href: "/runs/queued",
      label: "Track this check",
    });
    expect(nextRunReviewAction(run("failed", { status: "failed", decision: undefined }))).toMatchObject({
      href: "/runs/failed",
      label: "Inspect incomplete check",
    });
  });

  it("prioritizes actual findings and never turns a passing check into manufacturing approval", () => {
    expect(nextRunReviewAction(run("blocked", { decision: "fail" }))).toMatchObject({
      href: "/runs/blocked/findings",
      label: "Investigate findings",
    });
    const passing = nextRunReviewAction(run("passed"));
    expect(passing).toMatchObject({ href: "/runs/passed/artifacts", label: "Verify recorded evidence" });
    expect(passing.description).toContain("not fabrication approval");
    expect(nextRunReviewAction(run("unknown", { decision: undefined })).href).toBe("/runs/unknown");
  });

  it("renders at most three authorized listed runs with an actionable route for each", () => {
    const html = renderToStaticMarkup(
      createElement(RunReviewQueue, {
        runs: [
          run("first", { decision: "fail" }),
          run("second", { status: "running", decision: undefined }),
          run("third"),
          run("foreign-should-not-render"),
        ],
      }),
    );
    expect(html).toContain("Continue a hardware review");
    expect(html).toContain('href="/runs/first/findings"');
    expect(html).toContain('href="/runs/second"');
    expect(html).toContain('href="/runs/third/artifacts"');
    expect(html).not.toContain("foreign-should-not-render");
    expect(html).toContain("not a fabrication authorization");
  });

  it("links the authenticated run to its board, findings and repository-scoped Review history", () => {
    const html = renderToStaticMarkup(createElement(RunReviewPath, { run: run("a/b", { decision: "fail" }) }));
    expect(html).toContain('href="/runs/a%2Fb/design"');
    expect(html).toContain('href="/runs/a%2Fb/findings"');
    expect(html).toContain('href="/runs/a%2Fb/artifacts"');
    expect(html).toContain('href="/reviews?repository=owner%2Fhardware"');
    expect(html).toContain("Delivery requires separate authorization");
    expect(html).not.toContain("Manufacturing approved");
  });

  it("does not invent repository Review links for malformed repository identities", () => {
    const html = renderToStaticMarkup(
      createElement(RunReviewPath, { run: run("safe", { repository: "invalid-repo-name" }) }),
    );
    expect(html).not.toContain("/reviews?repository=");
    expect(html).toContain('href="/runs/safe/findings"');
  });
});
