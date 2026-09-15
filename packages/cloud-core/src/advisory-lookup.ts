/**
 * Asks OSV and NVD about the identifiers a run reported.
 *
 * The one thing this module must never do is let three different outcomes collapse into one.
 * Measured against both live APIs:
 *
 *   OSV, unknown package      200 `{}`                        -- answered, nothing found
 *   OSV, malformed purl       400 `{"code":3,"message":...}`   -- refused, nothing searched
 *   NVD, version with no CVE  200 `{"totalResults":0,...}`     -- answered, nothing found
 *   NVD, malformed cpe        404, empty body                  -- refused, nothing searched
 *
 * An empty list is a real answer. A rejection or an outage is not, and reporting either as
 * "no advisories found" is the false clean bill that #786, #790 and #793 were built to prevent,
 * reproduced one level up where it would be laundered through a regulator-facing report.
 *
 * So the result is a discriminated union and every caller has to handle all three. Part of #755.
 */

export type Advisory = {
  /** The database's own identifier, such as `GO-2024-2799` or `CVE-2025-66409`. */
  id: string;
  /** Other identifiers for the same advisory; the CVE is usually here for an OSV record. */
  aliases: readonly string[];
  /** Severity as the source states it, when it states one. Not normalised across sources. */
  severity?: string | undefined;
  source: "osv" | "nvd";
  url?: string | undefined;
};

export type AdvisoryLookupOutcome =
  /** The database answered. An empty list means checked, and nothing found. */
  | { status: "answered"; advisories: readonly Advisory[] }
  /**
   * The database refused the query: a malformed or unrecognised identifier.
   *
   * Never "clean", because nothing was searched. Distinct from `unavailable` because a rejection
   * will not fix itself on retry and points at the identifier rather than at the network.
   */
  | { status: "rejected"; reason: string }
  /** The database could not be reached, or rate-limited us. Never "clean"; retry later. */
  | { status: "unavailable"; reason: string };

