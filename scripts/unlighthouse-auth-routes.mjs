const staticAuthenticatedPaths = new Set([
  "/dashboard",
  "/reviews",
  "/settings/billing",
  "/settings/component-intelligence",
  "/settings/data",
  "/settings/security",
  "/settings/tokens",
]);

const seedPaths = [...staticAuthenticatedPaths];
const runSections = ["findings", "artifacts", "attempts", "audit", "publication"];
const dynamicPathPatterns = [
  /^\/repositories\/[^/]+$/u,
  /^\/reviews\/[^/]+$/u,
  new RegExp(`^/runs/[^/]+(?:/(${runSections.join("|")}))?$`, "u"),
];
const sessionPattern = /^[A-Za-z0-9._~-]+$/u;

function normalizePath(pathname) {
  if (pathname === "/") return pathname;
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function isAllowedAuthenticatedPath(pathname) {
  const normalized = normalizePath(pathname);
  return staticAuthenticatedPaths.has(normalized) || dynamicPathPatterns.some((pattern) => pattern.test(normalized));
}

export function extractHrefPaths(html, site) {
  const origin = new URL(site).origin;
  const paths = [];
  const seen = new Set();
  const hrefPattern = /\bhref\s*=\s*["']([^"']+)["']/giu;

  for (const match of html.matchAll(hrefPattern)) {
    const href = match[1].replaceAll("&amp;", "&");
    let url;
    try {
      url = new URL(href, origin);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    const path = normalizePath(url.pathname);
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }

  return paths;
}

function firstMatching(paths, pattern) {
  return paths.find((path) => pattern.test(path));
}

export function buildRepresentativeRoutes(paths) {
  const allowed = paths.filter(isAllowedAuthenticatedPath);
  const staticRoutes = allowed.filter((path) => staticAuthenticatedPaths.has(path));
  const repository = firstMatching(allowed, /^\/repositories\/[^/]+$/u);
  const review = firstMatching(allowed, /^\/reviews\/[^/]+$/u);
  const run = firstMatching(allowed, /^\/runs\/[^/]+$/u);
  const routes = [...staticRoutes];

  if (repository) routes.push(repository);
  if (review) routes.push(review);
  if (run) {
    routes.push(run);
    for (const section of runSections) routes.push(`${run}/${section}`);
  }

  return [...new Set(routes)];
}

function validateSession(session) {
  if (typeof session !== "string" || session.length === 0) throw new Error("BROPS_SESSION is required");
  if (!sessionPattern.test(session)) throw new Error("BROPS_SESSION is invalid");
}

function isAuthenticationFailure(response) {
  return response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400);
}

export async function discoverAuthenticatedRoutes({
  site,
  session,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  validateSession(session);
  const origin = new URL(site).origin;
  const discovered = [];

  for (const path of seedPaths) {
    let response;
    try {
      response = await fetchImpl(new URL(path, origin), {
        headers: { cookie: `brops_session=${session}` },
        redirect: "manual",
      });
    } catch {
      throw new Error(`authenticated route ${path} request failed`);
    }

    if (isAuthenticationFailure(response)) throw new Error(`authentication failed for ${path}`);
    if (response.status === 404 && path !== "/dashboard") continue;
    if (!response.ok) throw new Error(`authenticated route ${path} returned HTTP ${response.status}`);

    discovered.push(path, ...extractHrefPaths(await response.text(), origin));
  }

  return {
    site: origin,
    generatedAt: now().toISOString(),
    routes: buildRepresentativeRoutes(discovered),
  };
}
