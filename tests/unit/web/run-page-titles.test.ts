import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as runDashboard from "../../../apps/web/lib/run-dashboard.js";
import { formatRunPageTitle, type RunDetail } from "../../../apps/web/lib/run-dashboard.js";
import * as viewerAuth from "../../../apps/web/lib/viewer-authorization.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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
  it("Summary page passes its runId, section, and the viewer's authorizer to resolveRunPageTitle", async () => {
    vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
      session: {
        login: "acme-corp",
        name: "Acme Lead",
        email: "lead@acme.com",
        avatarUrl: "https://github.com/acme.png",
      },
      authorizeRepository: vi.fn().mockResolvedValue(true),
      authorizeInstallation: vi.fn().mockResolvedValue(true),
    } as unknown as viewerAuth.ViewerAuthorization);
    const resolveSpy = vi
      .spyOn(runDashboard, "resolveRunPageTitle")
      .mockResolvedValue("Summary · acme/power-distribution PR #42");

    const metadata = await summaryMetadata({ params: Promise.resolve({ runId: "run-1" }) });

    expect(metadata.title).toBe("Summary · acme/power-distribution PR #42");
    expect(resolveSpy).toHaveBeenCalledWith("run-1", "Summary", expect.any(Function));
  });

  it("Attempts page carries through resolveRunPageTitle's fallback when the run cannot be loaded", async () => {
    vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
      session: {
        login: "acme-corp",
        name: "Acme Lead",
        email: "lead@acme.com",
        avatarUrl: "https://github.com/acme.png",
      },
      authorizeRepository: vi.fn().mockResolvedValue(true),
      authorizeInstallation: vi.fn().mockResolvedValue(true),
    } as unknown as viewerAuth.ViewerAuthorization);
    vi.spyOn(runDashboard, "resolveRunPageTitle").mockResolvedValue("Run");

    const metadata = await attemptsMetadata({ params: Promise.resolve({ runId: "missing" }) });
    expect(metadata.title).toBe("Run");
  });
});

describe("resolveRunPageTitle", () => {
  // No DATABASE_URL in this test environment: loadRunDashboard serves the built-in demo run for
  // an id starting with "demo" when NODE_ENV is "development" or "test", and reports
  // "not-configured" for anything else -- real, unmocked branches of the same code the page
  // components call.
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    // CI sets DATABASE_URL at the workflow level for every job (see ci.yml), including this one,
    // which has no reachable Postgres -- clear it so loadRunDashboard takes the "not-configured"
    // branch this suite is actually testing, instead of trying a real connection and ECONNREFUSING.
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("returns the formatted title for the demo run", async () => {
    const title = await runDashboard.resolveRunPageTitle("demo-1", "Summary", undefined);
    expect(title).toBe("Summary · boardreadyops/drone-flight-controller PR #42");
  });

  it("falls back to a generic title when the run cannot be loaded", async () => {
    const title = await runDashboard.resolveRunPageTitle("not-a-demo-run", "Attempts", undefined);
    expect(title).toBe("Run");
  });
});
