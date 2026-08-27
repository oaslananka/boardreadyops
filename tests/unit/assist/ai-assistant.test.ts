import { afterEach, describe, expect, it } from "vitest";
import { NoOpAiAssistant } from "../../../packages/cloud-core/src/assist/ai-assistant.js";

describe("NoOpAiAssistant", () => {
  const originalFlag = process.env.AI_ASSIST_ENABLED;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.AI_ASSIST_ENABLED;
    else process.env.AI_ASSIST_ENABLED = originalFlag;
  });

  it("is disabled by default per spec, regardless of tenant", () => {
    delete process.env.AI_ASSIST_ENABLED;
    const assistant = new NoOpAiAssistant();
    expect(assistant.enabled("tenant-a")).toBe(false);
  });

  it("refuses to summarize when disabled for the tenant", async () => {
    delete process.env.AI_ASSIST_ENABLED;
    const assistant = new NoOpAiAssistant();
    await expect(
      assistant.summarize({ reviewId: "rev-1", tenantId: "tenant-a", findings: [], comments: [] }),
    ).rejects.toThrow("AI assist is disabled for this tenant");
  });

  it("only summarizes and never returns a gate, waiver, or approval decision", async () => {
    process.env.AI_ASSIST_ENABLED = "true";
    const assistant = new NoOpAiAssistant();
    const result = await assistant.summarize({
      reviewId: "rev-1",
      tenantId: "tenant-a",
      findings: [
        { fingerprint: "fp1", ruleId: "erc.unrouted", message: "unrouted pin" },
        { fingerprint: "fp2", ruleId: "erc.unrouted", message: "unrouted pin" },
      ],
      comments: [],
    });

    expect(result.isProbabilistic).toBe(true);
    expect(result.provider).toBeTruthy();
    expect(result.model).toBeTruthy();
    expect(result.inputDigest).toContain("rev-1");
    expect(Object.keys(result)).not.toContain("decision");
    expect(Object.keys(result)).not.toContain("approved");
  });

  it("flags duplicate-looking findings and brief waiver reasons without deciding anything", async () => {
    process.env.AI_ASSIST_ENABLED = "true";
    const assistant = new NoOpAiAssistant();
    const result = await assistant.summarize({
      reviewId: "rev-1",
      tenantId: "tenant-a",
      findings: [
        { fingerprint: "fp1", ruleId: "erc.unrouted", message: "too short" },
        { fingerprint: "fp2", ruleId: "erc.unrouted", message: "also short" },
      ],
      comments: [],
    });

    expect(result.duplicateGroups).toHaveLength(1);
    expect(result.duplicateGroups[0]?.fingerprints).toEqual(["fp1", "fp2"]);
    expect(result.waiverWarnings.length).toBeGreaterThan(0);
  });
});
