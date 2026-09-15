import { describe, expect, it, vi } from "vitest";
import { cpeNamesAnExactVersion, createAdvisoryProvider } from "../../../packages/cloud-core/src/advisory-lookup.js";

/**
 * Every fixture body here was copied from the live APIs, not invented, because the whole point of
 * this module is that three outcomes never collapse into one and the shapes are what separate
 * them. See #755.
 */

function responder(status: number, body: unknown, statusText = "") {
  const fetchMock = vi.fn(
    async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        statusText,
        json: async () => {
          if (body === undefined) throw new Error("Unexpected end of JSON input");
          return body;
        },
      }) as unknown as Response,
  );
  return { provider: createAdvisoryProvider({ fetch: fetchMock }), fetchMock };
}

describe("advisory provider: OSV by PURL", () => {
  it("reads a real advisory, with the CVE as an alias", async () => {
    // Live response for pkg:golang/github.com/mcu-tools/mcuboot.
    const { provider } = responder(200, { vulns: [{ id: "GO-2024-2799", aliases: ["CVE-2024-32883"] }] });

    const outcome = await provider.findByPurl("pkg:golang/github.com/mcu-tools/mcuboot");

    expect(outcome).toEqual({
      status: "answered",
      advisories: [
        {
          id: "GO-2024-2799",
          aliases: ["CVE-2024-32883"],
          source: "osv",
          url: "https://osv.dev/vulnerability/GO-2024-2799",
        },
      ],
    });
  });

  it("treats an empty object as an answer of none, not a parse failure", async () => {
    // OSV returns literally `{}` for an unknown package -- `vulns` is absent, not an empty array.
    const { provider } = responder(200, {});

    const outcome = await provider.findByPurl("pkg:generic/Yageo/RC0603FR-0710KL");

    expect(outcome).toEqual({ status: "answered", advisories: [] });
  });

  it("reports a refused purl as rejected rather than clean", async () => {
    // Live: 400 with {"code":3,"message":"purl scheme is not \"pkg\""}.
    const { provider } = responder(400, { code: 3, message: "bad purl" }, "Bad Request");

    const outcome = await provider.findByPurl("pkg:nonsense");

    // This is the distinction the module exists for. "answered: []" here would be a clean bill
    // for a component nothing looked at.
    expect(outcome.status).toBe("rejected");
  });

  it("rejects a non-purl without spending a request", async () => {
    const { provider, fetchMock } = responder(200, {});

    const outcome = await provider.findByPurl("RC0603FR-0710KL");

    expect(outcome).toEqual({ status: "rejected", reason: "not a package URL" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a network failure as unavailable", async () => {
    const provider = createAdvisoryProvider({
      fetch: async () => {
        throw new Error("getaddrinfo ENOTFOUND api.osv.dev");
      },
    });

    const outcome = await provider.findByPurl("pkg:npm/lodash@4.17.15");

    expect(outcome.status).toBe("unavailable");
    expect(outcome.status === "unavailable" && outcome.reason).toContain("ENOTFOUND");
  });

  it("reports a rate limit as unavailable, never as an empty answer", async () => {
    const { provider } = responder(429, {}, "Too Many Requests");

    // A throttled pass that recorded "no advisories" would quietly mark everything clean.
    expect((await provider.findByPurl("pkg:npm/lodash")).status).toBe("unavailable");
  });

  it("reports an unreadable 200 as unavailable", async () => {
    const { provider } = responder(200, undefined);

    expect((await provider.findByPurl("pkg:npm/lodash")).status).toBe("unavailable");
  });

  it("skips malformed entries instead of failing the whole answer", async () => {
    const { provider } = responder(200, { vulns: [{ noId: true }, { id: "GHSA-real", aliases: "not-an-array" }] });

    const outcome = await provider.findByPurl("pkg:npm/x");

    expect(outcome.status === "answered" && outcome.advisories).toEqual([
      { id: "GHSA-real", aliases: [], source: "osv", url: "https://osv.dev/vulnerability/GHSA-real" },
    ]);
  });
});

describe("advisory provider: NVD by CPE", () => {
  it("reads the severity from the newest CVSS metric present", async () => {
    // Live shape for cpe:2.3:a:espressif:esp-idf:5.2.1 -- CVE-2025-66409 is CRITICAL.
    const { provider } = responder(200, {
      totalResults: 1,
      vulnerabilities: [
        { cve: { id: "CVE-2025-66409", metrics: { cvssMetricV31: [{ cvssData: { baseSeverity: "CRITICAL" } }] } } },
      ],
    });

    const outcome = await provider.findByCpe("cpe:2.3:a:espressif:esp-idf:5.2.1:*:*:*:*:*:*:*");

    expect(outcome.status === "answered" && outcome.advisories).toEqual([
      {
        id: "CVE-2025-66409",
        aliases: [],
        severity: "CRITICAL",
        source: "nvd",
        url: "https://nvd.nist.gov/vuln/detail/CVE-2025-66409",
      },
    ]);
  });

  it("treats zero results as an answer of none", async () => {
    // Live response for esp-idf 6.1: a real, useful "this version is clean".
    const { provider } = responder(200, { resultsPerPage: 0, totalResults: 0, vulnerabilities: [] });

    expect(await provider.findByCpe("cpe:2.3:a:espressif:esp-idf:6.1:*:*:*:*:*:*:*")).toEqual({
      status: "answered",
      advisories: [],
    });
  });

  it("refuses a wildcard version without spending a request", async () => {
    const { provider, fetchMock } = responder(200, { vulnerabilities: [] });

    // NVD answers the open query with 31 CVEs, against 2 for 5.2.1 and 0 for 6.1. Sending it
    // would over-report six to fifteen times -- a false alarm, which is the worse failure
    // because a reader can check it and find it wrong. See #797.
    for (const cpe of [
      "cpe:2.3:a:espressif:esp-idf:*:*:*:*:*:*:*:*",
      "cpe:2.3:a:espressif:esp-idf:-:*:*:*:*:*:*:*",
      "cpe:2.3:a:espressif:esp-idf",
      "not-a-cpe",
    ]) {
      const outcome = await provider.findByCpe(cpe);
      expect(outcome, cpe).toEqual({ status: "rejected", reason: "cpe does not name an exact version" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a refused cpe as rejected", async () => {
    // Live: NVD answers a malformed cpeName with 404 and an empty body.
    const { provider } = responder(404, undefined, "Not Found");

    expect((await provider.findByCpe("cpe:2.3:a:vendor:product:1.0:*:*:*:*:*:*:*")).status).toBe("rejected");
  });

  it("sends the API key as a header when one is configured", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, status: 200, statusText: "", json: async () => ({}) }) as unknown as Response,
    );
    const provider = createAdvisoryProvider({ fetch: fetchMock, nvdApiKey: "secret-key" });

    await provider.findByCpe("cpe:2.3:a:espressif:esp-idf:5.2.1:*:*:*:*:*:*:*");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("cpeName=cpe%3A2.3%3Aa%3Aespressif%3Aesp-idf%3A5.2.1");
    expect((init.headers as Record<string, string>).apiKey).toBe("secret-key");
  });

  it("sends no key header when none is configured", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, status: 200, statusText: "", json: async () => ({}) }) as unknown as Response,
    );
    const provider = createAdvisoryProvider({ fetch: fetchMock });

    await provider.findByCpe("cpe:2.3:a:espressif:esp-idf:5.2.1:*:*:*:*:*:*:*");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({});
  });
});

describe("cpeNamesAnExactVersion", () => {
  it("accepts a version and refuses a wildcard or a malformed name", () => {
    expect(cpeNamesAnExactVersion("cpe:2.3:a:espressif:esp-idf:5.2.1:*:*:*:*:*:*:*")).toBe(true);
    expect(cpeNamesAnExactVersion("CPE:2.3:a:vendor:product:1.0:*:*:*:*:*:*:*")).toBe(true);
    for (const cpe of [
      "cpe:2.3:a:v:p:*:*:*:*:*:*:*:*",
      "cpe:2.3:a:v:p:-:*",
      "cpe:2.2:a:v:p:1.0",
      "",
      "cpe:2.3:a:v:p",
    ]) {
      expect(cpeNamesAnExactVersion(cpe), cpe).toBe(false);
    }
  });
});
