import { describe, expect, it, vi } from "vitest";
import {
  ComponentIntelligenceCredentialError,
  createNexarComponentIntelligenceProvider,
  nexarLifecycleStatus,
} from "../../../packages/cloud-core/src/nexar-component-intelligence.js";

const now = new Date("2026-08-25T12:00:00.000Z");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function part(
  mpn: string,
  lifecycle: string,
  manufacturer?: string,
  sellers?: {
    isAuthorized?: boolean;
    offers?: { prices?: { quantity?: number; price?: number; currency?: string }[] }[];
  }[],
) {
  return {
    mpn,
    ...(manufacturer ? { manufacturer: { name: manufacturer } } : {}),
    specs: [
      { attribute: { shortname: "lifecyclestatus" }, displayValue: lifecycle },
      { attribute: { shortname: "rohs" }, displayValue: "Compliant" },
    ],
    ...(sellers ? { sellers } : {}),
  };
}

/** A fetch stub that answers the token endpoint first, then the GraphQL endpoint. */
function stubFetch(
  graphql: (body: unknown) => Response,
  token: Response = jsonResponse({ access_token: "t", expires_in: 3600 }),
) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (new URL(String(url)).hostname === "identity.nexar.com") return token;
    return graphql(JSON.parse(String(init?.body ?? "{}")));
  }) as unknown as typeof globalThis.fetch;
}

function provider(fetchImpl: typeof globalThis.fetch) {
  return createNexarComponentIntelligenceProvider({
    clientId: "client",
    clientSecret: "secret",
    fetch: fetchImpl,
    now: () => now,
  });
}

describe("nexar lifecycle mapping", () => {
  it("maps the documented vocabulary", () => {
    expect(nexarLifecycleStatus("Production")).toBe("active");
    expect(nexarLifecycleStatus("New")).toBe("active");
    expect(nexarLifecycleStatus("NRND")).toBe("nrnd");
    expect(nexarLifecycleStatus("EOL")).toBe("eol");
    expect(nexarLifecycleStatus("Obsolete")).toBe("obsolete");
  });

  it("treats an unfamiliar or missing status as unknown rather than healthy", () => {
    // Reporting a board clean on the strength of a value nobody has read is the failure to
    // avoid; unknown is dropped by the caller instead.
    expect(nexarLifecycleStatus("Preliminary")).toBe("unknown");
    expect(nexarLifecycleStatus(undefined)).toBe("unknown");
    expect(nexarLifecycleStatus("")).toBe("unknown");
  });
});

