import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() =>
  vi.fn(async () => ({
    session: { userId: 3, login: "viewer", installationIds: [12] },
  })),
);
const load = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({ viewerAuthorization: auth }));
vi.mock("../../../apps/web/lib/run-listing.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  loadViewerRuns: load,
}));

import { GET } from "../../../apps/web/app/api/v1/runs/route.js";

describe("run-list API live selected repository revocation", () => {
  it("returns private no-store 503 without stale run metadata when GitHub current grants cannot be verified", async () => {
    load.mockResolvedValueOnce({ state: "access-unavailable" });
    const response = await GET(new Request("https://boardreadyops.invalid/api/v1/runs"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      ok: false,
      error: "GitHub repository permissions could not be verified",
    });
  });
});
