import { afterEach, describe, expect, it } from "vitest";
import { applicationHref, isMarketingSurface, marketingRouteAllowed } from "../../../apps/web/lib/marketing-surface.js";
import { proxy } from "../../../apps/web/proxy.js";

const prior = process.env.BOARDREADYOPS_SITE_SURFACE;
afterEach(() => {
  if (prior === undefined) delete process.env.BOARDREADYOPS_SITE_SURFACE;
  else process.env.BOARDREADYOPS_SITE_SURFACE = prior;
});

function request(path: string, method = "GET") {
  const url = `https://public.example.com${path}`;
  return { url, nextUrl: new URL(url), method, headers: new Headers() } as never;
}

describe("opt-in separately deployable marketing surface", () => {
  it("only enables when configured, without changing the default app", () => {
    expect(isMarketingSurface({})).toBe(false);
    expect(isMarketingSurface({ BOARDREADYOPS_SITE_SURFACE: "app" })).toBe(false);
    expect(isMarketingSurface({ BOARDREADYOPS_SITE_SURFACE: "marketing" })).toBe(true);
    expect(applicationHref("/setup", {})).toBe("/setup");
    expect(applicationHref("/setup", { BOARDREADYOPS_SITE_SURFACE: "marketing" })).toBe(
      "https://boardreadyops.com/setup",
    );
    expect(
      applicationHref("/setup", {
        BOARDREADYOPS_SITE_SURFACE: "marketing",
        BOARDREADYOPS_MARKETING_APP_ORIGIN: "https://app.example.com",
      }),
    ).toBe("https://app.example.com/setup");
    expect(() =>
      applicationHref("/setup", {
        BOARDREADYOPS_SITE_SURFACE: "marketing",
        BOARDREADYOPS_MARKETING_APP_ORIGIN: "http://example.com",
      }),
    ).toThrow();
  });

  it("allows only public reads and the liveness endpoint; excludes SaaS and auth APIs", () => {
    for (const path of [
      "/",
      "/index.md",
      "/llms.txt",
      "/robots.txt",
      "/sitemap.xml",
      "/icon",
      "/_next/static/test.js",
      "/demo/example.png",
      "/api/health/live",
    ]) {
      expect(marketingRouteAllowed(path, "GET")).toBe(true);
      expect(marketingRouteAllowed(path, "HEAD")).toBe(true);
      expect(marketingRouteAllowed(path, "POST")).toBe(false);
    }
    for (const path of [
      "/setup",
      "/dashboard",
      "/runs/a",
      "/reviews",
      "/policies",
      "/settings/billing",
      "/api/health",
      "/api/v1/runs",
      "/api/auth/github/login",
      "/api/github/webhook",
      "/.well-known/oauth-authorization-server",
      "/mcp",
      "/openapi.json",
      "/_next/data/123.json",
    ]) {
      expect(marketingRouteAllowed(path, "GET")).toBe(false);
    }
  });

  it("returns genuine 404 before app routing in marketing mode, leaving app mode unchanged", () => {
    process.env.BOARDREADYOPS_SITE_SURFACE = "marketing";
    expect(proxy(request("/api/v1/runs")).status).toBe(404);
    expect(proxy(request("/api/v1/runs", "POST")).status).toBe(404);
    expect(proxy(request("/setup")).status).toBe(404);
    expect(proxy(request("/_next/static/chunk.js")).status).toBe(200);
    expect(proxy(request("/api/health/live")).status).toBe(200);
    process.env.BOARDREADYOPS_SITE_SURFACE = "app";
    expect(proxy(request("/api/v1/runs")).status).toBe(200);
    process.env.BOARDREADYOPS_SITE_SURFACE = "other";
    expect(proxy(request("/")).status).toBe(503);
  });
});