export type AdvisoryProvider = {
  /** Looks up a PURL. Only worth calling for a type a database actually indexes. */
  findByPurl(purl: string): Promise<AdvisoryLookupOutcome>;
  /** Looks up a version-exact CPE 2.3 name. A wildcard version is refused rather than sent. */
  findByCpe(cpe: string): Promise<AdvisoryLookupOutcome>;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type AdvisoryProviderOptions = {
  fetch?: FetchLike | undefined;
  osvEndpoint?: string | undefined;
  nvdEndpoint?: string | undefined;
  /**
   * NVD API key.
   *
   * Without one the public rate limit is low enough that a pass over many components will be
   * throttled. That surfaces as `unavailable`, never as a clean answer.
   */
  nvdApiKey?: string | undefined;
  timeoutMs?: number | undefined;
};

const defaultOsvEndpoint = "https://api.osv.dev/v1/query";
const defaultNvdEndpoint = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const defaultTimeoutMs = 20_000;

/**
 * Whether a CPE names one release rather than all of them.
 *
 * A wildcard version matches every release of the product: measured against NVD, that returns 31
 * CVEs for esp-idf where the exact version 5.2.1 returns 2 and 6.1 returns 0. So a wildcard is
 * not a weaker query, it is a wrong one. See #797.
 */
export function cpeNamesAnExactVersion(cpe: string): boolean {
  const fields = cpe.trim().split(":");
  if (fields.length < 6 || fields[0]?.toLowerCase() !== "cpe" || fields[1] !== "2.3") return false;
  const version = fields[5];
  return version !== undefined && version !== "*" && version !== "-" && version !== "";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === "string" ? found : undefined;
}

function osvAdvisories(body: unknown): readonly Advisory[] {
  if (typeof body !== "object" || body === null) return [];
  const vulns = (body as { vulns?: unknown }).vulns;
  // Absent entirely on an empty result: the body is literally `{}`. That absence is an answer of
  // "none", not a parse failure, and must not be treated as one.
  if (!Array.isArray(vulns)) return [];

  const advisories: Advisory[] = [];
  for (const entry of vulns) {
    const id = stringField(entry, "id");
    if (id === undefined) continue;
    const aliases = (entry as { aliases?: unknown }).aliases;
    const severity = stringField((entry as { database_specific?: unknown }).database_specific, "severity");
    advisories.push({
      id,
      aliases: Array.isArray(aliases) ? aliases.filter((alias): alias is string => typeof alias === "string") : [],
      ...(severity === undefined ? {} : { severity }),
      source: "osv",
      url: `https://osv.dev/vulnerability/${id}`,
    });
  }
  return advisories;
}

/** Prefers the newest CVSS version NVD reports, since one record may carry several. */
function nvdSeverity(metrics: unknown): string | undefined {
  if (typeof metrics !== "object" || metrics === null) return undefined;
  const bag = metrics as Record<string, unknown>;
  for (const key of ["cvssMetricV40", "cvssMetricV31", "cvssMetricV30", "cvssMetricV2"]) {
    const entries = bag[key];
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const severity = stringField((entries[0] as { cvssData?: unknown })?.cvssData, "baseSeverity");
    if (severity !== undefined) return severity;
  }
  return undefined;
}

function nvdAdvisories(body: unknown): readonly Advisory[] {
  if (typeof body !== "object" || body === null) return [];
  const vulnerabilities = (body as { vulnerabilities?: unknown }).vulnerabilities;
  if (!Array.isArray(vulnerabilities)) return [];

  const advisories: Advisory[] = [];
  for (const entry of vulnerabilities) {
    const cve = (entry as { cve?: unknown })?.cve;
    const id = stringField(cve, "id");
    if (id === undefined) continue;
    const severity = nvdSeverity((cve as { metrics?: unknown }).metrics);
    advisories.push({
      id,
      aliases: [],
      ...(severity === undefined ? {} : { severity }),
      source: "nvd",
      url: `https://nvd.nist.gov/vuln/detail/${id}`,
    });
  }
  return advisories;
}

export function createAdvisoryProvider(options: AdvisoryProviderOptions = {}): AdvisoryProvider {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const osvEndpoint = options.osvEndpoint ?? defaultOsvEndpoint;
  const nvdEndpoint = options.nvdEndpoint ?? defaultNvdEndpoint;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;

  async function request(
    url: string,
    init: RequestInit,
    parse: (body: unknown) => readonly Advisory[],
  ): Promise<AdvisoryLookupOutcome> {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      return { status: "unavailable", reason: describe(error) };
    }

    if (response.status === 400 || response.status === 404) {
      // The identifier itself was refused. Retrying will not help, and nothing was searched.
      return { status: "rejected", reason: `${response.status} ${response.statusText}`.trim() };
    }
    if (!response.ok) {
      // Includes 403 and 429, which is how NVD reports rate limiting. Not an answer either.
      return { status: "unavailable", reason: `${response.status} ${response.statusText}`.trim() };
    }

    try {
      return { status: "answered", advisories: parse(await response.json()) };
    } catch (error) {
      // A 200 we cannot read is not an empty result.
      return { status: "unavailable", reason: `unreadable response: ${describe(error)}` };
    }
  }

  return {
    async findByPurl(purl) {
      if (!purl.trim().toLowerCase().startsWith("pkg:")) {
        return { status: "rejected", reason: "not a package URL" };
      }
      return request(
        osvEndpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package: { purl: purl.trim() } }),
        },
        osvAdvisories,
      );
    },

    async findByCpe(cpe) {
      if (!cpeNamesAnExactVersion(cpe)) {
        return { status: "rejected", reason: "cpe does not name an exact version" };
      }
      return request(
        `${nvdEndpoint}?cpeName=${encodeURIComponent(cpe.trim())}`,
        { method: "GET", headers: options.nvdApiKey === undefined ? {} : { apiKey: options.nvdApiKey } },
        nvdAdvisories,
      );
    },
  };
}
