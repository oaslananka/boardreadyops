import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGitHubSignatureHeader,
  createStripeSignatureHeader,
  resolveLocalArtifactPath,
  verifyGitHubWebhook,
  verifyStripeWebhook,
} from "../../../packages/cloud-core/src/index.js";

describe("GitHub webhook verification", () => {
  it("accepts a valid sha256 signature", () => {
    const payload = JSON.stringify({ action: "opened" });
    const secret = "test-secret";
    const signatureHeader = createGitHubSignatureHeader(payload, secret);

    expect(verifyGitHubWebhook({ payload, secret, signatureHeader })).toBe(true);
  });

  it("rejects missing or mismatched signatures", () => {
    const payload = JSON.stringify({ action: "opened" });
    const secret = "test-secret";

    expect(verifyGitHubWebhook({ payload, secret, signatureHeader: null })).toBe(false);
    expect(
      verifyGitHubWebhook({
        payload,
        secret,
        signatureHeader: createGitHubSignatureHeader(payload, "wrong-secret"),
      }),
    ).toBe(false);
  });
});

describe("Stripe webhook verification", () => {
  const payload = JSON.stringify({ type: "checkout.session.completed", id: "evt_test" });
  const secret = "whsec_test_secret";
  const now = 1_756_000_000;

  it("accepts a valid, fresh signature", () => {
    const signatureHeader = createStripeSignatureHeader(payload, secret, now);
    expect(verifyStripeWebhook({ payload, secret, signatureHeader, now })).toBe(true);
  });

  it("rejects a missing signature header", () => {
    expect(verifyStripeWebhook({ payload, secret, signatureHeader: null, now })).toBe(false);
  });

  it("rejects a signature produced with the wrong secret", () => {
    const signatureHeader = createStripeSignatureHeader(payload, "whsec_wrong", now);
    expect(verifyStripeWebhook({ payload, secret, signatureHeader, now })).toBe(false);
  });

  it("rejects a signature over a tampered payload", () => {
    const signatureHeader = createStripeSignatureHeader(payload, secret, now);
    const tamperedPayload = JSON.stringify({ type: "checkout.session.completed", id: "evt_evil" });
    expect(verifyStripeWebhook({ payload: tamperedPayload, secret, signatureHeader, now })).toBe(false);
  });

  it("rejects a timestamp outside the replay tolerance, even with a correct signature", () => {
    const staleTimestamp = now - 301;
    const signatureHeader = createStripeSignatureHeader(payload, secret, staleTimestamp);
    expect(verifyStripeWebhook({ payload, secret, signatureHeader, now })).toBe(false);
  });

  it("accepts a timestamp exactly at the tolerance boundary", () => {
    const boundaryTimestamp = now - 300;
    const signatureHeader = createStripeSignatureHeader(payload, secret, boundaryTimestamp);
    expect(verifyStripeWebhook({ payload, secret, signatureHeader, now })).toBe(true);
  });

  it("respects a custom tolerance", () => {
    const signatureHeader = createStripeSignatureHeader(payload, secret, now - 30);
    expect(verifyStripeWebhook({ payload, secret, signatureHeader, now, toleranceSeconds: 10 })).toBe(false);
  });

  it("accepts a second v1 signature during secret rotation", () => {
    const rotatedSecret = "whsec_rotated";
    const oldSignature = createStripeSignatureHeader(payload, secret, now).split(",")[1];
    const newSignature = createStripeSignatureHeader(payload, rotatedSecret, now).split(",")[1];
    const signatureHeader = `t=${now},${oldSignature},${newSignature}`;

    expect(verifyStripeWebhook({ payload, secret, signatureHeader, now })).toBe(true);
    expect(verifyStripeWebhook({ payload, secret: rotatedSecret, signatureHeader, now })).toBe(true);
  });

  it("rejects a malformed header", () => {
    expect(verifyStripeWebhook({ payload, secret, signatureHeader: "not-a-real-header", now })).toBe(false);
    expect(verifyStripeWebhook({ payload, secret, signatureHeader: "t=abc,v1=deadbeef", now })).toBe(false);
    expect(verifyStripeWebhook({ payload, secret, signatureHeader: `t=${now}`, now })).toBe(false);
  });
});

describe("local artifact path resolution", () => {
  it("keeps artifact keys inside the configured artifact root", () => {
    expect(resolveLocalArtifactPath("artifact-root", "runs/123/report.json")).toMatch(
      new RegExp(`${join("artifact-root", "runs", "123", "report.json").replaceAll("\\", "\\\\")}$`),
    );
  });

  it("rejects traversal outside the configured artifact root", () => {
    expect(() => resolveLocalArtifactPath("/tmp/artifacts", "../secret.txt")).toThrow(/artifact root/i);
  });
});
