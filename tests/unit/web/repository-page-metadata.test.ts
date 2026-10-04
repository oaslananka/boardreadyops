import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as repositoryDashboard from "../../../apps/web/lib/repository-dashboard.js";
import * as viewerAuth from "../../../apps/web/lib/viewer-authorization.js";

const { generateMetadata } = await import("../../../apps/web/app/repositories/[repositoryId]/page.js");

describe("Repository page metadata", () => {
  it("shows acknowledgement state and an explicit action for unacknowledged supply findings", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/page.tsx", "utf8");

    expect(source).toContain('id: "acknowledgement"');
    expect(source).toContain('header: "Acknowledgement"');
    expect(source).toContain("finding.acknowledgedAt");
    expect(source).toContain("Acknowledged by");
    expect(source).toContain("SupplyFindingAcknowledgeButton");
    expect(source).toContain("acknowledgeSupplyFindingAction");
  });

  it("shows the persisted provider source beside open supply findings", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/page.tsx", "utf8");

    expect(source).toContain('id: "source"');
    expect(source).toContain('header: "Source"');
    expect(source).toContain("customerStatusLabel(finding.source)");
  });

  it("does not promise a first readiness run when deployment rollout excludes the repository", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/page.tsx", "utf8");
    expect(source).toContain("releaseRepositoryDispatchAvailability");
    expect(source).toContain("dispatch.enabled ? (");
    expect(source).toContain('title="Readiness runs are not enabled yet"');
    expect(source).toContain("<p>{dispatch.reason}</p>");
  });

  it("uses the real owner/name instead of a generic 'Repository' title", async () => {
    vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
      status: "authenticated",
      session: {
        login: "acme-corp",
        name: "Acme Lead",
        email: "lead@acme.com",
        avatarUrl: "https://github.com/acme.png",
      },
    } as viewerAuth.ViewerAuthorizationResult);

    vi.spyOn(repositoryDashboard, "loadRepositoryDetail").mockResolvedValue({
      repository: { id: "repo-1", owner: "acme-corp", name: "power-distribution", private: false },
      runs: [],
      supplyFindings: [],
    } as unknown as Awaited<ReturnType<typeof repositoryDashboard.loadRepositoryDetail>>);

    const metadata = await generateMetadata({ params: Promise.resolve({ repositoryId: "repo-1" }) });

    expect(metadata.title).toBe("acme-corp/power-distribution");
    expect(metadata.title).not.toBe("Repository");
  });

  it("falls back to a generic title when the repository cannot be loaded (no data to name it with)", async () => {
    vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
      status: "authenticated",
      session: {
        login: "acme-corp",
        name: "Acme Lead",
        email: "lead@acme.com",
        avatarUrl: "https://github.com/acme.png",
      },
    } as viewerAuth.ViewerAuthorizationResult);

    vi.spyOn(repositoryDashboard, "loadRepositoryDetail").mockResolvedValue(null);

    const metadata = await generateMetadata({ params: Promise.resolve({ repositoryId: "missing" }) });

    expect(metadata.title).toBe("Repository");
  });
});
