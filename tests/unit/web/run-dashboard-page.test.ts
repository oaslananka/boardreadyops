import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync("apps/web/components/run-investigation.tsx", "utf8");
const styles = readFileSync("apps/web/app/styles.css", "utf8");
const liveRefreshComponent = existsSync("apps/web/components/run-live-refresh.tsx")
  ? readFileSync("apps/web/components/run-live-refresh.tsx", "utf8")
  : "";
const lifecycleDocumentation = readFileSync("docs/product/run-lifecycle.md", "utf8");

describe("run investigation routes", () => {
  it("provides route-level navigation and shared investigation components", () => {
    for (const route of ["attempts", "findings", "artifacts", "publication", "audit"]) {
      expect(readFileSync(`apps/web/app/runs/[runId]/${route}/page.tsx`, "utf8")).toContain(`active="${route}"`);
    }
    expect(component).toContain('aria-label="Run investigation"');
    expect(component).toContain("Breadcrumbs");
    for (const sharedComponent of ["RunHeader", "AttemptTimeline", "FindingList", "ArtifactTable"]) {
      expect(component).toContain(`export function ${sharedComponent}`);
    }
    expect(component).toContain("Lifecycle transitions");
    expect(component).toContain("No lifecycle transitions");
  });

  it("keeps active run pages current through reconnectable normalized refreshes", () => {
    expect(liveRefreshComponent).toContain('"use client"');
    expect(liveRefreshComponent).toContain("router.refresh()");
    expect(liveRefreshComponent).toContain("Live status updates");
    expect(liveRefreshComponent).toContain('<output className="live-refresh-status">');
    expect(liveRefreshComponent).not.toContain('role="status"');
    expect(component).toContain("RunLiveRefresh");
    expect(component).toContain("liveRefresh");
    expect(lifecycleDocumentation).toContain("five-second server refresh");
    expect(lifecycleDocumentation).toContain("paused while the page is hidden or offline");
    for (const route of [
      "page.tsx",
      "attempts/page.tsx",
      "findings/page.tsx",
      "artifacts/page.tsx",
      "publication/page.tsx",
      "audit/page.tsx",
    ]) {
      const page = readFileSync(`apps/web/app/runs/[runId]/${route}`, "utf8");
      expect(page).toContain("shouldLiveRefreshRun");
      expect(page).toContain("liveRefresh={");
    }
  });

  it("uses semantic, non-color-only status and bounded investigation controls", () => {
    expect(component).toContain("StatusBadge");
    expect(component).toContain("Search findings");
    expect(component).toContain('name="findingGroup"');
    expect(component).toContain("findingsPage");
    expect(component).toContain("Search artifacts");
    expect(component).toContain('name="artifactKind"');
    expect(component).toContain('name="artifactSort"');
    expect(component).toContain("artifactsPage");
    expect(component).toContain("Copy SHA-256");
    expect(component).toContain("no automatic age-based expiry");
    expect(component).toContain("Artifact lifecycle history");
    expect(component).toContain("Deleted objects");
    expect(component).toContain("Already missing");
    expect(component).toContain("Deletion pending");
    expect(component).toContain("Deletion failed");
    expect(component).toContain("Open GitHub checks");
    expect(component).toContain("Operator authentication required");
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain(".status-icon");
    expect(styles).toContain(".sr-only");
  });

  it("defines explicit loading, failure, unavailable, expired, stale, recovery, and partial states", () => {
    expect(readFileSync("apps/web/app/runs/[runId]/loading.tsx", "utf8")).toContain("Loading this run");
    expect(readFileSync("apps/web/app/runs/[runId]/error.tsx", "utf8")).toContain("Could not load this run");
    const notFoundPage = readFileSync("apps/web/app/runs/[runId]/not-found.tsx", "utf8");
    expect(notFoundPage).toContain("This run is not available");
    expect(notFoundPage).toContain("a repository you cannot see");
    expect(notFoundPage).toContain("aged out");
    expect(component).toContain("This run may be stale");
    expect(component).toContain("Reconciliation is active");
    expect(component).toContain("Recovery requires operator action");
    expect(component).toContain("This run has partial data");
    expect(component).toContain("A newer run superseded this result");
  });
});
