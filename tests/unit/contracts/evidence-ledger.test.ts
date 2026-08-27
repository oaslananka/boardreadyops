import { calculateEvidenceDigest, canonicalJsonStringify } from "@boardreadyops/contracts";
import { describe, expect, it } from "vitest";

describe("canonicalJsonStringify", () => {
  it("sorts object keys ordinally regardless of insertion order", () => {
    expect(canonicalJsonStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("recurses into nested objects and arrays, sorting keys at every level", () => {
    expect(canonicalJsonStringify({ z: { d: 1, c: 2 }, a: [{ y: 1, x: 2 }] })).toBe(
      '{"a":[{"x":2,"y":1}],"z":{"c":2,"d":1}}',
    );
  });

  it("passes primitives and null straight through JSON.stringify", () => {
    expect(canonicalJsonStringify(null)).toBe("null");
    expect(canonicalJsonStringify(42)).toBe("42");
    expect(canonicalJsonStringify("x")).toBe('"x"');
  });
});

describe("calculateEvidenceDigest", () => {
  it("is order-independent for manifest, decisions, approvals, and checklist entries", () => {
    const manifest = [
      { name: "b.json", path: "b.json", type: "report", sizeBytes: 1, sha256: "b".repeat(64) },
      { name: "a.json", path: "a.json", type: "report", sizeBytes: 1, sha256: "a".repeat(64) },
    ];
    const decisions = [
      {
        fingerprint: "f".repeat(64),
        disposition: "fixed" as const,
        reason: "second",
        owner: "owner-b",
        timestamp: "2026-01-02T00:00:00.000Z",
      },
      {
        fingerprint: "e".repeat(64),
        disposition: "open" as const,
        reason: "first",
        owner: "owner-a",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ];
    const approvals = [
      { approverId: "b", status: "approved" as const, isBreakGlass: false, timestamp: "2026-01-02T00:00:00.000Z" },
      { approverId: "a", status: "approved" as const, isBreakGlass: false, timestamp: "2026-01-01T00:00:00.000Z" },
    ];
    const checklist = [
      { id: "b", title: "second", completed: true },
      { id: "a", title: "first", completed: false },
    ];

    const forward = calculateEvidenceDigest({ manifest, decisions, approvals, checklist });
    const reversed = calculateEvidenceDigest({
      manifest: [...manifest].reverse(),
      decisions: [...decisions].reverse(),
      approvals: [...approvals].reverse(),
      checklist: [...checklist].reverse(),
    });

    expect(forward).toBe(reversed);
    expect(forward).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the digest when a decision's reason changes", () => {
    const decision = {
      fingerprint: "f".repeat(64),
      disposition: "accepted_risk" as const,
      reason: "original reason text long enough",
      owner: "owner-a",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    const base = { manifest: [], decisions: [decision], approvals: [], checklist: [] };
    const changed = {
      ...base,
      decisions: [{ ...decision, reason: "a different reason entirely, also long enough" }],
    };

    expect(calculateEvidenceDigest(base)).not.toBe(calculateEvidenceDigest(changed));
  });
});
