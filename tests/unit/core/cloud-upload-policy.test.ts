import { describe, expect, it } from "vitest";
import { evaluateCloudUploadPolicy } from "../../../src/core/cloud-upload-policy.js";

describe("evaluateCloudUploadPolicy", () => {
  it("denies publish when cloud upload mode is unset, even if token is present", () => {
    const decision = evaluateCloudUploadPolicy({
      uploadMode: undefined,
      hasToken: true,
    });
    expect(decision.shouldPublish).toBe(false);
    expect(decision.reason).toContain("unset");
    expect(decision.allowSnapshots).toBe(false);
    expect(decision.allowSource).toBe(false);
  });

  it("denies publish when token is missing even if mode is set", () => {
    const decision = evaluateCloudUploadPolicy({
      uploadMode: "metadata",
      hasToken: false,
    });
    expect(decision.shouldPublish).toBe(false);
    expect(decision.reason).toContain("BOARDREADYOPS_TOKEN is missing");
  });

  it("allows metadata mode publish when token is present, prohibiting snapshots and source", () => {
    const decision = evaluateCloudUploadPolicy({
      uploadMode: "metadata",
      hasToken: true,
    });
    expect(decision.shouldPublish).toBe(true);
    expect(decision.uploadMode).toBe("metadata");
    expect(decision.allowSnapshots).toBe(false);
    expect(decision.allowSource).toBe(false);
  });

  it("allows snapshots mode publish when token is present, enabling snapshots but prohibiting raw source", () => {
    const decision = evaluateCloudUploadPolicy({
      uploadMode: "snapshots",
      hasToken: true,
    });
    expect(decision.shouldPublish).toBe(true);
    expect(decision.uploadMode).toBe("snapshots");
    expect(decision.allowSnapshots).toBe(true);
    expect(decision.allowSource).toBe(false);
  });

  it("allows source mode publish when token is present, enabling source and snapshots", () => {
    const decision = evaluateCloudUploadPolicy({
      uploadMode: "source",
      hasToken: true,
    });
    expect(decision.shouldPublish).toBe(true);
    expect(decision.uploadMode).toBe("source");
    expect(decision.allowSnapshots).toBe(false);
    expect(decision.allowSource).toBe(true);
  });
});
