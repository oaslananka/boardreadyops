import { describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "../../../apps/web/app/mcp/route.js";
import {
  protectedResourceMetadata,
  remoteFootprintFacts,
  remoteMcpMetadataUrl,
  remoteMcpResource,
  remoteReviewFacts,
} from "../../../apps/web/lib/remote-mcp-foundation.js";

const sha40 = "a".repeat(40);
const sha64 = "b".repeat(64);

const sourceSummary = {
  schemaVersion: 1,
  scope: "pcb-footprints-only",
  provenance: "local-git-commits",
  disclosure: "counts-and-digests-only",
  baseCommitSha: sha40,
  headCommitSha: sha40,
  baseBlobSha: sha40,
  headBlobSha: sha40,
  baseSourceSha256: sha64,
  headSourceSha256: sha64,
  changes: {
    added: 1,
    removed: 0,
    modified: 1,
    byField: { reference: 1, libraryId: 0, layer: 0, positionMm: 0, rotationDeg: 0 },
  },
  riskAssessment: "not-evaluated",
} as const;

describe("remote MCP foundation - deny by default", () => {
  it("does not expose any MCP method even with a bearer token or a browser session", async () => {
    for (const [method, handler] of [
      ["GET", GET],
      ["POST", POST],
      ["DELETE", DELETE],
    ] as const) {
      const request = new Request(remoteMcpResource, {
        method,
        headers: {
          authorization: "Bearer should-never-be-trusted",
          cookie: "brops_session=untrusted",
          host: "evil.test",
        },
      });
      const response = handler(request);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(await response.json())).not.toContain("token");
    }
  });

  it("uses a fixed OAuth resource identity rather than untrusted Host or Forwarded headers", () => {
    expect(remoteMcpResource).toBe("https://boardreadyops.com/mcp");
    expect(remoteMcpMetadataUrl).toBe("https://boardreadyops.com/.well-known/oauth-protected-resource/mcp");
    expect(protectedResourceMetadata("https://id.boardreadyops.com")).toEqual({
      resource: remoteMcpResource,
      authorization_servers: ["https://id.boardreadyops.com"],
      scopes_supported: ["review:read", "evidence:read"],
      bearer_methods_supported: ["header"],
    });
  });

  it.each([
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com#fragment",
    "https://example.com?redirect=https://evil.test",
    "https://example.com/\nX-Fake: ok",
    "not-a-url",
  ])("rejects untrusted OAuth issuer %s", (issuer) => {
    expect(() => protectedResourceMetadata(issuer)).toThrow();
  });

  it("omits free text, untrusted paths and raw CAD fields from review summaries", () => {
    const data = {
      status: "active" as const,
      decision: "pending" as const,
      evidenceDigest: sha64,
      headCommitSha: sha40,
      title: "Confidential Project",
      path: "/secrets/board.kicad_pcb",
      source: "(kicad_pcb secret)",
    };
    const result = remoteReviewFacts(data);
    expect(result).toEqual({
      schemaVersion: 1,
      status: "active",
      decision: "pending",
      evidenceDigest: sha64,
      headCommitSha: sha40,
      productionApproval: "not-evaluated",
    });
  });

  it("distinguishes unavailable evidence from unchanged PCB and rejects extra private fields", () => {
    expect(remoteFootprintFacts(null)).toEqual({ availability: "unavailable", riskAssessment: "not-evaluated" });
    expect(remoteFootprintFacts(sourceSummary)).toEqual({ availability: "client-reported", summary: sourceSummary });
    expect(() => remoteFootprintFacts({ ...sourceSummary, pcb: "secret" })).toThrow();
    expect(() => remoteFootprintFacts({ ...sourceSummary, riskAssessment: "pass" })).toThrow();
  });
});
