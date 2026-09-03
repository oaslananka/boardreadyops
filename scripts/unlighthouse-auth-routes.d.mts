export interface AuthenticatedRouteManifest {
  site: string;
  generatedAt: string;
  routes: string[];
}

export function isAllowedAuthenticatedPath(pathname: string): boolean;

export function extractHrefPaths(html: string, site: string): string[];

export function buildRepresentativeRoutes(paths: string[]): string[];

export function discoverAuthenticatedRoutes(options: {
  site: string;
  session: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): Promise<AuthenticatedRouteManifest>;
