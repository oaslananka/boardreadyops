import { describe, expect, it, vi } from "vitest";
import * as runDashboard from "../../../apps/web/lib/run-dashboard.js";
import { formatRunPageTitle, type RunDetail } from "../../../apps/web/lib/run-dashboard.js";
import * as viewerAuth from "../../../apps/web/lib/viewer-authorization.js";

const { generateMetadata: summaryMetadata } = await import("../../../apps/web/app/runs/[runId]/page.js");
const { generateMetadata: attemptsMetadata } = await import("../../../apps/web/app/runs/[runId]/attempts/page.js");

function sampleRun(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    repository: "acme/power-distribution",
    pullRequestNumber: 42,
    commitSha: "f8a92b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a",
    ...overrides,
  } as RunDetail;
}

describe("formatRunPageTitle", () => {
  it("uses the PR number as the run identity when one exists", () => {
    expect(formatRunPageTitle(sampleRun(), "Findings")).toBe("Findings · acme/power-distribution PR #42");
  });

  it("falls back to a short commit SHA for non-PR triggers", () => {
    expect(formatRunPageTitle(sampleRun({ pullRequestNumber: undefined }), "Audit")).toBe(
      "Audit · acme/power-distribution f8a92b3",
    );
  });
});

describe("run page generateMetadata carries run context in the browser title", () => {
  it("Summary page title names the repository and section instead of a generic 'Run'", async () => {
    vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
      status: "authenticated",
      session: {
        login: "acme-corp",
        name: "Acme Lead",
        email: "lead@acme.com",
        avatarUrl: "https://github.com/acme.png",
      },
    } as viewerAuth.ViewerAuthorizationResult);
    vi.spyOn(runDashboard, "loadRunDashboard").mockResolvedValue({ state: "found", run: sampleRun() });

    const metadata = await summaryMetadata({ params: Promise.resolve({ runId: "run-1" }) });
    expect(metadata.title).toBe("Summary · acme/power-distribution PR #42");
  });

  it("Attempts page falls back to a generic title when the run cannot be loaded", async () => {
    vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
      status: "authenticated",
      session: {
        login: "acme-corp",
        name: "Acme Lead",
        email: "lead@acme.com",
        avatarUrl: "https://github.com/acme.png",
      },
    } as viewerAuth.ViewerAuthorizationResult);
    vi.spyOn(runDashboard, "loadRunDashboard").mockResolvedValue({ state: "not-found" });

    const metadata = await attemptsMetadata({ params: Promise.resolve({ runId: "missing" }) });
    expect(metadata.title).toBe("Run");
  });
});
