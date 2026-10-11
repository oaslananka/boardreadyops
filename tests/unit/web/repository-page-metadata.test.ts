import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as repositoryDashboard from "../../../apps/web/lib/repository-dashboard.js";
import * as viewerAuth from "../../../apps/web/lib/viewer-authorization.js";

const { default: RepositoryPage, generateMetadata } = await import(
  "../../../apps/web/app/repositories/[repositoryId]/page.js"
);

describe("Repository page metadata", () => {
  it("shows explicit time-bound suppression controls and active suppression state", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/page.tsx", "utf8");
    const control = readFileSync("apps/web/components/supply-finding-suppression-control.tsx", "utf8");

    expect(source).toContain('id: "alert-policy"');
    expect(source).toContain('header: "Alert policy"');
    expect(source).toContain("SupplyFindingSuppressionControl");
    expect(source).toContain("suppressSupplyFindingAction");
    expect(source).toContain("clearSupplyFindingSuppressionAction");
    expect(control).toContain('name="reason"');
    expect(control).toContain('name="duration"');
    expect(control).toContain('"1d"');
    expect(control).toContain('"7d"');
    expect(control).toContain('"30d"');
    expect(control).toContain("Resume alerts");
  });

  it("shows acknowledgement state and an explicit action for unacknowledged supply findings", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/page.tsx", "utf8");

    expect(source).toContain('id: "acknowledgement"');
    expect(source).toContain('header: "Acknowledgement"');
    expect(source).toContain("finding.acknowledgedAt");
    expect(source).toContain("Acknowledged by");
    expect(source).toContain("SupplyFindingAcknowledgeButton");
    expect(source).toContain("acknowledgeSupplyFindingAction");
  });

  it("uses the durable finding id as the supply table row key", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/page.tsx", "utf8");

    expect(source).toContain("rowKey={(finding) => finding.id}");
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

  it("renders distinct persisted board IDs and exact source evidence without inventing release authorization", async () => {
    vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
      status: "authenticated",
      session: {
        login: "acme-corp",
        installationIds: [12345],
      },
    } as unknown as viewerAuth.ViewerAuthorizationResult);
    vi.spyOn(repositoryDashboard, "loadRepositoryDetail").mockResolvedValue({
      repository: {
        id: "repo-1",
        owner: "acme",
        name: "gateway",
        private: true,
        githubInstallationId: 12345,
        latestRunId: "run-a",
        latestRunDecision: "fail",
        openFindings: 1,
        watchedBoards: 0,
      },
      runs: [],
      supplyFindings: [],
      boards: [
        {
          id: "board-a",
          displayName: "Mainboard",
          projectPath: "hardware/mainboard/mainboard.kicad_pro",
          archived: false,
          latestBom: {
            commitSha: "a".repeat(40),
            runCommitSha: "a".repeat(40),
            runId: "run-a",
            componentCount: 14,
            capturedAt: "2026-10-11T00:00:00Z",
          },
        },
        {
          id: "board-b",
          displayName: "Sensor",
          projectPath: "hardware/sensor/sensor.kicad_pro",
          archived: true,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof repositoryDashboard.loadRepositoryDetail>>);

    const html = renderToStaticMarkup(await RepositoryPage({ params: Promise.resolve({ repositoryId: "repo-1" }) }));
    expect(html).toContain("Recorded boards and BOM history");
    expect(html).toContain("Mainboard");
    expect(html).toContain('href="/repositories/repo-1/boards/board-a"');
    expect(html).toContain('href="/repositories/repo-1/boards/board-b"');
    expect(html).toContain("hardware/mainboard/mainboard.kicad_pro");
    expect(html).toContain("Sensor");
    expect(html).toContain("No BOM snapshot recorded");
    expect(html).toContain("Archived board record");
    expect(html).toContain("14 recorded components");
    expect(html).toContain('href="/runs/run-a"');
    expect(html).toContain(
      `href="https://github.com/acme/gateway/blob/${"a".repeat(40)}/hardware/mainboard/mainboard.kicad_pro"`,
    );
    expect(html).toContain("not a board-level Review approval");
    expect(html).not.toContain("Ready for Fabrication");
  });

  it("does not treat a mismatching snapshot and Run commit as source-bound evidence", async () => {
    vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
      status: "authenticated",
      session: { login: "acme", installationIds: [12345] },
    } as unknown as viewerAuth.ViewerAuthorizationResult);
    vi.spyOn(repositoryDashboard, "loadRepositoryDetail").mockResolvedValue({
      repository: {
        id: "repo-1",
        owner: "acme",
        name: "gateway",
        private: true,
        githubInstallationId: 12345,
        latestRunId: "run-source",
        watchedBoards: 0,
        openFindings: 0,
      },
      runs: [],
      supplyFindings: [],
      boards: [
        {
          id: "board-a",
          displayName: "Mainboard",
          projectPath: "hardware/mainboard/mainboard.kicad_pro",
          archived: false,
          latestBom: {
            commitSha: "a".repeat(40),
            runCommitSha: "b".repeat(40),
            runId: "run-source",
            componentCount: 3,
            capturedAt: "2026-10-11T00:00:00Z",
          },
        },
      ],
    } as unknown as Awaited<ReturnType<typeof repositoryDashboard.loadRepositoryDetail>>);

    const html = renderToStaticMarkup(await RepositoryPage({ params: Promise.resolve({ repositoryId: "repo-1" }) }));
    expect(html).toContain("Captured source differs from recorded Run commit");
    expect(html).toContain(`Recorded Run commit: ${"b".repeat(40)}`);
    expect(html).toContain('href="/runs/run-source"');
    expect(html).toContain('href="/repositories/repo-1/boards/board-a"');
    expect(html).not.toContain("Open project at this commit");
    expect(html).not.toContain("https://github.com/acme/gateway/blob/");
  });

  it("does not offer a source link for an unsafe persisted project path", async () => {
    vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
      status: "authenticated",
      session: { login: "acme-corp", installationIds: [12345] },
    } as unknown as viewerAuth.ViewerAuthorizationResult);
    vi.spyOn(repositoryDashboard, "loadRepositoryDetail").mockResolvedValue({
      repository: {
        id: "repo-1",
        owner: "acme",
        name: "gateway",
        private: true,
        githubInstallationId: 12345,
        latestRunId: undefined,
        watchedBoards: 0,
        openFindings: 0,
      },
      runs: [],
      supplyFindings: [],
      boards: [
        {
          id: "bad-path",
          displayName: "Missing source",
          projectPath: "../secrets",
          archived: false,
          latestBom: {
            commitSha: "b".repeat(40),
            runCommitSha: "b".repeat(40),
            runId: "run-b",
            componentCount: 1,
            capturedAt: "2026-10-11T00:00:00Z",
          },
        },
      ],
    } as unknown as Awaited<ReturnType<typeof repositoryDashboard.loadRepositoryDetail>>);
    const html = renderToStaticMarkup(await RepositoryPage({ params: Promise.resolve({ repositoryId: "repo-1" }) }));
    expect(html).toContain('href="/runs/run-b"');
    expect(html).not.toContain("Open project at this commit");
    expect(html).not.toContain("https://github.com/acme/gateway/blob/");
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
