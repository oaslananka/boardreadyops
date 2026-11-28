import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { loadDashboard, viewer, authorizeRepository, filters, resolveTitle } = vi.hoisted(() => ({
  loadDashboard: vi.fn(),
  resolveTitle: vi.fn(),
  viewer: vi.fn(),
  authorizeRepository: vi.fn(async () => true),
  filters: vi.fn((query: Record<string, string>) => ({
    findingSearch: query.findingSearch,
    artifactSearch: query.artifactSearch,
  })),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({ viewerAuthorization: viewer }));
vi.mock("../../../apps/web/lib/run-dashboard.js", () => ({
  loadRunDashboard: loadDashboard,
  resolveRunPageTitle: resolveTitle,
  runDashboardLoaderDependencies: {},
}));
vi.mock("../../../apps/web/components/run-investigation.js", () => ({
  filtersFromSearchParameters: filters,
  RunUnavailable: ({ runId }: { runId: string }) => `Unavailable ${runId}`,
  RunPageFrame: ({
    active,
    signedIn,
    liveRefresh,
    children,
  }: {
    active: string;
    signedIn: boolean;
    liveRefresh: boolean;
    children: ReactNode;
  }) =>
    createElement(
      "main",
      { "data-view": active, "data-session": String(signedIn), "data-refresh": String(liveRefresh) },
      children,
    ),
  FindingsView: ({ signedIn, searchParameters }: { signedIn: boolean; searchParameters: Record<string, string> }) =>
    `Finding session=${signedIn} search=${searchParameters.findingSearch}`,
  ArtifactsView: ({ searchParameters }: { searchParameters: Record<string, string> }) =>
    `Artifact search=${searchParameters.artifactSearch}`,
}));

import ArtifactsPage, {
  generateMetadata as artifactsMetadata,
} from "../../../apps/web/app/runs/[runId]/artifacts/page.js";
import FindingsPage, {
  generateMetadata as findingsMetadata,
} from "../../../apps/web/app/runs/[runId]/findings/page.js";

afterEach(() => {
  vi.clearAllMocks();
  viewer.mockReset();
  loadDashboard.mockReset();
  resolveTitle.mockReset();
});

const pages = [
  ["findings", FindingsPage, findingsMetadata, "Findings"],
  ["artifacts", ArtifactsPage, artifactsMetadata, "Artifacts"],
] as const;
const query = { findingSearch: "mpn", artifactSearch: "bom" };
const props = () => ({ params: Promise.resolve({ runId: "run-1" }), searchParams: Promise.resolve(query) });

describe.each(pages)("%s filtered run route", (active, Page, metadata, section) => {
  it("passes the request authorizer to the route-specific title lookup", async () => {
    viewer.mockResolvedValueOnce({ authorizeRepository, session: undefined });
    resolveTitle.mockResolvedValueOnce("Safe run title");
    expect(await metadata(props())).toEqual({ title: "Safe run title" });
    expect(resolveTitle).toHaveBeenCalledWith("run-1", section, authorizeRepository);
  });

  it.each([false, true])("keeps the request authorizer, filters, session and refresh state (%s)", async (signedIn) => {
    viewer.mockResolvedValueOnce({ authorizeRepository, session: signedIn ? { login: "fixture" } : undefined });
    loadDashboard.mockResolvedValueOnce({ state: "found", run: { id: "run-1", investigationState: "current" } });
    const html = renderToStaticMarkup(await Page(props()));
    expect(viewer).toHaveBeenCalledTimes(1);
    expect(filters).toHaveBeenCalledWith(query);
    expect(loadDashboard).toHaveBeenCalledWith(
      "run-1",
      process.env,
      { findingSearch: "mpn", artifactSearch: "bom" },
      { authorizeRepository },
    );
    expect(html).toContain(`data-view="${active}"`);
    expect(html).toContain(`data-session="${signedIn}"`);
    expect(html).toContain('data-refresh="true"');
    expect(html).toContain(active === "findings" ? `Finding session=${signedIn} search=mpn` : "Artifact search=bom");
  });

  it("preserves unavailable and inaccessible outcomes", async () => {
    viewer.mockResolvedValue({ authorizeRepository, session: undefined });
    loadDashboard.mockResolvedValueOnce({ state: "not-configured" }).mockResolvedValueOnce({ state: "not-found" });
    expect(renderToStaticMarkup(await Page(props()))).toBe("Unavailable run-1");
    await expect(Page(props())).rejects.toThrow("not-found");
  });
});