describe("nexar component intelligence", () => {
  it("encodes the licence limits as its cache policy", () => {
    const nexar = provider(stubFetch(() => jsonResponse({ data: { supMultiMatch: [] } })));

    // §1.2(vi) caps retention at 24h; §1.1/§1.2(i) make the licence non-transferable.
    expect(nexar.cachePolicy.maximumCacheAgeMs).toBe(24 * 60 * 60 * 1000);
    expect(nexar.cachePolicy.shareableAcrossTenants).toBe(false);
  });

  it("returns an observation per matched part", async () => {
    const nexar = provider(
      stubFetch(() =>
        jsonResponse({
          data: {
            supMultiMatch: [
              { reference: "0", parts: [part("STM32F103C8T6", "EOL")] },
              { reference: "1", parts: [part("RC0603FR-0710KL", "Production")] },
            ],
          },
        }),
      ),
    );

    const observed = await nexar.lookup([{ mpn: "STM32F103C8T6" }, { mpn: "RC0603FR-0710KL" }]);

    expect(observed).toEqual([
      { mpn: "STM32F103C8T6", status: "eol", source: "nexar", observedAt: now, distributorClassification: "unknown" },
      {
        mpn: "RC0603FR-0710KL",
        status: "active",
        source: "nexar",
        observedAt: now,
        distributorClassification: "unknown",
      },
    ]);
  });

  it("omits a part it could not identify rather than calling it unknown", async () => {
    const nexar = provider(stubFetch(() => jsonResponse({ data: { supMultiMatch: [{ reference: "0", parts: [] }] } })));

    // "We did not find it" must stay distinguishable from "its state is unknown".
    expect(await nexar.lookup([{ mpn: "MYSTERY-1" }])).toEqual([]);
  });

  it("answers for the manufacturer the BOM named, not whichever part came back first", async () => {
    const nexar = provider(
      stubFetch(() =>
        jsonResponse({
          data: {
            supMultiMatch: [
              {
                reference: "0",
                parts: [part("LM339", "Obsolete", "Acme Clone"), part("LM339", "Production", "Texas Instruments")],
              },
            ],
          },
        }),
      ),
    );

    const observed = await nexar.lookup([{ mpn: "LM339", manufacturer: "Texas Instruments" }]);

    // Attaching one vendor's obsolescence to another's part would be a false alarm on a board
    // that is fine.
    expect(observed).toEqual([
      {
        mpn: "LM339",
        manufacturer: "Texas Instruments",
        status: "active",
        source: "nexar",
        observedAt: now,
        distributorClassification: "unknown",
      },
    ]);
  });

  it("drops a named manufacturer with no matching part instead of guessing", async () => {
    const nexar = provider(
      stubFetch(() =>
        jsonResponse({
          data: { supMultiMatch: [{ reference: "0", parts: [part("LM339", "Obsolete", "Acme Clone")] }] },
        }),
      ),
    );

    expect(await nexar.lookup([{ mpn: "LM339", manufacturer: "Texas Instruments" }])).toEqual([]);
  });

  it("reuses the access token across lookups until it expires", async () => {
    const fetchImpl = stubFetch(() => jsonResponse({ data: { supMultiMatch: [] } }));
    const nexar = provider(fetchImpl);

    await nexar.lookup([{ mpn: "A" }]);
    await nexar.lookup([{ mpn: "B" }]);

    const tokenCalls = vi
      .mocked(fetchImpl)
      .mock.calls.filter(([url]) => new URL(String(url)).hostname === "identity.nexar.com");
    expect(tokenCalls).toHaveLength(1);
  });

  it("raises a credential error when the token endpoint refuses the client", async () => {
    const nexar = provider(stubFetch(() => jsonResponse({}), jsonResponse({ error: "invalid_client" }, 401)));

    await expect(nexar.lookup([{ mpn: "A" }])).rejects.toBeInstanceOf(ComponentIntelligenceCredentialError);
  });

  it("raises a credential error when the API refuses the token", async () => {
    const nexar = provider(stubFetch(() => jsonResponse({ message: "forbidden" }, 403)));

    await expect(nexar.lookup([{ mpn: "A" }])).rejects.toBeInstanceOf(ComponentIntelligenceCredentialError);
  });

  it("distinguishes a transient failure from a rejected credential", async () => {
    const nexar = provider(stubFetch(() => jsonResponse({ message: "bad gateway" }, 502)));

    // The caller records a rejection only for the credential case; treating an outage as a
    // revoked key would make customers re-enter a secret that still works.
    const failure = await nexar.lookup([{ mpn: "A" }]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ComponentIntelligenceCredentialError);
  });

  it("surfaces GraphQL errors even though they arrive with HTTP 200", async () => {
    const nexar = provider(stubFetch(() => jsonResponse({ errors: [{ message: "quota exceeded" }] })));

    await expect(nexar.lookup([{ mpn: "A" }])).rejects.toThrow(/errors/u);
  });

  it("never puts the client secret in an error message", async () => {
    const nexar = provider(stubFetch(() => jsonResponse({}), jsonResponse({ error: "invalid_client: secret" }, 400)));

    const failure = await nexar.lookup([{ mpn: "A" }]).catch((error: unknown) => error);
    // Token endpoints commonly reflect submitted credentials back in their error bodies.
    expect(String(failure)).not.toContain("secret");
  });

  it("splits a large part list into bounded requests", async () => {
    const fetchImpl = stubFetch(() => jsonResponse({ data: { supMultiMatch: [] } }));
    const nexar = provider(fetchImpl);

    await nexar.lookup(Array.from({ length: 45 }, (_, index) => ({ mpn: `PART-${index}` })));

    const graphqlCalls = vi
      .mocked(fetchImpl)
      .mock.calls.filter(([url]) => new URL(String(url)).hostname === "api.nexar.com");
    expect(graphqlCalls).toHaveLength(3);
  });

  it("makes no request at all for an empty part list", async () => {
    const fetchImpl = stubFetch(() => jsonResponse({}));

    expect(await provider(fetchImpl).lookup([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to construct with an incomplete credential", () => {
    const fetchImpl = stubFetch(() => jsonResponse({}));

    expect(() =>
      createNexarComponentIntelligenceProvider({ clientId: " ", clientSecret: "secret", fetch: fetchImpl }),
    ).toThrow(ComponentIntelligenceCredentialError);
  });
});

describe("nexar distributor classification and pricing", () => {
  it("classifies a part with an authorized seller as authorized-distributor", async () => {
    const nexar = provider(
      stubFetch(() =>
        jsonResponse({
          data: {
            supMultiMatch: [
              {
                reference: "0",
                parts: [part("STM32F103C8T6", "Production", undefined, [{ isAuthorized: true, offers: [] }])],
              },
            ],
          },
        }),
      ),
    );

    const observed = await nexar.lookup([{ mpn: "STM32F103C8T6" }]);
    expect(observed[0]?.distributorClassification).toBe("authorized-distributor");
  });

  it("classifies a part with only unauthorized sellers as marketplace", async () => {
    const nexar = provider(
      stubFetch(() =>
        jsonResponse({
          data: {
            supMultiMatch: [
              {
                reference: "0",
                parts: [part("STM32F103C8T6", "Production", undefined, [{ isAuthorized: false, offers: [] }])],
              },
            ],
          },
        }),
      ),
    );

    const observed = await nexar.lookup([{ mpn: "STM32F103C8T6" }]);
    expect(observed[0]?.distributorClassification).toBe("marketplace");
  });

  it("classifies a part with a mix of authorized and marketplace sellers as authorized-distributor", async () => {
    // Any authorized channel means the part is not confined to the grey market, which is the
    // question this classification exists to answer.
    const nexar = provider(
      stubFetch(() =>
        jsonResponse({
          data: {
            supMultiMatch: [
              {
                reference: "0",
                parts: [
                  part("STM32F103C8T6", "Production", undefined, [
                    { isAuthorized: false, offers: [] },
                    { isAuthorized: true, offers: [] },
                  ]),
                ],
              },
            ],
          },
        }),
      ),
    );

    const observed = await nexar.lookup([{ mpn: "STM32F103C8T6" }]);
    expect(observed[0]?.distributorClassification).toBe("authorized-distributor");
  });

  it("reports unknown -- not a guess -- when Nexar returns no seller data at all", async () => {
    const nexar = provider(
      stubFetch(() =>
        jsonResponse({
          data: { supMultiMatch: [{ reference: "0", parts: [part("STM32F103C8T6", "Production")] }] },
        }),
      ),
    );

    const observed = await nexar.lookup([{ mpn: "STM32F103C8T6" }]);
    expect(observed[0]?.distributorClassification).toBe("unknown");
  });

  it("reports unknown when sellers are present but none carry the isAuthorized signal", async () => {
    // Ambiguous/unclassifiable case: Nexar returned seller data, but not the specific field
    // this classification depends on. Reported honestly rather than defaulted either way.
    const nexar = provider(
      stubFetch(() =>
        jsonResponse({
          data: {
            supMultiMatch: [
              { reference: "0", parts: [part("STM32F103C8T6", "Production", undefined, [{ offers: [] }])] },
            ],
          },
        }),
      ),
    );

    const observed = await nexar.lookup([{ mpn: "STM32F103C8T6" }]);
    expect(observed[0]?.distributorClassification).toBe("unknown");
  });

  it("captures quantity-price tier breaks with their currency from the seller's offers", async () => {
    const nexar = provider(
      stubFetch(() =>
        jsonResponse({
          data: {
            supMultiMatch: [
              {
                reference: "0",
                parts: [
                  part("STM32F103C8T6", "Production", undefined, [
                    {
                      isAuthorized: true,
                      offers: [
                        {
                          prices: [
                            { quantity: 1, price: 2.5, currency: "USD" },
                            { quantity: 100, price: 1.9, currency: "USD" },
                          ],
                        },
                      ],
                    },
                  ]),
                ],
              },
            ],
          },
        }),
      ),
    );

    const observed = await nexar.lookup([{ mpn: "STM32F103C8T6" }]);
    expect(observed[0]?.priceBreaks).toEqual([
      { quantity: 1, price: 2.5, currency: "USD" },
      { quantity: 100, price: 1.9, currency: "USD" },
    ]);
  });

  it("prefers an authorized seller's pricing over a marketplace seller's when both are present", async () => {
    const nexar = provider(
      stubFetch(() =>
        jsonResponse({
          data: {
            supMultiMatch: [
              {
                reference: "0",
                parts: [
                  part("STM32F103C8T6", "Production", undefined, [
                    { isAuthorized: false, offers: [{ prices: [{ quantity: 1, price: 9.99, currency: "USD" }] }] },
                    { isAuthorized: true, offers: [{ prices: [{ quantity: 1, price: 2.5, currency: "USD" }] }] },
                  ]),
                ],
              },
            ],
          },
        }),
      ),
    );

    const observed = await nexar.lookup([{ mpn: "STM32F103C8T6" }]);
    expect(observed[0]?.priceBreaks).toEqual([{ quantity: 1, price: 2.5, currency: "USD" }]);
  });

  it("omits priceBreaks rather than reporting an empty list when no seller carries priced offers", async () => {
    const nexar = provider(
      stubFetch(() =>
        jsonResponse({
          data: {
            supMultiMatch: [
              {
                reference: "0",
                parts: [part("STM32F103C8T6", "Production", undefined, [{ isAuthorized: true, offers: [] }])],
              },
            ],
          },
        }),
      ),
    );

    const observed = await nexar.lookup([{ mpn: "STM32F103C8T6" }]);
    expect(observed[0]?.priceBreaks).toBeUndefined();
  });

  it("drops a price entry missing quantity, price, or currency rather than reporting a partial tier", async () => {
    const nexar = provider(
      stubFetch(() =>
        jsonResponse({
          data: {
            supMultiMatch: [
              {
                reference: "0",
                parts: [
                  part("STM32F103C8T6", "Production", undefined, [
                    {
                      isAuthorized: true,
                      offers: [
                        {
                          prices: [
                            { quantity: 1, price: 2.5, currency: "USD" },
                            { quantity: 10, price: 2.1 }, // no currency
                          ],
                        },
                      ],
                    },
                  ]),
                ],
              },
            ],
          },
        }),
      ),
    );

    const observed = await nexar.lookup([{ mpn: "STM32F103C8T6" }]);
    expect(observed[0]?.priceBreaks).toEqual([{ quantity: 1, price: 2.5, currency: "USD" }]);
  });
});
