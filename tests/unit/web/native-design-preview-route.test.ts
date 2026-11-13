import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorizeViewer, loadRun, loadNativeSvg } = vi.hoisted(() => ({
  authorizeViewer: vi.fn(),
  loadRun: vi.fn(),
  loadNativeSvg: vi.fn(),
}));
vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({ viewerAuthorization: authorizeViewer }));
vi.mock("../../../apps/web/lib/run-dashboard.js", () => ({
  loadRunDashboard: loadRun,
  runDashboardLoaderDependencies: {},
}));
vi.mock("../../../apps/web/lib/run-design-snapshots.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../apps/web/lib/run-design-snapshots.js")>()),
  loadRunNativeDesignPreview: loadNativeSvg,
}));

import { GET } from "../../../apps/web/app/runs/[runId]/preview/route.js";
import { RealDesignEvidencePanel } from "../../../apps/web/components/real-design-evidence-panel.js";

const { loadRunNativeDesignPreview: queryNativePreview } = await vi.importActual<
  typeof import("../../../apps/web/lib/run-design-snapshots.js")
>("../../../apps/web/lib/run-design-snapshots.js");

const runId = "c4ff45b2-a3e6-4732-8551-045db1de5965";
const repoId = "d4ff45b2-a3e6-4732-8551-045db1de5965";
const ctx = { params: Promise.resolve({ runId }) };
function request(kind = "pcb") {
  return new Request(`https://boardreadyops.test/runs/${runId}/preview?kind=${kind}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  authorizeViewer.mockResolvedValue({ session: { login: "owner" }, authorizeRepository: vi.fn(async () => true) });
  loadRun.mockResolvedValue({ state: "found", run: { repositoryId: repoId } });
  loadNativeSvg.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"></svg>');
});

describe("authorized native-only design thumbnail", () => {
  it("never fetches a Run or SVG for malformed parameters or signed-out users", async () => {
    expect((await GET(request(), { params: Promise.resolve({ runId: "not-a-run" }) })).status).toBe(404);
    expect((await GET(request("script"), ctx)).status).toBe(400);
    authorizeViewer.mockResolvedValueOnce({ session: undefined });
    expect((await GET(request(), ctx)).status).toBe(401);
    expect(loadRun).not.toHaveBeenCalled();
    expect(loadNativeSvg).not.toHaveBeenCalled();
  });

  it("denies another tenant's private Run before asking for artwork", async () => {
    loadRun.mockResolvedValueOnce({ state: "not-found" });
    const result = await GET(request(), ctx);
    expect(result.status).toBe(404);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(loadNativeSvg).not.toHaveBeenCalled();
    expect(loadRun.mock.calls[0]?.[3]).toHaveProperty("authorizeRepository");
  });

  it("fails closed for missing native art, missing persistence or unexpected provider errors", async () => {
    loadRun.mockResolvedValueOnce({ state: "not-configured" });
    expect((await GET(request(), ctx)).status).toBe(503);
    loadNativeSvg.mockResolvedValueOnce(undefined);
    expect((await GET(request("schematic"), ctx)).status).toBe(404);
    loadNativeSvg.mockRejectedValueOnce(new Error("private database URL"));
    const result = await GET(request(), ctx);
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("private database URL");
  });

  it("serves one bounded real SVG as a private sandboxed, no-cache same-origin image", async () => {
    const result = await GET(request(), ctx);
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toContain("image/svg+xml");
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("vary")).toBe("Cookie");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(result.headers.get("content-security-policy")).toContain("sandbox");
    expect(await result.text()).toContain("<svg");
    expect(loadNativeSvg).toHaveBeenCalledWith(runId, repoId, "pcb_layer");
  });
});

describe("single-snapshot query boundary", () => {
  it("queries only the exact Run/repository/kind, prefers F.Cu, closes DB and rejects unsafe SVG", async () => {
    const query = vi.fn(async () => ({ rows: [{ content: '<svg viewBox="0 0 10 10"></svg>' }] }));
    const close = vi.fn(async () => {});
    const open = vi.fn(() => ({ query, close }));
    const result = await queryNativePreview(runId, repoId, "pcb_layer", { DATABASE_URL: "postgres://test" }, open);
    expect(result).toContain("<svg");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("r.repository_id = $2"), [runId, repoId, "pcb_layer"]);
    expect(String(query.mock.calls[0]?.[0])).toContain("left(s.name, 13) = 'kicad_native_'");
    expect(String(query.mock.calls[0]?.[0])).toContain("F.Cu");
    expect(close).toHaveBeenCalledOnce();
    query.mockResolvedValueOnce({ rows: [{ content: '<svg onload="alert(1)"></svg>' }] });
    expect(
      await queryNativePreview(runId, repoId, "schematic", { DATABASE_URL: "postgres://test" }, open),
    ).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("does not open DB without config and returns no image when no published plot exists", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const close = vi.fn(async () => {});
    const open = vi.fn(() => ({ query, close }));
    expect(await queryNativePreview(runId, repoId, "pcb_layer", {}, open)).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(
      await queryNativePreview(runId, repoId, "pcb_layer", { DATABASE_URL: "postgres://test" }, open),
    ).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("Dashboard/Projects native-evidence entry point", () => {
  it("puts real image links before descriptive text; never embeds full private SVG in HTML", () => {
    const html = renderToStaticMarkup(
      createElement(RealDesignEvidencePanel, {
        evidence: {
          runId,
          repositoryId: repoId,
          repository: "owner/source-pcb",
          hasPcb: true,
          hasSchematic: true,
          hasNativePcb: true,
          hasNativeSchematic: true,
        },
      }),
    );
    expect(html).toContain(`/runs/${runId}/preview?kind=pcb`);
    expect(html).toContain(`/runs/${runId}/preview?kind=schematic`);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("Actual source-bound KiCad design previews");
    expect(html.indexOf(`preview?kind=pcb`)).toBeLessThan(html.indexOf("Explore your actual PCB"));
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("data:image/svg+xml");
  });

  it("keeps metadata-only historical evidence as text, not a broken/fake native thumbnail", () => {
    const html = renderToStaticMarkup(
      createElement(RealDesignEvidencePanel, {
        evidence: {
          runId,
          repositoryId: repoId,
          repository: "owner/legacy",
          hasPcb: true,
          hasSchematic: false,
        },
      }),
    );
    expect(html).not.toContain("preview?kind=");
    expect(html).toContain("Inspect real design");
  });
});
