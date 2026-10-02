import { describe, expect, it } from "vitest";
import nextConfig from "../../../apps/web/next.config.mjs";

async function globalSecurityHeaders(): Promise<Map<string, string>> {
  const entries = await nextConfig.headers();
  const global = entries.find((entry) => entry.source === "/:path*");
  expect(global).toBeDefined();
  return new Map((global?.headers ?? []).map((header) => [header.key.toLowerCase(), header.value]));
}

describe("browser security headers", () => {
  it("defines the baseline once for every route", async () => {
    const headers = await globalSecurityHeaders();

    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(headers.get("permissions-policy")).toBe("camera=(), geolocation=(), microphone=(), usb=()");
  });

  it("uses CSP as the authoritative frame restriction without broad resource directives", async () => {
    const headers = await globalSecurityHeaders();
    const csp = headers.get("content-security-policy");

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("default-src");
    expect(csp).not.toContain("script-src");
  });

  it("keeps the framework identity header disabled", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
