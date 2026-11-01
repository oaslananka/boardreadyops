/**
 * Optional public-only runtime. The same immutable web image can be deployed
 * separately as a marketing service without a database, OAuth keys or worker.
 *
 * This is a surface boundary, not a substitute for customer API authorization.
 */
export function isMarketingSurface(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment.BOARDREADYOPS_SITE_SURFACE === "marketing";
}

const publicPaths = new Set([
  "/",
  "/index.md",
  "/llms.txt",
  "/llms-full.txt",
  "/sitemap.md",
  "/sitemap.xml",
  "/robots.txt",
  "/AGENTS.md",
  "/opengraph-image",
  "/icon",
  "/favicon.ico",
  "/api/health/live",
]);

export function marketingRouteAllowed(pathname: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return publicPaths.has(pathname) || pathname.startsWith("/_next/static/") || pathname.startsWith("/demo/");
}

/** Application links from the separately hosted marketing origin must lead to SaaS. */
export function applicationHref(
  pathname: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (!isMarketingSurface(environment)) return pathname;
  if (!pathname.startsWith("/") || pathname.startsWith("//")) throw new Error("Expected application-relative path");
  const origin = new URL(environment.BOARDREADYOPS_MARKETING_APP_ORIGIN || "https://boardreadyops.com");
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  ) {
    throw new Error("Marketing application origin must be an HTTPS origin");
  }
  return new URL(pathname, origin).href;
}
