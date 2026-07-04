import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGitHubSignatureHeader,
  resolveLocalArtifactPath,
  verifyGitHubWebhook,
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
