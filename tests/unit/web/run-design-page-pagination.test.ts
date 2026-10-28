import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { loadDashboard, loadHead, loadBase } = vi.hoisted(() => ({
  loadDashboard: vi.fn(),
  loadHead: vi.fn(async () => []),
  loadBase: vi.fn(async () => []),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({ authorizeRepository: async () => true })),
}));
vi.mock("../../../apps/web/lib/run-dashboard.js", () => ({
  loadRunDashboard: loadDashboard,
  resolveRunPageTitle: vi.fn(async () => "Design"),
  runDashboardLoaderDependencies: {},
}));
vi.mock("../../../apps/web/lib/run-design-snapshots.js", () => ({
  loadRunDesignSnapshots: loadHead,
  loadRunDesignBaseSnapshots: loadBase,
}));
vi.mock("../../../apps/web/components/run-investigation.js", () => ({
  filtersFromSearchParameters: (query: Record<string, string | string[] | undefined>) => {
    const value = Array.isArray(query.findingsPage) ? query.findingsPage[0] : query.findingsPage;
    const page = Number(value);
    return { findingsPage: Number.isSafeInteger(page) && page > 0 ? page : 1 };
  },
  RunPageFrame: ({ children }: { children: unknown }) => children,
  RunUnavailable: () => "Run unavailable",
}));
vi.mock("../../../apps/web/components/run-design-view.js", () => ({
  RunDesignView: ({
    findingsPage,
    findings,
  }: {
    findingsPage?: { page: number; totalPages: number };
    findings: { id: string }[];
  }) =>
    `Page ${findingsPage?.page ?? "missing"} of ${findingsPage?.totalPages ?? "missing"}: ${findings.map((x) => x.id).join(",")}`,
}));

import RunDesignPage from "../../../apps/web/app/runs/[runId]/design/page.js";

describe("run design finding pagination", () => {
  it("uses bounded URL findingsPage and passes authorized run page metadata to the viewer", async () => {
    loadDashboard.mockImplementation(async (_runId, _env, filters) => ({
      state: "ok",
      run: {
        repositoryId: "repo-1",
        repository: "example/hardware",
        commitSha: "a".repeat(40),
        investigationState: "complete",
        findings: [{ id: `page-${filters.findingsPage}` }],
        findingsPage: { page: filters.findingsPage, totalPages: 4, total: 100 },
      },
    }));

    const route = await RunDesignPage({
      params: Promise.resolve({ runId: "run-1" }),
      searchParams: Promise.resolve({ findingsPage: "3" }),
    });
    expect(loadDashboard).toHaveBeenCalledWith(
      "run-1",
      expect.anything(),
      expect.objectContaining({ findingsPage: 3 }),
      expect.anything(),
    );
    expect(loadHead).toHaveBeenCalledWith("run-1", "repo-1");
    expect(loadBase).toHaveBeenCalledWith("run-1", "repo-1");
    const html = renderToStaticMarkup(route);
    expect(html).toContain("Page 3 of 4: page-3");
  });

  it("falls back to the first findings page for a malformed query", async () => {
    loadDashboard.mockImplementation(async (_runId, _env, filters) => ({
      state: "ok",
      run: {
        repositoryId: "repo-1",
        repository: "example/hardware",
        commitSha: "a".repeat(40),
        investigationState: "complete",
        findings: [],
        findingsPage: { page: filters.findingsPage, totalPages: 1, total: 0 },
      },
    }));
    const route = await RunDesignPage({
      params: Promise.resolve({ runId: "run-1" }),
      searchParams: Promise.resolve({ findingsPage: "-12" }),
    });
    expect(renderToStaticMarkup(route)).toContain("Page 1 of 1");
  });
});
