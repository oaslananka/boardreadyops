import { describe, expect, it, vi } from "vitest";
import { nativeCodeqlDecision, waitForNativeCodeql } from "../../../scripts/verify-native-codeql.mjs";

const SHA = "a".repeat(40);
const nativeCheck = (status: string, conclusion: string | null = null) => ({
  id: 100,
  name: "CodeQL",
  head_sha: SHA,
  status,
  conclusion,
  app: { slug: "github-advanced-security" },
  html_url: "https://github.com/oaslananka/boardreadyops/runs/100",
});

describe("native CodeQL pull request admission", () => {
  it("accepts only a successful first-party check on the exact PR head", () => {
    expect(nativeCodeqlDecision([nativeCheck("completed", "success")], SHA)).toEqual({ state: "success" });
    expect(nativeCodeqlDecision([{ ...nativeCheck("completed", "success"), head_sha: "b".repeat(40) }], SHA)).toEqual({
      state: "pending",
    });
    expect(
      nativeCodeqlDecision([{ ...nativeCheck("completed", "success"), app: { slug: "github-actions" } }], SHA),
    ).toEqual({ state: "pending" });
    expect(nativeCodeqlDecision([nativeCheck("in_progress")], SHA)).toEqual({ state: "pending" });
  });

  it("rejects native failure, skipped, neutral and stale verdicts", () => {
    for (const conclusion of ["failure", "skipped", "neutral", "cancelled", null]) {
      expect(nativeCodeqlDecision([nativeCheck("completed", conclusion)], SHA).state).toBe("failure");
    }
  });

  it("uses the newest matching check and rejects invalid GitHub payloads", () => {
    expect(
      nativeCodeqlDecision(
        [{ ...nativeCheck("completed", "failure"), id: 99 }, nativeCheck("completed", "success")],
        SHA,
      ),
    ).toEqual({ state: "success" });
    expect(() => nativeCodeqlDecision(null, SHA)).toThrow("invalid");
  });

  it("waits for the first-party check instead of turning missing or pending into success", async () => {
    const readChecks = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([nativeCheck("in_progress")])
      .mockResolvedValueOnce([nativeCheck("completed", "success")]);
    const pause = vi.fn();
    await expect(waitForNativeCodeql(readChecks, SHA, { attempts: 3, pause })).resolves.toBeUndefined();
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("fails closed on missing, rejected and inaccessible CodeQL checks", async () => {
    await expect(waitForNativeCodeql(async () => [], SHA, { attempts: 2, pause: () => {} })).rejects.toThrow(
      "missing or incomplete",
    );
    await expect(
      waitForNativeCodeql(async () => [nativeCheck("completed", "failure")], SHA, { pause: () => {} }),
    ).rejects.toThrow("failed (failure)");
    await expect(
      waitForNativeCodeql(
        async () => {
          throw new Error("HTTP 403");
        },
        SHA,
        { pause: () => {} },
      ),
    ).rejects.toThrow("HTTP 403");
  });
});
