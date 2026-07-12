import { describe, expect, it } from "vitest";
import {
  canonicalRunnerRequest,
  normalizeRunnerRequestPath,
  signRunnerRequest,
  verifyRunnerRequestSignature,
} from "../../../packages/cloud-core/src/runner-request-signature.js";
import vector from "../../fixtures/runner-request-signature-v1.json" with { type: "json" };

function vectorRequest() {
  return {
    method: vector.request.method,
    path: vector.request.path,
    timestamp: vector.request.timestamp,
    nonce: vector.request.nonce,
    workerClass: "self_hosted" as const,
    runnerId: vector.request.runnerId,
    body: vector.body,
  };
}

describe("runner request signature protocol v1", () => {
  it("matches the committed Ed25519 canonical request test vector", () => {
    const request = vectorRequest();

    expect(canonicalRunnerRequest(request)).toBe(vector.expectedCanonical);
    expect(signRunnerRequest({ ...request, privateKey: vector.privateKeyPem })).toBe(vector.expectedSignature);
    expect(
      verifyRunnerRequestSignature({
        ...request,
        publicKey: vector.publicKeyPem,
        signature: vector.expectedSignature,
      }),
    ).toBe(true);
  });

  it("binds signatures to the body and normalized request path", () => {
    const request = vectorRequest();

    expect(
      verifyRunnerRequestSignature({
        ...request,
        body: `${request.body} `,
        publicKey: vector.publicKeyPem,
        signature: vector.expectedSignature,
      }),
    ).toBe(false);
    expect(
      verifyRunnerRequestSignature({
        ...request,
        path: "/api/v1/runner/jobs/claim?scope=pcb&z=changed",
        publicKey: vector.publicKeyPem,
        signature: vector.expectedSignature,
      }),
    ).toBe(false);
  });

  it("sorts query pairs and rejects ambiguous application paths", () => {
    expect(normalizeRunnerRequestPath("/claim?z=2&a=3&a=1&empty=")).toBe("/claim?a=1&a=3&empty=&z=2");
    expect(() => normalizeRunnerRequestPath("/api/v1/runner/../admin")).toThrow(/dot segments/i);
    expect(() => normalizeRunnerRequestPath("/api/v1/runner/%2fadmin")).toThrow(/encoded path separators/i);
    expect(() => normalizeRunnerRequestPath("https://example.test/claim")).toThrow(/application path/i);
    expect(() => normalizeRunnerRequestPath("/claim#fragment")).toThrow(/fragment/i);
  });

  it("rejects malformed signatures and canonical fields", () => {
    const request = vectorRequest();

    expect(
      verifyRunnerRequestSignature({
        ...request,
        publicKey: vector.publicKeyPem,
        signature: "not-base64url",
      }),
    ).toBe(false);
    expect(() => canonicalRunnerRequest({ ...request, runnerId: "runner-selected-tenant" })).toThrow(/lowercase UUID/i);
    expect(() => canonicalRunnerRequest({ ...request, nonce: "short" })).toThrow(/nonce/i);
  });
});
