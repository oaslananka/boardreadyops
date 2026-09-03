import { describe, expect, it } from "vitest";
import {
  buildRepresentativeRoutes,
  discoverAuthenticatedRoutes,
  extractHrefPaths,
  isAllowedAuthenticatedPath,
} from "../../../scripts/unlighthouse-auth-routes.mjs";

const site = "https://boardreadyops.com";

describe("authenticated Unlighthouse route policy", () => {
  it("extracts only same-origin href paths and removes query strings and fragments", () => {
    const html = `
      <a href="/dashboard?from=home#summary">Dashboard</a>
      <a href="https://boardreadyops.com/runs/run-1/findings?severity=high">Findings</a>
      <a href="https://example.com/runs/run-2">External</a>
      <a href="/reviews?tab=open&amp;sort=desc">Reviews</a>
    `;

    expect(extractHrefPaths(html, site)).toEqual(["/dashboard", "/runs/run-1/findings", "/reviews"]);
  });

  it("allows only explicit signed-in product route families", () => {
    expect(isAllowedAuthenticatedPath("/dashboard")).toBe(true);
    expect(isAllowedAuthenticatedPath("/settings/security")).toBe(true);
    expect(isAllowedAuthenticatedPath("/repositories/repo-123")).toBe(true);
    expect(isAllowedAuthenticatedPath("/reviews/review-123")).toBe(true);
    expect(isAllowedAuthenticatedPath("/runs/run-123/audit")).toBe(true);

    expect(isAllowedAuthenticatedPath("/api/v1/runs")).toBe(false);
    expect(isAllowedAuthenticatedPath("/api/auth/github/login")).toBe(false);
    expect(isAllowedAuthenticatedPath("/runs/run-123/artifacts/file-1/download")).toBe(false);
    expect(isAllowedAuthenticatedPath("/repositories/a/b")).toBe(false);
    expect(isAllowedAuthenticatedPath("/settings/unknown")).toBe(false);
  });

  it("keeps one representative dynamic route and expands the selected run investigation", () => {
    expect(
      buildRepresentativeRoutes([
        "/dashboard",
        "/repositories/repo-1",
        "/repositories/repo-2",
        "/reviews/review-1",
        "/runs/run-1",
        "/runs/run-2",
      ]),
    ).toEqual([
      "/dashboard",
      "/repositories/repo-1",
      "/reviews/review-1",
      "/runs/run-1",
      "/runs/run-1/findings",
      "/runs/run-1/artifacts",
      "/runs/run-1/attempts",
      "/runs/run-1/audit",
      "/runs/run-1/publication",
    ]);
  });
});

describe("authenticated Unlighthouse route discovery", () => {
  it("uses the browser session on every seed request and returns a secret-free manifest", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const session = "session-sentinel-123";
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const body = url.endsWith("/dashboard")
        ? '<a href="/repositories/repo-1">Repo</a><a href="/runs/run-1">Run</a><a href="/reviews/review-1">Review</a>'
        : "<main>authenticated</main>";
      return new Response(body, { status: 200 });
    };

    const manifest = await discoverAuthenticatedRoutes({
      site,
      session,
      fetchImpl,
      now: () => new Date("2026-09-03T04:00:00.000Z"),
    });

    expect(calls.length).toBe(7);
    for (const call of calls) {
      expect(new Headers(call.init?.headers).get("cookie")).toBe(`brops_session=${session}`);
      expect(call.init?.redirect).toBe("manual");
    }

    expect(manifest).toEqual({
      site,
      generatedAt: "2026-09-03T04:00:00.000Z",
      routes: [
        "/dashboard",
        "/reviews",
        "/settings/billing",
        "/settings/component-intelligence",
        "/settings/data",
        "/settings/security",
        "/settings/tokens",
        "/repositories/repo-1",
        "/reviews/review-1",
        "/runs/run-1",
        "/runs/run-1/findings",
        "/runs/run-1/artifacts",
        "/runs/run-1/attempts",
        "/runs/run-1/audit",
        "/runs/run-1/publication",
      ],
    });
    expect(JSON.stringify(manifest)).not.toContain(session);
  });

  it("fails closed when the session is missing", async () => {
    await expect(discoverAuthenticatedRoutes({ site, session: "" })).rejects.toThrow("BROPS_SESSION is required");
  });

  it("rejects authentication redirects without leaking the session", async () => {
    const session = "do-not-log-this-session";
    const fetchImpl = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://github.com/login/oauth/authorize" },
      });

    let message = "";
    try {
      await discoverAuthenticatedRoutes({ site, session, fetchImpl });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("authentication failed for /dashboard");
    expect(message).not.toContain(session);
    expect(message).not.toContain("Cookie:");
  });

  it("skips optional seed pages that return 404 but rejects server failures", async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === "/settings/tokens") return new Response("missing", { status: 404 });
      if (path === "/settings/security") return new Response("broken", { status: 500 });
      return new Response("<main>ok</main>", { status: 200 });
    };

    await expect(discoverAuthenticatedRoutes({ site, session: "valid", fetchImpl })).rejects.toThrow(
      "authenticated route /settings/security returned HTTP 500",
    );
  });
});
