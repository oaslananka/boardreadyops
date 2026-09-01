import { describe, expect, it, vi } from "vitest";
import * as repositoryDashboard from "../../../apps/web/lib/repository-dashboard.js";
import * as viewerAuth from "../../../apps/web/lib/viewer-authorization.js";

const { generateMetadata } = await import("../../../apps/web/app/repositories/[repositoryId]/page.js");

describe("Repository page metadata", () => {
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
