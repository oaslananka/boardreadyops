import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { viewerMock, repositoriesMock, capabilitiesMock, rolloutMock } = vi.hoisted(() => ({
  viewerMock: vi.fn(),
  repositoriesMock: vi.fn(),
  capabilitiesMock: vi.fn(),
  rolloutMock: vi.fn(),
}));

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({ viewerAuthorization: viewerMock }));
vi.mock("../../../apps/web/lib/repository-dashboard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../apps/web/lib/repository-dashboard.js")>()),
  loadViewerRepositories: repositoriesMock,
}));
vi.mock("../../../apps/web/lib/installation-capabilities.js", () => ({
  loadInstallationCapabilities: capabilitiesMock,
}));
vi.mock("../../../apps/web/lib/release-rollout.js", () => ({
  releaseRepositoryDispatchAvailability: rolloutMock,
}));

import SetupPage from "../../../apps/web/app/setup/page.js";
import { RepositorySetupInteractive } from "../../../apps/web/components/repository-setup-interactive.js";

function findSetup(node: ReactNode): { repositories: readonly Record<string, unknown>[] } | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findSetup(item);
      if (found) return found;
    }
  }
  if (!isValidElement(node)) return undefined;
  if (node.type === RepositorySetupInteractive) {
    return node.props as { repositories: readonly Record<string, unknown>[] };
  }
  return findSetup((node.props as { children?: ReactNode }).children);
}

describe("repository setup installation grant scope", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rolloutMock.mockImplementation((name: string) =>
      name.startsWith("alpha/")
        ? { enabled: false, reason: "Full readiness runs are not enabled for alpha yet." }
        : { enabled: true },
    );
    viewerMock.mockResolvedValue({ session: { userId: "user-1", login: "engineer" } });
    repositoriesMock.mockResolvedValue([
      {
        repositories: [
          { id: "repo-a", owner: "alpha", name: "board-a", githubInstallationId: 101 },
          { id: "repo-b", owner: "alpha", name: "board-b", githubInstallationId: 101 },
        ],
      },
      { repositories: [{ id: "repo-c", owner: "beta", name: "board-c", githubInstallationId: 202 }] },
    ]);
    capabilitiesMock.mockImplementation(async (installationId: number) => ({
      githubInstallationId: installationId,
      permissions: { actions: installationId === 101 ? "read" : "write" },
      missing: [],
      actions:
        installationId === 101
          ? [
              { id: "setup", satisfied: false, userExplanation: "Only alpha lacks setup grants." },
              { id: "validate-setup", satisfied: false, userExplanation: "Only alpha lacks Actions grants." },
            ]
          : [
              { id: "setup", satisfied: true },
              { id: "validate-setup", satisfied: true },
            ],
      manageUrl: `https://github.com/settings/installations/${installationId}`,
    }));
  });

  it("fetches once per installation and never borrows the first installation's grants for another repository", async () => {
    const setup = findSetup(await SetupPage({ searchParams: Promise.resolve({}) }));
    expect(setup).toBeDefined();
    expect(repositoriesMock).toHaveBeenCalledOnce();
    expect(capabilitiesMock).toHaveBeenCalledTimes(2);
    expect(capabilitiesMock.mock.calls.map(([id]) => id).sort()).toEqual([101, 202]);
    const first = setup?.repositories[0];
    const second = setup?.repositories[1];
    const otherOwner = setup?.repositories[2];
    expect(first?.setupBlockedReason).toBe("Only alpha lacks setup grants.");
    expect(first?.readinessBlockedReason).toBe("Only alpha lacks Actions grants.");
    expect(first?.installationGrants).toMatchObject({
      permissions: { actions: "read" },
      manageUrl: "https://github.com/settings/installations/101",
    });
    expect(second?.installationGrants).toEqual(first?.installationGrants);
    expect(first?.readinessRunBlockedReason).toBe("Full readiness runs are not enabled for alpha yet.");
    expect(second?.readinessRunBlockedReason).toBe(first?.readinessRunBlockedReason);
    expect(otherOwner?.readinessRunBlockedReason).toBeUndefined();
    expect(rolloutMock.mock.calls.map(([name]) => name)).toEqual(["alpha/board-a", "alpha/board-b", "beta/board-c"]);
    expect(otherOwner?.setupBlockedReason).toBeUndefined();
    expect(otherOwner?.readinessBlockedReason).toBeUndefined();
    expect(otherOwner?.installationGrants).toMatchObject({
      permissions: { actions: "write" },
      manageUrl: "https://github.com/settings/installations/202",
    });
  });

  it("does not substitute another owner's grants when one installation lookup fails", async () => {
    capabilitiesMock.mockImplementation(async (id: number) =>
      id === 202
        ? undefined
        : {
            githubInstallationId: id,
            permissions: { actions: "read" },
            missing: [],
            actions: [{ id: "setup", satisfied: false, userExplanation: "Missing permission." }],
            manageUrl: "https://github.com/settings/installations/101",
          },
    );
    const setup = findSetup(await SetupPage({ searchParams: Promise.resolve({}) }));
    expect(setup?.repositories[0]?.setupBlockedReason).toBe("Missing permission.");
    expect(setup?.repositories[2]?.installationGrants).toBeUndefined();
    expect(setup?.repositories[2]?.setupBlockedReason).toBeUndefined();
    // Unavailable GitHub grants must not suppress independently known rollout status.
    expect(setup?.repositories[0]?.readinessRunBlockedReason).toBe(
      "Full readiness runs are not enabled for alpha yet.",
    );
  });
});
