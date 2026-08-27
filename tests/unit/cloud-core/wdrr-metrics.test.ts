import { describe, expect, it } from "vitest";
import {
  allowedProductEvents,
  computeWdrrWeekly,
  isWdrrReady,
  sanitizeProductEventPayload,
} from "../../../packages/cloud-core/src/wdrr-metrics.js";

describe("isWdrrReady", () => {
  const base = {
    baseRunId: "base1",
    headRunId: "head1",
    requiredChecksComplete: true,
    blockerFindingsResolved: true,
    requiredApprovalsPresent: true,
    evidenceRecordProduced: true,
  };

  it("is ready when every condition holds", () => {
    expect(isWdrrReady(base)).toBe(true);
  });

  it("is not ready without a base run (no reproducible diff)", () => {
    const { baseRunId: _omit, ...withoutBase } = base;
    expect(isWdrrReady(withoutBase)).toBe(false);
  });

  it("is not ready when any single gate is false", () => {
    expect(isWdrrReady({ ...base, requiredChecksComplete: false })).toBe(false);
    expect(isWdrrReady({ ...base, blockerFindingsResolved: false })).toBe(false);
    expect(isWdrrReady({ ...base, requiredApprovalsPresent: false })).toBe(false);
    expect(isWdrrReady({ ...base, evidenceRecordProduced: false })).toBe(false);
  });
});

describe("computeWdrrWeekly", () => {
  it("buckets ready reviews into their ISO week (Monday start) and ignores non-ready ones", () => {
    const result = computeWdrrWeekly([
      { createdAt: "2026-08-24T10:00:00Z", wdrrReady: true }, // Monday
      { createdAt: "2026-08-26T10:00:00Z", wdrrReady: true }, // Wednesday, same week
      { createdAt: "2026-08-30T10:00:00Z", wdrrReady: true }, // Sunday, same week (ISO)
      { createdAt: "2026-08-31T10:00:00Z", wdrrReady: true }, // Monday, next week
      { createdAt: "2026-08-25T10:00:00Z", wdrrReady: false }, // not ready, excluded
    ]);

    expect(result).toEqual([
      { weekStart: "2026-08-24", count: 3 },
      { weekStart: "2026-08-31", count: 1 },
    ]);
  });

  it("returns an empty list when nothing is ready", () => {
    expect(computeWdrrWeekly([{ createdAt: "2026-08-24T10:00:00Z", wdrrReady: false }])).toEqual([]);
  });
});

describe("sanitizeProductEventPayload", () => {
  it("strips forbidden PII/content keys and naive email-shaped strings", () => {
    const sanitized = sanitizeProductEventPayload({
      reviewId: "rev_1",
      email: "user@example.test",
      findingMessage: "should be removed",
      commentBody: "should be removed",
      sourcePath: "hardware/main.kicad_sch",
      token: "secret-token",
      secret: "shh",
      contact: "someone@example.test",
      count: 3,
    });

    expect(sanitized).toEqual({ reviewId: "rev_1", count: 3 });
  });

  it("keeps non-PII fields untouched", () => {
    expect(sanitizeProductEventPayload({ status: "approved", severity: "high" })).toEqual({
      status: "approved",
      severity: "high",
    });
  });
});

describe("allowedProductEvents", () => {
  it("is a fixed, content-free event taxonomy", () => {
    expect(allowedProductEvents.has("review_approved")).toBe(true);
    expect(allowedProductEvents.has("something_made_up")).toBe(false);
  });
});
