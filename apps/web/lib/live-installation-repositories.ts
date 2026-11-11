import { createAppAuth } from "@octokit/auth-app";

/** Current GitHub App grants, not historical rows. GitHub can omit removed
 * repositories when changing an installation from all to selected. */
export type LiveInstallationRepositoryDependencies = {
  mintToken(installationId: number, environment: Readonly<Record<string, string | undefined>>): Promise<string | null>;
  fetcher: (url: string, init: RequestInit) => Promise<Response>;
};

const perPage = 100;
const maximumPages = 50;
const maximumInstallations = 20;
const apiRoot = "https://api.github.com";

const productionDependencies: LiveInstallationRepositoryDependencies = {
  async mintToken(installationId, environment) {
    const appId = environment.GITHUB_APP_ID?.trim();
    const privateKey = environment.GITHUB_APP_PRIVATE_KEY?.replaceAll(String.raw`\n`, "\n").trim();
    if (!appId || !privateKey) return null;
    const authorize = createAppAuth({ appId, privateKey, installationId });
    const auth = await authorize({ type: "installation" });
    return auth.token || null;
  },
  fetcher: fetch,
};

/** Bounded, no-redirect API response. A partial page cannot grant access. */
async function readPage(response: Response): Promise<{ totalCount: number; ids: number[] } | null> {
  if (!response.ok || !response.body) return null;
  const maxBytes = 1_500_000;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = response.body.getReader();
  let bytes = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.byteLength;
  }
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const payload = parsed as { total_count?: unknown; repositories?: unknown };
  if (!Number.isSafeInteger(payload.total_count) || Number(payload.total_count) < 0) return null;
  if (!Array.isArray(payload.repositories) || payload.repositories.length > perPage) return null;
  const ids = payload.repositories.map((repo: unknown) => {
    if (!repo || typeof repo !== "object") return null;
    const id = (repo as { id?: unknown }).id;
    return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
  });
  if (ids.some((id) => id === null)) return null;
  return { totalCount: Number(payload.total_count), ids: ids as number[] };
}

/** A page-scoped and bounded grant read; callers must never use partial results. */
async function readInstallationGrants(
  installationId: number,
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: LiveInstallationRepositoryDependencies,
): Promise<number[] | null> {
  const token = await dependencies.mintToken(installationId, environment);
  if (!token) return null;
  const ids: number[] = [];
  let total: number | undefined;
  for (let page = 1; page <= maximumPages; page++) {
    const response = await dependencies.fetcher(
      `${apiRoot}/installation/repositories?per_page=${perPage}&page=${page}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2026-03-10",
        },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(7_000),
      },
    );
    const parsed = await readPage(response);
    if (!parsed || (total !== undefined && parsed.totalCount !== total)) return null;
    total = parsed.totalCount;
    ids.push(...parsed.ids);
    if (ids.length === total) return ids;
    if (parsed.ids.length !== perPage || ids.length > total) return null;
  }
  return null;
}

/** null: could not verify GitHub grants => fail closed. []: genuinely no repos. */
export async function resolveLiveInstallationRepositoryIds(
  installationIds: readonly number[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: LiveInstallationRepositoryDependencies = productionDependencies,
): Promise<number[] | null> {
  const configuredApi = environment.GITHUB_API_BASE_URL?.trim();
  if (configuredApi && configuredApi !== apiRoot && configuredApi !== `${apiRoot}/`) return null;
  const installations = [...new Set(installationIds)];
  if (installations.length > maximumInstallations || installations.some((id) => !Number.isSafeInteger(id) || id <= 0))
    return null;
  if (installations.length === 0) return [];
  if (!environment.GITHUB_APP_ID?.trim() || !environment.GITHUB_APP_PRIVATE_KEY?.trim()) return null;

  const all = new Set<number>();
  try {
    for (const installationId of installations) {
      const grants = await readInstallationGrants(installationId, environment, dependencies);
      if (grants === null) return null;
      for (const id of grants) all.add(id);
    }
    return [...all];
  } catch {
    return null;
  }
}
